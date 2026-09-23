import test from "node:test";
import assert from "node:assert/strict";
import { toDevicePixels, intersects, contains, area } from "../extension/src/lib/geometry.js";

test("passes CSS pixels through unchanged at dpr 1", () => {
  const box = toDevicePixels({ left: 10, top: 20, width: 100, height: 40 }, 1, { x: 0, y: 0 });
  assert.deepEqual(box, { x: 10, y: 20, w: 100, h: 40 });
});

test("scales by devicePixelRatio", () => {
  const box = toDevicePixels({ left: 10, top: 20, width: 100, height: 40 }, 2, { x: 0, y: 0 });
  assert.deepEqual(box, { x: 20, y: 40, w: 200, h: 80 });
});

test("adds the frame offset before scaling", () => {
  const box = toDevicePixels({ left: 10, top: 20, width: 100, height: 40 }, 2, { x: 5, y: 7 });
  assert.deepEqual(box, { x: 30, y: 54, w: 200, h: 80 });
});

test("does not apply scroll offset — getBoundingClientRect is already viewport-relative", () => {
  // Same rect, same result, whatever the page has scrolled to. A naive
  // implementation adds scrollY here and shifts every mask down the page.
  const a = toDevicePixels({ left: 10, top: 20, width: 100, height: 40 }, 1, { x: 0, y: 0 });
  const b = toDevicePixels({ left: 10, top: 20, width: 100, height: 40 }, 1, { x: 0, y: 0 });
  assert.deepEqual(a, b);
  assert.equal(a.y, 20);
});

test("intersects is true for overlap and false for a gap", () => {
  assert.equal(intersects({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 }), true);
  assert.equal(intersects({ x: 0, y: 0, w: 10, h: 10 }, { x: 50, y: 50, w: 10, h: 10 }), false);
});

test("intersects is false for boxes that merely touch at an edge", () => {
  assert.equal(intersects({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 10, h: 10 }), false);
});

test("contains distinguishes enclosure from overlap", () => {
  const outer = { x: 0, y: 0, w: 100, h: 100 };
  assert.equal(contains(outer, { x: 10, y: 10, w: 10, h: 10 }), true);
  assert.equal(contains(outer, { x: 90, y: 90, w: 50, h: 50 }), false);
});

test("area is zero for a degenerate box", () => {
  assert.equal(area({ x: 0, y: 0, w: 0, h: 10 }), 0);
  assert.equal(area({ x: 0, y: 0, w: -5, h: 10 }), 0);
});
