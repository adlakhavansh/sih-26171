import test from "node:test";
import assert from "node:assert/strict";
import { VAULT_KEYS, configuredKeys, resolveVaultValue } from "../extension/src/lib/vault.js";

test("vault keys are drawn from the PII taxonomy", () => {
  assert.deepEqual(VAULT_KEYS, ["name", "aadhaar", "pan", "phone", "email"]);
});

test("configuredKeys lists only keys with a non-empty value", () => {
  const store = { name: "Ananya Sharma", pan: "", phone: "9876543210" };
  assert.deepEqual(configuredKeys(store), ["name", "phone"]);
});

test("configuredKeys ignores keys outside the taxonomy", () => {
  const store = { name: "Ananya Sharma", password: "hunter2hunter2" };
  assert.deepEqual(configuredKeys(store), ["name"]);
});

test("resolveVaultValue returns a configured value", () => {
  const res = resolveVaultValue({ pan: "ABCDE1234F" }, "pan");
  assert.deepEqual(res, { ok: true, value: "ABCDE1234F" });
});

// Review Focus 3: the planner names a key the user never filled in.
test("resolveVaultValue refuses an unconfigured key rather than returning undefined", () => {
  const res = resolveVaultValue({ name: "Ananya Sharma" }, "pan");
  assert.equal(res.ok, false);
  assert.match(res.reason, /not configured/);
});

test("resolveVaultValue refuses a key outside the taxonomy", () => {
  const res = resolveVaultValue({ password: "hunter2hunter2" }, "password");
  assert.equal(res.ok, false);
  assert.match(res.reason, /not a vault key/);
});

test("resolveVaultValue refuses an empty configured value", () => {
  const res = resolveVaultValue({ pan: "   " }, "pan");
  assert.equal(res.ok, false);
});
