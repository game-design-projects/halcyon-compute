/* Reference players for depth measurement. Loads in Node (require) and the browser (window.Bots).
 * idle:    never acts.
 * greedy:  every few days buys whatever raises income *right now* the most per dollar. Myopic:
 *          no seasons, no launches, no vendor risk, never sells, never pilots.
 * planner: plays the heuristics the game is meant to teach (see DESIGN.md): matches cards to the
 *          roofline, looks ahead over seasons and announced launches, sells dead weight, reads
 *          vendor news, pilots exotic tech before scaling it, upgrades by performance per kW.
 */
(function (root, factory) {
  const Bots = factory(typeof module === "object" && module.exports ? require("../js/sim.js") : root.Sim);
  if (typeof module === "object" && module.exports) module.exports = Bots;
  else root.Bots = Bots;
})(typeof globalThis !== "undefined" ? globalThis : this, function (Sim) {
  "use strict";
  const K = Sim.K;

  function needsSwitch(s, r) { return !r.devices.concat(r.pending).some(d => s.items[d.type].role === "net"); }
  function emptyRacks(s, n) { return s.racks.filter(r => !r.devices.length && !r.pending.length && !r.tank).slice(0, n); }

  /* candidate purchase bundles: [actions], cost */
  function candidates(s, opts) {
    const out = [], shop = Sim.shopItems(s).filter(k => !opts.skip || !opts.skip(k));
    const racks = s.racks.filter(r => r.devices.length || r.pending.length || r.tank).concat(emptyRacks(s, 2));
    for (const r of racks) for (const k of shop) {
      const it = s.items[k];
      if (it.role === "net" && !needsSwitch(s, r)) {
        const net = Sim.stats(s).perRack[r.id];
        if (net.netF >= 1) continue;
      }
      const hasGpu = r.devices.concat(r.pending).some(d => s.items[d.type].role === "gpu");
      const wls = it.role === "gpu" && !hasGpu ? Sim.WORKLOADS : [r.workload];
      for (const w of wls) {
        const acts = [];
        if (w !== r.workload) acts.push({ type: "workload", rack: r.id, workload: w });
        if (it.role !== "net" && it.role !== "cool" && it.role !== "mem" && needsSwitch(s, r)) acts.push({ type: "buy", item: "sw", rack: r.id });
        acts.push({ type: "buy", item: k, rack: r.id });
        const cost = acts.reduce((a, x) => a + (x.type === "buy" ? s.items[x.item].price : 0), 0);
        out.push({ acts, cost });
      }
    }
    return out;
  }
  /* apply a bundle to a preview copy; null if any step is invalid */
  function preview(s, acts) {
    let p = s;
    for (const a of acts) {
      const chk = Sim.check(p, a);
      if (!chk.ok) return null;
      p = Sim.project(p, a);
      if (a.type === "buy") { p.cash = s.cash; }
    }
    return p;
  }
  function doActs(s, acts) { for (const a of acts) if (!Sim.apply(s, a).ok) return false; return true; }

  /* ---------------- greedy ---------------- */
  function greedy(s, mem) {
    if (s.day < (mem.next || 0)) return;
    mem.next = s.day + 4;
    for (let n = 0; n < 4; n++) {
      const base = Sim.stats(s, { eq: true }).net;
      let best = null, gridBlocked = false;
      for (const c of candidates(s, {})) {
        if (c.cost > s.cash) continue;
        const p = preview(s, c.acts);
        if (!p) { const chk = Sim.check(s, c.acts[c.acts.length - 1]); if (/Grid/.test(chk.msg)) gridBlocked = true; continue; }
        const gain = Sim.stats(p, { eq: true }).net - base;
        if (gain <= 0 || c.cost / gain > 200) continue;
        const score = gain / c.cost;
        if (!best || score > best.score) best = Object.assign({ score }, c);
      }
      if (best) { doActs(s, best.acts); continue; }
      if (gridBlocked && Sim.check(s, { type: "grid" }).ok && s.cash > K.GRID_COST + 150) Sim.apply(s, { type: "grid" });
      break;
    }
  }

  /* ---------------- planner ---------------- */
  // knowledge the planner is allowed: public state (news, bench, shop), plus what its own pilots measured
  function riskyVendors(s) {
    const bad = new Set();
    for (const n of s.news) if (n.vendor && n.tone === "bad") bad.add(n.vendor);
    return bad;
  }
  function knownLaunches(s) {  // launches announced by rumor news but not yet happened
    const out = [];
    for (const n of s.news) if (/rumored/.test(n.title)) for (const g of Sim.GEN_LAUNCH) if (g > s.day && g - n.day < 120) out.push(g);
    return out;
  }
  /* a view of the state at a future day, with the planner's beliefs baked in */
  function beliefView(s, p, day, mem) {
    // pending hardware will be installed within the horizon: count it
    const racks = p.racks.map(r => r.pending.length ? Object.assign({}, r, { devices: r.devices.concat(r.pending), pending: [] }) : r);
    const v = Object.assign(Object.create(p), { racks, market: Object.assign({}, p.market, { mult: Object.assign({}, p.market.mult) }), vendors: {}, items: {} });
    for (const g of knownLaunches(s)) if (day >= g) for (const w of Sim.WORKLOADS) v.market.mult[w] *= w === "train" ? 0.72 : 0.75;
    const risky = riskyVendors(s);
    for (const [k, x] of Object.entries(p.vendors)) v.vendors[k] = { dead: x.dead || (risky.has(k) && day > s.day + 45) };
    for (const [k, it] of Object.entries(p.items)) {
      const field = it.role === "exotic" ? (mem.measured[it.vendor] != null ? mem.measured[it.vendor] : 0.7) : it.field;
      v.items[k] = Object.assign({}, it, { field });
    }
    return v;
  }
  function horizonDays(s) { return [8, 40, 90, 150].map(d => s.day + d).filter(d => d < K.END_DAY); }
  function lookValue(s, p, mem) {   // mean net/day over the horizon samples, and the days it covers
    const days = horizonDays(s);
    if (!days.length) return { perDay: 0, span: 0 };
    let sum = 0;
    for (const d of days) sum += Sim.stats(beliefView(s, p, d, mem), { day: d, eq: true }).net;
    return { perDay: sum / days.length, span: Math.min(150, K.END_DAY - s.day) };
  }

  function planner(s, mem) {
    mem.measured = mem.measured || {};
    if (s.day < (mem.next || 0)) return;
    mem.next = s.day + 4;
    const risky = riskyVendors(s);

    // 1. measure pilots: an installed exotic card reveals its field performance
    for (const r of s.racks) for (const d of r.devices) {
      const it = s.items[d.type];
      if (it.role === "exotic" && s.day - d.born > 12 && mem.measured[it.vendor] == null) mem.measured[it.vendor] = it.field;
    }
    // 2. dump dead weight: dead vendors, risky vendors' parts, cards that lose money
    for (const r of s.racks) for (const d of r.devices.slice()) {
      const it = s.items[d.type];
      const doomed = Sim.isDead(s, it) || (risky.has(it.vendor) && (it.role === "mem" || it.role === "exotic"))
        || (it.role === "exotic" && mem.measured[it.vendor] != null && mem.measured[it.vendor] < 0.9);
      if (doomed) Sim.apply(s, { type: "sell", rack: r.id, uid: d.uid });
    }
    // 2b. sell anything whose removal raises the lookahead income by more than it would earn back
    const curV = lookValue(s, s, mem);
    for (const r of s.racks) for (const d of r.devices.slice()) {
      const it = s.items[d.type];
      if (it.role === "net" && (r.devices.length > 1 || r.pending.length || r.tank)) continue;
      const a = { type: "sell", rack: r.id, uid: d.uid };
      if (Sim.check(s, a).ok && lookValue(s, Sim.project(s, a), mem).perDay > curV.perDay + 0.02) Sim.apply(s, a);
    }
    // 3. per-rack tuning: workload and power mode, judged over the lookahead
    for (const r of s.racks) {
      if (!r.devices.length) continue;
      const opts = [];
      if (r.devices.some(d => s.items[d.type].role === "gpu")) for (const w of Sim.WORKLOADS) opts.push({ type: "workload", rack: r.id, workload: w });
      for (const m of Object.keys(Sim.MODES)) opts.push({ type: "mode", rack: r.id, mode: m });
      for (const a of opts) {
        if (!Sim.check(s, a).ok) continue;
        const cur = lookValue(s, s, mem).perDay, nxt = lookValue(s, Sim.project(s, a), mem).perDay;
        if (nxt > cur + 0.05) Sim.apply(s, a);
      }
    }
    // 4. pilot exotic tech once, with one card each (paid information)
    const exShop = Sim.shopItems(s).filter(k => s.items[k].role === "exotic");
    if (exShop.length && s.cash > 250) {
      let tank = s.racks.find(r => r.tank) || null;
      const converting = s.jobs.some(j => j.kind === "tank");
      if (!tank && !converting) { const e = emptyRacks(s, 1)[0]; if (e) Sim.apply(s, { type: "tank", rack: e.id }); }
      if (tank) {
        if (needsSwitch(s, tank)) Sim.apply(s, { type: "buy", item: "sw", rack: tank.id });
        for (const v of ["lattice", "photon"]) {
          const k = exShop.find(x => s.items[x].vendor === v);
          const owned = s.racks.some(r => r.devices.concat(r.pending).some(d => s.items[d.type].vendor === v));
          if (k && !owned && mem.measured[v] == null && !risky.has(v)) Sim.apply(s, { type: "buy", item: k, rack: tank.id });
        }
      }
      // scale a proven tech: more tanks
      const proven = Object.keys(mem.measured).some(v => mem.measured[v] >= 0.95 && !risky.has(v));
      const tanks = s.racks.filter(r => r.tank).length;
      if (proven && !converting && tanks < 6 && s.cash > 400 && s.racks.filter(r => r.tank).every(r => Sim.usedU(s, r) >= 15)) {
        const e = emptyRacks(s, 1)[0]; if (e) Sim.apply(s, { type: "tank", rack: e.id });
      }
    }
    // 5. upgrades: swap the worst card per kW for the best new one when the grid is the limit
    const powerBound = Sim.gridKwAll(s) > s.gridKw - 8;
    const spaceBound = !s.racks.some(r => !r.tank && Sim.K.RACK_U - Sim.usedU(s, r) >= 4);
    if (powerBound && Sim.check(s, { type: "grid" }).ok && s.cash > K.GRID_COST + 200 && s.day < 800) Sim.apply(s, { type: "grid" });
    if (powerBound || spaceBound) {
      // refit: in one rack, pull the least valuable cards until a better new card fits
      const base = Sim.stats(s, { eq: true }).net, cur = lookValue(s, s, mem);
      const upg = Sim.shopItems(s).filter(k => { const it = s.items[k];
        return (it.role === "gpu" && it.gen === Sim.currentGen(s)) || (it.role === "exotic" && mem.measured[it.vendor] >= 0.95 && !risky.has(it.vendor)); });
      let bestRefit = null;
      for (const r of s.racks) {
        if (!r.devices.length) continue;
        const ranked = r.devices.filter(d => s.items[d.type].role !== "net").map(d => {
          const p = Sim.project(s, { type: "sell", rack: r.id, uid: d.uid });
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
            const a = { type: "sell", rack: r.id, uid: x.d.uid };
            p = Sim.project(p, a); sells.push(a); got += Sim.resale(s, x.d);
          }
          const buy = { type: "buy", item: k, rack: r.id };
          if (!sells.length || !Sim.check(p, buy).ok) continue;
          const v = lookValue(s, Sim.project(p, buy), mem);
          const value = (v.perDay - cur.perDay) * v.span - it.price + got;
          if (value > 20 && (!bestRefit || value > bestRefit.value)) bestRefit = { sells, buy, value };
        }
      }
      if (bestRefit) { for (const a of bestRefit.sells) Sim.apply(s, a); Sim.apply(s, bestRefit.buy); }
    }
    // 6. buy: best lookahead value per dollar
    const skip = k => {
      const it = s.items[k];
      if (risky.has(it.vendor)) return true;
      if (it.role === "exotic" && !(mem.measured[it.vendor] >= 0.95)) return true;   // unproven: pilot only
      return false;
    };
    for (let n = 0; n < 4; n++) {
      const cur = lookValue(s, s, mem);
      let best = null;
      for (const c of candidates(s, { skip })) {
        if (c.cost > s.cash - 20) continue;
        const p = preview(s, c.acts);
        if (!p) continue;
        const v = lookValue(s, p, mem);
        const endResale = c.acts.reduce((a, x) => a + (x.type === "buy" ? Sim.BASE_ITEMS[x.item].price * 0.3 : 0), 0);
        const value = (v.perDay - cur.perDay) * v.span - c.cost + endResale;
        if (value <= 0) continue;
        const score = value / c.cost;
        if (!best || score > best.score) best = Object.assign({ score }, c);
      }
      if (!best) break;
      doActs(s, best.acts);
    }
  }

  /* ---------------- shared housekeeping (v2 mechanics both bots handle the same, naive way) ---------------- */
  // keep internet transit a unit ahead of web + inference traffic (ch7)
  function keepTransit(s) {
    if (!Sim.on(s, "fabric")) return;
    const st = Sim.stats(s), need = Math.ceil((st.supply.web + st.supply.infer) / st.transitF / K.TRANSIT_PER) - K.TRANSIT_FREE + 1;
    const cur = Sim.transitTarget(s);
    if (need > cur) Sim.apply(s, { type: "transit", delta: need - cur });
    else if (cur > need + 3) Sim.apply(s, { type: "transit", delta: need + 1 - cur });
  }
  function housekeeping(s) { keepTransit(s); }
  const withHousekeeping = fn => (s, mem) => { if (s.day >= (mem.nextHk || 0)) { mem.nextHk = s.day + 2; housekeeping(s); } fn(s, mem); };

  const POLICIES = { idle: () => {}, greedy: withHousekeeping(greedy), planner: withHousekeeping(planner) };

  /* play a whole game headlessly. Returns final net worth and a small trace */
  function play(seed, policy, opts) {
    const s = Sim.newGame(seed, opts);
    const mem = {}, fn = POLICIES[policy];
    while (!s.over) { fn(s, mem); Sim.advance(s, 1); }
    return { seed, policy, worth: Sim.netWorth(s), score: Sim.score(s), over: s.over, state: s };
  }

  return { play, POLICIES, greedy, planner };
});
