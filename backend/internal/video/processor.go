package video

import (
	"fmt"

	"gocv.io/x/gocv"
)

type Capture struct {
	cap    *gocv.VideoCapture
	FPS    float64
	Width  int
	Height int
	Total  int
}

func OpenCapture(path string) (*Capture, error) {
	cap, err := gocv.VideoCaptureFile(path)
	if err != nil {
		return nil, fmt.Errorf("open video %s: %w", path, err)
	}
	fps := cap.Get(gocv.VideoCaptureFPS)
	if fps <= 0 {
		fps = 25
	}
	return &Capture{
		cap:    cap,
		FPS:    fps,
		Width:  int(cap.Get(gocv.VideoCaptureFrameWidth)),
		Height: int(cap.Get(gocv.VideoCaptureFrameHeight)),
		Total:  int(cap.Get(gocv.VideoCaptureFrameCount)),
	}, nil
}

func (c *Capture) Read(mat *gocv.Mat) bool {
	return c.cap.Read(mat)
}

func (c *Capture) Close() {
	c.cap.Close()
}

type Writer struct {
	writer *gocv.VideoWriter
}

func NewWriter(path string, fps float64, width, height int) (*Writer, error) {
	w, err := gocv.VideoWriterFile(path, "VP80", fps, width, height, true)
	if err != nil {
		return nil, fmt.Errorf("open video writer %s: %w", path, err)
	}
	return &Writer{writer: w}, nil
}

func (w *Writer) Write(mat gocv.Mat) error {
	return w.writer.Write(mat)
}

func (w *Writer) Close() {
	w.writer.Close()
}

func EncodeJPEG(mat gocv.Mat, quality int) ([]byte, error) {
	buf, err := gocv.IMEncodeWithParams(".jpg", mat, []int{int(gocv.IMWriteJpegQuality), quality})
	if err != nil {
		return nil, err
	}
	defer buf.Close()
	data := make([]byte, buf.Len())
	copy(data, buf.GetBytes())
	return data, nil
}
