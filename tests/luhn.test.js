import test from "node:test";
import assert from "node:assert/strict";
import { luhnValid } from "../extension/src/lib/luhn.js";

test("accepts a Luhn-valid card number", () => {
  assert.equal(luhnValid("4539578763621486"), true);
});

test("rejects a transposed digit", () => {
  assert.equal(luhnValid("4539578763621468"), false);
});

test("rejects short or non-numeric input", () => {
  assert.equal(luhnValid("123"), false);
  assert.equal(luhnValid("4539abcd63621486"), false);
});
