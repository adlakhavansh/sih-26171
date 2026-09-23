import test from "node:test";
import assert from "node:assert/strict";
import { buildSanitisedContext } from "../extension/src/lib/sanitise.js";

// The secrets that are actually on demo/index.html. If any of these reaches the
// serialised payload, the central claim of the project is false — so they are
// asserted against the exact bytes that would cross the socket.
const SECRETS = [
  "hunter2hunter2",
  "234123412346",
  "ABCDE1234F",
  "9876543210",
  "ananya.sharma@example.com",
  "Ananya Sharma"
];

// Shaped as the content script reports the demo page, values included — which is
// what makes this test meaningful: the raw values are present on the way in.
const elements = [
  { id: "e0", role: "input", inputType: "text", autocompleteToken: "name",
    label: "Full Name", name: "", box: { x: 0, y: 0, w: 1, h: 1 },
    valuePresent: true, value: "Ananya Sharma" },
  { id: "e1", role: "input", inputType: "text", autocompleteToken: "",
    label: "Aadhaar Number", name: "", box: { x: 0, y: 0, w: 1, h: 1 },
    valuePresent: true, value: "234123412346" },
  { id: "e2", role: "input", inputType: "text", autocompleteToken: "",
    label: "PAN", name: "", box: { x: 0, y: 0, w: 1, h: 1 },
    valuePresent: true, value: "ABCDE1234F" },
  { id: "e3", role: "input", inputType: "text", autocompleteToken: "tel",
    label: "Mobile Number", name: "", box: { x: 0, y: 0, w: 1, h: 1 },
    valuePresent: true, value: "9876543210" },
  { id: "e4", role: "input", inputType: "email", autocompleteToken: "email",
    label: "Email", name: "", box: { x: 0, y: 0, w: 1, h: 1 },
    valuePresent: true, value: "ananya.sharma@example.com" },
  { id: "e5", role: "input", inputType: "password", autocompleteToken: "",
    label: "Portal Password", name: "pw", box: { x: 0, y: 0, w: 1, h: 1 },
    valuePresent: true, value: "hunter2hunter2" },
  { id: "e6", role: "input", inputType: "text", autocompleteToken: "",
    label: "Search this portal", name: "q", box: { x: 0, y: 0, w: 1, h: 1 },
    valuePresent: true, value: "scholarship deadlines" }
];

const payload = JSON.stringify(buildSanitisedContext({
  step: 1,
  viewport: { w: 1280, h: 800 },
  elements,
  visualHints: [{ x: 0, y: 0, w: 10, h: 10, cls: "DOCUMENT" }],
  screenshotDataUrl: "data:image/jpeg;base64,AAAA",
  goal: "Demonstrate client-side redaction"
}));

for (const secret of SECRETS) {
  test(`the outbound payload does not contain ${JSON.stringify(secret)}`, () => {
    assert.equal(payload.includes(secret), false);
  });
}

test("negative control: the raw input did contain every secret", () => {
  const raw = JSON.stringify(elements);
  for (const secret of SECRETS) {
    assert.ok(raw.includes(secret), `${secret} was never in the input`);
  }
});

test("all six sensitive fields survive as classes, so the planner can still act", () => {
  const ctx = JSON.parse(payload);
  const classes = ctx.elements.filter((e) => e.piiClass).map((e) => e.piiClass);
  assert.deepEqual(
    classes.sort(),
    ["AADHAAR", "EMAIL", "NAME", "PAN", "PASSWORD", "PHONE"]
  );
});

test("the ordinary field keeps its label and is not redacted", () => {
  const ctx = JSON.parse(payload);
  const search = ctx.elements.find((e) => e.id === "e6");
  assert.equal(search.piiClass, null);
  assert.equal(search.valueClass, "filled");
});
