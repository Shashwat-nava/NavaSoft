package model

import (
	"fmt"
	"image"
	"log"
	"sync"
	"sync/atomic"
	"time"
)

type InferenceRequest struct {
	Image         image.Image
	ConfThreshold float32
	Result        chan<- InferenceResult
}

type InferenceResult struct {
	Detections  []Detection
	InferenceMs int32
	Err         error
}

type WorkerPool struct {
	workers []*YOLOXModel
	reqCh   chan *InferenceRequest
	active  atomic.Int32
	size    int
	stopCh  chan struct{}
	wg      sync.WaitGroup
}

func NewWorkerPool(modelPath string, numWorkers int, dc DeviceConfig) (*WorkerPool, error) {
	if numWorkers < 1 {
		numWorkers = 1
	}

	pool := &WorkerPool{
		workers: make([]*YOLOXModel, numWorkers),
		reqCh:   make(chan *InferenceRequest, numWorkers*8),
		size:    numWorkers,
		stopCh:  make(chan struct{}),
	}

	for i := 0; i < numWorkers; i++ {
		m, err := NewYOLOXModel(modelPath, dc)
		if err != nil {
			pool.Shutdown()
			return nil, fmt.Errorf("worker %d: %w", i, err)
		}
		pool.workers[i] = m
	}

	for i := 0; i < numWorkers; i++ {
		pool.wg.Add(1)
		go pool.runWorker(i)
	}

	log.Printf("inference pool started with %d workers", numWorkers)
	return pool, nil
}

func (p *WorkerPool) runWorker(id int) {
	defer p.wg.Done()
	worker := p.workers[id]

	for {
		select {
		case <-p.stopCh:
			return
		case req, ok := <-p.reqCh:
			if !ok {
				return
			}
			p.active.Add(1)
			start := time.Now()
			dets, err := worker.Detect(req.Image, req.ConfThreshold)
			elapsed := time.Since(start)
			p.active.Add(-1)

			req.Result <- InferenceResult{
				Detections:  dets,
				InferenceMs: int32(elapsed.Milliseconds()),
				Err:         err,
			}
		}
	}
}

func (p *WorkerPool) Submit(req *InferenceRequest) {
	p.reqCh <- req
}

func (p *WorkerPool) ActiveWorkers() int {
	return int(p.active.Load())
}

func (p *WorkerPool) MaxWorkers() int {
	return p.size
}

func (p *WorkerPool) Shutdown() {
	close(p.stopCh)
	p.wg.Wait()
	for _, w := range p.workers {
		if w != nil {
			w.Close()
		}
	}
	log.Println("inference pool shut down")
}
