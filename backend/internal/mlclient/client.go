package mlclient

import (
	"context"
	"fmt"
	"io"
	"log"
	"sync"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/keepalive"

	pb "github.com/shashwatmani201/back/gen/detectionpb"
)

type Detection struct {
	Label      string     `json:"label"`
	Confidence float64    `json:"confidence"`
	Box        [4]float64 `json:"box"` // x, y, w, h normalized [0, 1]
}

type Client struct {
	conn   *grpc.ClientConn
	client pb.DetectionServiceClient
	mu     sync.RWMutex
	addr   string
}

func New(addr string) (*Client, error) {
	opts := []grpc.DialOption{
		grpc.WithTransportCredentials(insecure.NewCredentials()),
		grpc.WithDefaultCallOptions(
			grpc.MaxCallRecvMsgSize(8*1024*1024),
			grpc.MaxCallSendMsgSize(32*1024*1024),
			grpc.ForceCodec(pb.JSONCodec{}),
		),
		grpc.WithKeepaliveParams(keepalive.ClientParameters{
			Time:                5 * time.Minute,
			Timeout:             20 * time.Second,
			PermitWithoutStream: false,
		}),
	}

	conn, err := grpc.NewClient(addr, opts...)
	if err != nil {
		return nil, fmt.Errorf("dial mlserver %s: %w", addr, err)
	}

	return &Client{
		conn:   conn,
		client: pb.NewDetectionServiceClient(conn),
		addr:   addr,
	}, nil
}

func (c *Client) Close() error {
	return c.conn.Close()
}

// Detect sends raw JPEG bytes to the mlserver and returns detections.
func (c *Client) Detect(ctx context.Context, jpegData []byte, width, height int, confThreshold float32) ([]Detection, int32, error) {
	resp, err := c.client.Detect(ctx, &pb.DetectRequest{
		ImageData:           jpegData,
		OriginalWidth:       int32(width),
		OriginalHeight:      int32(height),
		ConfidenceThreshold: confThreshold,
	})
	if err != nil {
		return nil, 0, fmt.Errorf("rpc detect: %w", err)
	}

	dets := make([]Detection, len(resp.Detections))
	for i, d := range resp.Detections {
		dets[i] = Detection{
			Label:      d.Label,
			Confidence: float64(d.Confidence),
			Box:        [4]float64{float64(d.Box.X), float64(d.Box.Y), float64(d.Box.Width), float64(d.Box.Height)},
		}
	}
	return dets, resp.InferenceTimeMs, nil
}

type StreamFrame struct {
	JpegData      []byte
	Width         int
	Height        int
	ConfThreshold float32
}

type StreamResult struct {
	Detections  []Detection
	InferenceMs int32
}

// DetectStream opens a bidirectional gRPC stream for batch frame processing.
func (c *Client) DetectStream(ctx context.Context) (chan<- StreamFrame, <-chan StreamResult, error) {
	stream, err := c.client.DetectStream(ctx)
	if err != nil {
		return nil, nil, fmt.Errorf("open stream: %w", err)
	}

	inCh := make(chan StreamFrame, 16)
	outCh := make(chan StreamResult, 16)

	go func() {
		defer stream.CloseSend()
		for frame := range inCh {
			if err := stream.Send(&pb.DetectRequest{
				ImageData:           frame.JpegData,
				OriginalWidth:       int32(frame.Width),
				OriginalHeight:      int32(frame.Height),
				ConfidenceThreshold: frame.ConfThreshold,
			}); err != nil {
				log.Printf("stream send: %v", err)
				return
			}
		}
	}()

	go func() {
		defer close(outCh)
		for {
			resp, err := stream.Recv()
			if err == io.EOF {
				return
			}
			if err != nil {
				log.Printf("stream recv: %v", err)
				return
			}
			dets := make([]Detection, len(resp.Detections))
			for i, d := range resp.Detections {
				dets[i] = Detection{
					Label:      d.Label,
					Confidence: float64(d.Confidence),
					Box:        [4]float64{float64(d.Box.X), float64(d.Box.Y), float64(d.Box.Width), float64(d.Box.Height)},
				}
			}
			outCh <- StreamResult{
				Detections:  dets,
				InferenceMs: resp.InferenceTimeMs,
			}
		}
	}()

	return inCh, outCh, nil
}

func (c *Client) HealthCheck(ctx context.Context) (bool, error) {
	resp, err := c.client.Health(ctx, &pb.HealthRequest{})
	if err != nil {
		return false, err
	}
	return resp.Ready, nil
}
