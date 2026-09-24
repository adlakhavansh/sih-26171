import test from "node:test";
import assert from "node:assert/strict";
import { buildActionSchema } from "../extension/src/lib/schema.js";

test("target is an enum of exactly this step's element ids", () => {
  const s = buildActionSchema({ elementIds: ["e0", "e1"], vaultKeys: ["pan"] });
  assert.deepEqual(s.properties.target.enum, ["e0", "e1"]);
});

test("valueKey is an enum of exactly the configured vault keys", () => {
  const s = buildActionSchema({ elementIds: ["e0"], vaultKeys: ["name", "pan"] });
  assert.deepEqual(s.properties.valueKey.enum, ["name", "pan"]);
});

test("there is no property through which a literal value could be sent", () => {
  const s = buildActionSchema({ elementIds: ["e0"], vaultKeys: ["pan"] });
  assert.equal(s.properties.value, undefined);
  assert.equal(s.additionalProperties, false);
});

test("reason is required so a refusal is always explicable", () => {
  const s = buildActionSchema({ elementIds: ["e0"], vaultKeys: ["pan"] });
  assert.ok(s.required.includes("reason"));
  assert.ok(s.required.includes("action"));
});

// Review Focus 1: an empty enum is not a valid JSON schema and Ollama rejects it.
test("a page with no interactive elements omits target instead of emitting an empty enum", () => {
  const s = buildActionSchema({ elementIds: [], vaultKeys: ["pan"] });
  assert.equal(s.properties.target, undefined);
  assert.deepEqual(s.properties.action.enum, ["scroll", "done", "ask_user"]);
});

test("an empty vault omits valueKey and drops type from the action enum", () => {
  const s = buildActionSchema({ elementIds: ["e0"], vaultKeys: [] });
  assert.equal(s.properties.valueKey, undefined);
  assert.ok(!s.properties.action.enum.includes("type"));
  assert.ok(s.properties.action.enum.includes("click"));
});
