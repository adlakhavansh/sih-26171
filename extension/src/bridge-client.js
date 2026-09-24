// The extension dials out. The bridge never initiates: a listening socket
// inside the browser would be a second way in, and an outbound client is not.
// Tier 2 spec §3.1.

const PING_MS = 20000;
const BACKOFF_MS = [1000, 2000, 4000, 8000, 15000];

export function connectBridge({ url, onPerceive, onAct, onStatus }) {
  let socket = null;
  let attempt = 0;
  let pingTimer = null;
  let closed = false;

  function status(state, detail) {
    onStatus?.({ state, detail });
  }

  function open() {
    if (closed) return;
    socket = new WebSocket(url);

    socket.addEventListener("open", () => {
      attempt = 0;
      status("connected");
      // MV3 service workers idle out after 30s and an open socket only keeps
      // one alive while messages flow. Without this the agent dies mid-loop.
      // Tier 2 spec §3.2.
      pingTimer = setInterval(() => {
        if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "ping" }));
      }, PING_MS);
    });

    socket.addEventListener("message", async (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      if (msg.type === "pong") return;

      let result;
      try {
        if (msg.type === "perceive") result = await onPerceive(msg.payload || {});
        else if (msg.type === "act") result = await onAct(msg.payload || {});
        else result = { ok: false, reason: `unknown request ${msg.type}` };
      } catch (err) {
        result = { ok: false, reason: String(err && err.message || err) };
      }

      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ id: msg.id, result }));
      }
    });

    socket.addEventListener("close", () => {
      clearInterval(pingTimer);
      pingTimer = null;
      socket = null;
      if (closed) return;
      status("disconnected");
      const wait = BACKOFF_MS[Math.min(attempt++, BACKOFF_MS.length - 1)];
      setTimeout(open, wait);
    });

    socket.addEventListener("error", () => {
      // 'close' always follows; reconnection is handled there.
      status("error");
    });
  }

  open();

  return {
    close() {
      closed = true;
      clearInterval(pingTimer);
      socket?.close();
    }
  };
}
