package config

import (
	"os"
	"runtime"
	"strconv"
	"strings"
)

type Config struct {
	Port        string
	ModelPath   string
	NumWorkers  int
	OrtLibPath  string
	Device      string // "cpu" or "cuda"
	GPUDeviceID int
}

func Load() Config {
	device := strings.ToLower(strings.TrimSpace(envOr("DEVICE", "cpu")))
	if device != "cpu" && device != "cuda" {
		device = "cpu"
	}

	c := Config{
		Port:        envOr("MLSERVER_PORT", "50051"),
		ModelPath:   envOr("MODEL_PATH", "./models/yolox_voc_m.onnx"),
		NumWorkers:  envInt("MLSERVER_WORKERS", min(runtime.NumCPU(), 4)),
		OrtLibPath:  envOr("ORT_LIB_PATH", ""),
		Device:      device,
		GPUDeviceID: envInt("GPU_DEVICE_ID", 0),
	}

	if c.OrtLibPath == "" && runtime.GOOS == "windows" {
		if device == "cuda" {
			c.OrtLibPath = `C:\onnxruntime-win-x64-gpu-1.24.4\lib\onnxruntime.dll`
		} else {
			c.OrtLibPath = `C:\onnxruntime-win-x64-1.24.4\lib\onnxruntime.dll`
		}
	}

	return c
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func envInt(key string, fallback int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			return n
		}
	}
	return fallback
}
