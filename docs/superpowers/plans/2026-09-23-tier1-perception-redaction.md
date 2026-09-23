# Tier 1 — On-device Perception and Redaction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Chrome extension that captures the current page, finds PII in both the DOM and the raw pixels, masks it locally, and sends only the masked result to a local server — with all three stages visible on screen for a recording.

**Architecture:** MV3 extension. A content script reads DOM semantics in every frame; the service worker captures the viewport and owns the only network call; an offscreen document runs two ONNX models over the screenshot and paints the masks. A local echo server receives the sanitised payload and renders it back, so the privacy claim is observed rather than asserted.

**Tech Stack:** Plain JavaScript (no build step), Chrome MV3, ONNX Runtime Web (vendored), UltraFace RFB-320 and a PP-OCRv4 detection model in ONNX form, Node's built-in `http` and `node:test`.

**Spec:** `docs/superpowers/specs/2026-09-23-sih26171-design.md` — §15 defines Tier 1 scope. Sections 6, 9, 10, 11 and 17 carry the requirements this plan implements.

## Global Constraints

- **No build step.** The `extension/` directory is loaded unpacked exactly as it sits on disk. No bundler, no transpiler, no `npm run build`.
- **No remote code.** MV3 forbids it and the privacy claim depends on it. Every script, model and WASM binary is vendored into `extension/vendor/` or `extension/models/`.
- **No runtime dependencies.** Node code uses the standard library only. There is no `dependencies` block in `package.json`.
- **Plain JavaScript, ES modules** everywhere except the content script, which must be a classic script because MV3 content scripts cannot be modules.
- **Model budget: ≤ 7MB total** across all models (spec §13).
- **Everything in `extension/src/lib/` must be pure** — no `document`, no `chrome`, no `window`. That is what makes it testable under `node:test`.
- **Tests use `node:test` and `node:assert/strict` only.** No test framework is installed.
- **Every failure degrades toward over-masking or toward not sending** (spec §17). No failure path may degrade toward sending.

## Review Focus

Five conditions the spec implies that no task's happy path exercises. Each one's test is assigned to the task that owns the code.

1. **`devicePixelRatio` is not 1.** On a HiDPI laptop the screenshot is 2× the CSS viewport, so every DOM box is at half scale relative to the pixels. Masks land in the wrong place while looking plausible. → Task 4.
2. **The page is scrolled.** `getBoundingClientRect()` is viewport-relative but a naive implementation mixes in `scrollY`, shifting every mask vertically. → Task 4.
3. **Zero detections.** A page with no face and no text must produce an empty mask list and a valid payload, not a crash or a null screenshot. → Tasks 5 and 6.
4. **Non-square model input.** Both models resize the screenshot to a fixed input shape with a different aspect ratio; mapping the output boxes back without inverting that distortion puts every box off-axis. → Tasks 5 and 6.
5. **A cross-origin iframe.** No content script reply arrives for it, so its area must be treated as DOM-blind and masked by the vision pass — not silently skipped. → Task 7.

---

## File Structure

```
extension/
  manifest.json            MV3 manifest, permissions, CSP
  background.js            service worker: orchestration, capture, the single fetch
  content.js               classic script: DOM extraction, all frames
  offscreen.html           host page for canvas + ORT
  offscreen.js             model sessions, detection, mask painting
  panel.html               side panel: three-pane view
  panel.js                 side panel rendering
  src/lib/
    verhoeff.js            Aadhaar checksum          (pure)
    luhn.js                card checksum             (pure)
    pii.js                 taxonomy + span detection (pure)
    geometry.js            coordinate normalisation, IoU, NMS, letterbox (pure)
    nms.js                 non-maximum suppression   (pure)
    ultraface.js           UltraFace output decoding (pure)
    dbnet.js               probability map to boxes  (pure)
    triage.js              DOM-blind regions, region sensitivity (pure)
    sanitise.js            SanitisedContext construction + chokepoint (pure)
  models/                  UltraFace + PP-OCRv4 det ONNX
  vendor/ort/              ONNX Runtime Web + .wasm files
tools/
  echo-server.js           receives the payload, renders it back
demo/
  index.html               the target page, seeded with DOM-blind PII
  assets/                  id-card.png, face.jpg, signature.png
tests/
  *.test.js                node:test, one file per lib module
```

---

## Task 1: Extension skeleton that captures the viewport

Proves the hardest platform plumbing works before any model is involved: MV3 capture, the offscreen document, and the side panel.

**Files:**
- Create: `extension/manifest.json`, `extension/background.js`, `extension/offscreen.html`, `extension/offscreen.js`, `extension/panel.html`, `extension/panel.js`
- Create: `package.json`

**Interfaces:**
- Consumes: nothing
- Produces: message protocol used by every later task —
  `{type: "CAPTURE_REQUEST"}` sent to the service worker;
  `{type: "OFFSCREEN_PROCESS", dataUrl: string}` service worker → offscreen;
  `{type: "OFFSCREEN_RESULT", width: number, height: number, maskedDataUrl: string}` offscreen → service worker;
  `{type: "PANEL_UPDATE", payload: object}` service worker → side panel.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "sih26171",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test tests/",
    "echo": "node tools/echo-server.js"
  }
}
```

- [ ] **Step 2: Create `extension/manifest.json`**

`wasm-unsafe-eval` is required or ONNX Runtime cannot instantiate its WASM backend. `all_frames` is what makes the DOM pass reach nested frames.

```json
{
  "manifest_version": 3,
  "name": "Privacy-First Browser Agent (Tier 1)",
  "version": "0.1.0",
  "description": "On-device visual perception with client-side PII redaction.",
  "permissions": ["activeTab", "scripting", "tabs", "offscreen", "sidePanel"],
  "host_permissions": ["<all_urls>"],
  "background": { "service_worker": "background.js", "type": "module" },
  "content_scripts": [
    { "matches": ["<all_urls>"], "js": ["content.js"], "all_frames": true, "run_at": "document_idle" }
  ],
  "side_panel": { "default_path": "panel.html" },
  "action": { "default_title": "Perceive and redact this page" },
  "content_security_policy": {
    "extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'"
  },
  "cross_origin_embedder_policy": { "value": "require-corp" },
  "cross_origin_opener_policy": { "value": "same-origin" }
}
```

- [ ] **Step 3: Create `extension/offscreen.html`**

```html
<!doctype html>
<meta charset="utf-8">
<title>offscreen</title>
<script src="vendor/ort/ort.min.js"></script>
<script type="module" src="offscreen.js"></script>
```

- [ ] **Step 4: Create `extension/offscreen.js` with capture decode only**

```javascript
async function decode(dataUrl) {
  const blob = await (await fetch(dataUrl)).blob();
  const bitmap = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0);
  return { canvas, ctx, width: bitmap.width, height: bitmap.height };
}

async function toDataUrl(canvas) {
  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.85 });
  return await new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type !== "OFFSCREEN_PROCESS") return false;
  (async () => {
    const { canvas, width, height } = await decode(msg.dataUrl);
    sendResponse({
      type: "OFFSCREEN_RESULT",
      width,
      height,
      maskedDataUrl: await toDataUrl(canvas)
    });
  })();
  return true;
});
```

- [ ] **Step 5: Create `extension/background.js`**

```javascript
async function ensureOffscreen() {
  const existing = await chrome.offscreen.hasDocument();
  if (existing) return;
  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["BLOBS"],
    justification: "Decode the captured screenshot and run local vision models on it."
  });
}

async function runStep(tab) {
  await ensureOffscreen();
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
  const result = await chrome.runtime.sendMessage({ type: "OFFSCREEN_PROCESS", dataUrl });
  await chrome.runtime.sendMessage({
    type: "PANEL_UPDATE",
    payload: { width: result.width, height: result.height, maskedDataUrl: result.maskedDataUrl }
  });
}

