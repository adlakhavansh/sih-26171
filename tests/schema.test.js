import test from "node:test";
import assert from "node:assert/strict";
import { buildActionSchema } from "../extension/src/lib/schema.js";

// The schema is a set of branches, one per action shape. These helpers ask the
// same questions of it the planner's decoder does: which actions can be named,
// and what must accompany each one.
const branchFor = (schema, action) =>
  schema.anyOf.find((b) => b.properties.action.enum.includes(action));

const actionsIn = (schema) =>
  schema.anyOf.flatMap((b) => b.properties.action.enum).sort();

test("target is an enum of exactly this step's element ids", () => {
  const s = buildActionSchema({ elementIds: ["e0", "e1"], vaultKeys: ["pan"] });
  assert.deepEqual(branchFor(s, "click").properties.target.enum, ["e0", "e1"]);
  // With no per-field pairing given, every element gets its own type branch.
  const targets = s.anyOf
    .filter((b) => b.properties.action.enum.includes("type"))
    .map((b) => b.properties.target.enum[0]);
  assert.deepEqual(targets, ["e0", "e1"]);
});

test("valueKey is an enum of exactly the configured vault keys", () => {
  const s = buildActionSchema({ elementIds: ["e0"], vaultKeys: ["name", "pan"] });
  assert.deepEqual(branchFor(s, "type").properties.valueKey.enum, ["name", "pan"]);
});

test("there is no property through which a literal value could be sent", () => {
  const s = buildActionSchema({ elementIds: ["e0"], vaultKeys: ["pan"] });
  for (const b of s.anyOf) {
    assert.equal(b.properties.value, undefined);
    assert.equal(b.additionalProperties, false);
  }
});

test("reason is required so a refusal is always explicable", () => {
  const s = buildActionSchema({ elementIds: ["e0"], vaultKeys: ["pan"] });
  for (const b of s.anyOf) {
    assert.ok(b.required.includes("reason"));
    assert.ok(b.required.includes("action"));
  }
});

// The failure that cost a live run its whole step budget: a flat schema let the
// model emit `type` with no target, which decoded cleanly and was then refused.
test("an action that needs a target cannot be emitted without one", () => {
  const s = buildActionSchema({ elementIds: ["e0"], vaultKeys: ["pan"] });
  for (const action of ["click", "submit", "type", "select"]) {
    assert.ok(branchFor(s, action).required.includes("target"), `${action} may omit target`);
  }
});

test("type and select must name a vault key, and nothing else may", () => {
  const s = buildActionSchema({ elementIds: ["e0"], vaultKeys: ["pan"] });
  for (const action of ["type", "select"]) {
    assert.ok(branchFor(s, action).required.includes("valueKey"), `${action} may omit valueKey`);
  }
  for (const action of ["click", "submit", "done"]) {
    assert.equal(branchFor(s, action).properties.valueKey, undefined);
  }
});

test("done, ask_user and scroll carry no target, so a blank page is still answerable", () => {
  const s = buildActionSchema({ elementIds: ["e0"], vaultKeys: ["pan"] });
  const b = branchFor(s, "done");
  assert.equal(b.properties.target, undefined);
  assert.deepEqual(b.required, ["action", "reason"]);
});

// Review Focus 1: an empty enum is not a valid JSON schema and Ollama rejects it.
test("a page with no interactive elements omits target instead of emitting an empty enum", () => {
  const s = buildActionSchema({ elementIds: [], vaultKeys: ["pan"] });
  assert.equal(s.anyOf.length, 1);
  assert.equal(s.anyOf[0].properties.target, undefined);
  assert.deepEqual(actionsIn(s), ["ask_user", "done", "scroll"]);
});

test("an empty vault omits valueKey and drops type from the action vocabulary", () => {
  const s = buildActionSchema({ elementIds: ["e0"], vaultKeys: [] });
  assert.equal(branchFor(s, "type"), undefined);
  assert.equal(branchFor(s, "select"), undefined);
  assert.ok(branchFor(s, "click"));
  for (const b of s.anyOf) assert.equal(b.properties.valueKey, undefined);
});

// Observed in a live run: the model refilled the same field three steps running,
// because a filled field was still a legal target and prose did not stop it.
test("a field that already holds a value cannot be typed into again", () => {
  const s = buildActionSchema({
    elementIds: ["e0", "e1", "e2"],
    vaultKeys: ["name", "pan"],
    typable: [{ id: "e2", keys: ["pan"] }]
  });
  assert.deepEqual(branchFor(s, "type").properties.target.enum, ["e2"]);
  // Clicking a filled field is still legitimate; only typing is restricted.
  assert.deepEqual(branchFor(s, "click").properties.target.enum, ["e0", "e1", "e2"]);
});

test("with every field filled, type is off the table entirely so the run can end", () => {
  const s = buildActionSchema({ elementIds: ["e0"], vaultKeys: ["name"], typable: [] });
  assert.equal(branchFor(s, "type"), undefined);
  assert.ok(branchFor(s, "done"));
});

// Observed in a live run: `name` went into the Aadhaar box, then at the submit
// button. Target and valueKey now travel together, one branch per field.
test("each field accepts only the vault key that belongs in it", () => {
  const s = buildActionSchema({
    elementIds: ["e0", "e1"],
    vaultKeys: ["name", "aadhaar"],
    typable: [{ id: "e0", keys: ["name"] }, { id: "e1", keys: ["aadhaar"] }]
  });
  const typeBranches = s.anyOf.filter((b) => b.properties.action.enum.includes("type"));
  assert.equal(typeBranches.length, 2);
  for (const b of typeBranches) {
    assert.equal(b.properties.target.enum.length, 1);
    assert.equal(b.properties.valueKey.enum.length, 1);
    assert.deepEqual(b.required.sort(), ["action", "reason", "target", "valueKey"]);
  }
  const pairs = typeBranches.map((b) => [b.properties.target.enum[0], b.properties.valueKey.enum[0]]);
  assert.deepEqual(pairs.sort(), [["e0", "name"], ["e1", "aadhaar"]].sort());
});

test("a field whose class has no vault key is not typable at all", () => {
  const s = buildActionSchema({
    elementIds: ["e0"],
    vaultKeys: ["name"],
    typable: [{ id: "e0", keys: [] }]
  });
  assert.equal(branchFor(s, "type"), undefined);
});
