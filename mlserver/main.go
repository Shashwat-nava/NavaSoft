package main

import (
	"log"
	"net"
	"os"
	"os/signal"
	"syscall"

	"google.golang.org/grpc"

	pb "github.com/shashwatmani201/mlserver/gen/detectionpb"
	"github.com/shashwatmani201/mlserver/internal/config"
	"github.com/shashwatmani201/mlserver/internal/model"
	"github.com/shashwatmani201/mlserver/internal/server"
)

func main() {
	cfg := config.Load()

	if err := model.InitORT(cfg.OrtLibPath); err != nil {
		log.Fatalf("onnxruntime init: %v", err)
	}

	dc := model.DeviceConfig{
		Device:      cfg.Device,
		GPUDeviceID: cfg.GPUDeviceID,
	}
	pool, err := model.NewWorkerPool(cfg.ModelPath, cfg.NumWorkers, dc)
	if err != nil {
		log.Fatalf("worker pool: %v", err)
	}

	lis, err := net.Listen("tcp", ":"+cfg.Port)
	if err != nil {
		log.Fatalf("listen: %v", err)
	}

	grpcServer := grpc.NewServer(
		grpc.MaxRecvMsgSize(32*1024*1024), // 32 MB per frame
		grpc.MaxSendMsgSize(8*1024*1024),
	)

	srv := server.New(pool)
	pb.RegisterDetectionServiceServer(grpcServer, srv)

	go func() {
		log.Printf("mlserver listening on :%s  (workers=%d, device=%s, model=%s)", cfg.Port, cfg.NumWorkers, cfg.Device, cfg.ModelPath)
		if err := grpcServer.Serve(lis); err != nil {
			log.Fatalf("grpc serve: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Println("shutting down mlserver...")
	grpcServer.GracefulStop()
	pool.Shutdown()
	log.Println("mlserver stopped")
}