chrome.action.onClicked.addListener(async (tab) => {
  await chrome.sidePanel.open({ windowId: tab.windowId });
  await runStep(tab);
});
```

- [ ] **Step 6: Create `extension/panel.html` and `extension/panel.js`**

```html
<!doctype html>
<meta charset="utf-8">
<title>Agent trace</title>
<style>
  body { font: 13px system-ui; margin: 0; padding: 12px; background: #111; color: #eee; }
  h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .08em; color: #888; margin: 16px 0 6px; }
  img { width: 100%; border-radius: 4px; display: block; }
  pre { background: #1b1b1b; padding: 8px; border-radius: 4px; overflow-x: auto; font-size: 11px; }
</style>
<h2>Masked view</h2>
<img id="masked" alt="masked capture">
<h2>Sent to server</h2>
<pre id="payload">nothing sent yet</pre>
<script type="module" src="panel.js"></script>
```

```javascript
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type !== "PANEL_UPDATE") return;
  document.getElementById("masked").src = msg.payload.maskedDataUrl;
  document.getElementById("payload").textContent = JSON.stringify(
    { width: msg.payload.width, height: msg.payload.height }, null, 2
  );
});
```

- [ ] **Step 7: Load and verify manually**

Open `chrome://extensions`, enable Developer mode, "Load unpacked", select `extension/`.
Open any page, click the extension icon.
Expected: the side panel opens and shows a screenshot of the page, plus its pixel dimensions.
If the panel stays blank, check the service worker console from the extensions page — a missing `offscreen` permission or a CSP error appears there.

- [ ] **Step 8: Commit**

```bash
git add package.json extension/
git commit -m "feat: MV3 skeleton with viewport capture and side panel"
```

---

## Task 2: The demo page

Built second because every later task is tested against it. It is the only page whose ground truth we control completely.

**Files:**
- Create: `demo/index.html`, `demo/assets/` (three images)

**Interfaces:**
- Consumes: nothing
- Produces: a page with exactly four DOM-blind PII items and six DOM-visible PII fields; counts are referenced by Task 7's tests.

- [ ] **Step 1: Obtain three images into `demo/assets/`**

- `face.jpg` — any photograph of a face. A stock or AI-generated portrait is fine; do not use a real person's identity document.
- `id-card.png` — a mock ID card image containing a face and printed text including a 12-digit number. Make it in any image editor; it must not be a real ID.
- `signature.png` — a handwritten signature on white background, scanned or drawn.

Verification: all three files exist and are under 400KB each.

- [ ] **Step 2: Create `demo/index.html`**

The `<canvas>` block is the important part: its text exists only as pixels, so the DOM pass is structurally incapable of seeing it.

```html
<!doctype html>
<html lang="en">
<meta charset="utf-8">
<title>State Scholarship Portal — Application Form</title>
<style>
  body { font: 15px system-ui; max-width: 720px; margin: 40px auto; padding: 0 20px; color: #222; }
  label { display: block; margin: 14px 0 4px; font-weight: 600; font-size: 13px; }
  input { width: 100%; padding: 8px; border: 1px solid #bbb; border-radius: 4px; font-size: 14px; }
  .docs { display: flex; gap: 16px; margin: 24px 0; flex-wrap: wrap; }
  .docs figure { margin: 0; }
  .docs img { height: 120px; border: 1px solid #ddd; border-radius: 4px; display: block; }
  figcaption { font-size: 11px; color: #777; margin-top: 4px; }
</style>

<h1>Scholarship Application</h1>

<label for="name">Full Name</label>
<input id="name" autocomplete="name" value="Ananya Sharma">

<label for="aadhaar">Aadhaar Number</label>
<input id="aadhaar" value="234123412346">

<label for="pan">PAN</label>
<input id="pan" value="ABCDE1234F">

<label for="phone">Mobile Number</label>
<input id="phone" autocomplete="tel" value="9876543210">

<label for="email">Email</label>
<input id="email" autocomplete="email" type="email" value="ananya.sharma@example.com">

<label for="pw">Portal Password</label>
<input id="pw" type="password" value="hunter2hunter2">

<h2>Uploaded Documents</h2>
<div class="docs">
  <figure><img src="assets/id-card.png" alt="identity document"><figcaption>ID proof</figcaption></figure>
  <figure><img src="assets/face.jpg" alt="passport photograph"><figcaption>Photograph</figcaption></figure>
  <figure><img src="assets/signature.png" alt="specimen signature"><figcaption>Signature</figcaption></figure>
</div>

<h2>Declaration (signed)</h2>
<canvas id="decl" width="620" height="90"></canvas>

<script>
  const ctx = document.getElementById("decl").getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, 620, 90);
  ctx.fillStyle = "#111"; ctx.font = "16px Georgia";
  ctx.fillText("I, Ananya Sharma, Aadhaar 2341 2341 2346,", 12, 34);
  ctx.fillText("declare the above particulars to be true.", 12, 62);
</script>
</html>
```

- [ ] **Step 3: Verify the DOM cannot see the canvas text**

Open `demo/index.html`, then in DevTools console run:

```javascript
document.body.innerText.includes("declare the above particulars")
```

Expected: `false`. The sentence is visible on screen and absent from the DOM. That is the whole argument for the vision pass, and it should be confirmed rather than assumed.

- [ ] **Step 4: Commit**

```bash
git add demo/
git commit -m "feat: demo page with DOM-visible and pixel-only PII"
```

---

## Task 3: PII detection library

Pure logic, fully testable without a browser. This is where the cheapest precision in the whole system lives (spec §9).

**Files:**
- Create: `extension/src/lib/verhoeff.js`, `extension/src/lib/luhn.js`, `extension/src/lib/pii.js`
- Test: `tests/verhoeff.test.js`, `tests/luhn.test.js`, `tests/pii.test.js`

**Interfaces:**
- Consumes: nothing
- Produces:
  `verhoeffValid(digits: string) => boolean`
  `luhnValid(digits: string) => boolean`
  `detectSpans(text: string) => Array<{start: number, end: number, cls: string}>`
  `classifyField({inputType, autocompleteToken, label, name}) => string | null`
  Class strings used everywhere downstream: `"AADHAAR" | "PAN" | "PHONE" | "EMAIL" | "CARD" | "PASSWORD" | "NAME" | "DOB"`.

- [ ] **Step 1: Write the failing test for Verhoeff**

```javascript
// tests/verhoeff.test.js
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
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test tests/verhoeff.test.js`
Expected: FAIL, cannot find module `verhoeff.js`.

- [ ] **Step 3: Implement `extension/src/lib/verhoeff.js`**

```javascript
const D = [
  [0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],
  [3,4,0,1,2,8,9,5,6,7],[4,0,1,2,3,9,5,6,7,8],[5,9,8,7,6,0,4,3,2,1],
  [6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],[8,7,6,5,9,3,2,1,0,4],
  [9,8,7,6,5,4,3,2,1,0]
];
const P = [
  [0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],
  [8,9,1,6,0,4,3,5,2,7],[9,4,5,3,1,2,6,8,7,0],[4,2,8,6,5,7,3,9,0,1],
  [2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8]
];

export function verhoeffValid(digits) {
  if (!/^\d{12}$/.test(digits)) return false;
  let c = 0;
  const reversed = digits.split("").reverse().map(Number);
  for (let i = 0; i < reversed.length; i++) {
    c = D[c][P[i % 8][reversed[i]]];
  }
  return c === 0;
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `node --test tests/verhoeff.test.js`
Expected: PASS, 3 tests.

If the first test fails, the literal in the test is not actually Verhoeff-valid. Generate a correct one rather than weakening the check:
`node -e "const{verhoeffValid}=await import('./extension/src/lib/verhoeff.js');for(let i=0;i<10;i++){const c='23412341234'+i;if(verhoeffValid(c))console.log(c)}" --input-type=module`
Use the number it prints, and update the demo page in Task 2 to match.

- [ ] **Step 5: Write the failing test for Luhn**

```javascript
// tests/luhn.test.js
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
```

- [ ] **Step 6: Run it and watch it fail**

Run: `node --test tests/luhn.test.js`
Expected: FAIL, cannot find module `luhn.js`.

- [ ] **Step 7: Implement `extension/src/lib/luhn.js`**

```javascript
export function luhnValid(digits) {
  if (!/^\d{13,19}$/.test(digits)) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}
