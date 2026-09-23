import test from "node:test";
import assert from "node:assert/strict";
import { escapeHtml, isSafeDataUrl } from "../tools/echo-server.js";

test("escapeHtml encodes the characters that break out of an attribute", () => {
  assert.equal(escapeHtml(`" onerror="alert(1)`), "&quot; onerror=&quot;alert(1)");
  assert.equal(escapeHtml("'"), "&#39;");
  assert.equal(escapeHtml("<script>"), "&lt;script&gt;");
  assert.equal(escapeHtml("a & b"), "a &amp; b");
});

test("isSafeDataUrl accepts a real base64 image data URL", () => {
  assert.equal(isSafeDataUrl("data:image/jpeg;base64,AAAA"), true);
  assert.equal(isSafeDataUrl("data:image/png;base64,iVBORw0KGgo="), true);
});

test("isSafeDataUrl rejects an attribute-escape attempt", () => {
  assert.equal(isSafeDataUrl(`data:image/jpeg;base64,AAAA" onerror="alert(1)`), false);
});

test("isSafeDataUrl rejects other schemes", () => {
  assert.equal(isSafeDataUrl("javascript:alert(1)"), false);
  assert.equal(isSafeDataUrl("http://example.com/x.png"), false);
  assert.equal(isSafeDataUrl("data:text/html;base64,PHNjcmlwdD4="), false);
});

test("isSafeDataUrl rejects non-strings and empties", () => {
  assert.equal(isSafeDataUrl(""), false);
  assert.equal(isSafeDataUrl(null), false);
  assert.equal(isSafeDataUrl(42), false);
});
