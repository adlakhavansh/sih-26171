# Demo assets

`id-card.svg`, `signature.svg` and `face-placeholder.svg` are authored here as plain
SVG, so they carry no binary files and no third party's likeness. All three are
DOM-blind to the perception pipeline exactly as a PNG or JPEG would be: the browser
rasterises them, and nothing inside them appears in the DOM.

## `face.jpg`

The face detector is trained on photographs, and a drawn face does not reliably
trigger it — so the demo needs one real photographic portrait here.

The committed `face.jpg` is machine-generated (1024×1024, from
thispersondoesnotexist.com). It depicts nobody, which is the point: this file ends
up in a screen recording on a public Drive link, and no real person consented to
that. If you replace it, replace it with another generated image or a stock photo
you are licensed to use — never a photograph of someone you know.

Fetch a fresh one with:

```bash
curl -L -A "Mozilla/5.0" -e "https://thispersondoesnotexist.com/" \
  -o demo/assets/face.jpg "https://thispersondoesnotexist.com/random-person.jpeg"
```

The bare domain returns an HTML page, not the image — hence the path and the
referer.

`face-placeholder.svg` is the fallback `demo/index.html` swaps in if `face.jpg` is
missing. It renders fine and will **not** be detected as a face.
