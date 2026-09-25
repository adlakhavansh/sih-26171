import { ACTIONS, TARGETED_ACTIONS } from "./action.js";

// Handed to Ollama as `format` each step. Constrained decoding then makes an
// invalid action unrepresentable rather than merely discouraged — which is why
// §12.1 can say schema-level defences hold even when prompt-level ones fail.
//
// Rebuilt per step because the element ids are ephemeral: an injected
// instruction cannot name a target the client did not enumerate this step.
//
// One branch per action shape, rather than one flat object. A flat schema can
// only require the fields every action shares, so `type` with no target decodes
// cleanly and is then refused by the validator — which cost a live run its whole
// step budget. Branches let each action carry its own required set, and let a
// typable field carry only the vault key that belongs in it.

// Bounded because an unbounded reason costs real seconds: the model will write
// 500 tokens of justification if allowed, and every one is decoded under the
// grammar. Long enough for a sentence, short enough to keep a step responsive.
const REASON = { type: "string", maxLength: 200 };

// No `value`, and nothing else may be added: the planner has no property
// through which a literal could travel. Tier 2 spec §5.1.
function object(properties, required) {
  return { type: "object", properties, required, additionalProperties: false };
}

function plainBranch(actions) {
  return object({ action: { type: "string", enum: [...actions] }, reason: REASON },
                ["action", "reason"]);
}

function pointingBranch(actions, elementIds) {
  return object({
    action: { type: "string", enum: [...actions] },
    target: { type: "string", enum: [...elementIds] },
    reason: REASON
  }, ["action", "target", "reason"]);
}

// One branch per field, so target and valueKey are locked to each other. Three
// live runs were lost to the model putting `name` into the Aadhaar box and then
// into the submit button; pairing them here removes both moves from the grammar.
function fieldBranch(actions, id, keys) {
  return object({
    action: { type: "string", enum: [...actions] },
    target: { type: "string", enum: [id] },
    valueKey: { type: "string", enum: [...keys] },
    reason: REASON
  }, ["action", "target", "valueKey", "reason"]);
}

// `select` sits with `type` because the executor resolves a vault value for both.
const VAULT_ACTIONS = ["type", "select"];

/**
 * @param elementIds  every element enumerated this step — the click/submit targets
 * @param vaultKeys   the configured vault keys, used when no per-field list is given
 * @param typable     [{ id, keys }] — fields that may still be typed into, each with
 *                    the key(s) it accepts. Omit to let any element take any key.
 */
export function buildActionSchema({ elementIds, vaultKeys, typable }) {
  const fields = (typable ?? elementIds.map((id) => ({ id, keys: vaultKeys })))
    .filter((f) => f.keys.length > 0);

  const plain = ACTIONS.filter((a) => !TARGETED_ACTIONS.includes(a));
  const pointing = TARGETED_ACTIONS.filter((a) => !VAULT_ACTIONS.includes(a));
  const valued = TARGETED_ACTIONS.filter((a) => VAULT_ACTIONS.includes(a));

  const branches = [];

  // An empty `enum` is not valid JSON Schema, and Ollama errors on it rather
  // than degrading. So a branch whose vocabulary would be empty is left out
  // entirely instead of being offered with nothing to point at.
  if (elementIds.length > 0) branches.push(pointingBranch(pointing, elementIds));
  for (const f of fields) branches.push(fieldBranch(valued, f.id, f.keys));
  branches.push(plainBranch(plain));

  return { anyOf: branches };
}
