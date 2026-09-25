/* Reference players for depth measurement. Loads in Node (require) and the browser (window.Bots).
 * idle:    never acts.
 * greedy:  every few days buys whatever raises income *right now* the most per dollar. Myopic:
 *          no seasons, no launches, no vendor risk, never hedges, never pilots; it only sells a part that loses
 *          money *today* (a gut player pulls a rack that runs in the red). It does the
 *          obvious chores (transit for its traffic, auto-repair on, one more technician when repairs pile up,
 *          one less when nobody has worked for a month)
 *          so it is a fair "gut feeling" baseline.
 * planner: plays the heuristics the game teaches (DESIGN.md), across all 17 chapters. It only reads what a
 *          human could see: the public state, the news feed, chapter cards (e.g. the launch calendar) and its
 *          own pilot measurements. Never `s.hidden`, never `s.events`.
 * Every planner action is tagged with the chapter whose mechanic motivated it; `play()` returns the tallies
 * (`used`) so the depth report can show that each chapter changes what the planner does (SPEC §6).
 */
(function (root, factory) {
  const Bots = factory(typeof module === "object" && module.exports ? require("../js/sim.js") : root.Sim);
  if (typeof module === "object" && module.exports) module.exports = Bots;
  else { root.Bots = Bots; (root.__factories = root.__factories || {}).bots = factory; }
})(typeof globalThis !== "undefined" ? globalThis : this, function (Sim) {
  "use strict";
  const K = Sim.K, C = Sim.CONTENT, END = K.END_DAY;
  const TERM_W = K.EARN_MULT * K.EARN_DAYS;          // score $ per $/day of final-quarter profit (SPEC §1)
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
  let DEBUG = false;
  const dbg = (s, ...m) => { if (DEBUG) console.debug(`[bot d${Math.floor(s.day)}]`, ...m); };

  /* ---------------- shared helpers ---------------- */
  const itemRole = (s, d) => s.items[d.type].role;
  function needsSwitch(s, r) { return !r.devices.concat(r.pending).some(d => itemRole(s, d) === "net"); }
  function emptyRacks(s, n) { return s.racks.filter(r => !r.devices.length && !r.pending.length && !r.tank).slice(0, n); }
  const waitingJobs = s => s.jobs.filter(j => j.phase === "wait").length;

  /* racks that would value the same purchase identically share a signature (content, workload, mode, hall,
     spine row and neighbour heat), so only one of them is evaluated */
  function rackSig(s, r, st) {
    const types = r.devices.concat(r.pending).map(d => d.type + (d.failed ? "x" : "") + (d.leased ? "l" : "")).sort().join(",");
    const pr = st.perRack[r.id] || {};
    const base = (r.hall - 1) * K.HALL_RACKS + r.row * K.COLS;
    let nb = 0;
    for (const c of [r.col - 1, r.col + 1]) if (c >= 0 && c < K.COLS) { const o = s.racks[base + c]; if (o && st.perRack[o.id]) nb += st.perRack[o.id].kw; }
    return `${r.hall}|${r.tank ? 1 : 0}|${r.workload}|${r.mode}|${types}|${pr.spine || ""}|${Math.round(nb / 4)}`;
  }

  /* candidate purchase bundles: {acts, cost, item}. opts: skip(k), lease (also offer leases), st (stats) */
  function candidates(s, opts) {
    const out = [], shop = Sim.shopItems(s).filter(k => !opts.skip || !opts.skip(k));
    const st = opts.st || Sim.stats(s);
    const racks = s.racks.filter(r => r.devices.length || r.pending.length || r.tank).concat(emptyRacks(s, 2));
    const seen = new Set();
    for (const r of racks) {
      const sig = rackSig(s, r, st);
      if (seen.has(sig)) continue;
      seen.add(sig);
      const hasGpu = r.devices.concat(r.pending).some(d => itemRole(s, d) === "gpu");
      for (const k of shop) {
        const it = s.items[k];
        if (it.role === "net" && !needsSwitch(s, r) && (st.perRack[r.id] || {}).netF >= 1) continue;
        if (!!it.tank !== !!r.tank && it.role !== "net") continue;
        const wls = it.role === "gpu" && !hasGpu ? Sim.WORKLOADS : [r.workload];
        const kinds = opts.lease && it.role === "gpu" ? ["buy", "lease"] : ["buy"];
        for (const w of wls) for (const kind of kinds) {
          const acts = [];
          if (w !== r.workload) acts.push({ type: "workload", rack: r.id, workload: w });
          if (it.role !== "net" && it.role !== "cool" && it.role !== "mem" && needsSwitch(s, r)) acts.push({ type: "buy", item: "sw", rack: r.id });
          acts.push({ type: kind, item: k, rack: r.id });
          const cost = acts.reduce((a, x) => a + (x.type === "buy" ? s.items[x.item].price : 0), 0);
          out.push({ acts, cost, item: k, kind });
        }
      }
    }
    return out;
  }
  /* apply a bundle to a preview copy; null if any step is invalid */
  function preview(s, acts) {
    let p = s;
    for (const a of acts) {
      if (!Sim.check(p, a).ok) return null;
      p = Sim.project(p, a);
      if (a.type === "buy") p.cash = s.cash;
    }
    return p === s ? Sim.shallowClone(s) : p;
  }
  function doActs(s, acts) { for (const a of acts) if (!Sim.apply(s, a).ok) return false; return true; }

  /* economics of a (projected) state assuming internet transit follows traffic, as both bots keep it (ch7).
     Without this every extra web/inference card would look transit-capped. `p` must be a copy we own. */
  function statsT(p, opts) {
    if (!Sim.on(p, "fabric")) return Sim.stats(p, opts);
    p.transit = K.TRANSIT_MAX;
    const st = Sim.stats(p, opts);
    const need = Math.max(0, Math.ceil((st.supply.web + st.supply.infer) / K.TRANSIT_PER) - K.TRANSIT_FREE + 1);
    st.net += (K.TRANSIT_MAX - need) * K.TRANSIT_COST;
    return st;
  }

  /* chores both bots do the same way: internet transit a unit ahead of web + inference traffic (ch7) */
  function keepTransit(s) {
    if (!Sim.on(s, "fabric")) return false;
    const st = Sim.stats(s), need = Math.ceil((st.supply.web + st.supply.infer) / st.transitF / K.TRANSIT_PER) - K.TRANSIT_FREE + 1;
    const cur = Sim.transitTarget(s);
    if (need > cur) return Sim.apply(s, { type: "transit", delta: need - cur }).ok;
    if (cur > need + 3) return Sim.apply(s, { type: "transit", delta: need + 1 - cur }).ok;
    return false;
  }

  /* ---------------- greedy ---------------- */
  /* sell any part whose removal raises today's income (it loses money right now); identical racks once */
  function greedySellLosers(s) {
    let base = statsT(Sim.shallowClone(s), { eq: true }).net;
    const st = Sim.stats(s), seen = new Set();
    for (const r of s.racks) {
      const sig = rackSig(s, r, st);
      for (const d of r.devices.slice()) {
        const it = s.items[d.type];
        if (it.role === "net" || d.leased) continue;
        const key = sig + "#" + d.type + (d.failed ? "x" : "");
        if (seen.has(key)) continue;
        seen.add(key);
        const a = { type: "sell", rack: r.id, uid: d.uid };
        if (!Sim.check(s, a).ok) continue;
        const n = statsT(Sim.project(s, a), { eq: true }).net;
        if (n > base + 0.05) { Sim.apply(s, a); base = statsT(Sim.shallowClone(s), { eq: true }).net; seen.delete(key); }
      }
    }
  }
  function greedy(s, mem) {
    if (s.day >= (mem.nextHk || 0)) {
      mem.nextHk = s.day + 2;
      keepTransit(s);
      if (Sim.on(s, "ops")) {
        if (!s.repairAuto) Sim.apply(s, { type: "repairPolicy", on: true });
        if (waitingJobs(s) > 5 && !s.hires.length && s.techs < 6) Sim.apply(s, { type: "hire" });
        mem.quiet = s.jobs.length ? 0 : (mem.quiet || 0) + 2;          // idle staff costs money: let one go
        if (mem.quiet >= 30 && s.techs > 3) { Sim.apply(s, { type: "fire" }); mem.quiet = 0; }
      }
    }
    if (s.day >= (mem.nextSell || 0)) { mem.nextSell = s.day + 20; greedySellLosers(s); }
    if (s.day < (mem.next || 0)) return;
    mem.next = s.day + 4;
    const reserve = 40 + Math.max(0, s.debt);        // gut feeling: keep a little cash for bills and taxes
    for (let n = 0; n < 4; n++) {
      const st = Sim.stats(s, { eq: true }), base = statsT(Sim.shallowClone(s), { eq: true }).net;
      let best = null, gridBlocked = false;
      for (const c of candidates(s, { st })) {
        if (c.cost > s.cash - reserve) continue;
        const p = preview(s, c.acts);
        if (!p) { const chk = Sim.check(s, c.acts[c.acts.length - 1]); if (/Grid/.test(chk.msg)) gridBlocked = true; continue; }
        const gain = statsT(p, { eq: true }).net - base;
        if (gain <= 0 || c.cost / gain > CFG.GREEDY_PAYBACK) continue;
        const score = gain / c.cost;
        if (!best || score > best.score) best = Object.assign({ score }, c);
      }
      if (best) { doActs(s, best.acts); continue; }
      const g = Sim.gridNext(s);
      if (gridBlocked && g && Sim.check(s, { type: "grid" }).ok && s.cash > g.cost + 150) Sim.apply(s, { type: "grid" });
      break;
    }
  }

  /* ================= planner ================= */
  const CFG = { STEP: 4, ENDGAME: 420, SPAN: 150, RESIDUAL: 0.3, SPARES: 2, TECH_MAX: 8,
    GREEDY_PAYBACK: 300 };            // greedy: buys only what pays for itself within this many days (gut feeling)
  const SCARE_TITLES = new Set(C.SCARES.map(x => x.title));

  function use(mem, s, key, what) {           // tally: which chapter's mechanic changed the planner's actions
    mem.used[key] = (mem.used[key] || 0) + 1;
    if (mem.trace) mem.trace.push(`d${Math.floor(s.day)} ${key}: ${what}`);
    dbg(s, key, what);
  }
  function note(mem, s, key, what) {          // a decision that kept the status quo (declines, "don't lobby")
    mem.noted[key] = (mem.noted[key] || 0) + 1;
    if (mem.trace) mem.trace.push(`d${Math.floor(s.day)} ${key} (kept): ${what}`);
    dbg(s, key, "(kept)", what);
  }
  function act(s, mem, a, key, why) {
    const r = Sim.apply(s, a);
    if (r.ok && key) use(mem, s, key, why || a.type);
    return r.ok;
  }

  /* ---- reading the news feed (only the public text) ---- */
  function readNews(s, mem) {
    const fresh = s.news.filter(n => n.day >= mem.newsDay && !mem.newsSeen.has(n.day + "|" + n.title));
    for (const n of fresh.reverse()) {
      mem.newsSeen.add(n.day + "|" + n.title);
      const t = n.title;
      if (SCARE_TITLES.has(t)) mem.scare = { day: n.day, real: null };
      else if (t === C.SCARE_FOLLOW.real.title) { mem.scare = { day: n.day, real: true }; mem.expectShock = n.day; }
      else if (t === C.SCARE_FOLLOW.fake.title) { mem.scare = { day: n.day, real: false }; mem.expectShock = null; }
      else if (/^HBM shortage/.test(t)) mem.expectShock = null;
      else if (t === "Breakthrough reproduced by independent labs") { mem.demandCut = true; mem.cutDay = n.day + 15; }
      else if (t === "Breakthrough results fail to replicate") mem.demandCut = false;
      else if (t === "Drought watch issued") mem.drought = { start: n.day + 12, until: n.day + 57, watch: n.day };
      else if (t === "Drought over") mem.drought = null;
      if (n.cat === "press") mem.lastPress = n.day;
      if (n.vendor && n.tone === "bad") mem.risky.add(n.vendor);
    }
    mem.newsDay = Math.floor(s.day) - 1;
  }

  /* ---- policy odds from the indirect signals: p0 ~ U(0.3, 0.8) prior (the range is a guess), each signal is
     "up" with probability p0, and a bill passes with probability p0 (+ lobbying) */
  function passProb(p) {
    let num = 0, den = 0;
    for (let i = 0; i < 50; i++) {
      const p0 = 0.3 + 0.5 * (i + 0.5) / 50;
      let L = 1;
      for (const sg of p.signals) L *= sg.up ? p0 : 1 - p0;
      num += L * clamp(p0 + p.shift, 0.02, 0.98); den += L;
    }
    return num / den;
  }
  function policyOdds(s) {
    const out = {};
    for (const p of s.policies) if (p.announced) out[p.kind] = { p: p.status === "passed" ? 1 : p.status === "failed" ? 0 : passProb(p), vote: p.vote, pol: p };
    return out;
  }

  /* ---- beliefs about the future, cached per decision tick ---- */
  function belief(s, mem) {
    const day = s.day, left = END - day, endgame = left <= CFG.ENDGAME;
    const span = endgame ? left : CFG.SPAN;
    const days = (endgame ? [0.12, 0.5, 0.85].map(f => day + Math.max(9, f * left)) : [day + 10, day + 55, day + 130])
      .map(d => Math.min(END - 1, Math.round(d)));
    const termDay = endgame ? END - 15 : null, termW = endgame ? TERM_W * clamp((left - 10) / 90, 0, 1) : 0;
    const launches = Sim.on(s, "gens") ? Sim.GEN_LAUNCH.filter(g => g > day) : [];   // the ch5 card lists them
    const items = {};
    for (const [k, it] of Object.entries(s.items)) {
      if (it.role !== "exotic") { items[k] = it; continue; }
      const m = s.measured[it.vendor];
      items[k] = Object.assign({}, it, { field: m != null ? m : 0.7 });           // unmeasured hype: assume 70 %
    }
    const odds = Sim.on(s, "policy") ? policyOdds(s) : {};
    const B = { day, left, endgame, span, days, termDay, termW, launches, items, odds, risky: mem.risky, repPoint: repPoint(s), cache: {} };
    B.at = d => {
      const key = Math.round(d);
      if (B.cache[key]) return B.cache[key];
      const mult = Object.assign({}, s.market.mult), dmult = Object.assign({}, s.market.dmult);
      for (const g of launches) if (key >= g) for (const w of Sim.WORKLOADS) mult[w] *= C.GEN_DROP[w];
      if (mem.demandCut && key >= mem.cutDay && s.market.dmult.infer > 0.9) dmult.infer *= K.DEMAND_CUT;
      const market = Object.assign({}, s.market, { mult, dmult });
      const vendors = {};
      for (const [k, x] of Object.entries(s.vendors)) vendors[k] = { dead: x.dead || (mem.risky.has(k) && key > day + 45) };
      const fx = Object.assign({}, s.policyFx);
      const ct = odds.carbonTax;
      if (ct && !fx.carbonTax && key > ct.vote) fx.carbonTax = ct.p * 0.25;           // expected tax level after a pass
      const drought = mem.drought && key >= mem.drought.start && key < mem.drought.until ? mem.drought : null;
      return (B.cache[key] = { market, vendors, fx, drought });
    };
    return B;
  }
  /* turn a projected copy into the planner's view: pending hardware and facilities count as done */
  const META = new WeakMap();                 // per-view bookkeeping (kept off the state objects: keeps them fast)
  const contractsOf = p => META.get(p).contracts;
  const setContracts = (p, cs) => { META.get(p).contracts = cs; };
  function prep(s, p) {
    if (META.has(p)) return p;
    META.set(p, { contracts: p.contracts });
    p.racks = p.racks.map(r => r.pending.length ? Object.assign({}, r, { devices: r.devices.concat(r.pending), pending: [] }) : r);
    for (const j of s.jobs) {
      if (j.kind === "spine") p.spines = Object.assign({}, p.spines, { [j.key]: true });
      if (j.kind === "crac") { p.halls = p.halls.map(h => Object.assign({}, h)); p.halls[j.hall - 1].crac = true; }
      if (j.kind === "cooling") { p.halls = p.halls.map(h => Object.assign({}, h)); p.halls[j.hall - 1].cooling = j.mode; }
      if (j.kind === "ups") p.ups = true;
      if (j.kind === "solar") p.solar = true;
    }
    p.heatWave = null; p.outage = null;
    return p;
  }
  function evalAt(p, B, d) {
    const a = B.at(d);
    p.items = B.items; p.market = a.market; p.vendors = a.vendors; p.policyFx = a.fx; p.drought = a.drought;
    p.contracts = contractsOf(p).filter(c => c.end > d);
    return statsT(p, { day: d, eq: true });
  }
  const missing = st => { let n = 0; for (const k in st.cMiss) if (st.cMiss[k] > 1e-6) n++; return n; };
  function value(s, B, p) {
    prep(s, p);
    let net = 0, gross = 0, miss = 0;
    for (const d of B.days) { const st = evalAt(p, B, d); net += st.net; gross += st.gross; miss += missing(st); }
    const term = B.termDay ? evalAt(p, B, B.termDay).net : 0;
    // SLA misses also cost reputation (ch15): per missing contract-day, valued at what a point is worth at the end
    const rep = -miss / B.days.length * B.span * K.REP_SLA_DAY * B.repPoint;
    return { mid: net / B.days.length, gross: gross / B.days.length, term, rep };
  }
  function screen(s, B, p) {                 // cheap one-sample estimate used to shortlist candidates
    prep(s, p);
    const st = evalAt(p, B, B.days[1]);
    return { mid: st.net, gross: st.gross, term: B.termDay ? evalAt(p, B, B.termDay).net : 0, rep: -missing(st) * B.span * K.REP_SLA_DAY * B.repPoint };
  }
  const gainOf = (B, v0, v) => (v.mid - v0.mid) * B.span + (v.term - v0.term) * B.termW + (v.rep - v0.rep);

  /* what a card is worth when the horizon ends: today's resale, cut by the public launch calendar
     (x0.6 per launch inside the horizon) and by age. Used the same way for buying and for keeping. */
  function launchesIn(B) { return B.launches.filter(g => g <= B.day + B.span).length; }
  function residual(s, B, k) {
    const it = s.items[k], base = Sim.BASE_ITEMS[k].price;
    if (it.role === "exotic" && B.risky.has(it.vendor)) return 0;
    const f = it.role === "gpu" ? Sim.hbmF(s) * s.market.gpuCut * Math.pow(0.6, Math.max(0, Sim.currentGen(s) - it.gen) + launchesIn(B)) : 1;
    return base * 0.55 * f * Math.max(0.3, 1 - B.span / 1200) * (B.endgame ? 1 : 0.8);   // mid-game: obsolescence risk
  }
  function residualDev(s, B, d) {
    const it = s.items[d.type];
    if (d.leased || B.risky.has(it.vendor)) return 0;
    const now = Sim.resale(s, d), age = Math.max(0, s.day - d.born);
    const ageF = Math.max(0.3, 1 - (age + B.span) / 1200) / Math.max(0.3, 1 - age / 1200);
    return now * ageF * (it.role === "gpu" ? Math.pow(0.6, launchesIn(B)) : 1) * (B.endgame ? 1 : 0.8);
  }

  /* ---------------- planner modules ---------------- */
  // ch6 operations: technicians follow the job queue; keep ~2 spares of the most common GPU
  function opsModule(s, mem) {
    if (!Sim.on(s, "ops")) return;
    if (!s.repairAuto) act(s, mem, { type: "repairPolicy", on: true }, "ops", "auto-repair on");
    const q = waitingJobs(s);
    mem.queueDays = q > 2 ? (mem.queueDays || 0) + CFG.STEP : 0;
    if (mem.queueDays >= 8 && !s.hires.length && s.techs < CFG.TECH_MAX) { act(s, mem, { type: "hire" }, "ops", `hire (queue ${q})`); mem.queueDays = 0; }
    // endgame: idle technicians only dilute the final-quarter profit that the score multiplies
    const left = END - s.day;
    if (left < 100 && left > 20 && s.techs > 3 && q === 0 && !s.jobs.some(j => j.phase === "work")) act(s, mem, { type: "fire" }, "ops", "fire idle tech before valuation");
    // spares: forward-order (ch9) one of the most common installed GPU while fewer than 2 are on the shelf
    if (Sim.on(s, "memory") && left > 200) {
      const cnt = {};
      for (const r of s.racks) for (const d of r.devices) if (itemRole(s, d) === "gpu" && !d.leased) cnt[d.type] = (cnt[d.type] || 0) + 1;
      const top = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0];
      if (top && top[1] >= 8) {
        const have = s.shelf.filter(d => d.type === top[0]).length + s.jobs.filter(j => j.kind === "forward" && j.dev.type === top[0]).length;
        mem.spareType = top[0];
        if (have < CFG.SPARES && s.cash > s.items[top[0]].price + 300 && Sim.check(s, { type: "forward", item: top[0] }).ok)
          act(s, mem, { type: "forward", item: top[0] }, "ops", `spare ${top[0]}`);
      }
    }
  }
  const isSpare = (s, mem, d) => d.type === mem.spareType && s.shelf.filter(x => x.type === d.type && !x.failed).indexOf(d) < CFG.SPARES;

  // ch17 disruption: pilots, dumping doomed parts
  function disruptModule(s, mem) {
    const risky = mem.risky;
    for (const r of s.racks) for (const d of r.devices.slice()) {
      const it = s.items[d.type];
      // bricked parts and measured duds go now; parts of a vendor with bad news keep working until it exits, so the
      // valuation-based sell pass retires them one by one (it prices the SLA misses a mass dump would cause)
      const doomed = Sim.isDead(s, it) || (it.role === "exotic" && s.measured[it.vendor] != null && s.measured[it.vendor] < 0.9);
      if (doomed && Sim.check(s, { type: "sell", rack: r.id, uid: d.uid }).ok)
        act(s, mem, { type: "sell", rack: r.id, uid: d.uid }, Sim.isDead(s, it) ? "racks" : "disrupt", `dump ${d.type}`);
    }
    const exShop = Sim.shopItems(s).filter(k => s.items[k].role === "exotic");
    if (!exShop.length || s.cash < 250) return;
    const tank = s.racks.find(r => r.tank) || null;
    const converting = s.jobs.some(j => j.kind === "tank");
    if (!tank && !converting) { const e = emptyRacks(s, 1)[0]; if (e) act(s, mem, { type: "tank", rack: e.id }, "disrupt", "tank for pilots"); }
    if (tank) {
      if (needsSwitch(s, tank)) act(s, mem, { type: "buy", item: "sw", rack: tank.id }, "disrupt", "tank switch");
      for (const v of ["lattice", "photon"]) {
        const k = exShop.find(x => s.items[x].vendor === v);
        const owned = s.racks.some(r => r.devices.concat(r.pending).some(d => s.items[d.type].vendor === v));
        if (k && !owned && s.measured[v] == null && !risky.has(v)) act(s, mem, { type: "buy", item: k, rack: tank.id }, "disrupt", `pilot ${k}`);
      }
    }
    const proven = Object.keys(s.measured).some(v => s.measured[v] >= 0.95 && !risky.has(v));
    const tanks = s.racks.filter(r => r.tank).length;
    if (proven && !converting && tanks < 6 && s.cash > 400 && s.racks.filter(r => r.tank).every(r => Sim.usedU(s, r) >= 15)) {
      const e = emptyRacks(s, 1)[0]; if (e) act(s, mem, { type: "tank", rack: e.id }, "disrupt", "scale proven tech");
    }
  }

  // ch8 contracts: sign when the fixed price beats what the planner expects to earn on spot over the term.
  // A contract it can't serve today is still worth signing if buying the capacity for it pays (that is the
  // expansion that turns the grid tier and Hall 2 into good investments).
  function bestCardFor(s, w) {
    let best = null;
    for (const k of Sim.shopItems(s)) {
      const it = s.items[k];
      if (it.role !== "gpu" || it.gen < Sim.currentGen(s)) continue;
      const u = Math.min(it.F, it.B * Sim.INTENSITY[w]);
      if (!best || u / it.price > best.u / best.price) best = { k, u, price: it.price };
    }
    return best;
  }
  function expand(s, p, w, n, card) {   // hypothetically add n cards for workload w; returns {p, n} placed
    let placed = 0;
    for (const r0 of p.racks) {
      if (placed >= n) break;
      const r = r0;
      if (r.tank) continue;
      const hasGpu = r.devices.concat(r.pending).some(d => itemRole(s, d) === "gpu");
      if (hasGpu && r.workload !== w) continue;
      while (placed < n) {
        const acts = [];
        if (!hasGpu && r.workload !== w) acts.push({ type: "workload", rack: r.id, workload: w });
        if (needsSwitch(p, Sim.rackById(p, r.id))) acts.push({ type: "buy", item: "sw", rack: r.id });
        acts.push({ type: "buy", item: card.k, rack: r.id });
        let q = p, ok = true;
        for (const a of acts) {
          const chk = Sim.check(q, a);
          if (!chk.ok && !/Needs \$/.test(chk.msg)) { ok = false; break; }
          q = Sim.project(q, a);
        }
        if (!ok) break;
        p = q; placed++;
      }
    }
    return { p, placed };
  }
  function contractsModule(s, mem, B, v0) {
    if (!Sim.on(s, "contracts")) return;
    for (const o of s.offers.slice()) {
      if (mem.offerSeen.has(o.id)) continue;
      mem.offerSeen.add(o.id);
      const ex = B.odds.export;
      if (o.foreign && ex && ex.p > 0.5 && ex.vote < s.day + o.days) { act(s, mem, { type: "declineContract", id: o.id }, "policy", `decline foreign ${o.cust} (export P=${ex.p.toFixed(2)})`); continue; }
      const start = s.day + (o.bts ? o.lead : 0);
      const c = Object.assign({}, o, { start, end: start + o.days });
      if (start >= END - 10) { if (Sim.apply(s, { type: "declineContract", id: o.id }).ok) note(mem, s, "contracts", "decline: starts too late"); continue; }
      let term = Math.min(o.days, END - start);
      // an inference build-to-suit customer walks away if the efficiency breakthrough is real (ch17): after the
      // preprint the planner weighs that; once "reproduced" it expects the deal to end at the shock
      if (o.bts && o.w === "infer" && Sim.on(s, "disrupt") && mem.demandCut !== false) {
        const cutAt = mem.cutDay || 1400;
        if (start + term > cutAt) term = Math.max(0, cutAt - start) + (mem.demandCut ? 0 : 0.5 * (start + term - cutAt));
      }
      if (term <= 5) { if (Sim.apply(s, { type: "declineContract", id: o.id }).ok) note(mem, s, "disrupt", `decline ${o.cust}: demand cut expected`); continue; }
      const days = [0.1, 0.5, 0.9].map(f => Math.min(END - 1, Math.round(start + 8 + f * (Math.min(o.days, END - start) - 8))));
      const base = prep(s, Sim.shallowClone(s));
      const evalWith = p => {
        setContracts(p, s.contracts.concat([c]));
        let d0 = 0, d1 = 0, miss = 0, mc = 0, cover = Infinity;
        for (const d of days) {
          const s0 = evalAt(base, B, d); d0 += s0.net; const st = evalAt(p, B, d); d1 += st.net; miss = Math.max(miss, st.cMiss[c.id] || 0); mc += missing(st) - missing(s0);
          const owed = contractsOf(p).filter(x => x.w === o.w && !(x.start > d) && x.end > d).reduce((a, x) => a + x.units, 0);
          cover = Math.min(cover, owed > 0 ? st.supply[o.w] / owed : Infinity);
        }
        let g = (d1 - d0) / days.length * term - mc / days.length * term * K.REP_SLA_DAY * B.repPoint;
        if (B.termDay && c.end > B.termDay) g += (evalAt(p, B, B.termDay).net - evalAt(base, B, B.termDay).net) * B.termW;
        return { g, miss, cover };
      };
      let r = evalWith(prep(s, Sim.shallowClone(s))), how = "";
      const fit = o.bts ? o.fitout : 0;
      r.g -= fit;
      if (o.w !== "web" && (r.miss > 0 || r.g <= 5) && END - s.day > 150) {
        // with extra capacity: the cards outlive the contract (residual), and they must fit on the floor
        const card = bestCardFor(s, o.w);
        const n = card ? Math.min(o.bts ? 30 : 10, Math.ceil(o.units / (card.u * 0.9))) : 0;
        if (n > 0) {
          const e = expand(s, Sim.shallowClone(s), o.w, n, card);
          // only if the fit-out and the hardware are affordable before delivery starts (cash, profit over the lead,
          // credit line); otherwise the "option" is a promise it can't keep (penalties can bankrupt it)
          const credit = Sim.on(s, "finance") ? Math.max(0, K.LOAN_LTV * Sim.netWorth(s) - s.debt) : 0;
          const avail = s.cash - 60 + Math.max(0, v0.mid) * (start - s.day) * 0.7 + credit * 0.8 - (mem.committed || 0);
          if (e.placed > 0 && fit + e.placed * card.price <= avail) {
            const x = evalWith(prep(s, e.p));
            const gx = x.g - fit - e.placed * (card.price - residual(s, B, card.k) - 0.35 * card.price * Math.max(0, B.span - term) / B.span);
            if (gx > r.g) { r = { g: gx, miss: x.miss, cover: x.cover, cost: e.placed * card.price }; how = ` +${e.placed}x${card.k}`; }
          }
        }
      }
      // don't oversell capacity: keep 10 % headroom over everything owed on this workload (heat, droughts and
      // failures take output away; a build-to-suit penalty is 3x the price)
      const gain = r.g - (r.miss > 0.02 * o.units ? 100 : 0) - (r.cover < (o.bts ? 1.15 : 1.1) ? 1e9 : 0);
      if ((gain > 5 || (mem.rescue && gain > -20 && !o.bts)) && (!o.bts || fund(s, mem, o.fitout + 50))) {
        act(s, mem, { type: "signContract", id: o.id }, "contracts", `sign ${o.bts ? "BUILD-TO-SUIT " : ""}${o.w} ${o.units}u x${o.days}d gain ${gain.toFixed(0)}${how}`);
        if (how) { mem.expandFor = s.day; mem.committed = (mem.committed || 0) + 0.5 * (r.cost || 0); }
      } else if (Sim.apply(s, { type: "declineContract", id: o.id }).ok) note(mem, s, "contracts", `decline ${o.w} gain ${gain.toFixed(0)}`);
    }
  }

  // ch9 memory: read scare stories, buy ahead of a real shortage, hold off while prices are spiked
  function memoryModule(s, mem) {
    if (!Sim.on(s, "memory")) return 1;
    let hurdle = 1;
    if (s.hbm.index > 1.2) hurdle = s.hbm.index;                      // wait: spiked prices revert
    if (mem.expectShock != null && s.day - mem.expectShock < 40) hurdle = 0.7;   // buy now, before the spike
    return hurdle;
  }

  // ch11 facilities / ch12 energy / ch13 environment / ch15 reputation: a few big, slow decisions
  function facilityModule(s, mem, B, v0, st) {
    const left = END - s.day;
    // UPS before outage-prone seasons: expected loss = ~2 outages/yr x ~2 days of revenue, plus reputation
    if (Sim.on(s, "facilities") && !s.ups && !s.jobs.some(j => j.kind === "ups") && left > 200) {
      const expLoss = K.OUTAGES_PER_YEAR * 2 * (st.gross + 5) * Math.min(left, 720) / K.YEAR + (Sim.on(s, "reputation") || left > 400 ? 150 : 0);
      if (expLoss > K.UPS_COST && s.cash > K.UPS_COST + 150) act(s, mem, { type: "ups" }, "facilities", `UPS (expected outage loss ${expLoss.toFixed(0)})`);
    }
    // solar + battery: valued over the remaining game (incl. the score's earnings multiple and green reputation)
    if (Sim.on(s, "energy") && !s.solar && !s.jobs.some(j => j.kind === "solar") && s.cash > K.SOLAR_COST + 200 && left > 250) {
      const p = prep(s, Sim.shallowClone(s)); p.solar = true;
      const v = value(s, B, p);
      const horizon = Math.min(left, 720);
      let gain = (v.mid - v0.mid) * horizon + (B.endgame ? (v.term - v0.term) * B.termW : 0);
      if (Sim.on(s, "reputation")) gain += greenRepValue(s, st, K.SOLAR_KW * 0.5);
      if (gain > K.SOLAR_COST) act(s, mem, { type: "solar" }, "energy", `solar gain ${gain.toFixed(0)}`);
    }
    // PPA: size it below the lowest expected draw, sign when the quote is at or below the long-run spot average
    if (Sim.on(s, "energy") && !(s.ppa && s.day < s.ppa.end) && left > 120) {
      const q = Sim.ppaQuote(s), fair = K.POWER_PRICE / K.PUE_BASE;
      const minDraw = Math.max(0, st.facility - (s.solar ? K.SOLAR_KW : 0));
      const kw = Math.floor(minDraw * 0.8 / K.PPA_STEP) * K.PPA_STEP;
      const taxP = B.odds.carbonTax ? B.odds.carbonTax.p : 0;
      const greenV = Sim.on(s, "reputation") ? 0.02 * fair : 0;
      if (kw >= K.PPA_STEP && q <= fair * (1.0 + 0.04 * taxP) + greenV) {
        act(s, mem, { type: "ppa", kw: Math.min(K.PPA_MAX, kw) }, "energy", `PPA ${kw} kW at ${q}`);
        if (q > fair + greenV) use(mem, s, "policy", `PPA signed only because a carbon tax looks likely (P=${taxP.toFixed(2)})`);
      }
    }
    // cooling mode vs drought risk (and the efficiency mandate)
    if (Sim.on(s, "environment")) {
      const mand = B.odds.mandate, mandP = mand ? mand.p : 0;
      for (const h of s.halls) {
        if (!h.built || s.jobs.some(j => j.kind === "cooling" && j.hall === h.n)) continue;
        if (h.cooling === "chiller" && (!mem.drought || s.day > mem.drought.until) ) {
          act(s, mem, { type: "cooling", hall: h.n, mode: "evap" }, mandP > 0.5 ? "policy" : "environment", "back to evaporative");
          continue;
        }
        mem.droughtDecided = mem.droughtDecided || {};
        if (h.cooling === "evap" && mem.drought && s.day < mem.drought.start && mem.drought.watch > (mem.droughtDecided[h.n] ?? -1)) {
          mem.droughtDecided[h.n] = mem.drought.watch;
          // compare the drought window under both modes: cooling loss vs the chiller's higher PUE and switch costs
          const pe = prep(s, Sim.shallowClone(s)), pc = prep(s, Sim.shallowClone(s));
          pc.halls = pc.halls.map(x => x.n === h.n ? Object.assign({}, x, { cooling: "chiller" }) : x);
          const ds = [mem.drought.start + 5, mem.drought.start + 25, mem.drought.start + 40].filter(d => d < END);
          let ve = 0, vc = 0;
          for (const d of ds) { ve += evalAt(pe, B, d).net; vc += evalAt(pc, B, d).net; }
          const dur = 45, rep = Sim.on(s, "reputation") ? 4.5 + 0.3 * 6 : 0;   // drought water: -0.1/day, press risk
          const gainC = (vc - ve) / Math.max(1, ds.length) * dur - 2 * K.COOL_SWITCH_COST + rep * repValue(s) - (mandP > 0.5 ? 30 : 0);
          if (gainC > 0) act(s, mem, { type: "cooling", hall: h.n, mode: "chiller" }, "environment", `chiller for drought (gain ${gainC.toFixed(0)})`);
          else note(mem, s, "environment", `stay evaporative through drought (chiller gain ${gainC.toFixed(0)})`);
        }
      }
    }
  }
  /* $ value of one reputation point now: the score factor moves 0.5 % of company value per point at the end,
     and a change today fades toward the start value at 0.3 %/day (ch15 rule, learnt from watching the gauge) */
  function repPoint(s) {
    if (!Sim.on(s, "reputation")) return 0;
    return 0.005 * Sim.companyValue(s) * Math.exp(-0.003 * (END - s.day));
  }
  const repValue = repPoint;
  function greenRepValue(s, st, kw) {           // green share lifts the daily drift (+0.1/day per unit share, reverting)
    if (!Sim.on(s, "reputation")) return 0;
    const share = st.facility > 0 ? Math.min(1, kw / st.facility) : 0;
    return share * 0.1 / 0.003 * (1 - Math.exp(-0.003 * (END - s.day))) * 0.005 * Sim.companyValue(s);
  }

  // ch11: grow the floor (grid tier and Hall 2) when demand or signed contracts outrun it and there is time
  // left to pay it back
  function growthModule(s, mem, B, st, blocked) {
    const left = END - s.day;
    const g = Sim.gridNext(s);
    // ch2: the first grid tier, as soon as power binds while demand is unmet
    if (g && s.gridTier === 0 && !s.jobs.some(j => j.kind === "grid") && left > 150 && (Sim.gridKwAll(s) > s.gridKw - 12 || blocked.grid)
      && (st.mk.infer.demand > st.supply.infer * 1.1 || st.mk.train.demand + st.mk.frontier.demand > st.supply.train * 1.1 || blocked.grid)) {
      if (fund(s, mem, g.cost + 100)) act(s, mem, { type: "grid" }, "power", `grid to ${g.kw} kW`);
      return;
    }
    if (!Sim.on(s, "facilities")) return;
    const building = s.jobs.some(j => j.kind === "buildHall");
    const hall2 = (s.halls[1] && s.halls[1].built) || building;
    const hall3 = (s.halls[2] && s.halls[2].built) || building;
    const kwUse = Sim.gridKwAll(s) / s.gridKw;
    const freeRacks = s.racks.filter(r => !r.tank && !r.devices.length && !r.pending.length).length;
    const hot = st.halls.some(h => h.n === 1 && h.tTarget > 29.5);
    const unmet = st.mk.infer.demand > st.supply.infer * 1.15 || st.mk.train.demand + st.mk.frontier.demand > st.supply.train * 1.15
      || (mem.expandFor != null && s.day - mem.expandFor < 60) || blocked.grid || blocked.space;
    const why = `kW ${Math.round(kwUse * 100)}%, free racks ${freeRacks}, hot ${hot}, unmet ${unmet}`;
    const gLeft = g && g.kw > 700 ? 380 : 280;       // tier 4 has a 90-day lead: needs more time to pay back
    if (g && g.kw > 400 && !s.jobs.some(j => j.kind === "grid") && left > gLeft && unmet && kwUse > 0.85) {
      if (fund(s, mem, g.cost + 150)) act(s, mem, { type: "grid" }, "facilities", `grid to ${g.kw} kW (${why})`);
    }
    if (!hall2 && left > 330 && unmet && (freeRacks < 3 || hot) && (s.gridKw > 400 || s.jobs.some(j => j.kind === "grid"))) {
      if (fund(s, mem, K.HALL_COST + 200)) act(s, mem, { type: "buildHall" }, "facilities", `Hall 2 (${why})`);
    }
    // Hall 3: a long build (120 days) on a 4th grid tier; a bet that demand keeps growing
    if (hall2 && !hall3 && s.halls[1].built && left > 450 && unmet && (freeRacks < 3 || st.halls.every(h => h.tTarget > 29)) && s.gridTier >= 2) {
      if (fund(s, mem, K.HALL3_COST + 200)) act(s, mem, { type: "buildHall" }, "facilities", `Hall 3 (${why})`);
    }
    // CRAC when a hall runs hot in summer
    for (const hh of st.halls) {
      const h = s.halls[hh.n - 1];
      if (!h.crac && !s.jobs.some(j => j.kind === "crac" && j.hall === h.n) && left > 200 && hh.tTarget > 30 && s.cash > K.CRAC_COST + 300)
        act(s, mem, { type: "crac", hall: h.n }, "facilities", `CRAC hall ${h.n}`);
    }
  }
  /* make `need` cash available: borrow (ch10) when the credit line allows it */
  function fund(s, mem, need) {
    if (s.cash >= need) return true;
    if (!Sim.on(s, "finance")) return false;
    const lim = K.LOAN_LTV * Sim.netWorth(s) - s.debt;
    const amt = Math.ceil((need - s.cash) / K.LOAN_STEP) * K.LOAN_STEP;
    if (amt > lim) return false;
    if (act(s, mem, { type: "borrow", amount: amt }, "finance", `borrow ${amt}`)) { mem.lastBorrow = s.day; return true; }
    return false;
  }
  function financeModule(s, mem) {
    if (!Sim.on(s, "finance") || s.debt <= 0) return;
    const spare = s.cash - 400 - (END - s.day < 60 ? -350 : 0);
    if (spare >= K.LOAN_STEP && s.day - (mem.lastBorrow || -99) > 20) {
      const amt = Math.min(s.debt, Math.floor(spare / K.LOAN_STEP) * K.LOAN_STEP);
      if (amt > 0) act(s, mem, { type: "repay", amount: amt }, "finance", `repay ${amt}`);
    }
  }

  // ch14 investors: take a round only at a valuation premium; never get fired; buy back at the end
  function investorModule(s, mem, B, st) {
    if (!Sim.on(s, "investors")) return;
    const o = s.roundOffer;
    if (o && !mem.roundSeen.has(o.id)) {
      mem.roundSeen.add(o.id);
      const cv = Sim.companyValue(s), rf = Sim.repFactor(s);
      const growth = mean(s.revDays.slice(-45)) / Math.max(1, mean(s.revDays.slice(-180, -135))) - 1;
      const left = END - s.day;
      // The first round creates the board (+15 %/half-year targets, two misses in a row = fired, half the score).
      // Take it only when two reviews can't fit before d1800, so a firing is impossible; later rounds add no new
      // risk, so they only need a valuation premium. (An earlier-round rule got it fired on 3-10/12 seeds with
      // generations ablated.)
      const safe = s.board ? true : s.day + 2 * K.BOARD_EVERY > END + 5;
      const ok = safe && o.valuation * rf >= cv * 1.02 && left > 30 && (!s.board || s.board.misses === 0);
      const why = `${Math.round(o.pct * 100)}% at ${Math.round(o.valuation)} vs value ${Math.round(cv)} (growth ${(growth * 100).toFixed(0)}%, can't be fired ${safe})`;
      if (ok) act(s, mem, { type: "acceptRound", id: o.id }, "investors", "accept " + why);
      else if (Sim.apply(s, { type: "declineRound", id: o.id }).ok) note(mem, s, "investors", "decline " + why);
    }
    const b = s.board;
    mem.rescue = false;
    if (b) {
      const daysLeft = Math.max(0, b.end - s.day), pace = mean(s.revDays.slice(-10));
      const proj = b.rev + pace * daysLeft;
      mem.rescue = proj < b.target * 1.04;
      if (mem.rescue && !mem.rescueLogged) { use(mem, s, "investors", `revenue rescue: projected ${proj.toFixed(0)} vs target ${b.target.toFixed(0)}`); mem.rescueLogged = true; }
      if (!mem.rescue) mem.rescueLogged = false;
    }
    // buyback with leftover cash in the last days: accretive while own < 1/repFactor
    if (END - s.day < 12 && s.equity.own < 0.99) {
      for (let i = 0; i < 40 && s.equity.own < 0.99; i++) {
        const c = Math.max(1, K.BUYBACK_STEP * Sim.companyValue(s));
        if (s.cash - c < 60 || (s.equity.own + 0.01) * Sim.repFactor(s) > 1) break;
        if (!act(s, mem, { type: "buyback" }, "investors", "buyback 1%")) break;
      }
    }
  }

  // ch15 reputation: PR lands on the valuation date, never into a live scandal
  function reputationModule(s, mem) {
    if (!Sim.on(s, "reputation")) return;
    const left = END - s.day, scandal = s.day - (mem.lastPress ?? -999) < K.SCANDAL_DAYS;
    if (scandal) return;
    const boosts = s.prBoosts.filter(b => s.day - b.day < 30).length;
    const gain = K.PR_GAIN * clamp(1 - (left - 5) / K.PR_DECAY, 0, 1) * 0.005 * Sim.companyValue(s);   // lands on the valuation
    if (left < 60 && left > 5 && boosts < 1 && Sim.repOf(s) < 95 && gain > K.PR_COST * 1.5 && s.cash > K.PR_COST + 100)
      act(s, mem, { type: "pr" }, "reputation", `PR before valuation (rep ${Sim.repOf(s).toFixed(0)})`);
  }

  // ch16 policy: lobby only when the expected stake is large
  function policyModule(s, mem, B, st) {
    if (!Sim.on(s, "policy")) return;
    for (const [kind, o] of Object.entries(B.odds)) {
      const p = o.pol;
      if (p.status !== "proposed" || p.lobbied || mem.lobbyDone.has(p.id) || o.vote - s.day > 40 || o.vote <= s.day) continue;
      mem.lobbyDone.add(p.id);
      const left = END - o.vote;
      let stake = 0;
      if (kind === "carbonTax") stake = st.carbon * 0.25 * left;
      if (kind === "export") stake = 0.2 * st.gross * left * 0.1;
      if (kind === "mandate") stake = s.halls.some(h => h.built && h.cooling === "chiller") ? K.MANDATE_FINE * left : 0;
      const leakCost = K.LOBBY_LEAK * K.PRESS_HIT * repValue(s);
      if (o.p > 0.35 && o.p < 0.75 && K.LOBBY_SHIFT * stake > K.LOBBY_COST + leakCost)
        act(s, mem, { type: "lobby", policy: p.id, dir: -1 }, "policy", `lobby against ${kind} (stake ${stake.toFixed(0)}, P=${o.p.toFixed(2)})`);
      else note(mem, s, "policy", `no lobbying on ${kind} (P=${o.p.toFixed(2)}, stake ${stake.toFixed(0)})`);
    }
  }

  // ch7 fabric: put a spine on the row that already holds most training GPUs, fill it to a frontier cluster
  function fabricModule(s, mem, B, v0) {
    if (!Sim.on(s, "fabric") || s.cash < K.SPINE_COST + 100) return;
    let best = null;
    for (const h of s.halls) if (h.built) for (let row = 0; row < K.ROWS; row++) {
      const key = `${h.n}-${row}`;
      if (s.spines[key] || s.jobs.some(j => j.kind === "spine" && j.key === key)) continue;
      const base = (h.n - 1) * K.HALL_RACKS + row * K.COLS, rs = s.racks.slice(base, base + K.COLS).filter(r => !r.tank);
      const gpus = rs.reduce((a, r) => a + (r.workload === "train" ? r.devices.concat(r.pending).filter(d => itemRole(s, d) === "gpu").length : 0), 0);
      if (gpus < 6) continue;
      const acts = [{ type: "spine", hall: h.n, row }];
      let p = preview(s, acts);
      if (!p) continue;
      let cost = K.SPINE_COST, n = gpus;
      // fill up to the frontier threshold with the best compute card on offer
      const card = Sim.shopItems(s).filter(k => s.items[k].role === "gpu" && s.items[k].fam === "C").pop();
      for (const r of rs) {
        while (card && n < K.FRONTIER_MIN_GPUS && r.workload === "train") {
          const a = { type: "buy", item: card, rack: r.id };
          const sw = needsSwitch(p, Sim.rackById(p, r.id)) ? [{ type: "buy", item: "sw", rack: r.id }] : [];
          let q = p, okAll = true;
          for (const x of sw.concat([a])) { if (!Sim.check(q, x).ok && !(x.type === "buy" && /Needs \$/.test(Sim.check(q, x).msg))) { okAll = false; break; } q = Sim.project(q, x); }
          if (!okAll) break;
          p = q; acts.push(...sw, a); n++; cost += s.items[card].price + (sw.length ? s.items.sw.price : 0);
        }
      }
      if (n < K.FRONTIER_MIN_GPUS) continue;
      const v = value(s, B, p);
      const g = gainOf(B, v0, v) - cost + (acts.length - 1) * (card ? residual(s, B, card) : 0);
      if (g > 0 && (!best || g > best.g)) best = { g, acts, cost, key };
    }
    if (best && fund(s, mem, best.cost + 50)) {
      let ok = true;
      for (const a of best.acts) ok = act(s, mem, a, a.type === "spine" ? "fabric" : "gpu", a.type === "spine" ? `spine ${best.key} (gain ${best.g.toFixed(0)})` : `cluster ${a.item}`) && ok;
    }
  }

  /* ---------------- planner main loop ---------------- */
  function planner(s, mem) {
    if (!mem.used) Object.assign(mem, { used: {}, noted: {}, newsDay: 0, newsSeen: new Set(), risky: new Set(), offerSeen: new Set(), roundSeen: new Set(), lobbyDone: new Set(), lastPositiveBuy: -99 });
    readNews(s, mem);
    if (s.day >= (mem.nextHk || 0)) { mem.nextHk = s.day + 2; if (keepTransit(s) && !mem.transitLogged) { use(mem, s, "fabric", "transit to match traffic"); mem.transitLogged = true; } }
    if (s.day < (mem.next || 0)) return;
    mem.next = s.day + CFG.STEP;
    const B = belief(s, mem);
    const st = Sim.stats(s, { eq: true });
    const tick = Math.round(s.day / CFG.STEP);

    opsModule(s, mem);
    disruptModule(s, mem);
    let v0 = value(s, B, Sim.shallowClone(s));
    contractsModule(s, mem, B, v0);
    investorModule(s, mem, B, st);
    reputationModule(s, mem);
    if (tick % 2 === 0) { facilityModule(s, mem, B, v0, st); policyModule(s, mem, B, st); }
    financeModule(s, mem);

    // sell (or return a lease) when removing a part raises the lookahead value by more than it would earn back.
    // Shortlist with the one-sample screen, confirm with the full lookahead; identical (rack, card) pairs once.
    if (tick % 2 === 1) {
      let s0 = screen(s, B, Sim.shallowClone(s));
      v0 = null;
      const seen = new Set(), st1 = Sim.stats(s);
      for (const r of s.racks) {
        const sig = rackSig(s, r, st1);
        for (const d of r.devices.slice()) {
          const it = s.items[d.type];
          if (it.role === "net" && (r.devices.length > 1 || r.pending.length || r.tank)) continue;
          if (it.role === "exotic" && s.measured[it.vendor] == null) continue;          // a pilot: wait for the measurement
          const dk = sig + "#" + d.type + (d.failed ? "x" : "") + (d.leased ? "l" : "");
          if (seen.has(dk)) continue;
          seen.add(dk);
          const a = d.leased ? { type: "returnLease", rack: r.id, uid: d.uid } : { type: "sell", rack: r.id, uid: d.uid };
          if (!Sim.check(s, a).ok) continue;
          const got = d.leased ? 0 : Sim.resale(s, d), keep = residualDev(s, B, d), bar = 15 + 0.05 * got;
          if (gainOf(B, s0, screen(s, B, Sim.project(s, a))) + got - keep <= bar * 0.5) continue;
          v0 = v0 || value(s, B, Sim.shallowClone(s));
          if (gainOf(B, v0, value(s, B, Sim.project(s, a))) + got - keep > bar) {
            const key = d.leased ? "finance" : mem.risky.has(it.vendor) ? "disrupt" : it.role === "gpu" && it.gen < Sim.currentGen(s) ? "gens" : "racks";
            act(s, mem, a, key, `${a.type} ${d.type} from ${r.id}`);
            s0 = screen(s, B, Sim.shallowClone(s)); v0 = null;
          }
        }
      }
    }
    // per-rack tuning: workload and power mode, judged over the lookahead (screened first)
    if (tick % 3 === 0) {
      let s0 = screen(s, B, Sim.shallowClone(s));
      v0 = null;
      for (const r of s.racks) {
        if (!r.devices.length) continue;
        const opts = [];
        if (r.devices.some(d => itemRole(s, d) === "gpu")) for (const w of Sim.WORKLOADS) if (w !== r.workload) opts.push({ type: "workload", rack: r.id, workload: w });
        for (const m of Object.keys(Sim.MODES)) if (m !== r.mode) opts.push({ type: "mode", rack: r.id, mode: m });
        let best = null;
        for (const a of opts) {
          if (!Sim.check(s, a).ok) continue;
          const p = Sim.project(s, a);
          if (gainOf(B, s0, screen(s, B, p)) <= 4) continue;
          v0 = v0 || value(s, B, Sim.shallowClone(s));
          const g = gainOf(B, v0, value(s, B, p));
          if (g > 8 && (!best || g > best.g)) best = { a, g };
        }
        if (best) {
          const key = best.a.type === "workload" ? (mem.demandCut && best.a.workload === "train" ? "disrupt" : "gpu") : (st.halls.some(h => h.tTarget > 29) ? "heat" : "power");
          act(s, mem, best.a, key, `${best.a.type} ${r.id} -> ${best.a.workload || best.a.mode}`);
          s0 = screen(s, B, Sim.shallowClone(s)); v0 = null;
        }
      }
    }
    // refit: when power or space binds, pull the least valuable cards of a rack for a better new one
    const blocked = { grid: false, space: false };
    const powerBound = Sim.gridKwAll(s) > s.gridKw - 8;
    const spaceBound = !s.racks.some(r => !r.tank && K.RACK_U - Sim.usedU(s, r) >= 5);
    if ((powerBound || spaceBound) && tick % 2 === 0) for (let i = 0; i < (s.cash > 3000 ? 3 : 1); i++) if (!refit(s, mem, B)) break;
    // buy: best lookahead value per dollar (hurdle raised while HBM prices are spiked)
    const hurdle = memoryModule(s, mem);
    buyLoop(s, mem, B, hurdle, blocked);
    fabricModule(s, mem, B, value(s, B, Sim.shallowClone(s)));
    if (tick % 2 === 0) growthModule(s, mem, B, Sim.stats(s, { eq: true }), blocked);
  }

  function refit(s, mem, B) {
    const base = Sim.stats(s, { eq: true }).net, v0 = value(s, B, Sim.shallowClone(s));
    const upg = Sim.shopItems(s).filter(k => { const it = s.items[k];
      return (it.role === "gpu" && it.gen === Sim.currentGen(s)) || (it.role === "exotic" && s.measured[it.vendor] >= 0.95 && !mem.risky.has(it.vendor)); });
    let bestRefit = null;
    const seen = new Set(), st = Sim.stats(s);
    for (const r of s.racks) {
      if (!r.devices.length) continue;
      const sig = rackSig(s, r, st);
      if (seen.has(sig)) continue;
      seen.add(sig);
      const ranked = r.devices.filter(d => itemRole(s, d) !== "net").map(d => {
        const p = Sim.project(s, { type: d.leased ? "returnLease" : "sell", rack: r.id, uid: d.uid });
        return { d, loss: (base - Sim.stats(p, { eq: true }).net) / s.items[d.type].u };
      }).sort((a, b) => a.loss - b.loss);
      for (const k of upg) {
        const it = s.items[k];
        if (s.cash < it.price + 20 || !!it.tank !== !!r.tank) continue;
        if (r.devices.some(d => d.type === k) && ranked.every(x => x.d.type === k)) continue;
        let p = s, sells = [], got = 0;
        for (const x of ranked) {
          if (Sim.check(p, { type: "buy", item: k, rack: r.id }).ok) break;
          if (x.d.type === k) continue;
          const a = x.d.leased ? { type: "returnLease", rack: r.id, uid: x.d.uid } : { type: "sell", rack: r.id, uid: x.d.uid };
          if (!Sim.check(p, a).ok) continue;
          p = Sim.project(p, a); sells.push({ a, d: x.d }); got += x.d.leased ? 0 : Sim.resale(s, x.d) - residualDev(s, B, x.d);
        }
        const buy = { type: "buy", item: k, rack: r.id };
        if (!sells.length || !Sim.check(p, buy).ok) continue;
        const v = value(s, B, Sim.project(p, buy));
        const g = gainOf(B, v0, v) - it.price + got + residual(s, B, k);
        if (g > 20 && (!bestRefit || g > bestRefit.g)) bestRefit = { sells, buy, g };
      }
    }
    if (!bestRefit) return false;
    for (const x of bestRefit.sells) {
      // keep up to 2 pulled cards of the spare type on the shelf instead of dumping them (ch6)
      if (x.a.type === "sell" && Sim.on(s, "ops") && x.d.type === mem.spareType && s.shelf.filter(d => d.type === x.d.type).length < CFG.SPARES
        && Sim.check(s, { type: "store", rack: x.a.rack, uid: x.a.uid }).ok) act(s, mem, { type: "store", rack: x.a.rack, uid: x.a.uid }, "ops", `shelve ${x.d.type} as spare`);
      else act(s, mem, x.a, "gens", `refit: ${x.a.type} ${x.d.type}`);
    }
    return act(s, mem, bestRefit.buy, "gens", `refit: buy ${bestRefit.buy.item} (gain ${bestRefit.g.toFixed(0)})`);
  }

  function buyLoop(s, mem, B, hurdle, blocked) {
    const skip = k => {
      const it = s.items[k];
      if (mem.risky.has(it.vendor)) return true;
      if (it.role === "exotic" && !(s.measured[it.vendor] >= 0.95)) return true;   // unproven: pilot only
      return false;
    };
    // leases make sense for the generation that will be replaced soon (ch10)
    const nextL = B.launches[0];
    const leaseOk = Sim.on(s, "finance") && nextL != null && nextL - s.day < 150 && nextL - s.day > 20 && !B.endgame;
    // shelf cards beyond the spare quota go back to work
    for (const d of s.shelf.slice()) {
      if (d.failed || isSpare(s, mem, d)) continue;
      let best = null;
      const v0 = value(s, B, Sim.shallowClone(s));
      for (const r of s.racks) {
        const a = { type: "unstore", rack: r.id, uid: d.uid };
        if (!Sim.check(s, a).ok) continue;
        const g = gainOf(B, v0, value(s, B, Sim.project(s, a)));
        if (g > 0 && (!best || g > best.g)) best = { a, g };
      }
      if (best) act(s, mem, best.a, "memory", `install shelf ${d.type}`);
    }
    const reserve = 20;
    const cashRich = s.cash + (mem.canBorrow || 0) > 3000;
    const scoreC = (c, v0, v) => {
      let g;
      if (c.kind === "lease") {
        const span = Math.min(B.span, nextL + 30 - s.day);        // plan: return it a month after the launch
        g = (v.mid - v0.mid) * span;
        c.rank = cashRich ? g : g / (s.items[c.item].price * 1.5);
      } else {
        g = gainOf(B, v0, v) - c.cost * hurdle + residual(s, B, c.item);
        if (mem.rescue) g += (v.gross - v0.gross) * Math.max(0, s.board.end - s.day) * 0.5;
        c.rank = cashRich ? g : g / c.cost;          // heuristic 4: rank by the scarce input (cash, or else space/power)
      }
      c.g = g;
      return g > 0;
    };
    // 1. shortlist on one sample day, 2. full lookahead for the best few, re-checked after every purchase
    const st = Sim.stats(s), s0 = screen(s, B, Sim.shallowClone(s));
    let list = [];
    for (const c of candidates(s, { skip, st, lease: leaseOk })) {
      if (c.kind === "buy" && c.cost > s.cash - reserve + (mem.canBorrow || 0)) continue;
      const p = preview(s, c.acts);
      if (!p) {
        if (/Grid/.test(Sim.check(s, c.acts[c.acts.length - 1]).msg)) blocked.grid = true;
        continue;
      }
      if (scoreC(c, s0, screen(s, B, p))) list.push(c);
    }
    list.sort((a, b) => b.rank - a.rank);
    list = list.slice(0, 12);
    for (let n = 0; n < 5 && list.length; n++) {
      const v0 = value(s, B, Sim.shallowClone(s));
      let best = null;
      for (const c of list.slice(0, 5)) {
        if (c.kind === "buy" && c.cost > s.cash - reserve + (mem.canBorrow || 0)) continue;
        const p = preview(s, c.acts);
        if (!p || !scoreC(c, v0, value(s, B, p))) continue;
        if (!best || c.rank > best.rank) best = c;
      }
      if (!best) break;
      list = list.filter(c => c !== best);
      if (best.kind === "buy" && best.cost > s.cash - reserve) { if (!fund(s, mem, best.cost + reserve)) break; }
      mem.lastPositiveBuy = s.day;
      if (best.kind === "buy") mem.committed = Math.max(0, (mem.committed || 0) - best.cost);
      const it = s.items[best.item];
      const key = best.kind === "lease" ? "finance" : hurdle < 1 ? "memory" : it.role === "cool" ? "heat" : it.role === "gpu" ? "gpu" : it.role === "mem" || it.role === "exotic" ? "disrupt" : "racks";
      let ok = true;
      for (const a of best.acts) ok = ok && act(s, mem, a, key, `${a.type} ${a.item || a.workload} ${a.rack} (gain ${best.g.toFixed(0)})`);
      if (!ok) break;
    }
    // blocked by space: every rack full
    if (!s.racks.some(r => !r.tank && K.RACK_U - Sim.usedU(s, r) >= 4)) blocked.space = true;
    mem.canBorrow = Sim.on(s, "finance") ? Math.max(0, Math.min(1500, K.LOAN_LTV * Sim.netWorth(s) - s.debt - 200)) : 0;
  }

  const POLICIES = { idle: () => {}, greedy, planner };

  /* play a whole game headlessly. Returns final net worth, score and which chapters the planner used */
  function play(seed, policy, opts) {
    const s = Sim.newGame(seed, opts);
    const mem = {}, fn = POLICIES[policy];
    if (opts && opts.trace) mem.trace = [];
    while (!s.over) { fn(s, mem); Sim.advance(s, 1); }
    return { seed, policy, worth: Sim.netWorth(s), score: Sim.score(s), over: s.over, used: mem.used || {}, noted: mem.noted || {}, trace: mem.trace, state: s };
  }

  return { play, POLICIES, greedy, planner, CFG, setDebug(v) { DEBUG = !!v; },
    _internal: { belief, value, screen, gainOf, residual, residualDev, candidates, preview, prep, evalAt } };
});
