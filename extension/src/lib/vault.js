// The vault is the answer to "where does the data actually live". Values are
// read only at the instant of typing and never enter a payload. Spec §7.
//
// Keys are a fixed vocabulary drawn from the §9 PII taxonomy, not free-form:
// the planner's valueKey enum is built from this list, so a key that is not
// here is a key the planner cannot name. Spec §5.1.

export const VAULT_KEYS = ["name", "aadhaar", "pan", "phone", "email"];

// Which key belongs in a field the classifier has already recognised. The
// classes come from §9's taxonomy, which is broader than the vault: a PASSWORD
// or ADDRESS field has no key here and so is not typable at all.
const KEY_FOR_CLASS = {
  NAME: "name",
  AADHAAR: "aadhaar",
  PAN: "pan",
  PHONE: "phone",
  EMAIL: "email"
};

// The keys a given field may legitimately receive. A recognised field accepts
// exactly one, which is what stops a name being typed into the Aadhaar box: the
// pairing is wrong, so it must be unrepresentable rather than merely unlikely.
// An unrecognised field falls back to the whole configured vault.
export function vaultKeysForField(piiClass, configured) {
  const key = KEY_FOR_CLASS[piiClass];
  if (!key) return piiClass ? [] : [...configured];
  return configured.includes(key) ? [key] : [];
}

function filled(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function configuredKeys(store) {
  return VAULT_KEYS.filter((k) => filled(store?.[k]));
}

export function resolveVaultValue(store, key) {
  if (!VAULT_KEYS.includes(key)) {
    return { ok: false, reason: `${key} is not a vault key` };
  }
  if (!filled(store?.[key])) {
    // Refusing beats typing "undefined" into someone's scholarship form.
    return { ok: false, reason: `${key} is not configured` };
  }
  return { ok: true, value: store[key] };
}
