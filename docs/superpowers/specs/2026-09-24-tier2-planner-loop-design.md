# Tier 2 — planner loop, MCP bridge, action execution

**Date:** 24 September 2026
**Status:** approved in conversation, pending written review
**Extends:** `2026-09-23-sih26171-design.md`. That document remains the
architecture of record. This one settles only what Tier 2 (§15) left open, and
amends the parent spec where noted.

## 1. Intent

Tier 1 proved the hard part: a page can be perceived and stripped of PII on the
device, and what leaves is demonstrably clean. It has no planner, so the claim
"the agent works without seeing your data" is argued rather than shown.

Tier 2 closes that. A local open-weights model receives only the redacted view,
decides one action at a time, and the page visibly changes. The privacy boundary
stops being a property of a payload and becomes a property of a working agent.

Scope is set by the 30 September submission: the demo video and deck must show
the loop running and MCP carrying it. Everything here is judged against whether
it survives a sceptical question, not whether it is complete.

## 2. Constraints carried in

- Open-source and open-weights only, per the problem statement. No hosted model.
- Anything the browser agent captures is masked before it reaches the planner.
  This is the user's stated hard requirement and the parent spec's §5 boundary.
- The extension ships to users and stays dependency-free. The two Node processes
  introduced here may take dependencies; the parent spec's "no runtime
  dependencies" decision is narrowed to the extension, not relaxed.
- Six days, one person. Every choice below prefers the version that can be
  finished and filmed over the version that is more complete.

## 3. Topology

```
planner.js --stdio (MCP)--> bridge.js --ws://127.0.0.1:8788--> service worker
     |                                                              |
     +-- HTTP --> Ollama :11434                         content.js / offscreen.js
```

Three processes, each with one job.

**`bridge.js`** — an MCP server over stdio, using `@modelcontextprotocol/sdk`.
It exposes exactly two tools and holds the WebSocket to the extension. It
contains no model and no policy; it is a transport with a narrow surface.

**`planner.js`** — an MCP client. It spawns the bridge as a subprocess, calls
Ollama over HTTP, and runs the loop. Its entire reachable surface is the two
tools the bridge advertises.

**The extension** — unchanged in structure. It gains a WebSocket client, an
action executor, and a vault.

The planner being a separate process is the point, not an accident of layout.
§12.2 of the parent spec assumes a fully compromised planner and argues its
reachable actions are bounded. When the loop lives inside the bridge that
argument is a claim about code nobody can inspect at demo time; when the planner
is a distinct MCP client, the boundary is the process boundary, and any
third-party MCP client can be pointed at the same bridge to make the same point.

### 3.1 Direction of connection

The extension dials out to the bridge. The bridge never initiates. A listening
socket inside the browser would be a second way in; an outbound client is not.

The service worker retries with backoff when the bridge is absent, and the panel
button forces a reconnect. Port 8788, next to the echo server's 8787.

### 3.2 Service worker lifetime

MV3 service workers idle out after 30 seconds, and an open WebSocket keeps one
alive only while messages actually flow. The socket therefore carries a ping
every 20 seconds for as long as a session is open.

This is stated in the design because the failure it prevents — the agent dying
mid-loop while recording — is indistinguishable from a logic bug when it
happens, and the bring-up on 24 September already lost time to exactly that
class of problem.

## 4. Tool surface

The bridge exposes two tools. There is no third, and no raw accessor, so §5's
"a hostile consumer has nothing to call" holds by construction.

### `perceive({ goal }) -> SanitisedContext`

Triggers a capture-and-redact pass in the extension and returns the parent
spec's §8.2 payload: masked screenshot, element descriptions, value classes,
visual hints. Never raw pixels, never field values.

### `act({ action, target, valueKey, reason }) -> ActionResult`

Executes one action against the current page and returns whether it succeeded.
Returns no page content; the planner learns the outcome from the next
`perceive()`.

## 5. Amendments to the parent spec

Two changes to §8.3, both narrowing what the planner can express.

### 5.1 `value: string` becomes `valueKey: enum`

The parent spec says values come from a local vault and the planner only names
the field, but it types the action's `value` as a free string. A free string is
a channel: it relies on the client discarding what the planner sends rather than
on the planner being unable to send it.

