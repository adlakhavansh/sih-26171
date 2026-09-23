import test from "node:test";
import assert from "node:assert/strict";
import { verhoeffValid } from "../extension/src/lib/verhoeff.js";

test("accepts a Verhoeff-valid 12-digit number", () => {
  assert.equal(verhoeffValid("234123412346"), true);
});

test("rejects the same number with one digit changed", () => {
  assert.equal(verhoeffValid("234123412345"), false);
});

test("rejects anything that is not 12 digits", () => {
  assert.equal(verhoeffValid("23412341234"), false);
  assert.equal(verhoeffValid("2341234123a6"), false);
});
