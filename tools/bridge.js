// An MCP server that is also the WebSocket server the extension dials into.
//
// It holds no model and no policy: it is a transport with a deliberately narrow
// surface. Two tools exist and there is no raw accessor, so a hostile consumer
// has nothing to call that could return an unredacted page. Parent spec §5,
// Tier 2 spec §4.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { WebSocketServer } from "ws";
import { z } from "zod";

const PORT = 8788;
const HOST = "127.0.0.1";
const TIMEOUT_MS = 60000;

let client = null;
let nextId = 1;
const pending = new Map();

// Bound to loopback. The extension dials out to this; nothing off-machine may
// dial in.
const wss = new WebSocketServer({ host: HOST, port: PORT });

wss.on("connection", (ws) => {
  // One extension at a time. A second connection replaces the first rather than
  // racing it for the same pending map.
  if (client && client !== ws && client.readyState === client.OPEN) client.close();
  client = ws;
  // stdio carries the MCP protocol, so every log goes to stderr.
  console.error("[bridge] extension connected");

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (msg.type === "ping") {
      ws.send(JSON.stringify({ type: "pong" }));
      return;
    }
    const settle = pending.get(msg.id);
    if (!settle) return;
    pending.delete(msg.id);
    settle(msg.result);
  });

  ws.on("close", () => {
    console.error("[bridge] extension disconnected");
    if (client === ws) client = null;
    // Nothing is coming back for these. Fail them now rather than leaving the
    // planner to sit out the full timeout.
    for (const [id, settle] of pending) {
      pending.delete(id);
      settle({ ok: false, reason: "extension disconnected" });
    }
  });
});

wss.on("error", (err) => {
  console.error(`[bridge] websocket server error: ${err.message}`);
  process.exit(1);
});

function request(type, payload) {
  if (!client || client.readyState !== client.OPEN) {
    return Promise.resolve({ ok: false, reason: "extension not connected" });
  }
  const id = nextId++;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    client.send(JSON.stringify({ id, type, payload }));
    setTimeout(() => {
      if (!pending.has(id)) return;
      pending.delete(id);
      resolve({ ok: false, reason: "extension timed out" });
    }, TIMEOUT_MS).unref?.();
  });
}

const server = new McpServer({ name: "privacy-browser-agent", version: "0.1.0" });

server.registerTool(
  "perceive",
  {
    title: "Perceive the page",
    description:
      "Capture the active tab and return a redacted description of it. " +
      "Faces, identity documents and sensitive field values are removed before " +
      "this returns. Field values are never included; each field reports only " +
      "whether it is empty, filled or redacted.",
    inputSchema: { goal: z.string().describe("What the user is trying to accomplish") }
  },
  async ({ goal }) => {
    const result = await request("perceive", { goal });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "act",
  {
    title: "Perform one action",
    description:
      "Perform a single action against the page. Targets are the ephemeral " +
      "element ids from the most recent perceive call. A type action names a " +
      "vault key; the browser supplies the value. Literal values are rejected.",
    inputSchema: {
      action: z.enum(["click", "type", "scroll", "select", "submit", "done", "ask_user"]),
      target: z.string().optional(),
      valueKey: z.string().optional(),
      reason: z.string()
    }
  },
  async (args) => {
    const result = await request("act", args);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

await server.connect(new StdioServerTransport());
console.error(`[bridge] MCP server ready, websocket on ${HOST}:${PORT}`);
