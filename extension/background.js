// Orchestrator. Owns viewport capture and, from Task 8, the single network call.

async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["BLOBS"],
    justification: "Decode the captured screenshot and run local vision models on it."
  });
}

// The side panel is a listener that may not exist yet. A missing panel must not
// abort the step: the local pipeline does not depend on anything downstream of
// it. Spec §17.
async function tellPanel(payload) {
  try {
    await chrome.runtime.sendMessage({ type: "PANEL_UPDATE", payload });
  } catch (err) {
    console.warn("side panel not listening:", err.message);
  }
}

async function runStep(tab) {
  await ensureOffscreen();

  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
  const result = await chrome.runtime.sendMessage({ type: "OFFSCREEN_PROCESS", dataUrl });

  if (!result || result.type === "OFFSCREEN_ERROR") {
    console.error("perception failed, nothing rendered:", result?.message);
    return;
  }

  await tellPanel({
    width: result.width,
    height: result.height,
    maskedDataUrl: result.maskedDataUrl
  });
}

chrome.action.onClicked.addListener(async (tab) => {
  await chrome.sidePanel.open({ windowId: tab.windowId });
  try {
    await runStep(tab);
  } catch (err) {
    console.error("step failed:", err);
  }
});
