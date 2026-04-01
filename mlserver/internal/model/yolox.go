package model

import (
	"fmt"
	"image"
	"image/color"
	"log"
	"sort"
	"sync"

	"github.com/fogleman/gg"
	ort "github.com/yalue/onnxruntime_go"
)

var (
	ortOnce     sync.Once
	ortInitErr  error
	initialized bool
)

// Both ort.Session[float32] and ort.AdvancedSession satisfy this.
type ortSession interface {
	Run() error
	Destroy() error
}

type Detection struct {
	Label      string
	Confidence float32
	Box        [4]float32 // x, y, w, h in 640x640 letterbox space
}

type DeviceConfig struct {
	Device      string // "cpu" or "cuda"
	GPUDeviceID int
}

type YOLOXModel struct {
	session ortSession
	input   *ort.Tensor[float32]
	output  *ort.Tensor[float32]
	mu      sync.Mutex
}

func InitORT(libPath string) error {
	ortOnce.Do(func() {
		if libPath != "" {
			ort.SetSharedLibraryPath(libPath)
		}
		if err := ort.InitializeEnvironment(); err != nil {
			ortInitErr = fmt.Errorf("failed to init ORT: %w", err)
			return
		}
		initialized = true
	})
	return ortInitErr
}

func NewYOLOXModel(modelPath string, dc DeviceConfig) (*YOLOXModel, error) {
	if !initialized {
		return nil, fmt.Errorf("ORT not initialized, call InitORT first")
	}

	inputShape := ort.NewShape(1, 3, 640, 640)
	inputTensor, err := ort.NewEmptyTensor[float32](inputShape)
	if err != nil {
		return nil, fmt.Errorf("input tensor: %w", err)
	}

	outputShape := ort.NewShape(1, 8400, 9)
	outputTensor, err := ort.NewEmptyTensor[float32](outputShape)
	if err != nil {
		inputTensor.Destroy()
		return nil, fmt.Errorf("output tensor: %w", err)
	}

	var session ortSession

	if dc.Device == "cuda" {
		session, err = createCUDASession(modelPath, inputTensor, outputTensor, dc.GPUDeviceID)
	} else {
		session, err = createCPUSession(modelPath, inputTensor, outputTensor)
	}
	if err != nil {
		inputTensor.Destroy()
		outputTensor.Destroy()
		return nil, err
	}

	return &YOLOXModel{session: session, input: inputTensor, output: outputTensor}, nil
}

func createCPUSession(modelPath string, input, output *ort.Tensor[float32]) (ortSession, error) {
	opts, err := ort.NewSessionOptions()
	if err != nil {
		return nil, fmt.Errorf("session options: %w", err)
	}
	defer opts.Destroy()

	opts.SetIntraOpNumThreads(4)
	opts.SetInterOpNumThreads(2)
	opts.SetGraphOptimizationLevel(ort.GraphOptimizationLevelEnableAll)

	session, err := ort.NewAdvancedSession(
		modelPath,
		[]string{"images"}, []string{"output"},
		[]ort.Value{input}, []ort.Value{output},
		opts,
	)
	if err != nil {
		return nil, fmt.Errorf("cpu session: %w", err)
	}
	log.Printf("YOLOX session created on CPU")
	return session, nil
}

func createCUDASession(modelPath string, input, output *ort.Tensor[float32], deviceID int) (ortSession, error) {
	opts, err := ort.NewSessionOptions()
	if err != nil {
		return nil, fmt.Errorf("session options: %w", err)
	}
	defer opts.Destroy()

	cudaOpts, err := ort.NewCUDAProviderOptions()
	if err != nil {
		return nil, fmt.Errorf("cuda provider options: %w", err)
	}
	defer cudaOpts.Destroy()

	cudaOpts.Update(map[string]string{
		"device_id": fmt.Sprintf("%d", deviceID),
	})

	if err := opts.AppendExecutionProviderCUDA(cudaOpts); err != nil {
		return nil, fmt.Errorf("append cuda provider: %w", err)
	}

	opts.SetGraphOptimizationLevel(ort.GraphOptimizationLevelEnableAll)

	session, err := ort.NewAdvancedSession(
		modelPath,
		[]string{"images"}, []string{"output"},
		[]ort.Value{input}, []ort.Value{output},
		opts,
	)
	if err != nil {
		return nil, fmt.Errorf("cuda session (device %d): %w", deviceID, err)
	}
	log.Printf("YOLOX session created on CUDA (device %d)", deviceID)
	return session, nil
}

func (m *YOLOXModel) Close() {
	if m.session != nil {
		m.session.Destroy()
	}
	if m.input != nil {
		m.input.Destroy()
	}
	if m.output != nil {
		m.output.Destroy()
	}
}

