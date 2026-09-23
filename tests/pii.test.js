import test from "node:test";
import assert from "node:assert/strict";
import { detectSpans, classifyField } from "../extension/src/lib/pii.js";

test("finds a spaced Aadhaar number in running text", () => {
  const spans = detectSpans("I, Ananya Sharma, Aadhaar 2341 2341 2346, declare.");
  assert.ok(spans.some((s) => s.cls === "AADHAAR"));
});

test("ignores a 12-digit number that fails the checksum", () => {
  const spans = detectSpans("Order reference 234123412345 shipped.");
  assert.equal(spans.filter((s) => s.cls === "AADHAAR").length, 0);
});

test("finds PAN, phone and email", () => {
  const classes = detectSpans("ABCDE1234F / 9876543210 / a.b@example.com").map((s) => s.cls);
  assert.ok(classes.includes("PAN"));
  assert.ok(classes.includes("PHONE"));
  assert.ok(classes.includes("EMAIL"));
});

test("returns spans that index back into the original string", () => {
  const text = "call 9876543210 now";
  const span = detectSpans(text).find((s) => s.cls === "PHONE");
  assert.equal(text.slice(span.start, span.end), "9876543210");
});

test("classifies a password field by input type alone", () => {
  assert.equal(classifyField({ inputType: "password", label: "", name: "", autocompleteToken: "" }), "PASSWORD");
});

test("classifies a field by its label when the value is empty", () => {
  assert.equal(classifyField({ inputType: "text", label: "Aadhaar Number", name: "", autocompleteToken: "" }), "AADHAAR");
});

test("returns null for an ordinary field", () => {
  assert.equal(classifyField({ inputType: "text", label: "Search", name: "q", autocompleteToken: "" }), null);
});
