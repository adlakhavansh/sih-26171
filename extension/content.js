// Classic script — MV3 content scripts cannot be ES modules, so the two geometry
// helpers are inlined rather than imported. Kept deliberately small.
//
// This script classifies nothing. It reports standard DOM semantics and lets the
// redactor decide what is sensitive (spec §6). No CSS selector here is keyed to
// any site: input types, autocomplete tokens, ARIA roles and label proximity are
// the whole vocabulary, which is what makes the pass work on pages nobody has
// seen (spec §3).

(function () {
  // Reloading the extension orphans this script in already-open tabs, so the
  // background re-injects it on demand. Injection is therefore not once-per-page
  // and the listener must not stack up.
  if (window.__agentDomReporterReady) return;
  window.__agentDomReporterReady = true;

  const INTERACTIVE =
    "input,select,textarea,button,a[href],[role=button],[role=textbox],[contenteditable=true]";
  const BLIND = "img,canvas,svg,video,iframe,object,embed";

  function labelFor(el) {
    if (el.labels && el.labels.length) return el.labels[0].innerText.trim();
    const aria = el.getAttribute("aria-label");
    if (aria) return aria.trim();
    const id = el.getAttribute("id");
    if (id) {
      const lab = document.querySelector(`label[for="${CSS.escape(id)}"]`);
      if (lab) return lab.innerText.trim();
    }
    const parentLabel = el.closest("label");
    if (parentLabel) return parentLabel.innerText.trim();
    return "";
  }

  // A nested frame's contents are positioned relative to that frame. Walking up
  // to the top window accumulates the offset so every box lands in one space.
  // Cross-origin parents throw on access; we stop there and the frame's area is
  // handled by the vision pass instead (spec §17).
  function frameOffset() {
    let x = 0;
    let y = 0;
    let win = window;
    while (win !== window.top) {
      let frameEl;
      try {
        frameEl = win.frameElement;
      } catch {
        break;
      }
      if (!frameEl) break;
      const r = frameEl.getBoundingClientRect();
      x += r.left;
      y += r.top;
      win = win.parent;
    }
    return { x, y };
  }

  function visible(r) {
    return r.width > 2 && r.height > 2 &&
      r.bottom > 0 && r.right > 0 &&
      r.top < window.innerHeight && r.left < window.innerWidth;
  }

  function collect() {
    const dpr = window.devicePixelRatio || 1;
    const off = frameOffset();
    const scale = (r) => ({
      x: Math.round((r.left + off.x) * dpr),
      y: Math.round((r.top + off.y) * dpr),
      w: Math.round(r.width * dpr),
      h: Math.round(r.height * dpr)
    });

    const elements = [];
    let n = 0;
    for (const el of document.querySelectorAll(INTERACTIVE)) {
      const r = el.getBoundingClientRect();
      if (!visible(r)) continue;
      elements.push({
        // Ephemeral, per step. Nothing about this page can be learned across
        // steps or cached by anything downstream (spec §8.1).
        id: `e${n++}`,
        tag: el.tagName.toLowerCase(),
        role: el.getAttribute("role") || el.tagName.toLowerCase(),
        inputType: el.type || "",
        autocompleteToken: el.getAttribute("autocomplete") || "",
        label: labelFor(el),
        name: el.getAttribute("name") || "",
        box: scale(r),
        // Whether a value exists — never the value itself. The distinction is
        // the whole point (spec §8.2).
        valuePresent: Boolean(el.value && String(el.value).length)
      });
    }

    const blindBoxes = [];
    for (const el of document.querySelectorAll(BLIND)) {
      const r = el.getBoundingClientRect();
      if (!visible(r)) continue;
      blindBoxes.push({ ...scale(r), kind: el.tagName.toLowerCase() });
    }

    return { elements, blindBoxes, dpr };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type !== "DOM_REPORT") return false;
    sendResponse(collect());
    return true;
  });
})();
