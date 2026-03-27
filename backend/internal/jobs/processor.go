package jobs

import (
	"context"
	"encoding/base64"
	"fmt"
	"log"
	"math"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/google/uuid"
	"gocv.io/x/gocv"

	"github.com/shashwatmani201/back/internal/analysis"
	"github.com/shashwatmani201/back/internal/mlclient"
	"github.com/shashwatmani201/back/internal/tracking"
	"github.com/shashwatmani201/back/internal/video"
	"github.com/shashwatmani201/back/internal/ws"
)

const targetFPS = 5

type Job struct {
	ID        string          `json:"id"`
	VideoID   string          `json:"videoId"`
	UserID    int             `json:"userId"`
	VideoPath string          `json:"videoPath"`
	Zones     []analysis.Zone `json:"zones"`
	Metrics   []string        `json:"metrics"`
	Status    string          `json:"status"`
	CreatedAt time.Time       `json:"createdAt"`
}

type Processor struct {
	queue   chan *Job
	ml      *mlclient.Client
	hub     *ws.Hub
	wg      sync.WaitGroup
	ctx     context.Context
	cancel  context.CancelFunc
	workers int
}

func NewProcessor(ml *mlclient.Client, hub *ws.Hub, concurrency int) *Processor {
	if concurrency < 1 {
		concurrency = 2
	}
	ctx, cancel := context.WithCancel(context.Background())
	p := &Processor{
		queue:   make(chan *Job, 256),
		ml:      ml,
		hub:     hub,
		ctx:     ctx,
		cancel:  cancel,
		workers: concurrency,
	}
	for i := 0; i < concurrency; i++ {
		p.wg.Add(1)
		go p.worker(i)
	}
	log.Printf("job processor started with %d workers", concurrency)
	return p
}

func (p *Processor) Submit(job *Job) {
	job.Status = "queued"
	job.CreatedAt = time.Now()
	if job.ID == "" {
		job.ID = uuid.New().String()
	}
	p.queue <- job
}

func (p *Processor) Shutdown() {
	p.cancel()
	close(p.queue)
	p.wg.Wait()
	log.Println("job processor stopped")
}

func (p *Processor) worker(id int) {
	defer p.wg.Done()
	for job := range p.queue {
		if p.ctx.Err() != nil {
			return
		}
		p.process(job)
	}
}

func (p *Processor) process(job *Job) {
	job.Status = "processing"
	log.Printf("job %s: processing video=%s user=%d", job.ID, job.VideoID, job.UserID)

	// Brief wait for the WebSocket subscriber to connect before processing starts
	deadline := time.After(3 * time.Second)
	for !p.hub.HasSubscribers(job.ID) {
		select {
		case <-deadline:
			log.Printf("job %s: proceeding without WebSocket subscriber", job.ID)
			goto startProcessing
		case <-time.After(100 * time.Millisecond):
		}
	}
startProcessing:

	cap, err := video.OpenCapture(job.VideoPath)
	if err != nil {
		log.Printf("job %s: open video: %v", job.ID, err)
		p.hub.SendToJob(job.ID, ws.Message{
			Type:  "error",
			JobID: job.ID,
			Error: fmt.Sprintf("failed to open video: %v", err),
		})
		job.Status = "failed"
		return
	}
	defer cap.Close()

	outPath := filepath.Join("./processed_videos", uuid.New().String()+".webm")
	os.MkdirAll("./processed_videos", 0755)

	writer, err := video.NewWriter(outPath, float64(targetFPS), cap.Width, cap.Height)
	if err != nil {
		log.Printf("job %s: video writer: %v", job.ID, err)
		job.Status = "failed"
		return
	}

	sampleInterval := 1
	if cap.FPS > float64(targetFPS) {
		sampleInterval = int(math.Round(cap.FPS / float64(targetFPS)))
	}

	tracker := tracking.NewTracker()

	mat := gocv.NewMat()
	defer mat.Close()

	rawIdx := 0
	frameIdx := 0

	for cap.Read(&mat) {
		if mat.Empty() || p.ctx.Err() != nil {
			break
		}

		if sampleInterval > 1 && rawIdx%sampleInterval != 0 {
			rawIdx++
			continue
		}
		rawIdx++

		jpegBytes, err := video.EncodeJPEG(mat, 90)
		if err != nil {
			log.Printf("job %s frame %d: encode jpeg: %v", job.ID, frameIdx, err)
			frameIdx++
			continue
		}

		dets, inferMs, err := p.ml.Detect(p.ctx, jpegBytes, cap.Width, cap.Height, 0.3)
		if err != nil {
			log.Printf("job %s frame %d: detect: %v", job.ID, frameIdx, err)
			frameIdx++
			continue
		}

		trackDets := make([]tracking.Detection, len(dets))
		for i, d := range dets {
			trackDets[i] = tracking.Detection{Label: d.Label, Box: d.Box, Confidence: d.Confidence}
		}
		tracks := tracker.Update(trackDets)

		analysisDets := make([]analysis.Detection, len(tracks))
		for i, t := range tracks {
			analysisDets[i] = analysis.Detection{
				Label:      t.Label,
				Confidence: t.Confidence,
				Box:        t.Box,
				TrackID:    t.ID,
				InZone:     false,
			}
		}

		metrics := analysis.AnalyzeFrame(analysisDets, job.Zones, cap.Width, cap.Height)

		annotated := mat.Clone()
		video.DrawDetections(&annotated, analysisDets, job.Zones, cap.Width, cap.Height)

		if err := writer.Write(annotated); err != nil {
			log.Printf("job %s frame %d: write video: %v", job.ID, frameIdx, err)
		}

		var b64Frame string
		if p.hub.HasSubscribers(job.ID) {
			wsBytes, err := video.EncodeJPEG(annotated, 75)
			if err == nil {
				b64Frame = base64.StdEncoding.EncodeToString(wsBytes)
			}
		}
		annotated.Close()

		p.hub.SendToJob(job.ID, ws.Message{
			Type:           "frame",
			JobID:          job.ID,
			FrameIndex:     frameIdx,
			Timestamp:      time.Now().Format("15:04:05"),
			AnnotatedFrame: b64Frame,
			Detections:     analysisDets,
			Metrics: map[string]interface{}{
				"near_miss":      metrics.NearMiss,
				"exposure":       metrics.Exposure,
				"zone_violation": metrics.ZoneViolation,
				"ppe_compliance": metrics.PPECompliant,
				"inference_ms":   inferMs,
			},
		})

		frameIdx++
	}

	writer.Close()

	processedURL := ""
	if frameIdx > 0 {
		processedURL = "/processed_videos/" + filepath.Base(outPath)
	}

	p.hub.SendToJob(job.ID, ws.Message{
		Type:         "complete",
		JobID:        job.ID,
		ProcessedURL: processedURL,
		TotalFrames:  frameIdx,
	})

	job.Status = "completed"
	log.Printf("job %s: completed (%d frames)", job.ID, frameIdx)
}
