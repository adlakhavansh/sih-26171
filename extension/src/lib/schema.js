import { ACTIONS, TARGETED_ACTIONS } from "./action.js";

// Handed to Ollama as `format` each step. Constrained decoding then makes an
// invalid action unrepresentable rather than merely discouraged — which is why
// §12.1 can say schema-level defences hold even when prompt-level ones fail.
//
// Rebuilt per step because the element ids are ephemeral: an injected
// instruction cannot name a target the client did not enumerate this step.

export function buildActionSchema({ elementIds, vaultKeys }) {
  const hasElements = elementIds.length > 0;
  const hasVault = vaultKeys.length > 0;

  // An empty `enum` is not valid JSON Schema, and Ollama errors on it rather
  // than degrading. So an action that needs an empty vocabulary is removed from
  // the action enum instead of being offered with nothing to point at.
  const allowed = ACTIONS.filter((a) => {
    if (TARGETED_ACTIONS.includes(a) && !hasElements) return false;
    if (a === "type" && !hasVault) return false;
    return true;
  });

  const properties = {
    action: { type: "string", enum: allowed },
    reason: { type: "string" }
  };
  if (hasElements) properties.target = { type: "string", enum: [...elementIds] };
  if (hasVault) properties.valueKey = { type: "string", enum: [...vaultKeys] };

  return {
    type: "object",
    properties,
    required: ["action", "reason"],
    // No `value`, and nothing else may be added: the planner has no property
    // through which a literal could travel. Tier 2 spec §5.1.
    additionalProperties: false
  };
}
