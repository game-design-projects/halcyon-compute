/* Halcyon Compute — pure UI logic for the v0.4 QOL pass (no DOM, no sim writes): Node-testable (test/qol.test.js).
 * - reason(msg): classify a Sim.check rejection (cash / space / rack kW / grid / shelf / other) for show-not-tell feedback
 * - offerFit: deliverability of an order-board offer (your spare capacity vs what it needs)
 * - blueprint / blueprintDiff: copy a rack's layout, turn it into the actions that rebuild it on another rack
 * - fillPlan: shift+drag fill (how many copies of an order fit, as a list of actions)
 * - undoPre / undoEntry / resolveUndo: multi-step undo for reversible actions, expressed as ordinary sim actions
 * - alerts: live problems (no switch, failed part, throttling, SLA at risk, idle capacity, runway)
 * Every action produced here is an ordinary sim action; the UI still sends each one through act() → Sim.check/apply.
 * Classic script (window.QOL) + CommonJS.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.QOL = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* ---------- rejection reasons ---------- */
  function reason(msg) {
    const m = String(msg || "");
    if (/^Needs \$|Not enough cash|Fit-out needs \$/.test(m)) return "cash";
    if (/^Needs \d+U/.test(m)) return "space";
    if (/^Rack limit|^Rack would draw/.test(m)) return "kw";
    if (/^Grid limit/.test(m)) return "grid";
    if (/Shelf full/.test(m)) return "shelf";
    return "other";
  }

  /* ---------- order board: can you deliver this offer? ---------- */
  function offerFit(Sim, S, o, st) {
    st = st || Sim.stats(S);
    const cap = Sim.capacity(S, st), owed = Sim.owedNow(S);
    const m = o.kind === "frontier" ? "frontier" : o.w;
    const need = Math.max(1e-9, +o.units || (Sim.isJob(o) ? o.work / o.days : 0));
    const free = Math.max(0, (cap[m] || 0) - (owed[m] || 0));
    const frac = free / need;
    return { market: m, need, free, frac, level: frac >= 1 - 1e-9 ? "ok" : frac >= 0.5 ? "part" : "none" };
  }
  /* which racks would serve an offer if it were signed and active now (preview; the real state is untouched) */
  function servePreview(Sim, S, o) {
    const p = Sim.shallowClone(S);
    const fake = Object.assign({}, o, { id: "__preview", signed: S.day, start: S.day, delivered: 0, missed: 0, penaltyPaid: 0, missDays: 0, streak: 0 });
    if (Sim.isJob(fake)) Object.assign(fake, { done: 0, deadline: S.day + o.days, end: S.day + o.days + (o.lateMax || 0) });
    else fake.end = S.day + o.days;
    p.contracts = S.contracts.concat([fake]);
    const st = Sim.stats(p), racks = {};
    for (const l of st.alloc) if (l.id === "__preview") racks[l.rack] = (racks[l.rack] || 0) + l.u;
    return racks;
  }

  /* ---------- blueprints ---------- */
  function blueprint(S, rackId) {
    const r = S.racks.find(x => x.id === rackId);
    if (!r || !r.devices.length && !r.pending.length) return null;
    return { from: r.id, devices: r.devices.concat(r.pending).map(d => d.type), mode: r.mode, workload: r.workload, tank: !!r.tank };
  }
  /* actions that turn rack `rackId` into the blueprint: workload first (so the first GPU does not pick its own), then the
     missing parts (switches first, so the rack is never switchless), then the mode. Parts already there are reused. */
  function blueprintDiff(S, bp, rackId) {
    const r = S.racks.find(x => x.id === rackId);
    if (!r || !bp) return { actions: [], blocked: "rack" };
    if (!!bp.tank !== !!r.tank) return { actions: [], blocked: "tank" };
    const have = {};
    for (const d of r.devices.concat(r.pending)) have[d.type] = (have[d.type] || 0) + 1;
    const missing = [];
    for (const t of bp.devices) { if (have[t] > 0) have[t]--; else missing.push(t); }
    const isNet = t => S.items[t] && S.items[t].role === "net";
    missing.sort((a, b) => (isNet(b) ? 1 : 0) - (isNet(a) ? 1 : 0));
    const actions = [];
    const hasGpu = bp.devices.some(t => S.items[t] && S.items[t].role === "gpu");
    if (hasGpu && r.workload !== bp.workload) actions.push({ type: "workload", rack: r.id, workload: bp.workload });
    for (const t of missing) actions.push({ type: "buy", item: t, rack: r.id });
    if (bp.mode && r.mode !== bp.mode) actions.push({ type: "mode", rack: r.id, mode: bp.mode });
    return { actions, blocked: null };
  }
  /* the next empty rack after `rackId` (same hall first, then any built hall) for "Duplicate rack" */
  function nextEmptyRack(S, rackId, tank) {
    const r0 = S.racks.find(x => x.id === rackId);
    const built = new Set((S.halls || []).filter(h => h.built).map(h => h.n));
    const empty = x => !x.devices.length && !x.pending.length && !!x.tank === !!tank && (!built.size || built.has(x.hall)) &&
      !S.jobs.some(j => j.kind === "tank" && j.rack === x.id);
    const same = S.racks.filter(x => r0 && x.hall === r0.hall && x.id !== rackId && empty(x));
    const any = S.racks.filter(x => x.id !== rackId && empty(x));
    const r = same[0] || any[0];
    return r ? r.id : null;
  }

  /* ---------- shift+drag fill ---------- */
  function fillPlan(Sim, S, op, max) {
    max = max || 20;
    let p = S, n = 0, stop = null, first = null;
    const actions = [];
    while (n < max) {
      const res = Sim.check(p, op);
      if (!res.ok) { stop = res.msg; break; }
      if (!first) first = res.msg;
      actions.push(Object.assign({}, op));
      p = Sim.project(p, op);
      n++;
    }
    if (!stop) { const res = Sim.check(p, op); if (!res.ok) stop = res.msg; }
    const it = op.item && S.items[op.item];
    return { n, actions, cost: op.type === "buy" && it ? n * it.price : 0, stop, msg: first };
  }

  /* ---------- multi-step undo ---------- */
  const rackOf = (S, id) => S.racks.find(x => x.id === id);
  /* what an action's inverse needs from the state BEFORE it is applied */
  function undoPre(S, a) {
    const r = a.rack != null ? rackOf(S, a.rack) : null;
    if (a.type === "mode" && r) return { prev: r.mode };
    if (a.type === "workload" && r) return { prev: r.workload };
    if (a.type === "reorder" && r) return { prev: r.devices.findIndex(d => d.uid === a.uid) };
    if (a.type === "policy") return { prev: a.key === "keepSpares" ? (S.policy && S.policy.keepSpares[a.item]) || 0 : !!(S.policy && S.policy[a.key]) };
    if (a.type === "buy" || a.type === "lease") return { jobs: new Set(S.jobs.map(j => j.id)) };
    return {};
  }
  /* an undo entry for an applied action, or null when it has no clean inverse (signing, hiring, …) */
  function undoEntry(pre, a, S) {
    pre = pre || {};
    switch (a.type) {
      case "mode": return { a, kind: "direct", inv: { type: "mode", rack: a.rack, mode: pre.prev } };
      case "workload": return { a, kind: "direct", inv: { type: "workload", rack: a.rack, workload: pre.prev } };
      case "reorder": return pre.prev >= 0 ? { a, kind: "direct", inv: { type: "reorder", rack: a.rack, uid: a.uid, index: pre.prev } } : null;
      case "policy": return { a, kind: "direct", inv: a.key === "keepSpares" ? { type: "policy", key: "keepSpares", item: a.item, n: pre.prev } : { type: "policy", key: a.key, on: pre.prev } };
      case "transit": return { a, kind: "direct", inv: { type: "transit", delta: -Math.round(a.delta || 0) } };
      case "buy": case "lease": {
        const j = S.jobs.find(x => (x.kind === "buy" || x.kind === "lease") && x.dev && (!pre.jobs || !pre.jobs.has(x.id)));
        return j ? { a, kind: "order", uid: j.dev.uid } : null;
      }
      case "sell": return { a, kind: "sell", uid: a.uid, from: a.rack };
      case "move": return { a, kind: "move", uid: a.uid, from: a.rack, to: a.to };
      case "store": return { a, kind: "store", uid: a.uid, from: a.rack };
      case "unstore": return { a, kind: "unstore", uid: a.uid, to: a.rack };
    }
    return null;
  }
  const jobOn = (S, kind, uid) => S.jobs.find(j => j.kind === kind && j.dev && j.dev.uid === uid);
  const installedIn = (S, id, uid) => { const r = rackOf(S, id); return !!r && r.devices.some(d => d.uid === uid); };
  /* the sim action that undoes `e` in today's state, or null if it can no longer be undone cleanly */
  function resolveUndo(Sim, S, e) {
    if (!e) return null;
    let inv = null;
    if (e.kind === "direct") inv = e.inv;
    else if (e.kind === "order") { const j = S.jobs.find(x => (x.kind === "buy" || x.kind === "lease") && x.dev && x.dev.uid === e.uid); inv = j && j.phase === "ship" ? { type: "cancelJob", id: j.id } : null; }
    else if (e.kind === "sell") {
      const j = jobOn(S, "sell", e.uid);
      if (j) inv = { type: "cancelJob", id: j.id };
      else if ((S.recentlySold || []).some(x => x.uid === e.uid)) inv = { type: "undoSell", uid: e.uid, rack: e.from };
    } else if (e.kind === "move") {
      const j = jobOn(S, "move", e.uid);
      if (j) inv = { type: "cancelJob", id: j.id };
      else if (installedIn(S, e.to, e.uid)) inv = { type: "move", rack: e.to, uid: e.uid, to: e.from };
    } else if (e.kind === "store") {
      const j = jobOn(S, "store", e.uid);
      if (j) inv = { type: "cancelJob", id: j.id };
      else if (S.shelf.some(d => d.uid === e.uid)) inv = { type: "unstore", rack: e.from, uid: e.uid };
    } else if (e.kind === "unstore") {
      const j = jobOn(S, "unstore", e.uid);
      if (j) inv = { type: "cancelJob", id: j.id };
      else if (installedIn(S, e.to, e.uid)) inv = { type: "store", rack: e.to, uid: e.uid };
    }
    return inv && Sim.check(S, inv).ok ? inv : null;
  }
  /* a bounded stack; pop() skips entries that went stale (e.g. an order that already shipped) */
  function undoStack(max) {
    const list = [];
    return {
      push(e) { if (!e) return; list.push(e); if (list.length > (max || 20)) list.shift(); },
      pop(Sim, S) { while (list.length) { const e = list.pop(), inv = resolveUndo(Sim, S, e); if (inv) return { e, inv }; } return null; },
      peek(Sim, S) { for (let i = list.length - 1; i >= 0; i--) { const inv = resolveUndo(Sim, S, list[i]); if (inv) return { e: list[i], inv }; } return null; },
      clear() { list.length = 0; },
      get size() { return list.length; },
    };
  }

  /* ---------- alerts tray ---------- */
  const NEEDS_NET = it => it && (it.role === "cpu" || it.role === "gpu" || it.role === "exotic");
  function alerts(Sim, S, st, opts) {
    opts = opts || {};
    const out = [], item = k => S.items[k];
    for (const r of S.racks) {
      const pr = st.perRack[r.id];
      if (!pr) continue;
      const all = r.devices.concat(r.pending);
      const hasNet = all.some(d => item(d.type).role === "net");
      if (!hasNet && all.some(d => NEEDS_NET(item(d.type))) && !(pr.spine && pr.netF >= 1)) out.push({ kind: "nosw", rack: r.id, sev: 3 });
      const nf = r.devices.filter(d => d.failed).length;
      if (nf) out.push({ kind: "fail", rack: r.id, n: nf, sev: 3 });
      if (pr.throttle < 1 && r.devices.length) out.push({ kind: "hot", rack: r.id, n: Math.round(pr.throttle * 100), sev: 2 });
      if (r.mode !== "off" && pr.out && Sim.contractsOn(S)) {
        const made = (pr.out.web || 0) + (pr.out.train || 0) + (pr.out.infer || 0), used = (pr.to || []).reduce((a, x) => a + x.u, 0);
        if (made - used >= Math.max(1.5, 0.25 * made)) out.push({ kind: "idle", rack: r.id, n: +(made - used).toFixed(1), sev: 1 });
      }
    }
    for (const c of S.contracts) if ((st.cMiss && st.cMiss[c.id] || 0) > 1e-6) {
      const l = (st.alloc || []).find(x => x.id === c.id);
      out.push({ kind: "sla", id: c.id, cust: c.cust, rack: l ? l.rack : null, sev: 3 });
    }
    if (opts.runway != null && opts.runway < 60) out.push({ kind: "runway", n: Math.max(0, Math.round(opts.runway)), sev: opts.runway < 30 ? 3 : 2 });
    out.sort((a, b) => b.sev - a.sev);
    return out;
  }

  /* ---------- contract link colours (stable per contract id) ---------- */
  const LINK = ["#FFD24A", "#5AD1E6", "#FF8FB1", "#9BE15D", "#C79BFF", "#FFA95A", "#7FB2FF", "#F2F2F2"];
  function linkColor(id) {
    // by the numeric part of the id: stable while contracts come and go, and consecutive signings differ
    let n = parseInt(String(id).replace(/\D/g, ""), 10);
    if (!isFinite(n)) { n = 0; for (const ch of String(id)) n = (n * 31 + ch.charCodeAt(0)) >>> 0; }
    return LINK[n % LINK.length];
  }

  return { reason, offerFit, servePreview, blueprint, blueprintDiff, nextEmptyRack, fillPlan, undoPre, undoEntry, resolveUndo, undoStack, alerts, linkColor, LINK };
});
