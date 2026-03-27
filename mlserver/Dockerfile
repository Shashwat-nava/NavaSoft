FROM golang:1.26-bookworm AS builder

WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=1 GOOS=linux go build -o /mlserver .

FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates libgomp1 && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /mlserver .
COPY models/ ./models/

ENV MLSERVER_PORT=50051
ENV MLSERVER_WORKERS=2
ENV MODEL_PATH=./models/yolox_voc_m.onnx

EXPOSE 50051

CMD ["./mlserver"]