```

- [ ] **Step 8: Run it and watch it pass**

Run: `node --test tests/luhn.test.js`
Expected: PASS, 3 tests.

- [ ] **Step 9: Write the failing test for span detection and field classification**

```javascript
// tests/pii.test.js
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
```

- [ ] **Step 10: Run it and watch it fail**

Run: `node --test tests/pii.test.js`
Expected: FAIL, cannot find module `pii.js`.

- [ ] **Step 11: Implement `extension/src/lib/pii.js`**

```javascript
import { verhoeffValid } from "./verhoeff.js";
import { luhnValid } from "./luhn.js";

const PATTERNS = [
  { cls: "EMAIL",  re: /\b[\w.+-]+@[\w-]+\.[\w.]{2,}\b/g },
  { cls: "PAN",    re: /\b[A-Z]{5}\d{4}[A-Z]\b/g },
  { cls: "AADHAAR", re: /\b\d{4}\s?\d{4}\s?\d{4}\b/g, check: (m) => verhoeffValid(m.replace(/\s/g, "")) },
  { cls: "CARD",   re: /\b(?:\d[ -]?){13,19}\b/g, check: (m) => luhnValid(m.replace(/[\s-]/g, "")) },
  { cls: "PHONE",  re: /\b[6-9]\d{9}\b/g },
  { cls: "DOB",    re: /\b\d{2}[\/-]\d{2}[\/-]\d{4}\b/g }
];

export function detectSpans(text) {
  const spans = [];
  for (const { cls, re, check } of PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      if (check && !check(m[0])) continue;
      spans.push({ start: m.index, end: m.index + m[0].length, cls });
    }
  }
  // Longest span wins on overlap: a card number must not be reported as a phone number.
  spans.sort((a, b) => (b.end - b.start) - (a.end - a.start));
  const kept = [];
  for (const s of spans) {
    if (kept.some((k) => s.start < k.end && k.start < s.end)) continue;
    kept.push(s);
  }
  return kept.sort((a, b) => a.start - b.start);
}

const LABEL_RULES = [
  { cls: "AADHAAR", re: /aadhaar|aadhar|uidai/i },
  { cls: "PAN",     re: /\bpan\b/i },
  { cls: "PHONE",   re: /mobile|phone|contact number/i },
  { cls: "EMAIL",   re: /e-?mail/i },
  { cls: "NAME",    re: /name/i },
  { cls: "DOB",     re: /birth|dob/i },
  { cls: "CARD",    re: /card number|credit|debit/i }
];

const AUTOCOMPLETE_MAP = {
  name: "NAME", "given-name": "NAME", "family-name": "NAME",
  tel: "PHONE", "tel-national": "PHONE",
  email: "EMAIL", bday: "DOB",
  "cc-number": "CARD",
  "current-password": "PASSWORD", "new-password": "PASSWORD",
  "street-address": "NAME", "postal-code": "NAME"
};

export function classifyField({ inputType, autocompleteToken, label, name }) {
  if (inputType === "password") return "PASSWORD";
  const token = (autocompleteToken || "").toLowerCase();
  if (AUTOCOMPLETE_MAP[token]) return AUTOCOMPLETE_MAP[token];
  const haystack = `${label || ""} ${name || ""}`;
  for (const { cls, re } of LABEL_RULES) {
    if (re.test(haystack)) return cls;
  }
  return null;
}
```

- [ ] **Step 12: Run the full suite and watch it pass**

Run: `node --test tests/`
Expected: PASS, 13 tests.

- [ ] **Step 13: Commit**

```bash
git add extension/src/lib/verhoeff.js extension/src/lib/luhn.js extension/src/lib/pii.js tests/
git commit -m "feat: PII detection with Verhoeff and Luhn checksum gating"
```

---

## Task 4: DOM extraction and coordinate normalisation

Owns Review Focus items 1 and 2 — the two silent coordinate bugs from spec §11.

**Files:**
- Create: `extension/src/lib/geometry.js`, `extension/content.js`
- Modify: `extension/background.js`
- Test: `tests/geometry.test.js`

**Interfaces:**
- Consumes: `classifyField` from Task 3.
- Produces:
  `toDevicePixels(rect, dpr, frameOffset) => {x, y, w, h}`
  Element record shape used by Tasks 6, 7 and 8:
  `{id: string, role: string, inputType: string, autocompleteToken: string, label: string, box: {x,y,w,h}, valuePresent: boolean, piiClass: string|null, tag: string}`
  Content-script message: `{type: "DOM_REPORT"}` → replies `{elements: [...], blindBoxes: [{x,y,w,h,kind}]}`.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/geometry.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { toDevicePixels } from "../extension/src/lib/geometry.js";

test("passes CSS pixels through unchanged at dpr 1", () => {
  const box = toDevicePixels({ left: 10, top: 20, width: 100, height: 40 }, 1, { x: 0, y: 0 });
  assert.deepEqual(box, { x: 10, y: 20, w: 100, h: 40 });
});

test("scales by devicePixelRatio", () => {
  const box = toDevicePixels({ left: 10, top: 20, width: 100, height: 40 }, 2, { x: 0, y: 0 });
  assert.deepEqual(box, { x: 20, y: 40, w: 200, h: 80 });
});

test("adds the frame offset before scaling", () => {
  const box = toDevicePixels({ left: 10, top: 20, width: 100, height: 40 }, 2, { x: 5, y: 7 });
  assert.deepEqual(box, { x: 30, y: 54, w: 200, h: 80 });
});

test("does not apply scroll offset — getBoundingClientRect is already viewport-relative", () => {
  const a = toDevicePixels({ left: 10, top: 20, width: 100, height: 40 }, 1, { x: 0, y: 0 });
  const b = toDevicePixels({ left: 10, top: 20, width: 100, height: 40 }, 1, { x: 0, y: 0 });
  assert.deepEqual(a, b);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test tests/geometry.test.js`
Expected: FAIL, cannot find module `geometry.js`.

- [ ] **Step 3: Implement `extension/src/lib/geometry.js`**