func (m *YOLOXModel) preprocess(img image.Image) {
	bounds := img.Bounds()
	imgW := float64(bounds.Dx())
	imgH := float64(bounds.Dy())

	dc := gg.NewContext(640, 640)
	dc.SetColor(color.RGBA{R: 114, G: 114, B: 114, A: 255})
	dc.DrawRectangle(0, 0, 640, 640)
	dc.Fill()

	scale := 640.0 / maxf(imgW, imgH)
	newW := imgW * scale
	newH := imgH * scale
	dx := (640 - newW) / 2
	dy := (640 - newH) / 2

	dc.Scale(scale, scale)
	dc.DrawImage(img, int(dx/scale), int(dy/scale))
	dc.Identity()
	resized := dc.Image()

	data := m.input.GetData()
	const wh = 640 * 640

	// NCHW layout, BGR channel order, [0, 255] range
	for y := 0; y < 640; y++ {
		for x := 0; x < 640; x++ {
			r, g, b, _ := resized.At(x, y).RGBA()
			idx := y*640 + x
			data[0*wh+idx] = float32(b >> 8) // B channel
			data[1*wh+idx] = float32(g >> 8) // G channel
			data[2*wh+idx] = float32(r >> 8) // R channel
		}
	}
}

var classNames = []string{"person", "forklift", "head", "helmet"}

func (m *YOLOXModel) Detect(img image.Image, confThreshold float32) ([]Detection, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if confThreshold <= 0 {
		confThreshold = 0.3
	}

	m.preprocess(img)

	if err := m.session.Run(); err != nil {
		return nil, fmt.Errorf("inference: %w", err)
	}

	shape := m.output.GetShape()
	if len(shape) != 3 {
		return nil, fmt.Errorf("unexpected output shape: %v", shape)
	}

	numDetections := int(shape[1])
	numValues := int(shape[2])
	numClasses := numValues - 5
	if numClasses <= 0 {
		return nil, fmt.Errorf("invalid class count: %d", numClasses)
	}

	labels := classNames
	if len(labels) != numClasses {
		log.Printf("model has %d classes, expected %d, using generic names", numClasses, len(labels))
		labels = make([]string, numClasses)
		for i := range labels {
			labels[i] = fmt.Sprintf("class_%d", i)
		}
	}

	data := m.output.GetData()
	const objThresh float32 = 0.5
	perBox := 5 + numClasses

	var detections []Detection
	for i := 0; i < numDetections; i++ {
		base := i * perBox
		objScore := data[base+4]
		if objScore < objThresh {
			continue
		}

		bestClass := 0
		bestScore := float32(0)
		for c := 0; c < numClasses; c++ {
			score := data[base+5+c] * objScore
			if score > bestScore {
				bestScore = score
				bestClass = c
			}
		}
		if bestScore < confThreshold {
			continue
		}

		cx := data[base]
		cy := data[base+1]
		w := data[base+2]
		h := data[base+3]

		detections = append(detections, Detection{
			Label:      labels[bestClass],
			Confidence: bestScore,
			Box:        [4]float32{cx - w/2, cy - h/2, w, h},
		})
	}

	// Remove duplicate overlapping boxes per class; this prevents inflated counts.
	detections = applyClasswiseNMS(detections, 0.45, 300)

	return detections, nil
}

func applyClasswiseNMS(detections []Detection, iouThreshold float32, maxKeep int) []Detection {
	if len(detections) <= 1 {
		return detections
	}

	byLabel := make(map[string][]Detection)
	for _, d := range detections {
		byLabel[d.Label] = append(byLabel[d.Label], d)
	}

	out := make([]Detection, 0, len(detections))
	for _, clsDets := range byLabel {
		kept := nmsDetections(clsDets, iouThreshold, maxKeep)
		out = append(out, kept...)
	}

	sort.Slice(out, func(i, j int) bool {
		return out[i].Confidence > out[j].Confidence
	})
	if maxKeep > 0 && len(out) > maxKeep {
		out = out[:maxKeep]
	}

	return out
}

func nmsDetections(detections []Detection, iouThreshold float32, maxKeep int) []Detection {
	if len(detections) <= 1 {
		return detections
	}

	sort.Slice(detections, func(i, j int) bool {
		return detections[i].Confidence > detections[j].Confidence
	})

	kept := make([]Detection, 0, len(detections))
	for _, d := range detections {
		suppress := false
		for _, k := range kept {
			if boxIoU(d.Box, k.Box) > iouThreshold {
				suppress = true
				break
			}
		}
		if suppress {
			continue
		}
		kept = append(kept, d)
		if maxKeep > 0 && len(kept) >= maxKeep {
			break
		}
	}

	return kept
}

func boxIoU(a, b [4]float32) float32 {
	ax1, ay1 := a[0], a[1]
	ax2, ay2 := a[0]+a[2], a[1]+a[3]
	bx1, by1 := b[0], b[1]
	bx2, by2 := b[0]+b[2], b[1]+b[3]

	ix1 := maxf32(ax1, bx1)
	iy1 := maxf32(ay1, by1)
	ix2 := minf32(ax2, bx2)
	iy2 := minf32(ay2, by2)

	iw := ix2 - ix1
	ih := iy2 - iy1
	if iw <= 0 || ih <= 0 {
		return 0
	}

	inter := iw * ih
	areaA := a[2] * a[3]
	areaB := b[2] * b[3]
	union := areaA + areaB - inter
	if union <= 0 {
		return 0
	}

	return inter / union
}

func minf32(a, b float32) float32 {
	if a < b {
		return a
	}
	return b
}

func maxf32(a, b float32) float32 {
	if a > b {
		return a
	}
	return b
}

func maxf(a, b float64) float64 {
	if a > b {
		return a
	}
	return b
}
