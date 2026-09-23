// Runs the pixel work the service worker cannot: MV3 service workers have no
// DOM, no canvas and no WebGPU, so every image operation lives here.

import { decodeUltraface } from "./src/lib/ultraface.js";
import { boxesFromProbMap } from "./src/lib/dbnet.js";
import { sensitiveRegions, fieldMasks } from "./src/lib/triage.js";
import { contains } from "./src/lib/geometry.js";

// ort.min.js is a classic script loaded by offscreen.html, so it lands on the
// global object rather than as a module import.
ort.env.wasm.wasmPaths = chrome.runtime.getURL("vendor/ort/");

// Single-threaded on purpose. WASM threads need cross-origin isolation, which an
// extension page does not have by default; asking for threads without it makes
// ORT fail to initialise rather than fall back. Spec §13 treats the plain WASM
// path as the real budget anyway.
ort.env.wasm.numThreads = 1;

console.log("[agent] offscreen document ready");

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

let textPromise = null;
function textSession() {
  if (!textPromise) {
    textPromise = ort.InferenceSession.create(
      chrome.runtime.getURL("models/ppocr-det.onnx"),
      { executionProviders: ["webgpu", "wasm"] }
    );
  }
  return textPromise;
}

async function detectFaces(canvas, width, height) {
  const session = await faceSession();
  const input = toTensor(canvas, 320, 240, [127, 127, 127], [1 / 128, 1 / 128, 1 / 128]);
  const results = await session.run({ [session.inputNames[0]]: input });
  return decodeUltraface(results.scores.data, results.boxes.data, width, height, 0.7);
}

// DBNet wants sides that are multiples of 32. 960 keeps a full-HD viewport
// legible while staying inside the latency budget in spec §13. Boxes only —
// Tier 1 reads nothing.
const TEXT_DIM = 960;

async function detectTextRegions(canvas, width, height) {
  const session = await textSession();
  const input = toTensor(canvas, TEXT_DIM, TEXT_DIM,
    [123.675, 116.28, 103.53], [1 / 58.395, 1 / 57.12, 1 / 57.375]);
  const results = await session.run({ [session.inputNames[0]]: input });
  const out = results[session.outputNames[0]];
  const [, , mapH, mapW] = out.dims;
  return boxesFromProbMap(out.data, mapW, mapH, width, height, 0.3);
}

// Colour-coded by family, per spec §10: identity, identifiers, credentials.
const MASK_COLOURS = {
  FACE: "#c0392b",
  DOCUMENT: "#8e44ad",
  SIGNATURE: "#8e44ad",
  AADHAAR: "#d35400",
  PAN: "#d35400",
  CARD: "#d35400",
  PHONE: "#d35400",
  EMAIL: "#d35400",
  DOB: "#d35400",
  NAME: "#d35400",
  ADDRESS: "#d35400",
  PASSWORD: "#1e6f50"
};

// Three sources, one list. A region mask already covering a face makes the
// face's own box redundant — dropping it keeps the count honest, since the
// panel reports the number of masks as evidence.
function assembleMasks(blindBoxes, faces, textBoxes, elements) {
  const regions = sensitiveRegions(blindBoxes, faces, textBoxes, MIN_TEXT_BOXES);
  const loose = faces
    .filter((f) => !regions.some((r) => contains(r, f)))
    .map((f) => ({ x: f.x, y: f.y, w: f.w, h: f.h, cls: "FACE" }));
  return [...regions, ...loose, ...fieldMasks(elements)];
}

// Three boxes of text inside one image is the line between a decorative graphic
// and a document. Low enough to catch an ID card, high enough to leave a logo
// alone — and the failure direction is over-masking either way.
const MIN_TEXT_BOXES = 3;

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

      // Both passes run before anything is painted or answered. A partial
      // perception pass means unmasked PII, so there is no early exit. Spec §17.
      const faces = await detectFaces(canvas, width, height);
      const textBoxes = await detectTextRegions(canvas, width, height);

      const masks = assembleMasks(
        msg.blindBoxes || [],
        faces,
        textBoxes,
        msg.elements || []
      );
      paintMasks(ctx, masks);

      sendResponse({
        type: "OFFSCREEN_RESULT",
        width,
        height,
        maskedDataUrl: await toDataUrl(canvas),
        masks,
        textBoxCount: textBoxes.length,
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
