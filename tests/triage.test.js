import test from "node:test";
import assert from "node:assert/strict";
import { sensitiveRegions, fieldMasks } from "../extension/src/lib/triage.js";

const IMG = { x: 0, y: 0, w: 200, h: 200, kind: "img" };

test("marks a DOM-blind region containing a face", () => {
  const out = sensitiveRegions([IMG], [{ x: 20, y: 20, w: 50, h: 50, score: 0.9 }], [], 3);
  assert.equal(out.length, 1);
  assert.equal(out[0].cls, "FACE");
});

test("marks a DOM-blind region holding enough text boxes", () => {
  const text = [
    { x: 10, y: 10, w: 40, h: 12 },
    { x: 10, y: 30, w: 60, h: 12 },
    { x: 10, y: 50, w: 50, h: 12 }
  ];
  const out = sensitiveRegions([IMG], [], text, 3);
  assert.equal(out.length, 1);
  assert.equal(out[0].cls, "DOCUMENT");
});

test("leaves a region with too little text alone", () => {
  const out = sensitiveRegions([IMG], [], [{ x: 10, y: 10, w: 40, h: 12 }], 3);
  assert.deepEqual(out, []);
});

test("ignores text boxes that fall outside the region", () => {
  const far = [
    { x: 900, y: 10, w: 40, h: 12 },
    { x: 900, y: 30, w: 40, h: 12 },
    { x: 900, y: 50, w: 40, h: 12 }
  ];
  assert.deepEqual(sensitiveRegions([IMG], [], far, 3), []);
});

test("treats a cross-origin iframe area as DOM-blind, not as skipped", () => {
  // No content script answers for a cross-origin frame, so its area arrives here
  // as a blind box. Skipping it would leak; masking it over-masks. Spec §17.
  const frame = { x: 0, y: 0, w: 300, h: 300, kind: "iframe" };
  const out = sensitiveRegions([frame], [{ x: 10, y: 10, w: 40, h: 40, score: 0.9 }], [], 3);
  assert.equal(out.length, 1);
});

test("a face outranks a text count in the same region", () => {
  const text = [
    { x: 10, y: 10, w: 40, h: 12 },
    { x: 10, y: 30, w: 60, h: 12 },
    { x: 10, y: 50, w: 50, h: 12 }
  ];
  const out = sensitiveRegions([IMG], [{ x: 20, y: 20, w: 50, h: 50, score: 0.9 }], text, 3);
  assert.equal(out.length, 1);
  assert.equal(out[0].cls, "FACE");
});

test("masks a filled sensitive field and leaves an ordinary one alone", () => {
  const elements = [
    { id: "e0", inputType: "password", autocompleteToken: "", label: "Portal Password",
      name: "pw", box: { x: 0, y: 0, w: 100, h: 20 }, valuePresent: true },
    { id: "e1", inputType: "text", autocompleteToken: "", label: "Search",
      name: "q", box: { x: 0, y: 40, w: 100, h: 20 }, valuePresent: true }
  ];
  const masks = fieldMasks(elements);
  assert.equal(masks.length, 1);
  assert.equal(masks[0].cls, "PASSWORD");
});

test("does not mask an empty sensitive field", () => {
  const elements = [
    { id: "e0", inputType: "password", autocompleteToken: "", label: "Portal Password",
      name: "pw", box: { x: 0, y: 0, w: 100, h: 20 }, valuePresent: false }
  ];
  assert.deepEqual(fieldMasks(elements), []);
});
