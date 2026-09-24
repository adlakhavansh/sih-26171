// Orchestrator. Owns viewport capture and the single network call.

import { buildSanitisedContext, isSanitised } from "./src/lib/sanitise.js";

// If this line is missing from the service worker console, the worker failed to
// start and no click handler exists — which looks exactly like a dead button.
console.log("[agent] service worker started", new Date().toISOString());

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

// chrome.sidePanel.open() resolves before panel.js has run, so the first
// PANEL_UPDATE of a session is sent to a page that is not listening yet and is
// silently dropped. That makes the first click of a fresh panel look like
// nothing happened — which is the opening move of the demo.
//
// Keeping the last payload here and letting the panel pull it on load fixes it
// from the receiving end, and costs one message.
let lastPayload = null;

async function tellPanel(payload) {
  lastPayload = payload;
  try {
    await chrome.runtime.sendMessage({ type: "PANEL_UPDATE", payload });
  } catch (err) {
    // Panel closed or not yet listening. The local pipeline does not depend on
    // anything downstream of it. Spec §17.
    console.warn("side panel not listening:", err.message);
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "PANEL_REQUEST_LAST") {
    sendResponse(lastPayload);
    return true;
  }

  // The panel drives the run. Whether clicking the toolbar icon fires
  // action.onClicked or just opens the panel differs between Chrome versions,
  // and a demo cannot rest on which one this machine does.
  if (msg.type === "RUN_STEP") {
    (async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab) throw new Error("no active tab");
        await runStep(tab);
        sendResponse({ ok: true });
      } catch (err) {
        console.error("[agent] step failed:", err);
        sendResponse({ ok: false, error: String(err && err.message || err) });
      }
    })();
    return true;
  }

  return false;
});

// Reloading the extension leaves the old content script orphaned in tabs that
// were already open, and the declarative registration does not re-run until the
// page reloads. Asking first and injecting only when that fails keeps the fast
// path fast and stops the whole DOM pass from silently collapsing to zero
// elements because of the order someone happened to reload things in.
async function askFrame(tabId, frameId) {
  try {
    return await chrome.tabs.sendMessage(tabId, { type: "DOM_REPORT" }, { frameId });
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: [frameId] },
      files: ["content.js"]
    });
    return await chrome.tabs.sendMessage(tabId, { type: "DOM_REPORT" }, { frameId });
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
      report = await askFrame(tabId, frameId);
    } catch (err) {
      // No content script here — cross-origin or a restricted frame. Its pixels
      // are still in the screenshot, so the vision pass covers the area. This
      // degrades to over-masking, never to leaking. Spec §17. Logged because a
      // silently skipped top frame looks identical to a page with no fields.
      console.warn(`frame ${frameId} reported no DOM:`, err.message);
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

// Clicking the toolbar icon opens the panel, full stop. The panel's own button
// then runs a step. One deterministic path instead of two version-dependent ones.
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((err) => console.error("[agent] setPanelBehavior failed:", err));

// Kept as a fallback for Chrome versions where the behaviour above is ignored
// and onClicked fires instead.
chrome.action.onClicked.addListener(async (tab) => {
  console.log("[agent] icon clicked on", tab.url);
  try {
    await chrome.sidePanel.open({ windowId: tab.windowId });
  } catch (err) {
    console.error("[agent] could not open side panel:", err);
  }
});
