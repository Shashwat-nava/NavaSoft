package server

import (
	"bytes"
	"context"
	"fmt"
	"image"
	"image/jpeg"
	"image/png"
	"io"
	"log"
	"net/http"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	pb "github.com/shashwatmani201/mlserver/gen/detectionpb"
	"github.com/shashwatmani201/mlserver/internal/model"
)

type DetectionServer struct {
	pb.UnimplementedDetectionServiceServer
	pool *model.WorkerPool
}

func New(pool *model.WorkerPool) *DetectionServer {
	return &DetectionServer{pool: pool}
}

func (s *DetectionServer) Detect(ctx context.Context, req *pb.DetectRequest) (*pb.DetectResponse, error) {
	if len(req.ImageData) == 0 {
		return nil, status.Error(codes.InvalidArgument, "image_data is required")
	}

	img, err := decodeImage(req.ImageData)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "decode image: %v", err)
	}

	confThresh := req.ConfidenceThreshold
	if confThresh <= 0 {
		confThresh = 0.3
	}

	resultCh := make(chan model.InferenceResult, 1)
	s.pool.Submit(&model.InferenceRequest{
		Image:         img,
		ConfThreshold: confThresh,
		Result:        resultCh,
	})

	select {
	case <-ctx.Done():
		return nil, status.Error(codes.Canceled, "request canceled")
	case res := <-resultCh:
		if res.Err != nil {
			return nil, status.Errorf(codes.Internal, "inference: %v", res.Err)
		}
		return buildResponse(res, req.OriginalWidth, req.OriginalHeight), nil
	}
}

func (s *DetectionServer) DetectStream(stream pb.DetectionService_DetectStreamServer) error {
	for {
		req, err := stream.Recv()
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return status.Errorf(codes.Internal, "recv: %v", err)
		}

		resp, err := s.Detect(stream.Context(), req)
		if err != nil {
			log.Printf("stream frame error: %v", err)
			resp = &pb.DetectResponse{}
		}

		if err := stream.Send(resp); err != nil {
			return status.Errorf(codes.Internal, "send: %v", err)
		}
	}
}

func (s *DetectionServer) Health(ctx context.Context, _ *pb.HealthRequest) (*pb.HealthResponse, error) {
	return &pb.HealthResponse{
		Ready:         true,
		ModelName:     "yolox_voc_m",
		ActiveWorkers: int32(s.pool.ActiveWorkers()),
		MaxWorkers:    int32(s.pool.MaxWorkers()),
	}, nil
}

func decodeImage(data []byte) (image.Image, error) {
	ct := http.DetectContentType(data)
	r := bytes.NewReader(data)

	switch ct {
	case "image/jpeg":
		return jpeg.Decode(r)
	case "image/png":
		return png.Decode(r)
	default:
		img, _, err := image.Decode(r)
		if err != nil {
			return nil, fmt.Errorf("unsupported format %q: %w", ct, err)
		}
		return img, nil
	}
}

func buildResponse(res model.InferenceResult, origW, origH int32) *pb.DetectResponse {
	dets := make([]*pb.Detection, 0, len(res.Detections))

	if origW <= 0 || origH <= 0 {
		origW, origH = 640, 640
	}

	// Reconstruct the same letterbox params used during preprocessing
	scaleF := float32(640) / maxf32(float32(origW), float32(origH))
	padX := (640 - float32(origW)*scaleF) / 2
	padY := (640 - float32(origH)*scaleF) / 2

	for _, d := range res.Detections {
		// d.Box = [x, y, w, h] in 640x640 letterbox pixel space
		// Convert to normalized [0, 1] in original image space
		nx := (d.Box[0] - padX) / scaleF / float32(origW)
		ny := (d.Box[1] - padY) / scaleF / float32(origH)
		nw := d.Box[2] / scaleF / float32(origW)
		nh := d.Box[3] / scaleF / float32(origH)

		if nx < 0 {
			nw += nx
			nx = 0
		}
		if ny < 0 {
			nh += ny
			ny = 0
		}
		if nx+nw > 1 {
			nw = 1 - nx
		}
		if ny+nh > 1 {
			nh = 1 - ny
		}
		if nw <= 0 || nh <= 0 {
			continue
		}

		dets = append(dets, &pb.Detection{
			Label:      d.Label,
			Confidence: d.Confidence,
			Box: &pb.BoundingBox{
				X:      nx,
				Y:      ny,
				Width:  nw,
				Height: nh,
			},
		})
	}

	return &pb.DetectResponse{
		Detections:      dets,
		InferenceTimeMs: res.InferenceMs,
	}
}

func maxf32(a, b float32) float32 {
	if a > b {
		return a
	}
	return b
}

// WaitForReady blocks until the server is ready or timeout.
func (s *DetectionServer) WaitForReady(timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if s.pool.MaxWorkers() > 0 {
			return nil
		}
		time.Sleep(100 * time.Millisecond)
	}
	return fmt.Errorf("server not ready within %v", timeout)
}
