import test from "node:test";
import assert from "node:assert/strict";
import { boxesFromProbMap } from "../extension/src/lib/dbnet.js";

function blank(w, h) {
  return new Float32Array(w * h);
}

function fill(map, w, x0, x1, y0, y1, v = 0.9) {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) map[y * w + x] = v;
}

test("returns nothing for an empty probability map", () => {
  assert.deepEqual(boxesFromProbMap(blank(20, 20), 20, 20, 200, 200, 0.3), []);
});

test("finds one box around a single blob", () => {
  const map = blank(20, 20);
  fill(map, 20, 3, 12, 5, 10);
  const boxes = boxesFromProbMap(map, 20, 20, 20, 20, 0.3);
  assert.equal(boxes.length, 1);
  assert.deepEqual(boxes[0], { x: 3, y: 5, w: 9, h: 5 });
});

test("separates two disconnected blobs", () => {
  const map = blank(20, 20);
  fill(map, 20, 2, 5, 2, 4);
  fill(map, 20, 14, 18, 12, 15);
  assert.equal(boxesFromProbMap(map, 20, 20, 20, 20, 0.3).length, 2);
});

test("scales boxes from map space to image space", () => {
  const map = blank(10, 10);
  fill(map, 10, 0, 5, 0, 5);
  const boxes = boxesFromProbMap(map, 10, 10, 100, 100, 0.3);
  assert.equal(boxes[0].w, 50);
  assert.equal(boxes[0].h, 50);
});

test("ignores speckle below the minimum pixel count", () => {
  const map = blank(20, 20);
  map[5 * 20 + 5] = 0.9;
  map[5 * 20 + 6] = 0.9;
  assert.deepEqual(boxesFromProbMap(map, 20, 20, 20, 20, 0.3), []);
});

test("respects the threshold", () => {
  const map = blank(20, 20);
  fill(map, 20, 3, 12, 5, 10, 0.25);
  assert.deepEqual(boxesFromProbMap(map, 20, 20, 20, 20, 0.3), []);
  assert.equal(boxesFromProbMap(map, 20, 20, 20, 20, 0.2).length, 1);
});

test("handles a blob touching the map edge without walking off it", () => {
  const map = blank(20, 20);
  fill(map, 20, 0, 4, 0, 4);
  fill(map, 20, 16, 20, 16, 20);
  const boxes = boxesFromProbMap(map, 20, 20, 20, 20, 0.3);
  assert.equal(boxes.length, 2);
});

test("does not overflow the stack on a map that is entirely above threshold", () => {
  const map = new Float32Array(300 * 300).fill(0.9);
  const boxes = boxesFromProbMap(map, 300, 300, 300, 300, 0.3);
  assert.equal(boxes.length, 1);
  assert.deepEqual(boxes[0], { x: 0, y: 0, w: 300, h: 300 });
});
