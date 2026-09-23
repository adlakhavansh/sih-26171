// Turns a DBNet probability map into text boxes: threshold it, then find the
// connected components. Finding *where* text is costs a fraction of reading it,
// which is the whole point — Tier 1 never reads a character, and still knows an
// ID card carries text the DOM cannot see.
//
// The flood fill is iterative on purpose. A full-viewport map is ~230k cells,
// and a recursive fill over a mostly-text page overflows the stack.
//
// ponytail: axis-aligned bounding boxes with no unclip step. DBNet's reference
// postprocess expands each contour by a Vatti offset; skipping it under-covers
// text by a pixel or two. Add the real unclip only if measured recall suffers.

const MIN_PIXELS = 4; // below this it is speckle, not text

export function boxesFromProbMap(prob, mapW, mapH, imgW, imgH, threshold) {
  const seen = new Uint8Array(mapW * mapH);
  const boxes = [];
  const stack = [];

  const sx = imgW / mapW;
  const sy = imgH / mapH;

  for (let start = 0; start < prob.length; start++) {
    if (seen[start] || prob[start] < threshold) continue;

    let minX = mapW;
    let minY = mapH;
    let maxX = -1;
    let maxY = -1;
    let pixels = 0;

    stack.push(start);
    seen[start] = 1;

    while (stack.length) {
      const idx = stack.pop();
      const x = idx % mapW;
      const y = (idx - x) / mapW;
      pixels++;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;

      if (x > 0) {
        const n = idx - 1;
        if (!seen[n] && prob[n] >= threshold) { seen[n] = 1; stack.push(n); }
      }
      if (x < mapW - 1) {
        const n = idx + 1;
        if (!seen[n] && prob[n] >= threshold) { seen[n] = 1; stack.push(n); }
      }
      if (y > 0) {
        const n = idx - mapW;
        if (!seen[n] && prob[n] >= threshold) { seen[n] = 1; stack.push(n); }
      }
      if (y < mapH - 1) {
        const n = idx + mapW;
        if (!seen[n] && prob[n] >= threshold) { seen[n] = 1; stack.push(n); }
      }
    }

    if (pixels < MIN_PIXELS) continue;

    boxes.push({
      x: Math.round(minX * sx),
      y: Math.round(minY * sy),
      w: Math.round((maxX - minX + 1) * sx),
      h: Math.round((maxY - minY + 1) * sy)
    });
  }

  return boxes;
}