`valueKey` is an enum of the vault key names currently configured. The planner
cannot express a literal. The anti-exfiltration property moves from a convention
into the type.

### 5.2 `target` is an enum rebuilt per step

The JSON schema handed to the model each step lists exactly this step's element
IDs as the permitted values of `target`. An injected instruction cannot name an
element the client did not already enumerate, because the decoder will not emit
one.

This is what makes §12.1's ordering real: schema-level defences hold whether or
not the prompt-level ones do. Ollama's `/api/chat` accepts a JSON schema in
`format`, so this is genuine constrained decoding rather than a request the
model may decline.

## 6. The masking gate

Tier 1's trust boundary is a module-private `WeakSet`: a payload can be
transmitted only if the redactor itself stamped it, and no other module can
produce a value the transport accepts.

Tier 2 adds a second destination. The available mistake is a second send path
that reaches the socket without the stamp. It does not exist here: the
WebSocket send goes through the same gate as the echo server. Adding a consumer
adds a consumer, not an exit.

Three things never cross the boundary:

- **Raw screenshots.** Only the masked JPEG is ever encoded for transmission.
- **Field values.** Only `empty` / `filled` / `redacted`.
- **Vault contents.** Stored in `chrome.storage.local`, read only at the instant
  of typing into the page, never serialised into a payload.

## 7. Vault

An options page writes named values to `chrome.storage.local`. Keys are drawn
from the §9 PII taxonomy — name, aadhaar, pan, phone, email.

When the planner returns `act({ action: "type", target: "e3", valueKey: "pan" })`,
the extension resolves `pan` locally and types it. The planner named a field;
the machine supplied the digits.

A UI rather than a JSON file because the vault is the answer to "so where does
the data actually live", and a settings page the user filled in themselves is a
better answer than a file the developer edited.

## 8. Loop and policy

`planner.js` runs: `perceive` → model → validate → `act` → repeat, to a step
cap. It stops on `done`, on `ask_user`, on the cap, or on any validation
failure.

Submission requires `ask_user`, per the parent spec's default policy. The demo
therefore ends before submitting, which is also the honest thing to show.

## 9. Failure behaviour

Every path degrades toward doing nothing.

| Failure | Behaviour |
|---|---|
| Bridge not running | Extension retries with backoff; panel shows disconnected; no action |
| Ollama down or slow | Step times out, loop stops, nothing typed |
| Model output off-schema | Unrepresentable under constrained decoding; validator drops it regardless |
| `target` names an unknown element | Action rejected, step ends |
| Masking fails | Nothing is sent, per Tier 1 |

The belt-and-braces validator is kept even though the decoder should make it
unreachable, because the property it protects is the one the whole submission
rests on.

## 10. Demo

The echo server retires from the clip. It existed as a stand-in for a planner
that did not exist; one exists now.

Three panes: the page, the side panel's masked view, and the planner terminal
showing MCP tool calls and what the model received. Four panes do not fit in
45 seconds legibly.

## 11. Testing

- `no-leak.test.js` extended to the bridge path, using the demo page's own
  secrets, failing if any appears in what the planner would receive. An egress
  without a matching test is how the guarantee rots.
- Schema builder: the `target` enum contains this step's IDs and nothing else.
- Vault resolver: never returns a value the planner named.
- Action validator: rejects unknown targets, unknown keys, off-enum actions.

## 12. Build order

1. Vault options page and action executor in the extension.
2. `bridge.js` and the extension's socket client.
3. `planner.js`, Ollama wiring, per-step schema.
4. Extended no-leak test and end-to-end bring-up.
5. Record.
6. Deck and PDF.

The deck sits last with no slack, which puts the judged artifact behind the
unjudged one. Drafting it in parallel from step 2 is the recommendation on
record.

## 13. Open questions

- **Model tag.** The parent spec says Qwen2.5-VL. Current Ollama documentation
  uses `qwen3-vl`. Resolved at pull time against what exists and what fits in
  8GB; either satisfies the open-weights requirement.
- **Step cap.** Set once real latency is known.
