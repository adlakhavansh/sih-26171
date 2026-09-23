// Three coordinate spaces are in play (spec §11):
//   CSS pixels      — what getBoundingClientRect returns, per frame
//   device pixels   — what captureVisibleTab produces, scaled by devicePixelRatio
//   frame-local     — nested iframes carry their own origin
// Everything normalises to top-level device-pixel space once, here, at the point
// of collection. Getting this wrong puts masks beside the face instead of on it,
// silently, which is indistinguishable from no mask at all.

export function toDevicePixels(rect, dpr, frameOffset) {
  return {
    x: Math.round((rect.left + frameOffset.x) * dpr),
    y: Math.round((rect.top + frameOffset.y) * dpr),
    w: Math.round(rect.width * dpr),
    h: Math.round(rect.height * dpr)
  };
}

export function area(b) {
  return Math.max(0, b.w) * Math.max(0, b.h);
}

export function intersects(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

export function contains(outer, inner) {
  return inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h;
}
