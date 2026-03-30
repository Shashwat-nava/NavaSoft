#!/bin/sh
set -eu

requested_device="${DEVICE:-auto}"
requested_device="$(printf '%s' "$requested_device" | tr '[:upper:]' '[:lower:]')"

has_gpu="false"
if [ -c /dev/nvidiactl ] || [ -c /dev/nvidia0 ]; then
  has_gpu="true"
fi

selected_lib_dir="/opt/onnxruntime/cpu"
selected_device="cpu"

case "$requested_device" in
  cuda)
    if [ "$has_gpu" = "true" ] && [ -f /opt/onnxruntime/gpu/libonnxruntime.so ]; then
      selected_lib_dir="/opt/onnxruntime/gpu"
      selected_device="cuda"
    else
      echo "[mlserver] DEVICE=cuda requested but no GPU detected; falling back to CPU"
    fi
    ;;
  auto)
    if [ "$has_gpu" = "true" ] && [ -f /opt/onnxruntime/gpu/libonnxruntime.so ]; then
      selected_lib_dir="/opt/onnxruntime/gpu"
      selected_device="cuda"
    fi
    ;;
  *)
    selected_lib_dir="/opt/onnxruntime/cpu"
    selected_device="cpu"
    ;;
esac

export DEVICE="$selected_device"
export ORT_LIB_PATH="$selected_lib_dir/libonnxruntime.so"
export LD_LIBRARY_PATH="$selected_lib_dir:${LD_LIBRARY_PATH:-}"

echo "[mlserver] starting with DEVICE=$DEVICE"
exec "$@"
