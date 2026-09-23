chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type !== "PANEL_UPDATE") return;
  const p = msg.payload;
  document.getElementById("masked").src = p.maskedDataUrl;
  document.getElementById("payload").textContent = JSON.stringify(
    { width: p.width, height: p.height }, null, 2
  );
});
