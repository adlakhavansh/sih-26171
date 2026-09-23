import { intersects } from "./geometry.js";
import { classifyField } from "./pii.js";

// Region-level sensitivity, per spec §15. A DOM-blind region is sensitive when
// it contains a face, or when it carries enough text to be a document. Both
// decisions over-mask rather than leak, which is the correct failure direction
// for this rubric: a missed span costs under detection recall AND under
// redaction precision, an over-mask costs once under visual accuracy.
//
// ponytail: whole-region masking with no pixel OCR. Upgrade path is PP-OCRv4 rec
// plus an NER pass, which converts this into span-level masking.

export function sensitiveRegions(blindBoxes, faceBoxes, textBoxes, minTextBoxes) {
  const out = [];
  for (const region of blindBoxes) {
    if (faceBoxes.some((f) => intersects(region, f))) {
      out.push({ x: region.x, y: region.y, w: region.w, h: region.h, cls: "FACE" });
      continue;
    }
    const inside = textBoxes.filter((t) => intersects(region, t));
    if (inside.length >= minTextBoxes) {
      out.push({ x: region.x, y: region.y, w: region.w, h: region.h, cls: "DOCUMENT" });
    }
  }
  return out;
}

// A field is masked when it is classified sensitive AND holds a value. An empty
// sensitive field has nothing to hide, and masking it would cost visual accuracy
// for no privacy gain — the planner still needs to see that the box is there and
// empty in order to fill it.
export function fieldMasks(elements) {
  const out = [];
  for (const el of elements) {
    if (!el.valuePresent) continue;
    const cls = classifyField(el);
    if (!cls) continue;
    out.push({ x: el.box.x, y: el.box.y, w: el.box.w, h: el.box.h, cls });
  }
  return out;
}
