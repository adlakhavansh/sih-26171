import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const HTML = readFileSync(new URL("../demo/index.html", import.meta.url), "utf8");
const DECLARATION = "declare the above particulars";

// Everything a DOM text query could reach: the markup minus the parts the
// browser never renders as text.
function domVisibleText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ");
}

test("negative control: the check catches text that IS in the DOM", () => {
  const doctored = `<p>I declare the above particulars to be true.</p>`;
  assert.ok(domVisibleText(doctored).includes(DECLARATION));
});

test("the declaration exists on the page", () => {
  assert.ok(HTML.includes(DECLARATION));
});

test("the declaration is unreachable from the DOM", () => {
  assert.equal(domVisibleText(HTML).includes(DECLARATION), false);
});

test("the page carries four DOM-blind items", () => {
  const imgs = HTML.match(/<img\b/g) ?? [];
  const canvases = HTML.match(/<canvas\b/g) ?? [];
  assert.equal(imgs.length + canvases.length, 4);
});

test("the page carries six sensitive fields and one ordinary one", () => {
  const inputs = HTML.match(/<input\b[^>]*>/g) ?? [];
  assert.equal(inputs.length, 7);
  assert.equal(inputs.filter((i) => i.includes('type="password"')).length, 1);
});
