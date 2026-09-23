// Non-maximum suppression. A detector fires many times on one face; this keeps
// the best box and drops the rest. Without it a single face becomes a dozen
// overlapping masks, which is harmless for privacy and terrible on camera.

function iou(a, b) {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  if (inter === 0) return 0;
  return inter / (a.w * a.h + b.w * b.h - inter);
}

export function nms(boxes, iouThreshold) {
  const sorted = [...boxes].sort((p, q) => q.score - p.score);
  const kept = [];
  for (const box of sorted) {
    if (kept.some((k) => iou(k, box) > iouThreshold)) continue;
    kept.push(box);
  }
  return kept;
}