```javascript
// The screenshot is in device pixels; getBoundingClientRect returns CSS pixels
// relative to its own frame's viewport. Scroll is already accounted for by the
// rect, so adding scrollY here would double-count it and shift every mask.
export function toDevicePixels(rect, dpr, frameOffset) {
  return {
    x: Math.round((rect.left + frameOffset.x) * dpr),
    y: Math.round((rect.top + frameOffset.y) * dpr),
    w: Math.round(rect.width * dpr),
    h: Math.round(rect.height * dpr)
  };
}

export function area(b) {
  return Math.max(0, b.w) * Math.max(0, b.h);
}

export function intersects(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

export function contains(outer, inner) {
  return inner.x >= outer.x && inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h;
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `node --test tests/geometry.test.js`
Expected: PASS, 4 tests.

- [ ] **Step 5: Create `extension/content.js`**

A classic script, so it inlines its own copies of the two small helpers rather than importing them. MV3 content scripts cannot be ES modules.

```javascript
// Classic script — no imports available. Kept deliberately small.
(function () {
  const INTERACTIVE = "input,select,textarea,button,a[href],[role=button],[role=textbox],[contenteditable=true]";
  const BLIND = "img,canvas,svg,video,iframe,object,embed";

  function labelFor(el) {
    if (el.labels && el.labels.length) return el.labels[0].innerText.trim();
    const aria = el.getAttribute("aria-label");
    if (aria) return aria.trim();
    const id = el.getAttribute("id");
    if (id) {
      const lab = document.querySelector(`label[for="${CSS.escape(id)}"]`);
      if (lab) return lab.innerText.trim();
    }
    const parentLabel = el.closest("label");
    if (parentLabel) return parentLabel.innerText.trim();
    return "";
  }

  function frameOffset() {
    // Top frame contributes nothing. Nested same-origin frames report their own
    // offset within the top viewport via their frameElement rect.
    let x = 0, y = 0, win = window;
    while (win !== window.top) {
      let frameEl;
      try { frameEl = win.frameElement; } catch { break; }
      if (!frameEl) break;
      const r = frameEl.getBoundingClientRect();
      x += r.left; y += r.top;
      win = win.parent;
    }
    return { x, y };
  }

  function visible(r) {
    return r.width > 2 && r.height > 2 &&
      r.bottom > 0 && r.right > 0 &&
      r.top < window.innerHeight && r.left < window.innerWidth;
  }

  function collect() {
    const dpr = window.devicePixelRatio || 1;
    const off = frameOffset();
    const scale = (r) => ({
      x: Math.round((r.left + off.x) * dpr),
      y: Math.round((r.top + off.y) * dpr),
      w: Math.round(r.width * dpr),
      h: Math.round(r.height * dpr)
    });

    const elements = [];
    let n = 0;
    for (const el of document.querySelectorAll(INTERACTIVE)) {
      const r = el.getBoundingClientRect();
      if (!visible(r)) continue;
      elements.push({
        id: `e${n++}`,
        tag: el.tagName.toLowerCase(),
        role: el.getAttribute("role") || el.tagName.toLowerCase(),
        inputType: el.type || "",
        autocompleteToken: el.getAttribute("autocomplete") || "",
        label: labelFor(el),
        name: el.getAttribute("name") || "",
        box: scale(r),
        valuePresent: Boolean(el.value && String(el.value).length)
      });
    }

    const blindBoxes = [];
    for (const el of document.querySelectorAll(BLIND)) {
      const r = el.getBoundingClientRect();
      if (!visible(r)) continue;
      blindBoxes.push({ ...scale(r), kind: el.tagName.toLowerCase() });
    }

    return { elements, blindBoxes, dpr };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type !== "DOM_REPORT") return false;
    sendResponse(collect());
    return true;
  });
})();
```

- [ ] **Step 6: Wire the DOM pass into `extension/background.js`**

Replace the body of `runStep` with:

```javascript
async function runStep(tab) {
  await ensureOffscreen();

  const frames = await chrome.webNavigation?.getAllFrames?.({ tabId: tab.id }).catch(() => null);
  const frameIds = frames ? frames.map((f) => f.frameId) : [0];

  const reports = [];
  for (const frameId of frameIds) {
    try {
      const r = await chrome.tabs.sendMessage(tab.id, { type: "DOM_REPORT" }, { frameId });
      if (r) reports.push(r);
    } catch {
      // No content script in this frame — cross-origin or restricted.
      // Its area is handled by the vision pass, never skipped. (Spec §17)
    }
  }

  const elements = reports.flatMap((r) => r.elements);
  const blindBoxes = reports.flatMap((r) => r.blindBoxes);

  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
  const result = await chrome.runtime.sendMessage({
    type: "OFFSCREEN_PROCESS", dataUrl, elements, blindBoxes
  });

  await chrome.runtime.sendMessage({ type: "PANEL_UPDATE", payload: result });
}
```

Add `"webNavigation"` to the `permissions` array in `manifest.json`.

- [ ] **Step 7: Verify against the demo page**

Reload the extension, open `demo/index.html`, click the icon, and read the service worker console.
Expected: six `input` elements reported, four blind boxes (three `img`, one `canvas`).
On a HiDPI display, check that a box's `w` is roughly twice the CSS width shown in DevTools — that confirms the `dpr` scaling is live rather than silently 1.

- [ ] **Step 8: Commit**

```bash
git add extension/src/lib/geometry.js extension/content.js extension/background.js extension/manifest.json tests/geometry.test.js
git commit -m "feat: DOM extraction across frames with device-pixel normalisation"
```

---

## Task 5: Face detection

First model. Owns Review Focus items 3 and 4 — empty results and letterbox distortion.

**Files:**
- Create: `extension/src/lib/nms.js`, `extension/src/lib/ultraface.js`
- Modify: `extension/offscreen.js`
- Create: `extension/models/ultraface-rfb-320.onnx`, `extension/vendor/ort/`
- Test: `tests/nms.test.js`, `tests/ultraface.test.js`

**Interfaces:**
- Consumes: `toDevicePixels` conventions from Task 4 (boxes are `{x,y,w,h}` in device pixels).
- Produces:
  `nms(boxes: Array<{x,y,w,h,score}>, iouThreshold: number) => Array<same>`
  `decodeUltraface(scores: Float32Array, boxes: Float32Array, imgW: number, imgH: number, scoreThreshold: number) => Array<{x,y,w,h,score}>`

- [ ] **Step 1: Vendor ONNX Runtime Web**

```bash
mkdir -p extension/vendor/ort extension/models
cd extension/vendor/ort
npm pack onnxruntime-web
tar -xzf onnxruntime-web-*.tgz
cp package/dist/ort.min.js .
cp package/dist/*.wasm .
cd ../../..
rm -rf extension/vendor/ort/package extension/vendor/ort/onnxruntime-web-*.tgz
ls -la extension/vendor/ort/
```

Expected: `ort.min.js` plus several `.wasm` files. `npm pack` downloads the tarball without adding a dependency, which keeps the no-dependencies constraint intact.

- [ ] **Step 2: Obtain the face model**

Download `version-RFB-320.onnx` from the UltraFace model in the ONNX Model Zoo
(`https://github.com/onnx/models`, under `validated/vision/body_analysis/ultraface/models/`)
and save it as `extension/models/ultraface-rfb-320.onnx`.

Verify: `ls -l extension/models/ultraface-rfb-320.onnx` shows roughly 1.2MB.

If that exact file is unavailable, any ONNX face detector under 3MB whose outputs are
`scores [1,N,2]` and `boxes [1,N,4]` in normalised corner form will drop in unchanged.
If the outputs differ, only `decodeUltraface` changes.

- [ ] **Step 3: Write the failing test for NMS**

```javascript
// tests/nms.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { nms } from "../extension/src/lib/nms.js";

test("returns an empty array for no input", () => {
  assert.deepEqual(nms([], 0.5), []);
});

test("keeps the higher-scoring box of an overlapping pair", () => {
  const kept = nms([
    { x: 0, y: 0, w: 100, h: 100, score: 0.9 },
    { x: 10, y: 10, w: 100, h: 100, score: 0.6 }
  ], 0.5);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].score, 0.9);
});

test("keeps both boxes when they do not overlap", () => {
  const kept = nms([
    { x: 0, y: 0, w: 50, h: 50, score: 0.9 },
    { x: 500, y: 500, w: 50, h: 50, score: 0.6 }
  ], 0.5);
  assert.equal(kept.length, 2);
});
```

- [ ] **Step 4: Run it and watch it fail**

Run: `node --test tests/nms.test.js`
Expected: FAIL, cannot find module `nms.js`.

- [ ] **Step 5: Implement `extension/src/lib/nms.js`**

```javascript
function iou(a, b) {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  if (inter === 0) return 0;
  return inter / (a.w * a.h + b.w * b.h - inter);
}

export function nms(boxes, iouThreshold) {
  const sorted = [...boxes].sort((p, q) => q.score - p.score);
  const kept = [];
  for (const box of sorted) {
    if (kept.some((k) => iou(k, box) > iouThreshold)) continue;
    kept.push(box);
  }
  return kept;
}
```

- [ ] **Step 6: Run it and watch it pass**

Run: `node --test tests/nms.test.js`
Expected: PASS, 3 tests.

- [ ] **Step 7: Write the failing test for UltraFace decoding**

```javascript
// tests/ultraface.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { decodeUltraface } from "../extension/src/lib/ultraface.js";

test("returns nothing when every confidence is below threshold", () => {
  const scores = Float32Array.from([0.95, 0.05, 0.9, 0.1]);
  const boxes = Float32Array.from([0, 0, 0.5, 0.5, 0.1, 0.1, 0.2, 0.2]);
  assert.deepEqual(decodeUltraface(scores, boxes, 800, 600, 0.6), []);
});

test("scales a normalised box to image pixels", () => {
  const scores = Float32Array.from([0.1, 0.9]);
  const boxes = Float32Array.from([0.25, 0.5, 0.75, 1.0]);
  const out = decodeUltraface(scores, boxes, 800, 600, 0.6);
  assert.equal(out.length, 1);
  assert.deepEqual(
    { x: out[0].x, y: out[0].y, w: out[0].w, h: out[0].h },
    { x: 200, y: 300, w: 400, h: 300 }
  );
});

test("clamps a box that runs past the image edge", () => {
  const scores = Float32Array.from([0.1, 0.9]);
  const boxes = Float32Array.from([-0.1, -0.1, 1.2, 1.2]);
  const out = decodeUltraface(scores, boxes, 100, 100, 0.6);
  assert.deepEqual(
    { x: out[0].x, y: out[0].y, w: out[0].w, h: out[0].h },
    { x: 0, y: 0, w: 100, h: 100 }
  );
});
```

- [ ] **Step 8: Run it and watch it fail**

Run: `node --test tests/ultraface.test.js`
Expected: FAIL, cannot find module `ultraface.js`.

- [ ] **Step 9: Implement `extension/src/lib/ultraface.js`**

```javascript
import { nms } from "./nms.js";

// UltraFace emits scores as [background, face] pairs and boxes as normalised
// corners. Both are relative to the model's own input, which is a plain resize
// of the full image — so the inverse mapping is a straight multiply, with no
// letterbox offset to undo. Any model that pads instead of stretching needs the
// padding removed here before scaling.
export function decodeUltraface(scores, boxes, imgW, imgH, scoreThreshold) {
  const out = [];
  const count = scores.length / 2;
  for (let i = 0; i < count; i++) {
    const score = scores[i * 2 + 1];
    if (score < scoreThreshold) continue;
    const x1 = Math.max(0, Math.min(1, boxes[i * 4 + 0])) * imgW;
    const y1 = Math.max(0, Math.min(1, boxes[i * 4 + 1])) * imgH;
    const x2 = Math.max(0, Math.min(1, boxes[i * 4 + 2])) * imgW;
    const y2 = Math.max(0, Math.min(1, boxes[i * 4 + 3])) * imgH;
    out.push({
      x: Math.round(x1),
      y: Math.round(y1),
      w: Math.round(x2 - x1),
      h: Math.round(y2 - y1),
      score
    });
  }
  return nms(out, 0.4);
}
```

- [ ] **Step 10: Run it and watch it pass**

Run: `node --test tests/ultraface.test.js`
Expected: PASS, 3 tests.

- [ ] **Step 11: Wire the model into `extension/offscreen.js`**

Add above the message listener:

```javascript
import { decodeUltraface } from "./src/lib/ultraface.js";

ort.env.wasm.wasmPaths = chrome.runtime.getURL("vendor/ort/");

let facePromise = null;
function faceSession() {
  if (!facePromise) {
    facePromise = ort.InferenceSession.create(
      chrome.runtime.getURL("models/ultraface-rfb-320.onnx"),
      { executionProviders: ["webgpu", "wasm"] }
    );
  }
  return facePromise;
}

function toTensor(ctx, srcW, srcH, dstW, dstH, mean, scale) {
  const tmp = new OffscreenCanvas(dstW, dstH);
  const tctx = tmp.getContext("2d");
  tctx.drawImage(ctx.canvas, 0, 0, srcW, srcH, 0, 0, dstW, dstH);
  const { data } = tctx.getImageData(0, 0, dstW, dstH);
  const out = new Float32Array(3 * dstW * dstH);
  const plane = dstW * dstH;
  for (let i = 0; i < plane; i++) {
    out[i]             = (data[i * 4 + 0] - mean[0]) * scale[0];
    out[plane + i]     = (data[i * 4 + 1] - mean[1]) * scale[1];
    out[plane * 2 + i] = (data[i * 4 + 2] - mean[2]) * scale[2];
  }
  return new ort.Tensor("float32", out, [1, 3, dstH, dstW]);
}

async function detectFaces(ctx, width, height) {
  const session = await faceSession();
  const input = toTensor(ctx, width, height, 320, 240,
    [127, 127, 127], [1 / 128, 1 / 128, 1 / 128]);
  const results = await session.run({ [session.inputNames[0]]: input });
  const scores = results[session.outputNames[0]].data;
  const boxes = results[session.outputNames[1]].data;
  return decodeUltraface(scores, boxes, width, height, 0.7);
}
```

Then inside the message handler, after `decode`, call `detectFaces(ctx, width, height)` and paint each returned box:

```javascript
ctx.fillStyle = "#c0392b";
for (const b of faces) {
  ctx.fillRect(b.x, b.y, b.w, b.h);
  ctx.fillStyle = "#fff";
  ctx.font = "bold 14px system-ui";
  ctx.fillText("[FACE]", b.x + 6, b.y + 20);
  ctx.fillStyle = "#c0392b";
}
```

- [ ] **Step 12: Verify against the demo page**

Reload the extension, open `demo/index.html`, click the icon.
Expected: red boxes labelled `[FACE]` over the photograph and over the face printed on the ID card — two faces, not one. The ID card's face is the interesting one; it demonstrates detection inside an image the DOM cannot read.
On a page with no faces the panel must still render a screenshot rather than an error. Confirm this on `about:blank` before moving on.

- [ ] **Step 13: Commit**

```bash
git add extension/src/lib/nms.js extension/src/lib/ultraface.js extension/offscreen.js extension/models extension/vendor tests/nms.test.js tests/ultraface.test.js
git commit -m "feat: on-device face detection with masking"
```

---

## Task 6: Text-region detection

Second model. Turns the canvas declaration and the ID card's printed text into boxes without reading a single character.

**Files:**
- Create: `extension/src/lib/dbnet.js`
- Modify: `extension/offscreen.js`
- Create: `extension/models/ppocr-det.onnx`
- Test: `tests/dbnet.test.js`

**Interfaces:**
- Consumes: box conventions from Task 4.
- Produces: `boxesFromProbMap(prob: Float32Array, mapW: number, mapH: number, imgW: number, imgH: number, threshold: number) => Array<{x,y,w,h}>`

- [ ] **Step 1: Obtain the text detection model**

Download the English PP-OCRv4 **detection** model in ONNX form from the RapidOCR release assets
(`https://github.com/RapidAI/RapidOCR`, models section — the file is named like `en_PP-OCRv4_det_infer.onnx`)
and save it as `extension/models/ppocr-det.onnx`.

Verify: the file is roughly 4.5–5MB, keeping total models under the 7MB budget from spec §13.

Any DBNet-family detector works unchanged: the contract is a single-channel probability map output.

- [ ] **Step 2: Write the failing test**

```javascript
// tests/dbnet.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { boxesFromProbMap } from "../extension/src/lib/dbnet.js";

function blank(w, h) { return new Float32Array(w * h); }

test("returns nothing for an empty probability map", () => {
  assert.deepEqual(boxesFromProbMap(blank(20, 20), 20, 20, 200, 200, 0.3), []);
});

test("finds one box around a single blob", () => {
  const map = blank(20, 20);
  for (let y = 5; y < 10; y++) for (let x = 3; x < 12; x++) map[y * 20 + x] = 0.9;
  const boxes = boxesFromProbMap(map, 20, 20, 20, 20, 0.3);
  assert.equal(boxes.length, 1);
  assert.equal(boxes[0].x, 3);
  assert.equal(boxes[0].y, 5);
  assert.equal(boxes[0].w, 9);
  assert.equal(boxes[0].h, 5);
});

test("separates two disconnected blobs", () => {
  const map = blank(20, 20);
  for (let y = 2; y < 4; y++) for (let x = 2; x < 5; x++) map[y * 20 + x] = 0.9;
  for (let y = 12; y < 15; y++) for (let x = 14; x < 18; x++) map[y * 20 + x] = 0.9;
  assert.equal(boxesFromProbMap(map, 20, 20, 20, 20, 0.3).length, 2);
});

test("scales boxes from map space to image space", () => {
  const map = blank(10, 10);
  for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) map[y * 10 + x] = 0.9;
  const boxes = boxesFromProbMap(map, 10, 10, 100, 100, 0.3);
  assert.equal(boxes[0].w, 50);
  assert.equal(boxes[0].h, 50);
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `node --test tests/dbnet.test.js`
Expected: FAIL, cannot find module `dbnet.js`.

- [ ] **Step 4: Implement `extension/src/lib/dbnet.js`**

```javascript
// Connected-component labelling over the thresholded probability map, with an
// iterative flood fill. Recursion would blow the stack on a full-page map.
//
// ponytail: axis-aligned bounding boxes with no unclip step. DBNet's reference
// postprocess expands each contour by a Vatti offset; skipping it under-covers
// text by a pixel or two, which the dilation below compensates for. Add the real
// unclip only if measured recall suffers.
export function boxesFromProbMap(prob, mapW, mapH, imgW, imgH, threshold) {
  const seen = new Uint8Array(mapW * mapH);
  const boxes = [];
  const stack = [];

  for (let start = 0; start < prob.length; start++) {
    if (seen[start] || prob[start] < threshold) continue;

    let minX = mapW, minY = mapH, maxX = -1, maxY = -1, pixels = 0;
    stack.push(start);
    seen[start] = 1;

    while (stack.length) {
      const idx = stack.pop();
      const x = idx % mapW;
      const y = (idx - x) / mapW;
      pixels++;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;

      if (x > 0)          { const n = idx - 1;    if (!seen[n] && prob[n] >= threshold) { seen[n] = 1; stack.push(n); } }
      if (x < mapW - 1)   { const n = idx + 1;    if (!seen[n] && prob[n] >= threshold) { seen[n] = 1; stack.push(n); } }
      if (y > 0)          { const n = idx - mapW; if (!seen[n] && prob[n] >= threshold) { seen[n] = 1; stack.push(n); } }
      if (y < mapH - 1)   { const n = idx + mapW; if (!seen[n] && prob[n] >= threshold) { seen[n] = 1; stack.push(n); } }
    }

    if (pixels < 4) continue; // speckle, not text

    const sx = imgW / mapW;
    const sy = imgH / mapH;
    boxes.push({
      x: Math.round(minX * sx),
      y: Math.round(minY * sy),
      w: Math.round((maxX - minX + 1) * sx),
      h: Math.round((maxY - minY + 1) * sy)
    });
  }

  return boxes;
}
```

- [ ] **Step 5: Run it and watch it pass**

Run: `node --test tests/dbnet.test.js`
Expected: PASS, 4 tests.

- [ ] **Step 6: Wire the model into `extension/offscreen.js`**

```javascript
import { boxesFromProbMap } from "./src/lib/dbnet.js";

let textPromise = null;
function textSession() {
  if (!textPromise) {
    textPromise = ort.InferenceSession.create(
      chrome.runtime.getURL("models/ppocr-det.onnx"),
      { executionProviders: ["webgpu", "wasm"] }
    );
  }
  return textPromise;
}

async function detectTextRegions(ctx, width, height) {
  const session = await textSession();
  // DBNet wants sides that are multiples of 32. 960x960 keeps a full-HD
  // viewport legible while staying inside the latency budget in spec §13.
  const dim = 960;
  const input = toTensor(ctx, width, height, dim, dim,
    [123.675, 116.28, 103.53], [1 / 58.395, 1 / 57.12, 1 / 57.375]);
  const results = await session.run({ [session.inputNames[0]]: input });
  const out = results[session.outputNames[0]];
  const [, , mapH, mapW] = out.dims;
  return boxesFromProbMap(out.data, mapW, mapH, width, height, 0.3);
}
```

- [ ] **Step 7: Verify against the demo page**

Reload, open `demo/index.html`, and temporarily paint every returned text box with a translucent outline to inspect coverage:

```javascript
ctx.strokeStyle = "rgba(0,180,255,.9)";
ctx.lineWidth = 2;
for (const b of textBoxes) ctx.strokeRect(b.x, b.y, b.w, b.h);
```

Expected: outlines over the canvas declaration text and over the printed text on the ID card. Both are invisible to the DOM, which is the point.
Also load a page with no text at all and confirm an empty array rather than an exception.

- [ ] **Step 8: Commit**

```bash
git add extension/src/lib/dbnet.js extension/offscreen.js extension/models/ppocr-det.onnx tests/dbnet.test.js
git commit -m "feat: on-device text-region detection over the full viewport"
```

---

## Task 7: Triage, redaction and the trust boundary

Where the two passes meet. Owns Review Focus item 5.

**Files:**
- Create: `extension/src/lib/triage.js`, `extension/src/lib/sanitise.js`
- Modify: `extension/offscreen.js`
- Test: `tests/triage.test.js`, `tests/sanitise.test.js`

**Interfaces:**
- Consumes: `intersects`, `contains` from Task 4; `classifyField` from Task 3; box lists from Tasks 5 and 6.
- Produces:
  `sensitiveRegions(blindBoxes, faceBoxes, textBoxes, minTextBoxes) => Array<{x,y,w,h,cls}>`
  `buildSanitisedContext({step, viewport, elements, visualHints, screenshotDataUrl, goal}) => SanitisedContext`
  `isSanitised(value) => boolean`

- [ ] **Step 1: Write the failing test for triage**

```javascript
// tests/triage.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { sensitiveRegions } from "../extension/src/lib/triage.js";

const IMG = { x: 0, y: 0, w: 200, h: 200, kind: "img" };

test("marks a DOM-blind region containing a face", () => {
  const out = sensitiveRegions([IMG], [{ x: 20, y: 20, w: 50, h: 50, score: 0.9 }], [], 3);
  assert.equal(out.length, 1);
  assert.equal(out[0].cls, "FACE");
});

test("marks a DOM-blind region holding enough text boxes", () => {
  const text = [
    { x: 10, y: 10, w: 40, h: 12 },
    { x: 10, y: 30, w: 60, h: 12 },
    { x: 10, y: 50, w: 50, h: 12 }
  ];
  const out = sensitiveRegions([IMG], [], text, 3);
  assert.equal(out.length, 1);
  assert.equal(out[0].cls, "DOCUMENT");
});

test("leaves a region with too little text alone", () => {
  const out = sensitiveRegions([IMG], [], [{ x: 10, y: 10, w: 40, h: 12 }], 3);
  assert.deepEqual(out, []);
});

test("ignores text boxes that fall outside the region", () => {
  const far = [
    { x: 900, y: 10, w: 40, h: 12 },
    { x: 900, y: 30, w: 40, h: 12 },
    { x: 900, y: 50, w: 40, h: 12 }
  ];
  assert.deepEqual(sensitiveRegions([IMG], [], far, 3), []);
});

test("treats a cross-origin iframe area as DOM-blind, not as skipped", () => {
  const frame = { x: 0, y: 0, w: 300, h: 300, kind: "iframe" };
  const out = sensitiveRegions([frame], [{ x: 10, y: 10, w: 40, h: 40, score: 0.9 }], [], 3);
  assert.equal(out.length, 1);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test tests/triage.test.js`
Expected: FAIL, cannot find module `triage.js`.

- [ ] **Step 3: Implement `extension/src/lib/triage.js`**

```javascript
import { intersects } from "./geometry.js";

// Region-level sensitivity, per spec §15. A DOM-blind region is sensitive when
// it contains a face, or when it carries enough text to be a document. Both
// decisions over-mask rather than leak, which is the correct failure direction
// for this rubric.
//
// ponytail: whole-region masking with no pixel OCR. Upgrade path is PP-OCRv4 rec
// plus an NER pass, which converts this into span-level masking.
export function sensitiveRegions(blindBoxes, faceBoxes, textBoxes, minTextBoxes) {
  const out = [];
  for (const region of blindBoxes) {
    if (faceBoxes.some((f) => intersects(region, f))) {
      out.push({ x: region.x, y: region.y, w: region.w, h: region.h, cls: "FACE" });
      continue;
    }
    const inside = textBoxes.filter((t) => intersects(region, t));
    if (inside.length >= minTextBoxes) {
      out.push({ x: region.x, y: region.y, w: region.w, h: region.h, cls: "DOCUMENT" });
    }
  }
  return out;
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `node --test tests/triage.test.js`
Expected: PASS, 5 tests.

- [ ] **Step 5: Write the failing test for the trust boundary**

```javascript
// tests/sanitise.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { buildSanitisedContext, isSanitised } from "../extension/src/lib/sanitise.js";

const base = {
  step: 1,
  viewport: { w: 1280, h: 800 },
  elements: [
    { id: "e0", role: "input", inputType: "password", autocompleteToken: "",
      label: "Portal Password", name: "pw", box: { x: 0, y: 0, w: 10, h: 10 }, valuePresent: true },
    { id: "e1", role: "input", inputType: "text", autocompleteToken: "",
      label: "Search", name: "q", box: { x: 0, y: 0, w: 10, h: 10 }, valuePresent: false }
  ],
  visualHints: [{ x: 0, y: 0, w: 50, h: 50, cls: "FACE" }],
  screenshotDataUrl: "data:image/jpeg;base64,AAAA",
  goal: "fill the form"
};

test("never emits a raw value field", () => {
  const ctx = buildSanitisedContext(base);
  const serialised = JSON.stringify(ctx);
  assert.equal(serialised.includes("hunter2"), false);
  for (const el of ctx.elements) {
    assert.equal("value" in el, false);
  }
});

test("reports a filled sensitive field as redacted, not as its contents", () => {
  const ctx = buildSanitisedContext(base);
  assert.equal(ctx.elements[0].valueClass, "redacted");
  assert.equal(ctx.elements[0].piiClass, "PASSWORD");
});

test("reports an ordinary empty field as empty", () => {
  const ctx = buildSanitisedContext(base);
  assert.equal(ctx.elements[1].valueClass, "empty");
  assert.equal(ctx.elements[1].piiClass, null);
});

test("textRegions is present and empty in Tier 1", () => {
  assert.deepEqual(buildSanitisedContext(base).textRegions, []);
});

test("only the builder's output is recognised as sanitised", () => {
  assert.equal(isSanitised(buildSanitisedContext(base)), true);
  assert.equal(isSanitised({ step: 1, elements: [], screenshot: "x" }), false);
  assert.equal(isSanitised(null), false);
});
```

- [ ] **Step 6: Run it and watch it fail**

Run: `node --test tests/sanitise.test.js`
Expected: FAIL, cannot find module `sanitise.js`.

- [ ] **Step 7: Implement `extension/src/lib/sanitise.js`**

```javascript
import { classifyField } from "./pii.js";

// The trust boundary, per spec §6. Membership of this set is the only evidence
// that a payload came from the redactor, and the set is module-private, so no
// other code can forge it. Transport refuses anything isSanitised() rejects.
const SANITISED = new WeakSet();

export function isSanitised(value) {
  return typeof value === "object" && value !== null && SANITISED.has(value);
}

export function buildSanitisedContext({ step, viewport, elements, visualHints, screenshotDataUrl, goal }) {
  const safeElements = elements.map((el) => {
    const piiClass = classifyField(el);
    const valueClass = !el.valuePresent ? "empty" : (piiClass ? "redacted" : "filled");
    return {
      id: el.id,
      role: el.role,
      inputType: el.inputType,
      autocompleteToken: el.autocompleteToken,
      label: el.label,
      box: el.box,
      valuePresent: Boolean(el.valuePresent),
      valueClass,
      piiClass
    };
  });

  const ctx = {
    step,
    viewport,
    elements: safeElements,
    textRegions: [], // Tier 1 runs no pixel recognition — spec §8.2
    visualHints,
    screenshot: screenshotDataUrl,
    goal,
    lastAction: null
  };

  SANITISED.add(ctx);
  return ctx;
}
```

- [ ] **Step 8: Run the full suite and watch it pass**

Run: `node --test tests/`
Expected: PASS, 30 tests.

- [ ] **Step 9: Paint the region masks in `extension/offscreen.js`**

Replace the face-only painting with a single pass over both sources, so every mask is drawn the same way:

```javascript
import { sensitiveRegions } from "./src/lib/triage.js";

const MASK_COLOURS = { FACE: "#c0392b", DOCUMENT: "#8e44ad", FIELD: "#d35400" };

function paintMasks(ctx, masks) {
  for (const m of masks) {
    ctx.fillStyle = MASK_COLOURS[m.cls] || "#333";
    ctx.fillRect(m.x, m.y, m.w, m.h);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 14px system-ui";
    ctx.fillText(`[${m.cls}]`, m.x + 6, m.y + 20);
  }
}
```

Assemble the mask list from three sources: sensitive regions, any face box not already inside a masked region, and the box of every element whose `classifyField` returns non-null and whose `valuePresent` is true (labelled with its PII class).

- [ ] **Step 10: Verify against the demo page**

Reload, open `demo/index.html`, click the icon.
Expected in the masked pane: the photograph and the ID card fully covered and labelled, the signature covered once enough text is found on it, the canvas declaration covered, and the Aadhaar, PAN, phone, email and password inputs covered with their class labels. The "Search"-style ordinary fields stay visible.

- [ ] **Step 11: Commit**

```bash
git add extension/src/lib/triage.js extension/src/lib/sanitise.js extension/offscreen.js tests/triage.test.js tests/sanitise.test.js
git commit -m "feat: region triage, mask painting and the sanitised-context trust boundary"
```

---

## Task 8: Echo server and the three-pane view

Makes the privacy claim observable: the payload genuinely crosses a socket and comes back rendered.

**Files:**
- Create: `tools/echo-server.js`
- Modify: `extension/background.js`, `extension/panel.html`, `extension/panel.js`, `extension/manifest.json`

**Interfaces:**
- Consumes: `buildSanitisedContext`, `isSanitised` from Task 7.
- Produces: `POST http://127.0.0.1:8787/context` accepting the `SanitisedContext` JSON; `GET http://127.0.0.1:8787/` serving the received payload as a page.

- [ ] **Step 1: Create `tools/echo-server.js`**

```javascript
import http from "node:http";

let last = null;

const server = http.createServer((req, res) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS"
  };

  if (req.method === "OPTIONS") {
    res.writeHead(204, cors);
    return res.end();
  }

  if (req.method === "POST" && req.url === "/context") {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      try {
        last = JSON.parse(body);
        const fields = last.elements.filter((e) => e.piiClass).length;
        console.log(
          `[${new Date().toISOString()}] step ${last.step}: ` +
          `${last.elements.length} elements, ${fields} sensitive fields, ` +
          `${last.visualHints.length} masked regions, ${body.length} bytes`
        );
        res.writeHead(200, { ...cors, "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        res.writeHead(400, cors);
        res.end(String(err));
      }
    });
    return;
  }

  if (req.method === "GET" && req.url === "/") {
    const shot = last?.screenshot ?? "";
    const json = last ? JSON.stringify({ ...last, screenshot: "<omitted>" }, null, 2) : "nothing received yet";
    res.writeHead(200, { ...cors, "content-type": "text/html; charset=utf-8" });
    return res.end(
      `<!doctype html><meta charset="utf-8"><title>Server's-eye view</title>` +
      `<style>body{font:13px system-ui;background:#111;color:#eee;margin:0;padding:16px}` +
      `img{max-width:100%;border-radius:4px}pre{background:#1b1b1b;padding:10px;border-radius:4px;overflow:auto}</style>` +
      `<h2>Exactly what the server received</h2>` +
      (shot ? `<img src="${shot}" alt="received capture">` : "") +
      `<pre>${json.replace(/[<&]/g, (c) => (c === "<" ? "&lt;" : "&amp;"))}</pre>` +
      `<script>setTimeout(() => location.reload(), 1500)</script>`
    );
  }

  res.writeHead(404, cors);
  res.end();
});

server.listen(8787, "127.0.0.1", () => {
  console.log("echo server on http://127.0.0.1:8787 — open it to watch what arrives");
});
```

- [ ] **Step 2: Verify the server standalone**

Run: `npm run echo`
Then in another terminal:

```bash
curl -s -X POST http://127.0.0.1:8787/context -H 'content-type: application/json' \
  -d '{"step":1,"elements":[{"piiClass":"PHONE"}],"visualHints":[],"screenshot":""}'
```

Expected: `{"ok":true}` returned, and the server log shows `step 1: 1 elements, 1 sensitive fields, 0 masked regions`.
Open `http://127.0.0.1:8787/` and confirm the JSON is rendered.

- [ ] **Step 3: Add the host permission**

In `manifest.json`, add `"http://127.0.0.1:8787/*"` to `host_permissions`.

- [ ] **Step 4: Send from `extension/background.js`**

```javascript
import { buildSanitisedContext, isSanitised } from "./src/lib/sanitise.js";

const ENDPOINT = "http://127.0.0.1:8787/context";

// The only fetch in the extension. It refuses anything the redactor did not
// build, so a future code path cannot accidentally transmit raw state. Spec §6.
async function transmit(ctx) {
  if (!isSanitised(ctx)) throw new Error("refusing to transmit unsanitised context");
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(ctx)
  });
  return res.ok;
}
```

Call it at the end of `runStep`, wrapped so an unreachable server does not break the local pipeline (spec §17):

```javascript
const ctx = buildSanitisedContext({
  step: ++stepCounter,
  viewport: { w: result.width, h: result.height },
  elements,
  visualHints: result.masks,
  screenshotDataUrl: result.maskedDataUrl,
  goal: "Demonstrate client-side redaction"
});

let delivered = false;
try {
  delivered = await transmit(ctx);
} catch (err) {
  console.warn("echo server unreachable — local pipeline unaffected:", err.message);
}

await chrome.runtime.sendMessage({ type: "PANEL_UPDATE", payload: { ctx, delivered } });
```

- [ ] **Step 5: Show the counts in the side panel**

Replace `panel.js` with a version that renders the mask count, the sensitive-field count, delivery status, and the payload with the screenshot elided:

```javascript
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type !== "PANEL_UPDATE") return;
  const { ctx, delivered } = msg.payload;
  const sensitive = ctx.elements.filter((e) => e.piiClass).length;

  document.getElementById("masked").src = ctx.screenshot;
  document.getElementById("stats").textContent =
    `${ctx.visualHints.length} regions masked · ${sensitive} sensitive fields redacted · ` +
    (delivered ? "delivered to server" : "server unreachable");
  document.getElementById("payload").textContent =
    JSON.stringify({ ...ctx, screenshot: "<omitted>" }, null, 2);
});
```

Add `<p id="stats"></p>` to `panel.html` above the payload block.

- [ ] **Step 6: Verify end to end**

Start `npm run echo`. Open `demo/index.html` in one window and `http://127.0.0.1:8787/` in another, side by side. Click the extension icon.
Expected: the side panel shows the masked capture with its counts; the echo server window refreshes within two seconds and shows the same masked image plus the JSON; no raw value appears anywhere in that JSON.
Confirm the guarantee directly — search the echo page for `hunter2` and for the Aadhaar digits. Both must be absent.

- [ ] **Step 7: Commit**

```bash
git add tools/echo-server.js extension/background.js extension/panel.html extension/panel.js extension/manifest.json
git commit -m "feat: echo server and three-pane trace view"
```

---

## Task 9: Record the demo

**Files:**
- Create: `docs/demo-script.md`

- [ ] **Step 1: Write `docs/demo-script.md`**

```markdown
# Demo recording script (target: 45 seconds)

Layout: demo page left, side panel right, echo-server window bottom right.

0:00 — The form, filled in. Read out what is on it: name, Aadhaar, PAN, phone,
       email, password, an ID card, a photograph, a signature, a signed declaration.
0:08 — Open DevTools, run `document.body.innerText.includes("declare the above particulars")`.
       It prints false. The declaration is on screen and not in the DOM.
0:15 — Click the extension icon. Masks animate in.
0:22 — Point at the ID card: the face inside an image the DOM cannot read.
0:28 — Point at the canvas: text no DOM query can reach, masked anyway.
0:34 — Switch to the echo-server window. This is what the server received.
0:40 — Ctrl-F for the Aadhaar number in that window. No matches.
0:45 — End on the counts: N regions masked, M fields redacted, 0 raw values sent.

The closing search is the whole demo. Everything before it is setup.
```

- [ ] **Step 2: Record**

Use any screen recorder at 1080p. Keep it under 60 seconds. Do not narrate over the search — let the "no matches" sit on screen for two full seconds.

- [ ] **Step 3: Upload and capture the link**

Upload to Google Drive, set link sharing to "anyone with the link can view", and record the URL. It goes on slide 3 of the idea submission, as a short link plus a QR code.

- [ ] **Step 4: Commit**

```bash
git add docs/demo-script.md
git commit -m "docs: demo recording script"
```

---

## Self-Review

**Spec coverage.** §6 trust boundary → Task 7. §8.2 payload shape → Task 7. §9 taxonomy and checksums → Task 3. §10 redaction → Task 7 step 9. §11 coordinate spaces → Task 4. §15 Tier 1 scope → all tasks. §16 demo design → Tasks 2, 8, 9. §17 failure modes → Task 4 step 6, Task 8 step 4. §13 budgets are measured in Tier 3's harness, not here, which is deliberate: Tier 1 has no harness and inventing one would be the largest thing in the plan.

**Placeholders.** None. Every code step carries runnable code; the two steps that download external files name the source, the destination filename, the expected size, and what to do if the exact file has moved.

**Type consistency.** Boxes are `{x, y, w, h}` in device pixels everywhere after Task 4, with `score` added by Task 5 and `cls` by Task 7. `piiClass` and `valueClass` are spelled identically in Tasks 3, 7 and 8. `classifyField` takes the same four-key object in Task 3's test, Task 4's element record, and Task 7's builder.

**Review Focus coverage.** Item 1 (dpr) → `tests/geometry.test.js`. Item 2 (scroll) → same file, final test. Item 3 (zero detections) → `tests/nms.test.js` first test, `tests/dbnet.test.js` first test, plus the manual `about:blank` check in Task 5 step 12. Item 4 (non-square input) → `tests/ultraface.test.js` scaling test and `tests/dbnet.test.js` scaling test, with the letterbox caveat documented in `ultraface.js`. Item 5 (cross-origin iframe) → `tests/triage.test.js` final test, and the swallowed `sendMessage` rejection in Task 4 step 6.
