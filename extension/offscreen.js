// Runs the pixel work the service worker cannot: MV3 service workers have no
// DOM, no canvas and no WebGPU, so every image operation lives here.

import { decodeUltraface } from "./src/lib/ultraface.js";

// ort.min.js is a classic script loaded by offscreen.html, so it lands on the
// global object rather than as a module import.
ort.env.wasm.wasmPaths = chrome.runtime.getURL("vendor/ort/");

// Reported to the panel: which backend actually ran is a resource-metric fact,
// not a detail. Spec §17.
let activeBackend = "unknown";

let facePromise = null;
function faceSession() {
  if (!facePromise) {
    facePromise = ort.InferenceSession
      .create(chrome.runtime.getURL("models/ultraface-rfb-320.onnx"), {
        executionProviders: ["webgpu", "wasm"]
      })
      .then((s) => {
        activeBackend = navigator.gpu ? "webgpu" : "wasm";
        return s;
      });
  }
  return facePromise;
}

async function decode(dataUrl) {
  const blob = await (await fetch(dataUrl)).blob();
  const bitmap = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0);
  return { canvas, ctx, width: bitmap.width, height: bitmap.height };
}

async function toDataUrl(canvas) {
  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.85 });
  return await new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
}

// Resize into the model's input shape and lay the pixels out as NCHW float32.
// Each model wants its own mean and scale; passing them in keeps one copy of
// this loop rather than one per model.
function toTensor(sourceCanvas, dstW, dstH, mean, scale) {
  const tmp = new OffscreenCanvas(dstW, dstH);
  const tctx = tmp.getContext("2d");
  tctx.drawImage(sourceCanvas, 0, 0, sourceCanvas.width, sourceCanvas.height, 0, 0, dstW, dstH);
  const { data } = tctx.getImageData(0, 0, dstW, dstH);

  const out = new Float32Array(3 * dstW * dstH);
  const plane = dstW * dstH;
  for (let i = 0; i < plane; i++) {
    out[i] = (data[i * 4 + 0] - mean[0]) * scale[0];
    out[plane + i] = (data[i * 4 + 1] - mean[1]) * scale[1];
    out[plane * 2 + i] = (data[i * 4 + 2] - mean[2]) * scale[2];
  }
  return new ort.Tensor("float32", out, [1, 3, dstH, dstW]);
}

async function detectFaces(canvas, width, height) {
  const session = await faceSession();
  const input = toTensor(canvas, 320, 240, [127, 127, 127], [1 / 128, 1 / 128, 1 / 128]);
  const results = await session.run({ [session.inputNames[0]]: input });
  const scores = results.scores.data;
  const boxes = results.boxes.data;
  return decodeUltraface(scores, boxes, width, height, 0.7);
}

const MASK_COLOURS = {
  FACE: "#c0392b",
  DOCUMENT: "#8e44ad",
  SIGNATURE: "#8e44ad"
};

function paintMasks(ctx, masks) {
  // Solid fill, never blur: a blur is reversible in principle, a solid mask is
  // not. Each mask carries its class so the result stays readable to a planner
  // and to a viewer. Spec §10.
  for (const m of masks) {
    ctx.fillStyle = MASK_COLOURS[m.cls] || "#d35400";
    ctx.fillRect(m.x, m.y, m.w, m.h);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 14px system-ui";
    ctx.fillText(`[${m.cls}]`, m.x + 6, m.y + 20);
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type !== "OFFSCREEN_PROCESS") return false;
  (async () => {
    const started = performance.now();
    try {
      const { canvas, ctx, width, height } = await decode(msg.dataUrl);

      const faces = await detectFaces(canvas, width, height);
      const masks = faces.map((f) => ({ x: f.x, y: f.y, w: f.w, h: f.h, cls: "FACE" }));
      paintMasks(ctx, masks);

      sendResponse({
        type: "OFFSCREEN_RESULT",
        width,
        height,
        maskedDataUrl: await toDataUrl(canvas),
        masks,
        backend: activeBackend,
        elapsedMs: Math.round(performance.now() - started)
      });
    } catch (err) {
      // Never answer with a partially processed image: a half-run perception
      // pass means unmasked PII reaching the panel or the wire. Spec §17.
      sendResponse({ type: "OFFSCREEN_ERROR", message: String(err) });
    }
  })();
  return true;
});
