// Runs the pixel work the service worker cannot: MV3 service workers have no
// DOM, no canvas and no WebGPU, so every image operation lives here.

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
    try {
      const { canvas, width, height } = await decode(msg.dataUrl);
      sendResponse({
        type: "OFFSCREEN_RESULT",
        width,
        height,
        maskedDataUrl: await toDataUrl(canvas),
        masks: []
      });
    } catch (err) {
      // Never answer with a partially processed image: a half-run perception
      // pass means unmasked PII. Spec §17.
      sendResponse({ type: "OFFSCREEN_ERROR", message: String(err) });
    }
  })();
  return true;
});
