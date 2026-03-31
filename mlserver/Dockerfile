FROM golang:1.26-bookworm AS builder

WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=1 GOOS=linux go build -o /mlserver .

FROM nvidia/cuda:12.4.1-cudnn-devel-ubuntu22.04

ARG ONNX_VERSION=1.24.4

# Install cuDNN 9 from NVIDIA's official repository
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    libgomp1 \
    wget \
    && rm -rf /var/lib/apt/lists/*


WORKDIR /app

# Bundle both ONNX Runtime variants (CPU and GPU)
RUN mkdir -p /opt/onnxruntime/cpu /opt/onnxruntime/gpu && \
    wget -q https://github.com/microsoft/onnxruntime/releases/download/v${ONNX_VERSION}/onnxruntime-linux-x64-${ONNX_VERSION}.tgz && \
    tar -xzf onnxruntime-linux-x64-${ONNX_VERSION}.tgz && \
    cp onnxruntime-linux-x64-${ONNX_VERSION}/lib/*.so* /opt/onnxruntime/cpu/ && \
    rm -rf onnxruntime-linux-x64-${ONNX_VERSION}* && \
    wget -q https://github.com/microsoft/onnxruntime/releases/download/v${ONNX_VERSION}/onnxruntime-linux-x64-gpu-${ONNX_VERSION}.tgz && \
    tar -xzf onnxruntime-linux-x64-gpu-${ONNX_VERSION}.tgz && \
    cp onnxruntime-linux-x64-gpu-${ONNX_VERSION}/lib/*.so* /opt/onnxruntime/gpu/ && \
    rm -rf onnxruntime-linux-x64-gpu-${ONNX_VERSION}*

RUN ldconfig

COPY --from=builder /mlserver .
COPY models/ ./models/
COPY entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

ENV MLSERVER_PORT=50051
ENV MLSERVER_WORKERS=2
ENV MODEL_PATH=./models/yolox_voc_m.onnx
ENV DEVICE=auto

EXPOSE 50051

ENTRYPOINT ["./entrypoint.sh"]
CMD ["./mlserver"]
