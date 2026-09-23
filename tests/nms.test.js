import test from "node:test";
import assert from "node:assert/strict";
import { nms } from "../extension/src/lib/nms.js";

test("returns an empty array for no input", () => {
  assert.deepEqual(nms([], 0.5), []);
});

test("keeps the higher-scoring box of an overlapping pair", () => {
  const kept = nms([
    { x: 0, y: 0, w: 100, h: 100, score: 0.9 },
    { x: 10, y: 10, w: 100, h: 100, score: 0.6 }
  ], 0.5);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].score, 0.9);
});

test("keeps both boxes when they do not overlap", () => {
  const kept = nms([
    { x: 0, y: 0, w: 50, h: 50, score: 0.9 },
    { x: 500, y: 500, w: 50, h: 50, score: 0.6 }
  ], 0.5);
  assert.equal(kept.length, 2);
});

test("does not mutate the caller's array", () => {
  const input = [
    { x: 0, y: 0, w: 50, h: 50, score: 0.1 },
    { x: 0, y: 0, w: 50, h: 50, score: 0.9 }
  ];
  nms(input, 0.5);
  assert.equal(input[0].score, 0.1);
});
