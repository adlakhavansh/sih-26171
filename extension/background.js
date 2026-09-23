// Orchestrator. Owns viewport capture and the single network call.

import { buildSanitisedContext, isSanitised } from "./src/lib/sanitise.js";

const ENDPOINT = "http://127.0.0.1:8787/context";

let stepCounter = 0;

// The only fetch in the extension. It refuses anything the redactor did not
// build, so a future code path cannot transmit raw state by accident — the
// guarantee is enforced here rather than promised elsewhere. Spec §6.
async function transmit(ctx) {
  if (!isSanitised(ctx)) throw new Error("refusing to transmit unsanitised context");
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(ctx)
  });
  return res.ok;
}

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

// Every frame gets its own content script, and each numbers its elements from
// e0 — so the ids collide the moment a page has an iframe. The merge reassigns
// them, which is also the only place that can: no frame can see another's.
async function collectDom(tabId) {
  let frameIds = [0];
  try {
    const frames = await chrome.webNavigation.getAllFrames({ tabId });
    if (frames) frameIds = frames.map((f) => f.frameId);
  } catch (err) {
    console.warn("frame enumeration failed, using top frame only:", err.message);
  }

  const elements = [];
  const blindBoxes = [];
  for (const frameId of frameIds) {
    let report;
    try {
      report = await chrome.tabs.sendMessage(tabId, { type: "DOM_REPORT" }, { frameId });
    } catch {
      // No content script here — cross-origin or a restricted frame. Its pixels
      // are still in the screenshot, so the vision pass covers the area. This
      // degrades to over-masking, never to leaking. Spec §17.
      continue;
    }
    if (!report) continue;
    for (const el of report.elements) {
      elements.push({ ...el, id: `e${elements.length}` });
    }
    blindBoxes.push(...report.blindBoxes);
  }
  return { elements, blindBoxes };
}

async function runStep(tab) {
  await ensureOffscreen();

  const { elements, blindBoxes } = await collectDom(tab.id);
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
  const result = await chrome.runtime.sendMessage({
    type: "OFFSCREEN_PROCESS",
    dataUrl,
    elements,
    blindBoxes
  });

  if (!result || result.type === "OFFSCREEN_ERROR") {
    console.error("perception failed, nothing rendered:", result?.message);
    return;
  }

  const ctx = buildSanitisedContext({
    step: ++stepCounter,
    viewport: { w: result.width, h: result.height },
    elements,
    visualHints: result.masks,
    screenshotDataUrl: result.maskedDataUrl,
    goal: "Demonstrate client-side redaction"
  });

  // An unreachable server must not break the local pipeline: perception and
  // redaction have already happened and are worth showing either way. Spec §17.
  let delivered = false;
  try {
    delivered = await transmit(ctx);
  } catch (err) {
    console.warn("echo server unreachable, local pipeline unaffected:", err.message);
  }

  await tellPanel({
    ctx,
    delivered,
    backend: result.backend,
    elapsedMs: result.elapsedMs,
    textBoxCount: result.textBoxCount,
    blindCount: blindBoxes.length
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
