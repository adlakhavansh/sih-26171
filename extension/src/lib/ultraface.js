import { nms } from "./nms.js";

// UltraFace emits scores as [background, face] pairs and boxes as normalised
// corners. Both are relative to the model's own 320x240 input, which is a plain
// resize of the full image — so the inverse mapping is a straight multiply with
// no letterbox padding to undo. A model that pads instead of stretching would
// need the padding removed here before scaling; this one does not.

export function decodeUltraface(scores, boxes, imgW, imgH, scoreThreshold) {
  const out = [];
  const count = scores.length / 2;
  for (let i = 0; i < count; i++) {
    const score = scores[i * 2 + 1];
    if (score < scoreThreshold) continue;

    const x1 = Math.max(0, Math.min(1, boxes[i * 4 + 0])) * imgW;
    const y1 = Math.max(0, Math.min(1, boxes[i * 4 + 1])) * imgH;
    const x2 = Math.max(0, Math.min(1, boxes[i * 4 + 2])) * imgW;
    const y2 = Math.max(0, Math.min(1, boxes[i * 4 + 3])) * imgH;

    out.push({
      x: Math.round(x1),
      y: Math.round(y1),
      w: Math.round(x2 - x1),
      h: Math.round(y2 - y1),
      score
    });
  }
  return nms(out, 0.4);
}
