// Spec §8.3, as amended by the Tier 2 spec §5.1. The planner names a field; it
// cannot express a value. `value` is rejected outright rather than ignored,
// because an ignored field is a channel someone will later decide to honour.

export const ACTIONS = ["click", "type", "scroll", "select", "submit", "done", "ask_user"];
export const TARGETED_ACTIONS = ["click", "type", "select", "submit"];

export function validateAction(action, { elementIds, vaultKeys }) {
  if (!action || typeof action !== "object") return { ok: false, reason: "no action" };

  const { action: kind, target, valueKey, value, reason } = action;

  if (!ACTIONS.includes(kind)) return { ok: false, reason: `${kind} is not an action` };
  if (typeof reason !== "string" || !reason.trim()) {
    return { ok: false, reason: "action must carry a reason" };
  }
  if (value !== undefined) {
    return { ok: false, reason: "an action may not carry a literal value" };
  }

  if (TARGETED_ACTIONS.includes(kind)) {
    if (!target) return { ok: false, reason: `${kind} needs a target` };
    if (!elementIds.includes(target)) {
      return { ok: false, reason: `${target} was not enumerated this step` };
    }
  }

  if (kind === "type") {
    if (!valueKey) return { ok: false, reason: "type needs a valueKey" };
    if (!vaultKeys.includes(valueKey)) {
      return { ok: false, reason: `${valueKey} is not available in the vault` };
    }
  }

  return { ok: true, action };
}
