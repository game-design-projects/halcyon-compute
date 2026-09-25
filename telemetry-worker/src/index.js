/* Halcyon Compute telemetry sink (Cloudflare Worker + D1).
 * POST /v1/batch           body = {v, session, player, seed, build, seq, items[]} (sent as text/plain: no CORS preflight)
 * GET  /v1/sessions        admin: recent sessions (Authorization: Bearer $ADMIN_TOKEN)
 * GET  /v1/session/:id     admin: the merged log, same shape as the in-game "Export log" (feed it to tools/replay.js)
 */
const MAX_BODY = 256 * 1024;
const cors = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-allow-headers": "content-type,authorization" };
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", ...cors } });
const isId = s => typeof s === "string" && /^[A-Za-z0-9-]{8,64}$/.test(s);

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { headers: cors });

    if (req.method === "POST" && url.pathname === "/v1/batch") {
      const len = +(req.headers.get("content-length") || 0);
      if (len > MAX_BODY) return json({ error: "too large" }, 413);
      let b;
      try { const text = await req.text(); if (text.length > MAX_BODY) return json({ error: "too large" }, 413); b = JSON.parse(text); }
      catch { return json({ error: "bad json" }, 400); }
      if (!isId(b.session) || !Number.isInteger(b.seq) || b.seq < 0 || b.seq > 100000 || !Array.isArray(b.items) || b.items.length > 5000)
        return json({ error: "bad batch" }, 400);
      await env.DB.prepare("INSERT OR IGNORE INTO batches (session, seq, player, seed, build, items) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(b.session, b.seq, isId(b.player) ? b.player : null, Number.isInteger(b.seed) ? b.seed : null,
          String(b.build || "").slice(0, 64), JSON.stringify(b.items))
        .run();
      return json({ ok: true });
    }

    if (req.method === "GET" && url.pathname.startsWith("/v1/")) {
      if (!env.ADMIN_TOKEN || req.headers.get("authorization") !== `Bearer ${env.ADMIN_TOKEN}`) return json({ error: "unauthorized" }, 401);
      if (url.pathname === "/v1/sessions") {
        const { results } = await env.DB.prepare(
          "SELECT session, player, seed, build, MIN(received_at) AS first, MAX(received_at) AS last, COUNT(*) AS batches FROM batches GROUP BY session ORDER BY last DESC LIMIT 200").all();
        return json(results);
      }
      const m = url.pathname.match(/^\/v1\/session\/([A-Za-z0-9-]{8,64})$/);
      if (m) {
        const { results } = await env.DB.prepare("SELECT seq, player, seed, build, items FROM batches WHERE session = ? ORDER BY seq").bind(m[1]).all();
        if (!results.length) return json({ error: "not found" }, 404);
        const items = results.flatMap(r => JSON.parse(r.items));
        const meta = (items.find(i => i.k === "session") || {}).meta || {};
        return json(Object.assign({}, meta, {
          session: m[1], seed: results[0].seed, build: results[0].build,
          actions: items.filter(i => i.k === "act" || i.k === "rej"),
          events: items.filter(i => i.k === "ev"),
          snaps: items.filter(i => i.k === "snap"),
        }));
      }
    }
    return json({ error: "not found" }, 404);
  },
};
