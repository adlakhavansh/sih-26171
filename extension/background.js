// Orchestrator. Owns viewport capture and the single network call.

import { buildSanitisedContext, isSanitised } from "./src/lib/sanitise.js";
import { connectBridge } from "./src/bridge-client.js";
import { configuredKeys, resolveVaultValue } from "./src/lib/vault.js";
import { validateAction } from "./src/lib/action.js";

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

const BRIDGE_URL = "ws://127.0.0.1:8788";

// The handles of the step the planner has actually seen. An `act` that does not
// match this is acting on a page nobody perceived.
let currentStep = null;
let bridgeState = "disconnected";

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
  const handles = new Map();
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
    for (let i = 0; i < report.elements.length; i++) {
      const el = report.elements[i];
      const id = `e${elements.length}`;
      elements.push({ ...el, id });
      // The planner sees only `id`. This map is how the client turns that back
      // into a node, and it never leaves the service worker.
      handles.set(id, { frameId, localIndex: i, tag: el.tag, label: el.label, name: el.name, inputType: el.inputType });
    }
    blindBoxes.push(...report.blindBoxes);
  }
  return { elements, blindBoxes, handles };
}

async function runStep(tab, goal = "Demonstrate client-side redaction") {
  await ensureOffscreen();

  const { elements, blindBoxes, handles } = await collectDom(tab.id);
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
    goal
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

  currentStep = { tabId: tab.id, handles };
  return ctx;
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

async function handlePerceive({ goal }) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return { ok: false, reason: "no active tab" };

  const ctx = await runStep(tab, goal || "Complete the form");
  if (!ctx) return { ok: false, reason: "perception failed" };

  // The same gate the echo server goes through. Adding a consumer adds a
  // consumer, not an exit. Tier 2 spec §6.
  if (!isSanitised(ctx)) return { ok: false, reason: "refusing to send unsanitised context" };

  const { vault = {} } = await chrome.storage.local.get("vault");
  return { ok: true, context: ctx, vaultKeys: configuredKeys(vault) };
}

async function handleAct(action) {
  if (!currentStep) return { ok: false, reason: "nothing has been perceived yet" };

  const { vault = {} } = await chrome.storage.local.get("vault");
  const check = validateAction(action, {
    elementIds: [...currentStep.handles.keys()],
    vaultKeys: configuredKeys(vault)
  });
  if (!check.ok) return { ok: false, reason: check.reason };

  if (action.action === "done" || action.action === "ask_user") {
    return { ok: true, finished: true, reason: action.reason };
  }

  let value;
  if (action.action === "type" || action.action === "select") {
    const resolved = resolveVaultValue(vault, action.valueKey);
    if (!resolved.ok) return { ok: false, reason: resolved.reason };
    value = resolved.value;
  }

  const handle = currentStep.handles.get(action.target) || { frameId: 0, localIndex: -1 };
  const response = await chrome.tabs.sendMessage(
    currentStep.tabId,
    {
      type: "DOM_ACT",
      localIndex: handle.localIndex,
      expect: { tag: handle.tag, label: handle.label, name: handle.name, inputType: handle.inputType },
      action: action.action,
      value
    },
    { frameId: handle.frameId }
  );

  // The step the planner reasoned about is spent. It must perceive again before
  // it may act again.
  currentStep = null;
  return response || { ok: false, reason: "no response from page" };
}

connectBridge({
  url: BRIDGE_URL,
  onPerceive: handlePerceive,
  onAct: handleAct,
  onStatus: ({ state }) => {
    bridgeState = state;
    // Review Focus 5: a reconnect means the worker may have restarted, so the
    // ids the planner holds no longer describe anything.
    if (state !== "connected") currentStep = null;
    tellPanel(lastPayload ? { ...lastPayload, bridgeState } : { bridgeState });
  }
});
