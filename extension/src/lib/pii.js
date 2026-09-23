import { verhoeffValid } from "./verhoeff.js";
import { luhnValid } from "./luhn.js";

// Detection signals in descending order of precision, per spec §9. A checksum
// beats a format rule, a format rule beats field context. Recall is favoured
// over precision where they conflict: a miss is scored twice (detection recall
// and redaction precision), an over-mask only once.

const PATTERNS = [
  { cls: "EMAIL",   re: /\b[\w.+-]+@[\w-]+\.[\w.]{2,}\b/g },
  { cls: "PAN",     re: /\b[A-Z]{5}\d{4}[A-Z]\b/g },
  { cls: "AADHAAR", re: /\b\d{4}\s?\d{4}\s?\d{4}\b/g, check: (m) => verhoeffValid(m.replace(/\s/g, "")) },
  { cls: "CARD",    re: /\b(?:\d[ -]?){13,19}\b/g, check: (m) => luhnValid(m.replace(/[\s-]/g, "")) },
  { cls: "PHONE",   re: /\b[6-9]\d{9}\b/g },
  { cls: "DOB",     re: /\b\d{2}[/-]\d{2}[/-]\d{4}\b/g }
];

export function detectSpans(text) {
  const spans = [];
  for (const { cls, re, check } of PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      if (check && !check(m[0])) continue;
      spans.push({ start: m.index, end: m.index + m[0].length, cls });
    }
  }
  // Longest span wins on overlap, so a card number is never reported as the
  // phone number hiding inside it.
  spans.sort((a, b) => (b.end - b.start) - (a.end - a.start));
  const kept = [];
  for (const s of spans) {
    if (kept.some((k) => s.start < k.end && k.start < s.end)) continue;
    kept.push(s);
  }
  return kept.sort((a, b) => a.start - b.start);
}

const LABEL_RULES = [
  { cls: "AADHAAR", re: /aadhaar|aadhar|uidai/i },
  { cls: "PAN",     re: /\bpan\b/i },
  { cls: "PHONE",   re: /mobile|phone|contact number/i },
  { cls: "EMAIL",   re: /e-?mail/i },
  { cls: "DOB",     re: /birth|dob/i },
  { cls: "CARD",    re: /card number|credit|debit/i },
  { cls: "NAME",    re: /name/i }
];

const AUTOCOMPLETE_MAP = {
  "name": "NAME",
  "given-name": "NAME",
  "family-name": "NAME",
  "tel": "PHONE",
  "tel-national": "PHONE",
  "email": "EMAIL",
  "bday": "DOB",
  "cc-number": "CARD",
  "current-password": "PASSWORD",
  "new-password": "PASSWORD",
  "street-address": "ADDRESS",
  "postal-code": "ADDRESS"
};

export function classifyField({ inputType, autocompleteToken, label, name }) {
  if (inputType === "password") return "PASSWORD";
  const token = (autocompleteToken || "").toLowerCase();
  if (AUTOCOMPLETE_MAP[token]) return AUTOCOMPLETE_MAP[token];
  const haystack = `${label || ""} ${name || ""}`;
  for (const { cls, re } of LABEL_RULES) {
    if (re.test(haystack)) return cls;
  }
  return null;
}
