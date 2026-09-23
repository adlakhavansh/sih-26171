# On-device Visual Perception for Light-weight Browser Agents

SIH 2026, problem statement **26171** (ISRO / Department of Space).

A browser extension that perceives a web page using both its DOM and its raw
pixels, finds personally identifiable information in each, masks it locally, and
sends only the masked result anywhere. Nothing sensitive leaves the machine,
and the demo lets you watch that happen rather than take it on trust.

This repository is **Tier 1**: local perception and redaction, no planner. The
full design — including the server-side VLM, the MCP bridge and the multi-step
action loop — is in the spec.

- Design: `docs/superpowers/specs/2026-09-23-sih26171-design.md`
- Build plan: `docs/superpowers/plans/2026-09-23-tier1-perception-redaction.md`
- Demo script: `docs/demo-script.md`

## Running it

```bash
bash tools/fetch-deps.sh          # ONNX Runtime + face model (~48MB, not in git)
npm test                          # 67 tests, no framework, no dependencies
npm run echo                      # the receiving end, on 127.0.0.1:8787
npx --yes serve demo -l 5500      # the demo page over http
```

Then load `extension/` unpacked at `chrome://extensions` with Developer mode on,
open `http://localhost:5500`, and click the extension icon.

The portrait at `demo/assets/face.jpg` is machine-generated and depicts nobody —
see `demo/assets/README.md` before replacing it.

## How it works

```
content script  ──→  DOM semantics, every frame
                     input types, autocomplete tokens, ARIA roles, labels
                            │
service worker  ──→  captureVisibleTab
                            │
offscreen doc   ──→  face detection      (UltraFace, 1.2MB, whole viewport)
                     text-region detect  (PP-OCRv4, 4.5MB, boxes only)
                     triage + masking
                            │
                     ┌──────┴──────┐
                     │ the one     │  refuses anything the redactor
                     │ fetch()     │  did not build
                     └──────┬──────┘
                            │
echo server     ──→  renders exactly what arrived
```

Two properties are worth pointing at:

**Nothing is keyed to any site.** The DOM pass reads only standard semantics,
the vision pass reads arbitrary pixels. The finale is judged on pages nobody has
seen, so anything site-specific would score well in rehearsal and fail on the day.

**The boundary is structural.** `buildSanitisedContext` is the only function that
can produce a value the transport accepts, and the set proving it is
module-private. Raw values have no path to the network — not by discipline, by
construction. `tests/no-leak.test.js` holds it to that using the demo page's own
secrets.

## Deliberate limits

Tier 1 reads no pixel text. A DOM-blind region containing a face, or enough text
to look like a document, is masked whole. That over-masks — a logo with three
words on it gets covered — and over-masking is the right way to be wrong here: a
missed span costs twice in the rubric, an over-mask costs once. Per-token
precision needs OCR plus NER, which is Tier 3.

## Layout

```
extension/        the MV3 extension, loaded unpacked, no build step
  src/lib/        pure logic — no DOM, no chrome, no window; this is what tests run
  models/         ONNX models (gitignored, fetched)
  vendor/ort/     ONNX Runtime Web (gitignored, fetched)
demo/             the target page, seeded with pixel-only PII
tools/            echo server, dependency fetcher
tests/            node:test, one file per module
```
