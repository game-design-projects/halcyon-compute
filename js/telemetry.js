/* Halcyon Compute — gameplay telemetry.
 * Records a *replayable* log: seed + every applied action with its game day (the sim is deterministic, so
 * tools/replay.js can rebuild the exact game), plus what the player saw (chapters, toasts, drawers, speed changes,
 * rejected actions) and periodic state snapshots used to verify the replay.
 * Local: TELE.exportFile() downloads the log as JSON (HUD button / main menu).
 * Remote (optional): if an endpoint is configured (?telemetry=https://… or window.HALCYON_TELEMETRY_URL) and the player
 * hasn't opted out, batches are POSTed every 30 s and on page hide. Anonymous: random player/session ids, no PII.
 */
(function () {
  "use strict";
  const LOG_V = 1, MAX_ITEMS = 50000, BATCH_MS = 30000;
  const params = new URLSearchParams(location.search);
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage blocked: telemetry still works in memory */ } },
  };
  const rid = () => (crypto && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));
  const player = store.get("halcyon.player") || (() => { const p = rid(); store.set("halcyon.player", p); return p; })();
  const endpoint = (params.get("telemetry") || window.HALCYON_TELEMETRY_URL || "").trim();
  const debug = params.has("debug");
  const dlog = (...a) => { if (debug) console.log("[tele]", ...a); };

  let log = null, outbox = [], seq = 0, lastSend = 0, t0 = performance.now();

  function enabled() { return store.get("halcyon.telemetry") !== "off"; }
  function setEnabled(on) { store.set("halcyon.telemetry", on ? "on" : "off"); dlog("remote", on ? "on" : "off"); }
  const rt = () => Math.round(performance.now() - t0);        // real ms since page load (pacing, pauses)
  const clone = o => JSON.parse(JSON.stringify(o));

  function push(kind, item) {
    if (!log) return;
    const it = Object.assign({ k: kind, rt: rt() }, item);
    const list = kind === "act" || kind === "rej" ? log.actions : kind === "snap" ? log.snaps : log.events;
    if (log.actions.length + log.events.length + log.snaps.length >= MAX_ITEMS) { log.truncated = true; return; }
    list.push(it);
    if (endpoint && enabled()) outbox.push(it);
  }

  const TELE = {
    endpoint, player,
    get log() { return log; },
    enabled, setEnabled,
    start(seed, opts) {
      opts = opts || {};
      if (log && endpoint && enabled()) TELE.flush(true);
      log = {
        v: LOG_V, build: window.HALCYON_BUILD || "dev", session: rid(), player,
        startedAt: new Date().toISOString(), seed, sandbox: !!opts.sandbox, continued: !!opts.continued,
        startDay: opts.day || 0, lang: navigator.language, screen: `${screen.width}x${screen.height}@${devicePixelRatio}`,
        viewport: `${innerWidth}x${innerHeight}`, ua: navigator.userAgent.slice(0, 160), embedded: window.top !== window,
        actions: [], events: [], snaps: [],
      };
      seq = 0; outbox = [];
      if (endpoint && enabled()) outbox.push({ k: "session", rt: rt(), meta: Object.assign({}, log, { actions: undefined, events: undefined, snaps: undefined }) });
      dlog("session", log.session, "seed", seed);
    },
    action(day, a, ok, msg) { push(ok ? "act" : "rej", { d: +day.toFixed(4), a: clone(a), msg: ok ? undefined : msg }); },
    event(day, type, data) { push("ev", { d: day == null ? null : +(+day).toFixed(2), t: type, data: data == null ? undefined : clone(data) }); },
    snap(s, score) {
      push("snap", { d: +s.day.toFixed(2), cash: +s.cash.toFixed(2), score: score == null ? undefined : +(+score).toFixed(1),
        chapter: s.chapter, racks: s.racks.filter(r => r.devices.length).length, devices: s.racks.reduce((n, r) => n + r.devices.length, 0) });
    },
    end(s, summary) { push("ev", { d: +s.day.toFixed(2), t: "over", data: clone({ over: s.over, summary }) }); TELE.flush(true); },
    exportJSON() { return JSON.stringify(Object.assign({ exportedAt: new Date().toISOString() }, log), null, 1); },
    exportFile() {
      if (!log) return false;
      const name = `halcyon-seed${log.seed}-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.json`;
      const blob = new Blob([TELE.exportJSON()], { type: "application/json" });
      try {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob); a.download = name;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
        dlog("exported", name, blob.size);
        return name;
      } catch (e) { dlog("download failed", e); return false; }
    },
    async copyToClipboard() {
      try { await navigator.clipboard.writeText(TELE.exportJSON()); return true; } catch (e) { return false; }
    },
    /* Reliable delivery: items are cut into numbered batches (≤ 48 KB each, so they also fit sendBeacon/keepalive),
       kept in a pending queue (mirrored to localStorage) and removed only after the Worker answers 2xx. Every batch
       carries the session meta, so a lost first batch can't orphan a session. The Worker ignores duplicates
       (session, seq), so resending is safe. */
    flush(final) {
      if (!endpoint || !enabled() || !log) return;
      while (outbox.length) {
        const items = [];
        let size = 0;
        while (outbox.length && (items.length === 0 || size + JSON.stringify(outbox[0]).length < BATCH_BYTES)) {
          const it = outbox.shift(); size += JSON.stringify(it).length; items.push(it);
        }
        pending.push({ session: log.session, body: JSON.stringify({ v: LOG_V, session: log.session, player, seed: log.seed, build: log.build, seq: seq++, meta: metaOf(log), items }) });
      }
      savePending();
      lastSend = performance.now();
      sendPending(final);
    },
    tick() {
      if (!endpoint || !enabled()) return;
      const now = performance.now();
      if (outbox.length && now - lastSend > BATCH_MS) TELE.flush(false);
      else if (pending.length && !inflight && now - lastTry > backoff) sendPending(false);
    },
    get pendingCount() { return pending.length; },
  };
  const BATCH_BYTES = 48000, PKEY = "halcyon.tele.pending", PMAX = 400;
  let pending = [], inflight = false, lastTry = 0, backoff = 5000;
  try { pending = JSON.parse(store.get(PKEY) || "[]"); if (!Array.isArray(pending)) pending = []; } catch (e) { pending = []; }
  function metaOf(l) {
    const m = {};
    for (const k of ["v", "build", "session", "player", "startedAt", "seed", "sandbox", "continued", "startDay", "lang", "screen", "viewport", "ua", "embedded"]) m[k] = l[k];
    return m;
  }
  function savePending() {
    if (pending.length > PMAX) pending.splice(0, pending.length - PMAX);           // bounded; oldest go first
    let json = JSON.stringify(pending);
    while (json.length > 3e6 && pending.length) { pending.shift(); json = JSON.stringify(pending); }
    store.set(PKEY, json);
  }
  function sendPending(final) {
    if (!pending.length || (inflight && !final)) return;
    lastTry = performance.now();
    if (final && navigator.sendBeacon) {                // page is going away: best effort, keep what the browser refuses
      const keep = [];
      for (const p of pending) { let ok = false; try { ok = navigator.sendBeacon(endpoint, new Blob([p.body], { type: "text/plain" })); } catch (e) { ok = false; } if (!ok) keep.push(p); }
      // a queued beacon is not proof of delivery, but the Worker dedups by (session, seq), so keep a copy for next load
      store.set(PKEY, JSON.stringify(keep.length ? keep : pending));
      return;
    }
    const p = pending[0];
    inflight = true;
    fetch(endpoint, { method: "POST", body: p.body, headers: { "content-type": "text/plain" }, keepalive: p.body.length < 60000, mode: "cors" })
      .then(r => {
        inflight = false;
        if (r.ok || r.status === 400 || r.status === 413) {         // delivered, or permanently rejected: drop it
          if (!r.ok) dlog("batch rejected", r.status);
          pending.shift(); savePending(); backoff = 5000;
          if (pending.length) sendPending(false);
        } else { backoff = Math.min(300000, backoff * 2); dlog("send failed", r.status, "retry in", backoff); }
      })
      .catch(e => { inflight = false; backoff = Math.min(300000, backoff * 2); dlog("send failed", e.message, "retry in", backoff); });
  }
  if (pending.length) setTimeout(() => { if (endpoint && enabled()) sendPending(false); }, 3000);   // leftovers from a previous visit
  addEventListener("pagehide", () => TELE.flush(true));
  addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") TELE.flush(true); });
  window.addEventListener("error", e => push("ev", { d: null, t: "jsError", data: { msg: String(e.message).slice(0, 300), src: (e.filename || "").split("/").pop(), line: e.lineno } }));
  window.TELE = TELE;
})();
