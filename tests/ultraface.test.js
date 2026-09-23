import test from "node:test";
import assert from "node:assert/strict";
import { decodeUltraface } from "../extension/src/lib/ultraface.js";

test("returns nothing when every confidence is below threshold", () => {
  const scores = Float32Array.from([0.95, 0.05, 0.9, 0.1]);
  const boxes = Float32Array.from([0, 0, 0.5, 0.5, 0.1, 0.1, 0.2, 0.2]);
  assert.deepEqual(decodeUltraface(scores, boxes, 800, 600, 0.6), []);
});

test("scales a normalised box to image pixels", () => {
  const scores = Float32Array.from([0.1, 0.9]);
  const boxes = Float32Array.from([0.25, 0.5, 0.75, 1.0]);
  const out = decodeUltraface(scores, boxes, 800, 600, 0.6);
  assert.equal(out.length, 1);
  assert.deepEqual(
    { x: out[0].x, y: out[0].y, w: out[0].w, h: out[0].h },
    { x: 200, y: 300, w: 400, h: 300 }
  );
});

test("clamps a box that runs past the image edge", () => {
  const scores = Float32Array.from([0.1, 0.9]);
  const boxes = Float32Array.from([-0.1, -0.1, 1.2, 1.2]);
  const out = decodeUltraface(scores, boxes, 100, 100, 0.6);
  assert.deepEqual(
    { x: out[0].x, y: out[0].y, w: out[0].w, h: out[0].h },
    { x: 0, y: 0, w: 100, h: 100 }
  );
});

test("reads the face confidence, not the background one", () => {
  // UltraFace emits [background, face] pairs. Reading index 0 would invert the
  // whole detector: confident background becomes a confident face.
  const scores = Float32Array.from([0.99, 0.01]);
  const boxes = Float32Array.from([0.1, 0.1, 0.2, 0.2]);
  assert.deepEqual(decodeUltraface(scores, boxes, 100, 100, 0.5), []);
});

test("suppresses duplicate detections of one face", () => {
  const scores = Float32Array.from([0.1, 0.9, 0.2, 0.8]);
  const boxes = Float32Array.from([0.1, 0.1, 0.5, 0.5, 0.11, 0.11, 0.51, 0.51]);
  assert.equal(decodeUltraface(scores, boxes, 400, 400, 0.5).length, 1);
});
