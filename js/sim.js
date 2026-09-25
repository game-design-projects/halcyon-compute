/* Halcyon Compute — deterministic simulation core.
 * No DOM. Loads as a classic <script> (window.Sim) and as CommonJS (require).
 * All money is in $k, all time in days. State is plain JSON; the same seed + the same
 * actions at the same days always give the same result (fixed 0.25-day substep).
 */
(function (root, factory) {
  const Sim = factory();
  if (typeof module === "object" && module.exports) module.exports = Sim;
  else root.Sim = Sim;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* ================= constants ================= */
  const K = {
    DT: 0.25, END_DAY: 1080, START_CASH: 400, BANKRUPT: -150,
    RACK_U: 20, RACK_KW: 30, ROWS: 3, COLS: 6,
    GRID_KW: 250, GRID_KW_UP: 400, GRID_COST: 450, GRID_DAYS: 30,
    TECHS: 3, SHIP_DAYS: 6, INSTALL_DAYS: 2, MOVE_DAYS: 1, SELL_DAYS: 1,
    TANK_COST: 90, TANK_DAYS: 8, TANK_ROOM_HEAT: 0.2,
    T_LIMIT: 32, THERMAL_TAU: 5, OVERSUPPLY: 0.25,
    POWER_PRICE: 0.065, UPKEEP: 1.5, UPKEEP_PER_DEV: 0.02,
    SWITCH_NET: 16, HISTORY_EVERY: 5, BENCH_EVERY: 30,
  };
  const WORKLOADS = ["train", "infer"];
  const INTENSITY = { train: 2.0, infer: 0.5 };        // FLOP per byte: roofline x-axis
  const NET_NEED = { train: 4, infer: 2, cpu: 0.5, exotic: 1 };
  const MODES = {
    eco:   { kw: 0.65, out: 0.8,  label: "Eco" },
    std:   { kw: 1,    out: 1,    label: "Standard" },
    boost: { kw: 1.35, out: 1.12, label: "Boost" },
  };
  const MARKET = {
    web:   { base: 0.18, demand: 30, growth: 1.0,  drift: 1.0 },
    train: { base: 0.25, demand: 60, growth: 1.25, drift: 0.985 },
    infer: { base: 0.55, demand: 25, growth: 2.2,  drift: 0.985 },
  };
  const GEN_LAUNCH = [390, 780];
  const GEN_DROP = { train: 0.72, infer: 0.75 };

  /* catalog. F = compute, B = memory bandwidth (roofline). avail = first day on sale */
  const BASE_ITEMS = {
    sw:  { name: "Ferro 48P switch", role: "net",  u: 1, kw: 0.4, price: 25, net: K.SWITCH_NET, avail: 0, vendor: "ferro", icon: "switch" },
    cpu: { name: "Tern web server",  role: "cpu",  u: 1, kw: 0.8, price: 12, avail: 0, vendor: "tern", icon: "cpu" },
    cru: { name: "Brisa CRU cooler", role: "cool", u: 2, kw: 0.6, price: 45, cool: 12, avail: 120, vendor: "brisa", icon: "snow" },
    c1:  { name: "Kestrel C1", role: "gpu", fam: "C", gen: 1, u: 4, kw: 6.0, price: 180, F: 10, B: 4,  avail: 60,  vendor: "kestrel", icon: "chip" },
    m1:  { name: "Heron M1",   role: "gpu", fam: "M", gen: 1, u: 4, kw: 5.0, price: 200, F: 6,  B: 8,  avail: 60,  vendor: "heron", icon: "chip" },
    c2:  { name: "Kestrel C2", role: "gpu", fam: "C", gen: 2, u: 4, kw: 6.5, price: 230, F: 16, B: 6,  avail: 390, vendor: "kestrel", icon: "chip" },
    m2:  { name: "Heron M2",   role: "gpu", fam: "M", gen: 2, u: 4, kw: 5.5, price: 250, F: 9,  B: 13, avail: 390, vendor: "heron", icon: "chip" },
    c3:  { name: "Kestrel C3", role: "gpu", fam: "C", gen: 3, u: 4, kw: 7.0, price: 280, F: 25, B: 9,  avail: 780, vendor: "kestrel", icon: "chip" },
    m3:  { name: "Heron M3",   role: "gpu", fam: "M", gen: 3, u: 4, kw: 6.0, price: 300, F: 14, B: 21, avail: 780, vendor: "heron", icon: "chip" },
    pm9: { name: "Nanofab PM-900", role: "mem", u: 2, kw: 0.8, price: 150, boost: 1.25, avail: 520, vendor: "nanofab", icon: "layers" },
    // exotic accelerators: fixed workload, need an immersion tank rack. Which vendor is real is seeded.
    lat1: { name: "Lattice L1", role: "exotic", only: "infer", u: 2, kw: 1.2, price: 55, F: 2, B: 3,  avail: 450, vendor: "lattice", icon: "drop", tank: true, model: 0 },
    lat2: { name: "Lattice L2", role: "exotic", only: "infer", u: 2, kw: 1.4, price: 65, F: 5, B: 8,  avail: 690, vendor: "lattice", icon: "drop", tank: true, model: 1 },
    lat3: { name: "Lattice L3", role: "exotic", only: "infer", u: 2, kw: 1.5, price: 75, F: 9, B: 15, avail: 900, vendor: "lattice", icon: "drop", tank: true, model: 2 },
    pho1: { name: "Photon P1",  role: "exotic", only: "train", u: 2, kw: 1.2, price: 55, F: 1.5, B: 1,   avail: 450, vendor: "photon", icon: "rocket", tank: true, model: 0 },
    pho2: { name: "Photon P2",  role: "exotic", only: "train", u: 2, kw: 1.4, price: 65, F: 4,   B: 2.5, avail: 690, vendor: "photon", icon: "rocket", tank: true, model: 1 },
    pho3: { name: "Photon P3",  role: "exotic", only: "train", u: 2, kw: 1.5, price: 75, F: 7.5, B: 4,   avail: 900, vendor: "photon", icon: "rocket", tank: true, model: 2 },
  };
  const SHOP_ORDER = ["sw", "cpu", "cru", "c1", "m1", "c2", "m2", "c3", "m3", "pm9", "lat1", "lat2", "lat3", "pho1", "pho2", "pho3"];
  const FAKE_FIELD = 0.6;       // a hyped vendor's hardware delivers 60 % of the spec sheet in the field
  const PM9_PITCH = 0.7, PM9_FIRESALE = 0.4;

  const CHAPTERS = [
    { day: 0,   key: "racks",   title: "Racks and cash" },
    { day: 30,  key: "power",   title: "Power" },
    { day: 60,  key: "gpu",     title: "GPUs and the roofline" },
    { day: 120, key: "heat",    title: "Summer is coming" },
    { day: 330, key: "gens",    title: "Hardware generations" },
    { day: 450, key: "disrupt", title: "Something new" },
  ];

  /* ================= helpers ================= */
  function nextRand(s) {  // mulberry32, state lives in s.rng so runs are reproducible
    let t = (s.rng = (s.rng + 0x6D2B79F5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  let DEBUG = false;
  function log(s, msg) {
    s.log.push(`d${Math.floor(s.day)} ${msg}`);
    if (s.log.length > 300) s.log.shift();
    if (DEBUG) console.debug(`[sim d${s.day.toFixed(2)}] ${msg}`);
  }

  function seasonAt(day) {
    const doy = ((day % 360) + 360) % 360, frac = doy / 360;
    const c = Math.cos(2 * Math.PI * (frac - 0.55));            // +1 at the end of July, -1 in late January
    const month = Math.floor(doy / 30);
    const name = ["winter", "spring", "summer", "autumn"][Math.floor(((month + 1) % 12) / 3)];
    return { c, name, month, heatCap: 245 - 25 * c, powerPrice: K.POWER_PRICE * (1 + 0.2 * c) };
  }

  /* ================= new game ================= */
  function newGame(seed, opts) {
    opts = opts || {};
    const s = {
      v: 1, seed: seed >>> 0, rng: (seed >>> 0) ^ 0x9E3779B9, day: 0, cash: K.START_CASH,
      roomT: 24, gridKw: K.GRID_KW, gridUp: false, nextId: 1, over: null,
      mech: Object.assign({ heat: true, gens: true, disrupt: true, network: true, roofline: true }, opts.mech || {}),
      racks: [], jobs: [], news: [], log: [], history: [], bench: { lattice: [], photon: [] },
      chapter: 0, events: [], firedEvents: 0,
      market: { mult: { web: 1, train: 1, infer: 1 }, noise: { web: 1, train: 1, infer: 1 } },
      vendors: {}, items: {},
      ledger: newLedger(), lastQuarter: null, totals: { revenue: 0, power: 0, capex: 0, resale: 0 },
    };
    // seeded hidden truths
    const realExotic = nextRand(s) < 0.5 ? "lattice" : "photon";
    const fakeExotic = realExotic === "lattice" ? "photon" : "lattice";
    const nanofabDies = nextRand(s) < 0.75;
    s.hidden = { realExotic, fakeExotic, nanofabDies };
    for (const [k, it] of Object.entries(BASE_ITEMS)) s.items[k] = Object.assign({ key: k, field: 1 }, it);
    for (const k of Object.keys(s.items)) if (s.items[k].vendor === fakeExotic) s.items[k].field = FAKE_FIELD;
    s.items.pm9.price = Math.round(BASE_ITEMS.pm9.price * PM9_PITCH);
    for (const v of ["ferro", "tern", "brisa", "kestrel", "heron", "nanofab", "lattice", "photon"]) s.vendors[v] = { dead: false };
    if (!s.mech.roofline) {  // ablation: both GPU families identical (no bottleneck matching)
      for (const k of ["c1", "m1", "c2", "m2", "c3", "m3"]) { const it = s.items[k]; const g = it.gen; it.F = [0, 8, 12.5, 19.5][g]; it.B = [0, 6, 9.5, 15][g]; }
    }

    const ids = [];
    for (let r = 0; r < K.ROWS; r++) for (let c = 0; c < K.COLS; c++) ids.push("ABC"[r] + (c + 1));
    s.racks = ids.map(id => ({ id, devices: [], pending: [], mode: "std", workload: "train", tank: false }));
    for (const id of ["A1", "A2"]) {
      const r = rackById(s, id);
      r.devices.push(dev(s, "sw"));
      for (let i = 0; i < 8; i++) r.devices.push(dev(s, "cpu"));
    }
    s.events = buildEvents(s);
    log(s, `new game seed=${s.seed} real=${realExotic} nanofabDies=${nanofabDies}`);
    fireEvents(s);
    sampleHistory(s);
    return s;
  }
  function newLedger() { return { web: 0, train: 0, infer: 0, power: 0, upkeep: 0, lost: 0 }; }
  function dev(s, type) { return { uid: s.nextId++, type, born: s.day }; }

  function buildEvents(s) {
    const E = [], j = () => Math.round((nextRand(s) - 0.5) * 16);   // +-8 day jitter on news
    const R = s.hidden.realExotic, F = s.hidden.fakeExotic;
    const NAME = { lattice: "Lattice", photon: "Photon" };
    const add = (day, kind, data) => E.push(Object.assign({ day, kind }, data));
    CHAPTERS.forEach((c, i) => {
      if (c.key === "gens" && !s.mech.gens) return;
      if (c.key === "disrupt" && !s.mech.disrupt) return;
      add(c.day, "chapter", { idx: i });
    });
    add(0, "news", { title: "Welcome to Halcyon Compute", body: "Two racks of web servers and $400k. Grow it.", tone: "info" });
    if (s.mech.gens) {
      add(330 + j(), "news", { title: "Kestrel C2 and Heron M2 rumored", body: "Leaks say both ship in about two months.", tone: "info" });
      add(GEN_LAUNCH[0], "launch", { gen: 2 });
      add(720 + j(), "news", { title: "Third-generation cards rumored", body: "Kestrel C3 and Heron M3 expected in about two months.", tone: "info" });
      add(GEN_LAUNCH[1], "launch", { gen: 3 });
    }
    if (s.mech.disrupt) {
      add(360, "news", { title: "Two startups demo new accelerators", body: "Lattice (inference ASIC) and Photon (optical training). Both need immersion tanks.", tone: "info" });
      add(450, "exoticLaunch", { model: 0 });
      // the real one gathers momentum, the fake one gathers excuses
      add(600 + j(), "news", { title: `${NAME[R]} signs a hyperscaler deal`, body: "Undisclosed volume.", tone: "good", vendor: R });
      add(560 + j(), "news", { title: `${NAME[F]} pushes its next ship date`, body: "\"A short delay to raise yields.\"", tone: "info", vendor: F });
      add(690, "exoticLaunch", { model: 1 });
      add(720 + j(), "news", { title: `${NAME[F]} lead architect departs`, body: "Joins a competitor.", tone: "bad", vendor: F });
      add(840, "vendorDeath", { vendor: F, title: `${NAME[F]} winds down`, body: "Installed units lose firmware support and stop working." });
      add(900, "exoticLaunch", { model: 2 });
      add(520, "pitch", {});
      if (s.hidden.nanofabDies) {
        add(640 + j(), "news", { title: "Nanofab sells its only fab", body: "No successor product announced.", tone: "bad", vendor: "nanofab" });
        add(700 + j(), "firesale", {});
        add(770, "vendorDeath", { vendor: "nanofab", title: "Nanofab exits the memory business", body: "PM-900 firmware is withdrawn. Racks holding one run at 60 % until it is pulled." });
      } else {
        add(640 + j(), "news", { title: "Nanofab posts a record quarter", body: "PM-900 volume up 40 %.", tone: "good", vendor: "nanofab" });
      }
      for (let d = 360; d <= K.END_DAY; d += K.BENCH_EVERY) add(d, "bench", {});
    }
    E.sort((a, b) => a.day - b.day);
    return E;
  }

  function fireEvents(s) {
    while (s.firedEvents < s.events.length && s.events[s.firedEvents].day <= s.day) {
      const e = s.events[s.firedEvents++];
      handleEvent(s, e);
    }
  }
  function pushNews(s, n) { s.news.unshift(Object.assign({ day: Math.floor(s.day), tone: "info" }, n)); if (s.news.length > 40) s.news.pop(); }

  function handleEvent(s, e) {
    const NAME = { lattice: "Lattice", photon: "Photon" };
    switch (e.kind) {
      case "chapter": s.chapter = Math.max(s.chapter, e.idx); log(s, `chapter ${CHAPTERS[e.idx].key}`); break;
      case "news": pushNews(s, { title: e.title, body: e.body, tone: e.tone, vendor: e.vendor }); break;
      case "launch": {
        const g = e.gen;
        for (const it of Object.values(s.items)) if (it.role === "gpu" && it.gen === g - 1) it.price = Math.round(it.price * 0.6);
        for (const w of WORKLOADS) s.market.mult[w] *= GEN_DROP[w];
        pushNews(s, { title: `Generation ${g} ships`, body: "Rivals upgrade, so compute prices drop. Older cards resell for less.", tone: "bad", icon: "chip" });
        log(s, `gen ${g} launch`); break;
      }
      case "exoticLaunch": {
        const m = e.model, real = s.hidden.realExotic, fake = s.hidden.fakeExotic;
        const names = [];
        for (const v of [real, fake]) {
          if (s.vendors[v].dead) continue;
          const it = Object.values(s.items).find(x => x.vendor === v && x.model === m);
          if (!it) continue;
          if (v === fake && m === 2) continue;             // never ships
          it.avail = Math.min(it.avail, s.day); names.push(it.name);
        }
        if (m === 1) s.market.mult[s.items[real === "lattice" ? "lat1" : "pho1"].only] *= 0.8;
        if (m === 2) s.market.mult[s.items[real === "lattice" ? "lat1" : "pho1"].only] *= 0.85;
        if (names.length) pushNews(s, { title: `${names.join(" and ")} on sale`, body: m === 0 ? "Pilot quantities. Needs an immersion tank rack." : "Vendor claims a big jump in performance per watt.", tone: "info", icon: "rocket" });
        break;
      }
      case "pitch":
        pushNews(s, { title: "PM-900, 30 % off", body: "Nanofab: \"Adds 25 % memory bandwidth to every GPU in the rack. Fixes your HBM bottleneck.\"", tone: "pitch", vendor: "nanofab", icon: "tag" });
        break;
      case "firesale":
        s.items.pm9.price = Math.round(BASE_ITEMS.pm9.price * PM9_FIRESALE);
        pushNews(s, { title: "PM-900 now 60 % off", body: "\"Limited-time inventory clearance.\"", tone: "pitch", vendor: "nanofab", icon: "tag" });
        break;
      case "vendorDeath":
        s.vendors[e.vendor].dead = true;
        pushNews(s, { title: e.title, body: e.body, tone: "bad", vendor: e.vendor });
        log(s, `vendor ${e.vendor} dead`); break;
      case "bench": {
        for (const v of ["lattice", "photon"]) {
          const t = (s.day - 360);
          const real = v === s.hidden.realExotic;
          if (!real && s.vendors[v].dead) continue;
          const val = real ? 1.6 * Math.pow(2, t / 180) : 1.6 + 2.0 * (1 - Math.exp(-t / 110));
          s.bench[v].push({ d: Math.floor(s.day), v: +(val * (1 + (nextRand(s) - 0.5) * 0.1)).toFixed(2) });
        }
        break;
      }
    }
  }

  /* ================= model ================= */
  const rackById = (s, id) => s.racks.find(r => r.id === id);
  const rackIndex = (s, id) => s.racks.findIndex(r => r.id === id);
  const itemOf = (s, d) => s.items[d.type];
  const isDead = (s, it) => !!(it.vendor && s.vendors[it.vendor].dead);
  const usedU = (s, r) => r.devices.concat(r.pending).reduce((a, d) => a + itemOf(s, d).u, 0);
  const devKw = (s, r, list) => list.reduce((a, d) => a + itemOf(s, d).kw, 0) * MODES[r.mode].kw;
  const rackKw = (s, r) => devKw(s, r, r.devices);
  const rackKwAll = (s, r) => devKw(s, r, r.devices.concat(r.pending));
  const gridKwAll = s => s.racks.reduce((a, r) => a + rackKwAll(s, r), 0);

  function marketAt(s, day) {
    const out = {};
    for (const [w, m] of Object.entries(MARKET)) {
      out[w] = {
        price: m.base * s.market.mult[w] * Math.pow(m.drift, day / 90),
        demand: m.demand * Math.pow(m.growth, day / 360) * s.market.noise[w],
      };
    }
    return out;
  }

  /* throughput one device contributes, before rack-level factors */
  function deviceOut(s, r, it, boost) {
    if (isDead(s, it)) return null;
    if (it.role === "cpu") return { w: "web", v: 1 };
    if (it.role === "gpu") { const I = INTENSITY[r.workload]; return { w: r.workload, v: Math.min(it.F, it.B * boost * I) }; }
    if (it.role === "exotic") { const I = INTENSITY[it.only]; return { w: it.only, v: Math.min(it.F, it.B * I) * it.field }; }
    return null;
  }

  /* instantaneous economics. opts.day: evaluate at another day (market + season);
     opts.eq: use equilibrium room temperature instead of the current one */
  function stats(s, opts) {
    opts = opts || {};
    const day = opts.day != null ? opts.day : s.day;
    const se = seasonAt(day), mk = marketAt(s, day);
    const perRack = {};
    let kw = 0, roomHeat = 0, cool = 0;
    for (const r of s.racks) {
      const k = rackKw(s, r);
      perRack[r.id] = { kw: k };
      kw += k;
      roomHeat += r.tank ? k * K.TANK_ROOM_HEAT : k;
      for (const d of r.devices) { const it = itemOf(s, d); if (it.cool && !isDead(s, it)) cool += it.cool; }
    }
    const heatCap = (s.mech.heat ? se.heatCap : 1e6) + cool;
    const tTarget = 18 + 14 * roomHeat / heatCap;
    const roomT = opts.eq ? tTarget : s.roomT;
    const supply = { web: 0, train: 0, infer: 0 };
    s.racks.forEach((r, n) => {
      const pr = perRack[r.id];
      const col = n % K.COLS, row = Math.floor(n / K.COLS);
      let nb = 0;
      for (const c of [col - 1, col + 1]) if (c >= 0 && c < K.COLS) { const o = s.racks[row * K.COLS + c]; nb += perRack[o.id].kw * (o.tank ? K.TANK_ROOM_HEAT : 1); }
      const own = pr.kw * (r.tank ? K.TANK_ROOM_HEAT : 1);
      pr.load = (own + 0.3 * nb) / K.RACK_KW;
      pr.inlet = roomT + (s.mech.heat ? 5 * Math.max(0, pr.load - 0.6) : 0);
      pr.throttle = s.mech.heat ? throttleAt(pr.inlet) : 1;
      let netProv = 0, netNeed = 0, boost = 1, bricked = false;
      for (const d of r.devices) {
        const it = itemOf(s, d);
        if (it.role === "net") netProv += it.net;
        if (it.role === "mem") { if (isDead(s, it)) bricked = true; else boost = Math.max(boost, it.boost); }
      }
      const raw = { web: 0, train: 0, infer: 0 };
      for (const d of r.devices) {
        const it = itemOf(s, d), o = deviceOut(s, r, it, boost);
        if (!o) continue;
        raw[o.w] += o.v;
        netNeed += it.role === "cpu" ? NET_NEED.cpu : it.role === "exotic" ? NET_NEED.exotic : NET_NEED[r.workload];
      }
      pr.netProv = netProv; pr.netNeed = netNeed;
      pr.netF = !s.mech.network ? 1 : netNeed ? Math.min(1, netProv / netNeed) : 1;
      pr.penalty = bricked ? 0.6 : 1;
      const f = MODES[r.mode].out * pr.netF * pr.throttle * pr.penalty;
      pr.out = { web: raw.web * f, train: raw.train * f, infer: raw.infer * f };
      pr.raw = raw;
      for (const w in supply) supply[w] += pr.out[w];
    });
    const revenue = {}, lostCap = {};
    let gross = 0;
    for (const w in supply) {
      const S = supply[w], D = mk[w].demand, p = mk[w].price;
      revenue[w] = p * (Math.min(S, D) + K.OVERSUPPLY * Math.max(0, S - D));
      gross += revenue[w];
      lostCap[w] = Math.max(0, S - D);
    }
    for (const r of s.racks) {  // attribute revenue back to racks, for the detail panel
      const pr = perRack[r.id]; pr.rev = 0;
      for (const w in supply) if (supply[w] > 0) pr.rev += revenue[w] * pr.out[w] / supply[w];
    }
    const nDev = s.racks.reduce((a, r) => a + r.devices.length, 0);
    const powerCost = kw * se.powerPrice, upkeep = K.UPKEEP + K.UPKEEP_PER_DEV * nDev;
    const throttleLoss = s.racks.reduce((a, r) => { const pr = perRack[r.id]; return a + (pr.throttle < 1 ? pr.rev * (1 / pr.throttle - 1) : 0); }, 0);
    return { day, se, mk, kw, roomHeat, heatCap, tTarget, roomT, perRack, supply, revenue, gross, lostCap, powerCost, upkeep, throttleLoss,
      net: gross - powerCost - upkeep };
  }
  const throttleAt = t => t > K.T_LIMIT ? Math.max(0.5, 1 - (t - K.T_LIMIT) * 0.1) : 1;

  function resale(s, d) {
    const it = itemOf(s, d);
    if (isDead(s, it)) return 0;
    const base = BASE_ITEMS[d.type].price;
    let genBehind = 0;
    if (it.role === "gpu") genBehind = currentGen(s) - it.gen;
    const age = Math.max(0, s.day - d.born);
    return base * 0.55 * Math.pow(0.6, Math.max(0, genBehind)) * Math.max(0.3, 1 - age / 1200);
  }
  function netWorth(s) {
    let v = s.cash;
    for (const r of s.racks) for (const d of r.devices.concat(r.pending)) v += resale(s, d);
    return v;
  }

  /* ================= actions ================= */
  // {type:"buy", item, rack} | {type:"move", rack, uid, to} | {type:"sell", rack, uid}
  // {type:"mode", rack, mode} | {type:"workload", rack, workload} | {type:"tank", rack} | {type:"grid"}
  function isAvail(s, it) {
    if (it.avail > s.day || isDead(s, it)) return false;
    if ((it.role === "exotic" || it.key === "pm9") && !s.mech.disrupt) return false;
    if (it.role === "gpu" && it.gen > 1 && !s.mech.gens) return false;
    return true;
  }
  function shopItems(s) { return SHOP_ORDER.filter(k => isAvail(s, s.items[k])).filter(k => {
    const it = s.items[k];  // hide gpus two generations old
    return it.role !== "gpu" || it.gen >= currentGen(s) - 1;
  }); }
  const currentGen = s => 1 + GEN_LAUNCH.filter(g => s.day >= g && s.mech.gens).length;
  const busyTechs = s => s.jobs.filter(j => j.phase === "work" && j.tech).length;

  function fits(s, r, it, mode) {
    const m = MODES[mode || r.mode];
    if (it.tank && !r.tank) return "Needs an immersion tank rack";
    if (r.tank && !it.tank && it.role !== "net") return "Tank racks only take exotic cards and switches";
    const free = K.RACK_U - usedU(s, r);
    if (free < it.u) return `Needs ${it.u}U, ${free}U free`;
    if (rackKwAll(s, r) + it.kw * m.kw > K.RACK_KW + 1e-9) return `Rack limit ${K.RACK_KW} kW`;
    if (gridKwAll(s) + it.kw * m.kw > s.gridKw + 1e-9) return `Grid limit ${s.gridKw} kW`;
    return null;
  }
  function findDev(r, uid) { return r.devices.findIndex(d => d.uid === uid); }

  function check(s, a) {
    if (s.over) return { ok: false, msg: "Game over" };
    const r = a.rack != null ? rackById(s, a.rack) : null;
    if (a.type !== "grid" && !r) return { ok: false, msg: "No such rack" };
    switch (a.type) {
      case "buy": {
        const it = s.items[a.item];
        if (!it || !isAvail(s, it)) return { ok: false, msg: "Not on sale" };
        if (s.cash < it.price) return { ok: false, msg: `Needs $${it.price}k` };
        const f = fits(s, r, it); if (f) return { ok: false, msg: f };
        return { ok: true, msg: `$${it.price}k, online in ${K.SHIP_DAYS + K.INSTALL_DAYS} days` };
      }
      case "move": {
        const i = findDev(r, a.uid); if (i < 0) return { ok: false, msg: "Not in that rack" };
        if (a.to === a.rack) return { ok: false, msg: "Already here" };
        const to = rackById(s, a.to); if (!to) return { ok: false, msg: "No such rack" };
        const it = itemOf(s, r.devices[i]);
        const f = fits(s, to, it); if (f) return { ok: false, msg: f };
        return { ok: true, msg: `Move, ${K.MOVE_DAYS} day` };
      }
      case "sell": {
        const i = findDev(r, a.uid); if (i < 0) return { ok: false, msg: "Not in that rack" };
        return { ok: true, msg: `Sell for $${Math.round(resale(s, r.devices[i]))}k` };
      }
      case "mode": {
        if (!MODES[a.mode]) return { ok: false, msg: "Bad mode" };
        const k = devKw(s, { mode: a.mode }, r.devices.concat(r.pending));
        if (k > K.RACK_KW + 1e-9) return { ok: false, msg: `Rack would draw ${k.toFixed(1)} kW (limit ${K.RACK_KW})` };
        if (gridKwAll(s) - rackKwAll(s, r) + k > s.gridKw + 1e-9) return { ok: false, msg: `Grid limit ${s.gridKw} kW` };
        return { ok: true, msg: MODES[a.mode].label };
      }
      case "workload": return WORKLOADS.includes(a.workload) ? { ok: true, msg: a.workload } : { ok: false, msg: "Bad workload" };
      case "tank": {
        if (r.tank) return { ok: false, msg: "Already a tank" };
        if (r.devices.length || r.pending.length) return { ok: false, msg: "Empty the rack first" };
        if (s.jobs.some(j => j.kind === "tank" && j.rack === r.id)) return { ok: false, msg: "Already converting" };
        if (s.cash < K.TANK_COST) return { ok: false, msg: `Needs $${K.TANK_COST}k` };
        return { ok: true, msg: `Convert to immersion tank, $${K.TANK_COST}k, ${K.TANK_DAYS} days` };
      }
      case "grid": {
        if (s.gridUp || s.jobs.some(j => j.kind === "grid")) return { ok: false, msg: "Already upgraded" };
        if (s.cash < K.GRID_COST) return { ok: false, msg: `Needs $${K.GRID_COST}k` };
        return { ok: true, msg: `Grid to ${K.GRID_KW_UP} kW, $${K.GRID_COST}k, ${K.GRID_DAYS} days` };
      }
    }
    return { ok: false, msg: "Unknown action" };
  }

  function apply(s, a) {
    const res = check(s, a);
    if (!res.ok) { log(s, `reject ${a.type}: ${res.msg}`); return res; }
    const r = a.rack != null ? rackById(s, a.rack) : null;
    const job = { id: s.nextId++, kind: a.type, rack: a.rack };
    switch (a.type) {
      case "buy": {
        const it = s.items[a.item], d = dev(s, a.item);
        s.cash -= it.price; s.totals.capex += it.price;
        r.pending.push(d);
        Object.assign(job, { dev: d, to: a.rack, phase: "ship", left: K.SHIP_DAYS, total: K.SHIP_DAYS });
        s.jobs.push(job); break;
      }
      case "move": {
        const [d] = r.devices.splice(findDev(r, a.uid), 1);
        rackById(s, a.to).pending.push(d);
        Object.assign(job, { dev: d, to: a.to, phase: "wait", left: K.MOVE_DAYS, total: K.MOVE_DAYS });
        s.jobs.push(job); break;
      }
      case "sell": {
        const [d] = r.devices.splice(findDev(r, a.uid), 1);
        Object.assign(job, { dev: d, phase: "wait", left: K.SELL_DAYS, total: K.SELL_DAYS, value: resale(s, d) });
        s.jobs.push(job); break;
      }
      case "mode": r.mode = a.mode; break;
      case "workload": r.workload = a.workload; break;
      case "tank":
        s.cash -= K.TANK_COST; s.totals.capex += K.TANK_COST;
        Object.assign(job, { phase: "wait", left: K.TANK_DAYS, total: K.TANK_DAYS });
        s.jobs.push(job); break;
      case "grid":
        s.cash -= K.GRID_COST; s.totals.capex += K.GRID_COST;
        Object.assign(job, { phase: "contract", left: K.GRID_DAYS, total: K.GRID_DAYS });
        s.jobs.push(job); break;
    }
    log(s, `${a.type} ${JSON.stringify(a)}`);
    return res;
  }

  function finishJob(s, j) {
    if (j.kind === "buy" || j.kind === "move") {
      const r = rackById(s, j.to), i = r.pending.findIndex(d => d.uid === j.dev.uid);
      if (i >= 0) r.pending.splice(i, 1);
      if (j.kind === "buy") j.dev.inst = s.day;
      r.devices.push(j.dev);
    } else if (j.kind === "sell") { s.cash += j.value; s.totals.resale += j.value; }
    else if (j.kind === "tank") rackById(s, j.rack).tank = true;
    else if (j.kind === "grid") { s.gridUp = true; s.gridKw = K.GRID_KW_UP; pushNews(s, { title: "Grid upgrade live", body: `${K.GRID_KW_UP} kW available.`, tone: "good", icon: "bolt" }); }
    log(s, `done ${j.kind} ${j.dev ? j.dev.type : j.rack || ""}`);
  }

  /* ================= time ================= */
  function step(s) {
    const dt = K.DT, st = stats(s);
    const f = dt;
    s.cash += st.net * f;
    s.totals.revenue += st.gross * f; s.totals.power += st.powerCost * f;
    const L = s.ledger;
    L.web += st.revenue.web * f; L.train += st.revenue.train * f; L.infer += st.revenue.infer * f;
    L.power += st.powerCost * f; L.upkeep += st.upkeep * f; L.lost += st.throttleLoss * f;
    s.roomT += (st.tTarget - s.roomT) * (1 - Math.exp(-dt / K.THERMAL_TAU));

    for (const j of s.jobs) if (j.phase === "ship" || j.phase === "contract") {
      j.left -= dt;
      if (j.left <= 1e-9) { if (j.phase === "ship") { j.phase = "wait"; j.left = K.INSTALL_DAYS; j.total = K.INSTALL_DAYS; } else { j.done = true; finishJob(s, j); } }
    }
    for (const j of s.jobs) if (j.phase === "work" && !j.done) { j.left -= dt; if (j.left <= 1e-9) { j.done = true; finishJob(s, j); } }
    s.jobs = s.jobs.filter(j => !j.done);
    let free = K.TECHS - busyTechs(s);   // assign after progress, so a job never gains a free substep
    for (const j of s.jobs) if (j.phase === "wait" && free > 0) { j.phase = "work"; j.tech = true; free--; }

    const q0 = Math.floor(s.day / 90);
    s.day = +(s.day + dt).toFixed(4);
    if (Math.floor(s.day / 90) !== q0) {
      s.lastQuarter = Object.assign({ q: q0 }, s.ledger);
      s.ledger = newLedger();
    }
    if (Math.abs(s.day / 10 - Math.round(s.day / 10)) < 1e-6) {  // demand noise random walk every 10 days
      for (const w of ["train", "infer"]) s.market.noise[w] = clamp(s.market.noise[w] * (1 + (nextRand(s) - 0.5) * 0.08), 0.85, 1.15);
    }
    if (Math.abs(s.day / K.HISTORY_EVERY - Math.round(s.day / K.HISTORY_EVERY)) < 1e-6) sampleHistory(s, st);
    fireEvents(s);
    if (s.cash < K.BANKRUPT) { s.over = "bankrupt"; log(s, "bankrupt"); }
    else if (s.day >= K.END_DAY) { s.over = "end"; log(s, `end networth=${netWorth(s).toFixed(1)}`); }
  }
  function sampleHistory(s, st) {
    st = st || stats(s);
    s.history.push({ d: Math.round(s.day), cash: +s.cash.toFixed(1), worth: +netWorth(s).toFixed(1), net: +st.net.toFixed(2),
      pt: +st.mk.train.price.toFixed(3), pi: +st.mk.infer.price.toFixed(3),
      dt: +st.mk.train.demand.toFixed(1), di: +st.mk.infer.demand.toFixed(1),
      st: +st.supply.train.toFixed(1), si: +st.supply.infer.toFixed(1), t: +s.roomT.toFixed(1) });
  }
  /* advance by `days`, in whole substeps. Returns number of substeps taken. */
  function advance(s, days) {
    const n = Math.round(days / K.DT);
    let i = 0;
    for (; i < n && !s.over; i++) step(s);
    return i;
  }

  /* cheap copy for previews: racks/pending are copied, history and logs shared */
  function shallowClone(s) {
    return Object.assign({}, s, {
      racks: s.racks.map(r => Object.assign({}, r, { devices: r.devices.slice(), pending: r.pending.slice() })),
      jobs: s.jobs.slice(), log: [], cash: s.cash,
    });
  }
  /* state as if the action had fully completed (device installed), for previews and bots */
  function project(s, a) {
    const p = shallowClone(s), r = a.rack != null ? rackById(p, a.rack) : null;
    if (a.type === "buy") { r.devices.push({ uid: -1, type: a.item, born: s.day }); p.cash -= s.items[a.item].price; }
    else if (a.type === "move") { const [d] = r.devices.splice(findDev(r, a.uid), 1); rackById(p, a.to).devices.push(d); }
    else if (a.type === "sell") { const i = findDev(r, a.uid); p.cash += resale(s, r.devices[i]); r.devices.splice(i, 1); }
    else if (a.type === "mode") r.mode = a.mode;
    else if (a.type === "workload") r.workload = a.workload;
    else if (a.type === "tank") r.tank = true;
    else if (a.type === "grid") p.gridKw = K.GRID_KW_UP;
    return p;
  }

  return {
    K, MODES, MARKET, INTENSITY, NET_NEED, CHAPTERS, BASE_ITEMS, SHOP_ORDER, GEN_LAUNCH, WORKLOADS,
    newGame, step, advance, stats, check, apply, project, shallowClone, netWorth, resale,
    seasonAt, marketAt, rackById, rackIndex, usedU, rackKw, rackKwAll, gridKwAll, shopItems, currentGen, busyTechs, isDead, throttleAt,
    setDebug(v) { DEBUG = !!v; },
  };
});
