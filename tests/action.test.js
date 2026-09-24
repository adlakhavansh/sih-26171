import test from "node:test";
import assert from "node:assert/strict";
import { ACTIONS, validateAction } from "../extension/src/lib/action.js";

const ctx = { elementIds: ["e0", "e1"], vaultKeys: ["name", "pan"] };

test("the action vocabulary is exactly the spec's", () => {
  assert.deepEqual(ACTIONS, ["click", "type", "scroll", "select", "submit", "done", "ask_user"]);
});

test("accepts a click on an enumerated element", () => {
  const res = validateAction({ action: "click", target: "e1", reason: "next" }, ctx);
  assert.equal(res.ok, true);
});

test("accepts a type naming a configured vault key", () => {
  const res = validateAction({ action: "type", target: "e0", valueKey: "pan", reason: "fill" }, ctx);
  assert.equal(res.ok, true);
});

test("rejects an action outside the vocabulary", () => {
  const res = validateAction({ action: "navigate", target: "e0", reason: "go" }, ctx);
  assert.equal(res.ok, false);
  assert.match(res.reason, /not an action/);
});

test("rejects a target that was not enumerated this step", () => {
  const res = validateAction({ action: "click", target: "e9", reason: "x" }, ctx);
  assert.equal(res.ok, false);
  assert.match(res.reason, /not enumerated/);
});

test("rejects a valueKey the vault does not hold", () => {
  const res = validateAction({ action: "type", target: "e0", valueKey: "aadhaar", reason: "x" }, ctx);
  assert.equal(res.ok, false);
  assert.match(res.reason, /not available/);
});

test("rejects a literal value even when a valueKey is also present", () => {
  const res = validateAction(
    { action: "type", target: "e0", valueKey: "pan", value: "ABCDE1234F", reason: "x" }, ctx);
  assert.equal(res.ok, false);
  assert.match(res.reason, /may not carry a literal/);
});

test("rejects a type with no valueKey", () => {
  const res = validateAction({ action: "type", target: "e0", reason: "x" }, ctx);
  assert.equal(res.ok, false);
});

test("accepts done and ask_user without a target", () => {
  assert.equal(validateAction({ action: "done", reason: "finished" }, ctx).ok, true);
  assert.equal(validateAction({ action: "ask_user", reason: "confirm?" }, ctx).ok, true);
});

test("rejects a targeted action with no target", () => {
  const res = validateAction({ action: "click", reason: "x" }, ctx);
  assert.equal(res.ok, false);
});

test("requires a reason", () => {
  const res = validateAction({ action: "click", target: "e0" }, ctx);
  assert.equal(res.ok, false);
  assert.match(res.reason, /reason/);
});
