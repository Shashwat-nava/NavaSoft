FROM golang:1.26-bookworm AS builder

WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=1 GOOS=linux go build -o /backend .

FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates ffmpeg && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /backend .

RUN mkdir -p uploads processed_videos

ENV PORT=8080
ENV MLSERVER_ADDR=mlserver:50051
ENV DB_PATH=./nava.db

EXPOSE 8080

CMD ["./backend"]
