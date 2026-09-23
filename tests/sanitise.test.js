import test from "node:test";
import assert from "node:assert/strict";
import { buildSanitisedContext, isSanitised } from "../extension/src/lib/sanitise.js";

const base = {
  step: 1,
  viewport: { w: 1280, h: 800 },
  elements: [
    {
      id: "e0", role: "input", inputType: "password", autocompleteToken: "",
      label: "Portal Password", name: "pw", box: { x: 0, y: 0, w: 10, h: 10 },
      valuePresent: true, value: "hunter2hunter2"
    },
    {
      id: "e1", role: "input", inputType: "text", autocompleteToken: "",
      label: "Search", name: "q", box: { x: 0, y: 0, w: 10, h: 10 },
      valuePresent: false
    }
  ],
  visualHints: [{ x: 0, y: 0, w: 50, h: 50, cls: "FACE" }],
  screenshotDataUrl: "data:image/jpeg;base64,AAAA",
  goal: "fill the form"
};

test("never emits a raw value field", () => {
  const ctx = buildSanitisedContext(base);
  assert.equal(JSON.stringify(ctx).includes("hunter2"), false);
  for (const el of ctx.elements) {
    assert.equal("value" in el, false);
  }
});

test("reports a filled sensitive field as redacted, not as its contents", () => {
  const ctx = buildSanitisedContext(base);
  assert.equal(ctx.elements[0].valueClass, "redacted");
  assert.equal(ctx.elements[0].piiClass, "PASSWORD");
});

test("reports an ordinary empty field as empty", () => {
  const ctx = buildSanitisedContext(base);
  assert.equal(ctx.elements[1].valueClass, "empty");
  assert.equal(ctx.elements[1].piiClass, null);
});

test("textRegions is present and empty in Tier 1", () => {
  assert.deepEqual(buildSanitisedContext(base).textRegions, []);
});

test("only the builder's output is recognised as sanitised", () => {
  assert.equal(isSanitised(buildSanitisedContext(base)), true);
  assert.equal(isSanitised({ step: 1, elements: [], screenshot: "x" }), false);
  assert.equal(isSanitised(null), false);
  assert.equal(isSanitised("a string"), false);
});

test("a copy of a sanitised context is not itself sanitised", () => {
  // Structural, not procedural: spreading the object drops it out of the set,
  // so a future code path cannot launder raw state through a clone. Spec §6.
  const ctx = buildSanitisedContext(base);
  assert.equal(isSanitised({ ...ctx }), false);
});

test("an ordinary filled field is reported as filled, not redacted", () => {
  const ctx = buildSanitisedContext({
    ...base,
    elements: [{
      id: "e0", role: "input", inputType: "text", autocompleteToken: "",
      label: "Search", name: "q", box: { x: 0, y: 0, w: 10, h: 10 },
      valuePresent: true
    }]
  });
  assert.equal(ctx.elements[0].valueClass, "filled");
});
