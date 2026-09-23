# Demo recording script

Target: 45 seconds. Under 60 is the limit — a slide QR code buys attention for
about a minute.

## Before recording

1. `bash tools/fetch-deps.sh` — pulls ONNX Runtime and the face model.
2. Drop a real portrait at `demo/assets/face.jpg` (see `demo/assets/README.md`).
   The placeholder will not be detected as a face.
3. `npm run echo` in a terminal.
4. Load `extension/` unpacked at `chrome://extensions` with Developer mode on.
5. Serve the demo page over http, not `file://` — content scripts do not run on
   `file://` URLs unless the extension is granted file access:
   `npx --yes serve demo -l 5500` then open `http://localhost:5500`.

## Layout

Demo page on the left, extension side panel on the right, the echo-server window
(`http://127.0.0.1:8787`) bottom right. All three visible at once.

## Beats

| Time | What is on screen |
|---|---|
| 0:00 | The filled form. Name it out: name, Aadhaar, PAN, phone, email, password, an ID card, a photograph, a signature, a signed declaration. |
| 0:08 | DevTools console: `document.body.innerText.includes("declare the above particulars")` → `false`. The declaration is on screen and not in the DOM. |
| 0:15 | Click the extension icon. Masks appear. |
| 0:22 | Point at the ID card — a face inside an image the DOM cannot read. |
| 0:28 | Point at the canvas — text no DOM query can reach, masked anyway. |
| 0:34 | Switch to the echo-server window. This is what the server received. |
| 0:40 | Ctrl-F the Aadhaar number in that window. No matches. |
| 0:45 | End on the counts: N regions masked, M fields redacted, 0 raw values sent. |

The closing search is the demo. Everything before it is setup.

## Recording notes

- 1080p. Any recorder.
- Do not narrate over the search. Let "0 of 0" sit on screen for two full seconds.
- If the face is missed, check `face.jpg` is a real photograph. The ID card and
  canvas still mask via the text-count route, so the demo survives — but the
  photograph is the cleanest single moment in it.

## After recording

Upload to Google Drive, set sharing to "anyone with the link can view", and keep
the URL. It goes on slide 3 of the idea submission as a short link plus a QR
code, and again on slide 6.
