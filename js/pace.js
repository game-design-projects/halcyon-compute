/* Halcyon Compute — pace ghost (v0.3). The Greedy and Planner bots replay the player's seed in the background, advanced in
 * whole days up to the player's current day and never beyond it, so the HUD can show "you vs greedy vs planner" mid-game
 * and the end screen can compare instantly.
 * - createRunner(Sim, Bots): pure logic (Node-testable): init / to(day) / finish() / work(ms) / rows().
 * - Pace.start(opts): browser host. Runs the runner in a Web Worker built from the already-loaded factory sources
 *   (window.__factories), so it needs no extra file fetch and works from file://. Falls back to the main thread
 *   (greedy only, sliced in idle time) when workers are unavailable: a planner day can take 30 ms, which would drop frames.
 * Classic script (window.Pace) + CommonJS.
 */
(function (root, factory) {
  const P = factory();
  if (typeof module === "object" && module.exports) module.exports = P;
  else { root.Pace = P; (root.__factories = root.__factories || {}).pace = factory; }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const POLS = ["greedy", "planner"];

  /* the bots, day by day. Bot state at day d = Bots.play's state after d days (same seed, same sandbox flag). */
  function createRunner(Sim, Bots, pols) {
    pols = pols || POLS;
    let g = null;
    return {
      init(seed, sandbox, day) {
        g = { target: Math.max(0, Math.floor(day || 0)), finish: false, t: {}, b: {} };
        for (const p of pols) { g.b[p] = { s: Sim.newGame(seed, { sandbox: !!sandbox }), mem: {}, fn: Bots.POLICIES[p] }; g.t[p] = 0; }
      },
      /* the player reached `day`: bots may catch up to floor(day), never further (no future leakage) */
      to(day) { if (g) g.target = Math.max(g.target, Math.min(Sim.K.END_DAY, Math.floor(day))); },
      /* the player's game is over: play the bots to the end for the final comparison */
      finish() { if (g) { g.finish = true; g.target = Sim.K.END_DAY; } },
      busy() { return !!g && pols.some(p => { const s = g.b[p].s; return !s.over && s.day < g.target; }); },
      /* play whole bot days for about `ms`; greedy first (cheap), so the chip fills in quickly. Returns days played. */
      work(ms, now) {
        if (!g) return 0;
        now = now || (() => Date.now());
        const t0 = now();
        let n = 0;
        for (const p of pols) {
          const b = g.b[p];
          while (!b.s.over && b.s.day < g.target && now() - t0 < ms) {
            const t1 = now();
            b.fn(b.s, b.mem); Sim.advance(b.s, 1); n++;
            g.t[p] += now() - t1;
          }
          if (now() - t0 >= ms) break;
        }
        return n;
      },
      rows() {
        const out = {};
        if (g) for (const p of pols) { const s = g.b[p].s; out[p] = { day: Math.floor(s.day), score: Sim.score(s), over: s.over, ms: Math.round(g.t[p]) }; }
        return { target: g ? g.target : 0, finish: g ? g.finish : false, rows: out };
      },
      state(p) { return g && g.b[p] ? g.b[p].s : null; },
    };
  }

  /* worker body (serialized): receives init / to / finish, answers with {type:"rows"} after each work slice */
  function workerMain(self, Sim, Bots, createRunner) {
    const R = createRunner(Sim, Bots);
    let gen = 0, timer = null;
    const pump = () => {
      timer = null;
      const n = R.work(12);
      if (n) self.postMessage(Object.assign({ type: "rows", gen }, R.rows()));
      if (R.busy()) timer = setTimeout(pump, 0);
    };
    const kick = () => { if (!timer) timer = setTimeout(pump, 0); };
    self.onmessage = e => {
      const m = e.data || {};
      try {
        if (m.type === "init") { gen = m.gen; R.init(m.seed, m.sandbox, m.day); self.postMessage(Object.assign({ type: "rows", gen }, R.rows())); }
        else if (m.type === "to") R.to(m.day);
        else if (m.type === "finish") R.finish();
        kick();
      } catch (err) { self.postMessage({ type: "error", gen, msg: String(err && err.stack || err) }); }
    };
  }

  /* browser host: one ghost per game. onRows(rows) is called whenever the bots advance. */
  function start(opts) {
    const g = typeof window !== "undefined" ? window : globalThis;
    const log = opts.log || (() => {});
    let worker = null, alive = true, fallback = null, lastDay = -1;
    const gen = (start.gen = (start.gen || 0) + 1);
    const F = g.__factories || {};
    const api = {
      mode: "worker",
      to(day) { const d = Math.floor(day); if (d !== lastDay && worker) { lastDay = d; worker.postMessage({ type: "to", day: d }); } },
      finish() { if (worker) worker.postMessage({ type: "finish" }); },
      stop() { alive = false; if (worker) worker.terminate(); worker = null; },
    };
    try {
      if (opts.worker === false) throw new Error("disabled");
      if (!F.content || !F.sim || !F.bots || !F.pace || typeof Worker === "undefined") throw new Error("no factories/Worker");
      const src = `"use strict";\nconst C = (${F.content})();\nconst Sim = (${F.sim})(C);\nconst Bots = (${F.bots})(Sim);\n` +
        `const Pace = (${F.pace})();\n(${workerMain})(self, Sim, Bots, Pace.createRunner);\n`;
      const url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
      worker = new Worker(url);
      worker.onmessage = e => {
        const m = e.data;
        if (!alive || m.gen !== gen) return;
        if (m.type === "error") { log("worker error", m.msg); return; }
        opts.onRows(m);
      };
      worker.onerror = e => { log("worker failed", e.message); if (alive) useFallback(); };
      worker.postMessage({ type: "init", gen, seed: opts.seed, sandbox: opts.sandbox, day: opts.day || 0 });
      log("worker up", { seed: opts.seed, sandbox: opts.sandbox, day: opts.day || 0, srcKB: Math.round(src.length / 1024) });
    } catch (err) { log("no worker:", err.message); useFallback(); }
    function useFallback() {
      if (worker) { try { worker.terminate(); } catch (e) { /* ignore */ } worker = null; }
      const R = createRunner(g.Sim, g.Bots, ["greedy"]);      // the planner's 30 ms days would drop frames on the main thread
      R.init(opts.seed, opts.sandbox, opts.day || 0);
      const idle = g.requestIdleCallback || (cb => setTimeout(() => cb({ timeRemaining: () => 4 }), 50));
      const pump = dl => {
        fallback = null;
        if (!alive) return;
        const n = R.work(Math.max(0, Math.min(4, dl.timeRemaining() - 1)), () => performance.now());
        if (n) opts.onRows(Object.assign({ type: "rows", gen, fallback: true }, R.rows()));
        if (R.busy()) fallback = idle(pump);
      };
      api.to = day => { R.to(day); if (!fallback) fallback = idle(pump); };
      api.finish = () => { R.finish(); if (!fallback) fallback = idle(pump); };
      api.mode = "main";
      api.stop = () => { alive = false; };
      opts.onRows(Object.assign({ type: "rows", gen, fallback: true }, R.rows()));
      fallback = idle(pump);
    }
    return api;
  }

  return { createRunner, start, POLS };
});
