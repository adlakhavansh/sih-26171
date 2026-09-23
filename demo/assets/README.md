# Demo assets

`id-card.svg`, `signature.svg` and `face-placeholder.svg` are authored here as plain
SVG, so they carry no binary files and no third party's likeness. All three are
DOM-blind to the perception pipeline exactly as a PNG or JPEG would be: the browser
rasterises them, and nothing inside them appears in the DOM.

## One file you have to supply: `face.jpg`

The face detector is trained on photographs. A drawn face does not reliably trigger
it, so the demo needs one real photographic portrait in this directory, named
`face.jpg`.

Use an AI-generated portrait (thispersondoesnotexist.com or any image generator) or a
stock photo you are licensed to use. Do not use a photograph of a real person who has
not agreed to appear in a recording that goes on a public Drive link.

Until that file exists, `demo/index.html` falls back to `face-placeholder.svg` so the
page still renders. The placeholder will **not** be detected as a face — that is the
point of replacing it.

Keep it under 400KB and roughly portrait-shaped; anything from 200×240 upward is fine.
