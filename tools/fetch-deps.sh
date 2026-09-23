#!/usr/bin/env bash
# Fetches the vendored runtime and models. They are deliberately not in git:
# ~42MB of WASM and ~6MB of ONNX would dominate the repository, and both are
# reproducible from here.
#
# Run from the repository root:  bash tools/fetch-deps.sh
set -euo pipefail

ORT_VERSION="1.30.0"
ORT_DIR="extension/vendor/ort"
MODEL_DIR="extension/models"

mkdir -p "$ORT_DIR" "$MODEL_DIR"

echo "==> ONNX Runtime Web ${ORT_VERSION}"
if [ -f "$ORT_DIR/ort.min.js" ] && [ -f "$ORT_DIR/ort-wasm-simd-threaded.jsep.wasm" ]; then
  echo "    already present, skipping"
else
  tmp="$(mktemp -d)"
  ( cd "$tmp" && npm pack "onnxruntime-web@${ORT_VERSION}" --silent >/dev/null )
  tar -xzf "$tmp/onnxruntime-web-${ORT_VERSION}.tgz" -C "$tmp"
  for f in ort.min.js \
           ort-wasm-simd-threaded.jsep.mjs ort-wasm-simd-threaded.jsep.wasm \
           ort-wasm-simd-threaded.mjs ort-wasm-simd-threaded.wasm; do
    cp "$tmp/package/dist/$f" "$ORT_DIR/"
  done
  rm -rf "$tmp"
  echo "    done"
fi

echo "==> UltraFace RFB-320 (face detection, ~1.2MB)"
if [ -f "$MODEL_DIR/ultraface-rfb-320.onnx" ]; then
  echo "    already present, skipping"
else
  curl -fsSL -o "$MODEL_DIR/ultraface-rfb-320.onnx" \
    "https://github.com/onnx/models/raw/main/validated/vision/body_analysis/ultraface/models/version-RFB-320.onnx"
  echo "    done"
fi

echo "==> PP-OCRv4 text detection (~4.5MB)"
if [ -f "$MODEL_DIR/ppocr-det.onnx" ]; then
  echo "    already present, skipping"
else
  echo "    NOT AUTOMATED — see extension/models/README.md"
fi

echo
echo "Present:"
ls -l "$ORT_DIR" "$MODEL_DIR" | awk '{ if ($5) printf "  %8.2f MB  %s\n", $5/1048576, $9 }'
