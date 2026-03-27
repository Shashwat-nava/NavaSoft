package detectionpb

type BoundingBox struct {
	X      float32 `json:"x,omitempty"`
	Y      float32 `json:"y,omitempty"`
	Width  float32 `json:"width,omitempty"`
	Height float32 `json:"height,omitempty"`
}

type Detection struct {
	Label      string       `json:"label,omitempty"`
	Confidence float32      `json:"confidence,omitempty"`
	Box        *BoundingBox `json:"box,omitempty"`
}

type DetectRequest struct {
	ImageData           []byte  `json:"image_data,omitempty"`
	OriginalWidth       int32   `json:"original_width,omitempty"`
	OriginalHeight      int32   `json:"original_height,omitempty"`
	ConfidenceThreshold float32 `json:"confidence_threshold,omitempty"`
}

type DetectResponse struct {
	Detections      []*Detection `json:"detections,omitempty"`
	InferenceTimeMs int32        `json:"inference_time_ms,omitempty"`
}

type HealthRequest struct{}

type HealthResponse struct {
	Ready         bool   `json:"ready,omitempty"`
	ModelName     string `json:"model_name,omitempty"`
	ActiveWorkers int32  `json:"active_workers,omitempty"`
	MaxWorkers    int32  `json:"max_workers,omitempty"`
}
