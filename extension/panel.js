chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type !== "PANEL_UPDATE") return;
  const { ctx, delivered, backend, elapsedMs, textBoxCount, blindCount } = msg.payload;

  const sensitive = ctx.elements.filter((e) => e.piiClass);

  document.getElementById("masked").src = ctx.screenshot;

  document.getElementById("stats").textContent =
    `${ctx.visualHints.length} regions masked · ${sensitive.length} sensitive fields redacted · ` +
    `${delivered ? "delivered to server" : "server unreachable"}`;

  document.getElementById("detail").textContent =
    `${backend} · ${elapsedMs}ms · ${ctx.elements.length} elements · ` +
    `${blindCount} DOM-blind regions · ${textBoxCount} text boxes found`;

  // The screenshot is elided here only because a base64 JPEG is unreadable, not
  // because anything is being hidden: it is the masked image shown above.
  document.getElementById("payload").textContent =
    JSON.stringify({ ...ctx, screenshot: "<the masked image above>" }, null, 2);
});
