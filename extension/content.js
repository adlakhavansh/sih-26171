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

  // collect() and act() must agree on what "e3" means. One walk, used by both.
  function interactiveNodes() {
    const out = [];
    for (const el of document.querySelectorAll(INTERACTIVE)) {
      if (!visible(el.getBoundingClientRect())) continue;
      out.push(el);
    }
    return out;
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
    for (const el of interactiveNodes()) {
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

  // Fires the events a real user's interaction would, so frameworks listening
  // for input/change see the same thing they would from a keyboard.
  function setValue(el, value) {
    const proto = el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(el, value); else el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function act({ localIndex, expect, action, value }) {
    if (action === "scroll") {
      window.scrollBy({ top: Math.round(window.innerHeight * 0.8), behavior: "instant" });
      return { ok: true };
    }

    const nodes = interactiveNodes();
    const el = nodes[localIndex];
    if (!el) return { ok: false, reason: "element no longer present" };

    // The page can change between perceive and act. An index alone would then
    // point at a different control and we would click the wrong thing, which is
    // worse than doing nothing.
    if (expect) {
      if (el.tagName.toLowerCase() !== expect.tag) {
        return { ok: false, reason: "element changed since it was perceived" };
      }
      if (expect.label && labelFor(el) !== expect.label) {
        return { ok: false, reason: "element changed since it was perceived" };
      }
    }

    switch (action) {
      case "click":
        el.click();
        return { ok: true };

      case "type": {
        const typeable = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
        // Review Focus 4: a button has no value to set. Refuse, do not throw.
        if (!typeable) return { ok: false, reason: "target does not accept text" };
        el.focus();
        setValue(el, value);
        return { ok: true };
      }

      case "select": {
        if (!(el instanceof HTMLSelectElement)) {
          return { ok: false, reason: "target is not a select" };
        }
        setValue(el, value);
        return { ok: true };
      }

      case "submit": {
        const form = el.closest("form");
        if (!form) return { ok: false, reason: "target is not inside a form" };
        form.requestSubmit();
        return { ok: true };
      }

      default:
        return { ok: false, reason: `${action} is not executable here` };
    }
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === "DOM_REPORT") {
      sendResponse(collect());
      return true;
    }
    if (msg.type === "DOM_ACT") {
      try {
        sendResponse(act(msg));
      } catch (err) {
        sendResponse({ ok: false, reason: String(err && err.message || err) });
      }
      return true;
    }
    return false;
  });
})();
