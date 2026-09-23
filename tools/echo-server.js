// Receives the sanitised payload and renders it back, unchanged.
//
// There is no planner in Tier 1, so this server does nothing useful — which is
// exactly why it exists. It makes the payload cross a real socket and shows the
// receiver's copy, so the privacy claim is something a viewer watches rather
// than something the slide asserts. Spec §16.

import http from "node:http";

const PORT = 8787;
const HOST = "127.0.0.1";

let last = null;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS"
};

function escapeHtml(s) {
  return s.replace(/[<&>]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));
}

function renderPage() {
  if (!last) {
    return `<!doctype html><meta charset="utf-8"><title>Server's-eye view</title>
<style>body{font:14px system-ui;background:#111;color:#888;margin:0;padding:40px;text-align:center}</style>
<p>Nothing received yet. Click the extension icon.</p>
<script>setTimeout(()=>location.reload(),1500)</script>`;
  }

  const sensitive = last.elements.filter((e) => e.piiClass);
  const body = JSON.stringify({ ...last, screenshot: "<omitted from this view>" }, null, 2);

  return `<!doctype html><meta charset="utf-8"><title>Server's-eye view</title>
<style>
  body{font:13px system-ui;background:#111;color:#eee;margin:0;padding:16px}
  h2{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#888;margin:0 0 8px}
  img{max-width:100%;border-radius:4px;display:block}
  pre{background:#1b1b1b;padding:10px;border-radius:4px;overflow:auto;font-size:11px;max-height:50vh}
  .counts{color:#9fd;margin:10px 0}
</style>
<h2>Exactly what the server received</h2>
${last.screenshot ? `<img src="${last.screenshot}" alt="received capture">` : ""}
<p class="counts">step ${last.step} &middot; ${last.elements.length} elements &middot;
${sensitive.length} sensitive fields, all reported as class only &middot;
${last.visualHints.length} regions masked before sending</p>
<pre>${escapeHtml(body)}</pre>
<script>setTimeout(()=>location.reload(),1500)</script>`;
}

const server = http.createServer((req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS);
    return res.end();
  }

  if (req.method === "POST" && req.url === "/context") {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      try {
        const ctx = JSON.parse(body);
        last = ctx;
        const sensitive = ctx.elements.filter((e) => e.piiClass).length;
        console.log(
          `[${new Date().toISOString()}] step ${ctx.step}: ` +
          `${ctx.elements.length} elements, ${sensitive} sensitive fields, ` +
          `${ctx.visualHints.length} masked regions, ${body.length} bytes`
        );
        res.writeHead(200, { ...CORS, "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        res.writeHead(400, CORS);
        res.end(String(err));
      }
    });
    return;
  }

  if (req.method === "GET" && req.url === "/") {
    res.writeHead(200, { ...CORS, "content-type": "text/html; charset=utf-8" });
    return res.end(renderPage());
  }

  res.writeHead(404, CORS);
  res.end();
});

server.listen(PORT, HOST, () => {
  console.log(`echo server on http://${HOST}:${PORT} — open it to watch what arrives`);
});
