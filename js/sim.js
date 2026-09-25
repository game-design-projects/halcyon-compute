/* Halcyon Compute — deterministic simulation core (v2, 17 chapters, 1800 days).
 * No DOM. Loads as a classic <script> (window.Sim, after js/content.js) and as CommonJS (require).
 * All money is in $k, all time in days. State is plain JSON (survives JSON.parse(JSON.stringify(s)));
 * the same seed + the same actions at the same days always give the same result (fixed 0.25-day substep).
 * Static data (catalog, chapters, text) lives in js/content.js.
 */
(function (root, factory) {
  const isNode = typeof module === "object" && module.exports;
  const Sim = factory(isNode ? require("./content.js") : root.SimContent);
  if (isNode) module.exports = Sim;
  else root.Sim = Sim;
})(typeof globalThis !== "undefined" ? globalThis : this, function (C) {
  "use strict";
  const { WORKLOADS, INTENSITY, NET_NEED, MODES, MARKET, GEN_LAUNCH, GEN_DROP, BASE_ITEMS, SHOP_ORDER, CHAPTERS } = C;

  /* ================= constants ================= */
  const K = {
    DT: 0.25, END_DAY: 1800, START_CASH: 400, BANKRUPT: -150, YEAR: 360,
    RACK_U: 20, RACK_KW: 30, ROWS: 3, COLS: 6, HALL_RACKS: 18,
    GRID_KW: 250, GRID_KW_UP: 400, GRID_COST: 450, GRID_DAYS: 30,
    GRID_KW_UP2: 700, GRID_COST2: 900, GRID_DAYS2: 45,               // 3rd tier, from ch11 (Hall 2 needs power)
    GRID_KW_UP3: 1000, GRID_COST3: 1800, GRID_DAYS3: 90,             // 4th tier after the 3rd (Hall 3 needs power)
    TECHS: 3, SHIP_DAYS: 6, INSTALL_DAYS: 2, MOVE_DAYS: 1, SELL_DAYS: 1,
    TANK_COST: 90, TANK_DAYS: 8, TANK_ROOM_HEAT: 0.2,
    T_LIMIT: 32, THERMAL_TAU: 5, OVERSUPPLY: 0.25,
    POWER_PRICE: 0.065, UPKEEP: 1.5, UPKEEP_PER_DEV: 0.02,
    SWITCH_NET: 16, HISTORY_EVERY: 5, BENCH_EVERY: 30,
    // ch6 operations
    FAIL_BASE: { gpu: 0.0006, cpu: 0.0003, net: 0.0004, cool: 0.0004, mem: 0.0004, exotic: 0.0008 },
    INFANT_DAYS: 20, INFANT_MULT: 3, WEAROUT_DAYS: 500, WEAROUT_SCALE: 250, FAIL_T0: 30, FAIL_T_DOUBLE: 5,
    REPAIR_DAYS: 1, REPAIR_FRAC: 0.08, REPAIR_PARTS_DAYS: 4, SWAP_DAYS: 1, FAILED_RESALE: 0.5,
    TECH_MIN: 1, TECH_MAX: 10, SALARY: 0.35, HIRE_DAYS: 7, FIRE_PAY_DAYS: 10, UPKEEP_OPS: 0.45, SHELF: 12,
    // ch7 fabric
    SPINE_COST: 160, SPINE_DAYS: 20, SPINE_KW: 3, FRONTIER_MIN_GPUS: 12, FRONTIER_PRICE: 1.6, FRONTIER_DEMAND: 30, FRONTIER_GROWTH: 1.5,
    TRANSIT_PER: 10, TRANSIT_COST: 0.4, TRANSIT_DAYS: 5, TRANSIT_FREE: 3, TRANSIT_MAX: 300,
    // ch8 contracts
    OFFER_EVERY: 25, OFFER_JITTER: 7, OFFER_EXPIRY: 15, QUOTE_SPREAD: 0.15, PENALTY_MULT: 1.5, CONTRACT_OK_MISS: 0.05,
    // ch8 build-to-suit: big, long, high-SLA offers that need an up-front fit-out (capex) and start after a lead time
    BTS_EVERY: 60, BTS_JITTER: 15, BTS_FIRST: 30, BTS_EXPIRY: 20, BTS_LEAD: 45, BTS_PREMIUM: 0.2, BTS_PENALTY_MULT: 3,
    BTS_FIT_PER_UNIT: 6, BTS_MIN_UNITS: 20, BTS_SLA: 0.95,
    // ch9 memory
    HBM_BASE: 0.55, HBM_SLOPE: 0.45, HBM_REVERT: 0.08, HBM_VOL: 0.02, SHORT_SHIP_DAYS: 18, FORWARD_DAYS: 45,
    // ch10 finance
    LOAN_STEP: 100, LOAN_LTV: 0.4, INTEREST: 0.09, LEASE_RATE: 0.0045, TAX: 0.21, DEPR_DAYS: 1080,
    // ch11 facilities
    HALL_COST: 1400, HALL_DAYS: 75, HALL3_COST: 2400, HALL3_DAYS: 120, HALLS_MAX: 3, UPS_COST: 380, UPS_DAYS: 20, CRAC_COST: 260, CRAC_DAYS: 30, CRAC_KW: 45,
    OUTAGES_PER_YEAR: 2, DIESEL: 0.13, DIESEL_CO2: 0.8,             // $k per kW-day of generator power; t/MWh
    // ch12 energy
    SPOT_NOISE: 0.15, PPA_DAYS: 540, PPA_STEP: 25, PPA_MAX: 600, PPA_DISCOUNT: 0.95, SOLAR_COST: 600, SOLAR_DAYS: 30, SOLAR_KW: 60,
    BATTERY_SHAVE: 0.4, HEATWAVE_COOL: 15,
    // ch13 environment
    PUE_BASE: 1.3, PUE: { evap: 1.15, chiller: 1.45 }, COOL_SWITCH_COST: 40, COOL_SWITCH_DAYS: 7,
    WATER_PER_KW: 1, WATER_PRICE: 0.0025, DROUGHT_COOL: 0.6, GRID_CO2: 0.45, GRID_CO2_FALL: 0.97,
    // ch14 investors
    ROUND_EVERY: 120, ROUND_EXPIRY: 20, BOARD_EVERY: 180, BOARD_GROWTH: 0.15, PITCH_GROWTH: 0.05, FIRED_SCORE: 0.5,
    BUYBACK_STEP: 0.01, EARN_MULT: 2, EARN_DAYS: 365,
    // ch15 reputation
    REP_START: 60, PR_COST: 120, PR_GAIN: 8, PR_DECAY: 90, PR_BACKFIRE: 5, SCANDAL_DAYS: 45,
    REP_SLA_DAY: 0.15, REP_OUTAGE: 3, REP_CONTRACT_OK: 2, REP_DROUGHT_DAY: 0.1, PRESS_HIT: 6,
    // ch16 policy
    LOBBY_COST: 200, LOBBY_SHIFT: 0.15, LOBBY_LEAK: 0.3, CARBON_TAX0: 0.1, CARBON_TAX_STEP: 0.05, CARBON_TAX_MAX: 0.4,
    MANDATE_PUE: 1.3, MANDATE_GRACE: 120, MANDATE_FINE: 3, EXPORT_QUOTA: 8,
    // ch17 disruption
    DEMAND_CUT: 0.65, INCUMBENT_CUT: 0.75, PILOT_DAYS: 10,
  };
  const FAKE_FIELD = 0.6;       // a hyped vendor's hardware delivers 60 % of the spec sheet in the field
  const PM9_PITCH = 0.7, PM9_FIRESALE = 0.4;
  const CH_IDX = {};
  CHAPTERS.forEach((c, i) => { CH_IDX[c.key] = i; });
  const MECH_DEFAULT = { heat: true, gens: true, disrupt: true, network: true, roofline: true,
    ops: true, fabric: true, contracts: true, memory: true, finance: true, facilities: true, energy: true,
    environment: true, investors: true, reputation: true, policy: true };
  const LOSS_LABEL = {
    throttle: "throttling", failures: "failed hardware downtime", sla: "SLA penalties", shortage: "shortage delays",
    bricked: "bricked parts", fines: "efficiency fines", taxes: "taxes", outage: "grid outages", transit: "transit shortfall",
  };

  /* ================= helpers ================= */
  function nextRand(s, key) {  // mulberry32; streams live in the state so runs are reproducible
    key = key || "rng";
    let t = (s[key] = (s[key] + 0x6D2B79F5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const round2 = v => Math.round(v * 100) / 100;
  let DEBUG = false;
  function log(s, msg) {
    s.log.push(`d${Math.floor(s.day)} ${msg}`);
    if (s.log.length > 300) s.log.shift();
    if (DEBUG) console.debug(`[sim d${s.day.toFixed(2)}] ${msg}`);
  }
  /* is a chapter's mechanic live? (unlocked and not ablated) */
  function on(s, key) {
    const i = CH_IDX[key], c = CHAPTERS[i];
    if (c.mech && s.mech[c.mech] === false) return false;
    return s.chapter >= i;
  }

  function seasonAt(day) {
    const doy = ((day % 360) + 360) % 360, frac = doy / 360;
    const c = Math.cos(2 * Math.PI * (frac - 0.55));            // +1 at the end of July, -1 in late January
    const month = Math.floor(doy / 30);
    const name = ["winter", "spring", "summer", "autumn"][Math.floor(((month + 1) % 12) / 3)];
    return { c, name, month, heatCap: 245 - 25 * c, powerPrice: K.POWER_PRICE * (1 + 0.2 * c) };
  }
  const periodOf = day => `Y${Math.floor(day / 360) + 1} ${seasonAt(day).name}`;

  /* ================= new game ================= */
  function newGame(seed, opts) {
    opts = opts || {};
    seed = seed >>> 0;
    const s = {
      v: 2, seed, rng: seed ^ 0x9E3779B9, rngF: (seed ^ 0x85EBCA6B) >>> 0, day: 0, cash: K.START_CASH, sandbox: !!opts.sandbox,
      roomT: 24, gridKw: K.GRID_KW, gridUp: false, gridTier: 0, nextId: 1, over: null,
      mech: Object.assign({}, MECH_DEFAULT, opts.mech || {}),
      racks: [], jobs: [], news: [], log: [], history: [], bench: { lattice: [], photon: [] },
      chapter: 0, unlocked: {}, events: [], firedEvents: 0,
      market: { mult: { web: 1, train: 1, infer: 1 }, noise: { web: 1, train: 1, infer: 1 }, dmult: { web: 1, train: 1, infer: 1 }, gpuCut: 1 },
      vendors: {}, items: {},
      ledger: newLedger(), lastQuarter: null, totals: { revenue: 0, power: 0, capex: 0, resale: 0, opex: 0, tax: 0 },
      // ch6 operations
      techs: K.TECHS, hires: [], repairAuto: true, shelf: [],
      // ch7 fabric
      spines: {}, transit: 0, transitOrders: [],
      // ch8 contracts
      offers: [], contracts: [], nextOffer: -1, nextBts: -1, contractLog: { signed: 0, fulfilled: 0, failed: 0 },
      // ch9 memory
      hbm: { index: 1, target: 1, shortage: false, until: 0 },
      // ch10 finance
      debt: 0, creditLimit: -K.BANKRUPT, fin: { rev: 0, opex: 0, dep: 0 }, deprec: [],
      // ch11 facilities
      halls: [{ n: 1, built: true, cooling: "evap", crac: false, roomT: 24 }],
      ups: false, outage: null,
      // ch12 energy
      power: { noise: 1 }, heatWave: null, ppa: null, solar: false,
      // ch13 environment
      drought: null, env: { water: 0, carbon: 0, waterRate: 0, carbonRate: 0, green: 0 },
      // ch14 investors
      equity: { own: 1, raised: 0, rounds: 0 }, roundOffer: null, nextRound: -1, board: null, firedScore: null,
      // ch15 reputation
      rep: K.REP_START, prBoosts: [], scandalUntil: -1, press: {},
      // ch16 policy
      policies: [], policyFx: { carbonTax: 0, mandate: null, exportCtl: false }, exportUsed: 0, leaks: [],
      // ch17 disruption: pilot measurements
      measured: {},
      // end screen
      losses: {}, lossBy: {},
      revDays: [], profitDays: [], dayAcc: { rev: 0, profit: 0, missed: {} },
    };
    for (const k of Object.keys(LOSS_LABEL)) { s.losses[k] = 0; s.lossBy[k] = {}; }
    ensureHalls(s);
    // seeded hidden truths
    const realExotic = nextRand(s) < 0.5 ? "lattice" : "photon";
    const fakeExotic = realExotic === "lattice" ? "photon" : "lattice";
    const nanofabDies = nextRand(s) < 0.75;
    const demandCut = nextRand(s) < 0.5;
    s.hidden = { realExotic, fakeExotic, nanofabDies, demandCut, scares: [], policy: {} };
    for (const [k, it] of Object.entries(BASE_ITEMS)) s.items[k] = Object.assign({ key: k, field: 1, base: it.price }, it);
    for (const k of Object.keys(s.items)) if (s.items[k].vendor === fakeExotic) s.items[k].field = FAKE_FIELD;
    s.items.pm9.price = s.items.pm9.base = Math.round(BASE_ITEMS.pm9.price * PM9_PITCH);
    for (const v of C.VENDORS) s.vendors[v] = { dead: false };
    if (!s.mech.roofline) {  // ablation: both GPU families identical (no bottleneck matching)
      for (const it of Object.values(s.items)) if (it.role === "gpu") { it.F = C.FLAT_F[it.gen]; it.B = C.FLAT_B[it.gen]; }
    }
    if (s.sandbox) for (const k of ["c1", "m1", "cru"]) s.items[k].avail = 0;
    addHallRacks(s, 1);
    for (const id of ["A1", "A2"]) {
      const r = rackById(s, id);
      r.devices.push(dev(s, "sw"));
      for (let i = 0; i < 8; i++) r.devices.push(dev(s, "cpu"));
    }
    s.events = buildEvents(s);
    log(s, `new game seed=${s.seed} sandbox=${s.sandbox} real=${realExotic} nanofabDies=${nanofabDies} demandCut=${demandCut}`);
    fireEvents(s);
    sampleHistory(s);
    return s;
  }
  const HALL_LETTERS = ["ABC", "DEF", "GHJ"];
  /* halls are generic: s.halls[n-1] for n = 1..HALLS_MAX (old two-hall saves get the missing entries) */
  function ensureHalls(s) {
    while (s.halls.length < K.HALLS_MAX) s.halls.push({ n: s.halls.length + 1, built: false, cooling: "evap", crac: false, roomT: 24 });
  }
  const hallCost = n => n <= 2 ? { cost: K.HALL_COST, days: K.HALL_DAYS } : { cost: K.HALL3_COST, days: K.HALL3_DAYS };
  function nextHall(s) {       // the next hall to build: first unbuilt one
    ensureHalls(s);
    const h = s.halls.find(x => !x.built);
    return h ? h.n : null;
  }
  function addHallRacks(s, hall) {
    const letters = HALL_LETTERS[hall - 1];
    for (let r = 0; r < K.ROWS; r++) for (let c = 0; c < K.COLS; c++)
      s.racks.push({ id: letters[r] + (c + 1), hall, row: r, col: c, devices: [], pending: [], mode: "std", workload: "train", tank: false });
  }
  function newLedger() {
    return { web: 0, train: 0, infer: 0, frontier: 0, contracts: 0, power: 0, upkeep: 0, salaries: 0, transit: 0, interest: 0,
      lease: 0, water: 0, carbonTax: 0, fines: 0, diesel: 0, penalties: 0, repairs: 0, other: 0, tax: 0, lost: 0 };
  }
  function dev(s, type) { return { uid: s.nextId++, type, born: s.day }; }

  /* the scripted + seeded timeline. Group events carry `group` and are skipped if that mechanic is off at fire time. */
  function buildEvents(s) {
    const E = [], R = () => nextRand(s), j = () => Math.round((R() - 0.5) * 16);   // +-8 day jitter on news
    const Rx = s.hidden.realExotic, Fx = s.hidden.fakeExotic, sb = s.sandbox;
    const NAME = { lattice: "Lattice", photon: "Photon" };
    const add = (day, kind, data) => { if (day <= K.END_DAY) E.push(Object.assign({ day, kind }, data)); };
    const startOf = key => sb ? 0 : CHAPTERS[CH_IDX[key]].day;
    CHAPTERS.forEach((c, i) => {
      if (c.mech && s.mech[c.mech] === false) return;
      add(sb ? 0 : c.day, "chapter", { idx: i });
    });
    add(0, "news", { title: "Welcome to Halcyon Compute", body: "Two racks of web servers and $400k. Grow it.", tone: "info" });
    if (s.mech.gens) {
      const RUMOR = ["", "", "Kestrel C2 and Heron M2 rumored", "Third-generation cards rumored", "Fourth-generation cards rumored", "Fifth-generation cards rumored"];
      GEN_LAUNCH.forEach((d, i) => {
        const g = i + 2;
        add(d - 60 + j(), "news", { title: RUMOR[g], body: `Kestrel C${g} and Heron M${g} expected in about two months.`, tone: "info", cat: "hardware" });
        add(d, "launch", { gen: g });
      });
    }
    // ---- ch9 memory: HBM shocks with leading scare stories; ~1/3 of scares are false alarms
    {
      const st = startOf("memory") + 40, shocks = [];
      for (let t = st + R() * 120; t < K.END_DAY - 90; t += 220 + R() * 160) shocks.push(Math.round(t));
      for (const d of shocks) {
        const lead = 20 + Math.round(R() * 20), sc = C.SCARES[Math.floor(R() * C.SCARES.length)];
        const dur = 45 + Math.round(R() * 45), peak = +(1.6 + R() * 0.4).toFixed(2);
        add(d - lead, "news", { group: "memory", title: sc.title, body: sc.body, tone: "bad", cat: "memory", icon: "layers" });
        add(d - lead + 10, "news", { group: "memory", title: C.SCARE_FOLLOW.real.title, body: C.SCARE_FOLLOW.real.body, tone: "info", cat: "memory" });
        add(d, "hbmShock", { group: "memory", until: d + dur, peak });
        add(d + dur, "hbmEnd", { group: "memory" });
        s.hidden.scares.push({ day: d - lead, real: true });
      }
      const nFalse = Math.max(1, Math.round(shocks.length / 2));
      for (let i = 0; i < nFalse; i++) {
        const d = Math.round(st + R() * (K.END_DAY - st - 60));
        if (shocks.some(x => Math.abs(x - d) < 60)) continue;
        const sc = C.SCARES[Math.floor(R() * C.SCARES.length)];
        add(d, "news", { group: "memory", title: sc.title, body: sc.body, tone: "bad", cat: "memory", icon: "layers" });
        add(d + 10, "news", { group: "memory", title: C.SCARE_FOLLOW.fake.title, body: C.SCARE_FOLLOW.fake.body, tone: "info", cat: "memory" });
        s.hidden.scares.push({ day: d, real: false });
      }
    }
    // ---- ch12 energy: summer heat waves (price spikes x2-3, flagged by weather news 5 days ahead)
    const waves = [];
    {
      const st = startOf("energy");
      for (let y = 0; y * 360 < K.END_DAY; y++) {
        const n = 1 + (R() < 0.5 ? 1 : 0);
        for (let i = 0; i < n; i++) {
          const d = Math.round(y * 360 + 150 + R() * 90), dur = 5 + Math.round(R() * 5), mult = +(2 + R()).toFixed(2);
          if (d - 5 < st || d + dur > K.END_DAY) continue;
          waves.push([d, d + dur]);
          add(d - 5, "news", { group: "energy", title: "Heat wave forecast next week", body: "Grid operator warns of price spikes.", tone: "bad", cat: "energy", icon: "temp" });
          add(d, "heatWave", { group: "energy", until: d + dur, mult });
        }
      }
    }
    // ---- ch11 facilities: grid outages (~2/yr, more in summer and heat waves)
    {
      const st = startOf("facilities") + 10;
      for (let d = st; d < K.END_DAY; d++) {
        const inWave = waves.some(w => d >= w[0] && d < w[1]);
        const p = K.OUTAGES_PER_YEAR / 360 * (1 + 0.8 * seasonAt(d).c) * (inWave ? 3 : 1) / 1.0;
        if (R() < p) {
          const dur = 1 + Math.floor(R() * 3);
          add(d, "outage", { group: "facilities", until: d + dur });
          d += dur + 10;
        }
      }
    }
    // ---- ch13 environment: summer droughts with a warning
    {
      const st = startOf("environment");
      for (let y = 0; y * 360 < K.END_DAY; y++) {
        const roll = R(), d = Math.round(y * 360 + 160 + R() * 60), dur = 30 + Math.round(R() * 30);
        if (roll > 0.6 || d - 12 < st || d > K.END_DAY) continue;
        add(d - 12, "news", { group: "environment", title: "Drought watch issued", body: "Water utility may cap industrial use this summer.", tone: "bad", cat: "environment", icon: "drop" });
        add(d, "drought", { group: "environment", until: d + dur });
      }
    }
    // ---- ch16 policy: three proposals with hidden pass probability, indirect signals, a vote
    {
      const st = startOf("policy") + (sb ? 60 : 10);
      C.POLICIES.forEach((pd, i) => {
        const ann = st + i * 70 + Math.round(R() * 20), vote = ann + 60 + Math.round(R() * 60);
        const id = "p" + (i + 1);
        s.hidden.policy[id] = { p0: +(0.3 + 0.5 * R()).toFixed(2), u: R() };
        s.policies.push({ id, kind: pd.kind, title: pd.title, body: pd.body, announced: false, announceDay: ann, vote, status: "proposed", shift: 0, lobbied: 0, signals: [] });
        add(ann, "policyAnnounce", { group: "policy", pid: id });
        add(Math.round(ann + (vote - ann) * 0.4), "policySignal", { group: "policy", pid: id });
        add(Math.round(ann + (vote - ann) * 0.75), "policySignal", { group: "policy", pid: id });
        add(vote, "policyVote", { group: "policy", pid: id });
      });
    }
    // ---- ch17 disruption (re-timed v1 chapter 6)
    if (s.mech.disrupt) {
      const D = 1290;
      add(1200, "news", { group: "disrupt", title: "Two startups demo new accelerators", body: "Lattice (inference ASIC) and Photon (optical training). Both need immersion tanks.", tone: "info", cat: "vendor" });
      add(D, "exoticLaunch", { model: 0 });
      add(1380 + j(), "news", { group: "disrupt", title: `${NAME[Rx]} signs a hyperscaler deal`, body: "Undisclosed volume.", tone: "good", vendor: Rx, cat: "vendor" });
      add(1350 + j(), "news", { group: "disrupt", title: `${NAME[Fx]} pushes its next ship date`, body: "\"A short delay to raise yields.\"", tone: "info", vendor: Fx, cat: "vendor" });
      add(1440, "exoticLaunch", { model: 1 });
      add(1450, "incumbentCut", { group: "disrupt" });
      add(1425 + j(), "news", { group: "disrupt", title: `${NAME[Fx]} lead architect departs`, body: "Joins a competitor.", tone: "bad", vendor: Fx, cat: "vendor" });
      add(1500, "vendorDeath", { vendor: Fx, title: `${NAME[Fx]} winds down`, body: "Installed units lose firmware support and stop working." });
      add(1590, "exoticLaunch", { model: 2 });
      add(1330, "pitch", {});
      if (s.hidden.nanofabDies) {
        add(1420 + j(), "news", { group: "disrupt", title: "Nanofab sells its only fab", body: "No successor product announced.", tone: "bad", vendor: "nanofab", cat: "vendor" });
        add(1500, "firesale", {});
        add(1560, "vendorDeath", { vendor: "nanofab", title: "Nanofab exits the memory business", body: "PM-900 firmware is withdrawn. Racks holding one run at 60 % until it is pulled." });
      } else {
        add(1420 + j(), "news", { group: "disrupt", title: "Nanofab posts a record quarter", body: "PM-900 volume up 40 %.", tone: "good", vendor: "nanofab", cat: "vendor" });
      }
      for (let d = 1200; d <= K.END_DAY; d += K.BENCH_EVERY) add(d, "bench", {});
      // M65 demand disruption: a preprint, then either independent reproduction (real) or failure to replicate
      const dd = 1400 + Math.round((R() - 0.5) * 20);
      add(dd - 30, "news", { group: "disrupt", title: "Preprint claims 3x cheaper inference", body: "\"Algorithmic breakthrough\" circulates among AI labs.", tone: "info", cat: "market" });
      add(dd - 15, "news", s.hidden.demandCut
        ? { group: "disrupt", title: "Breakthrough reproduced by independent labs", body: "Several labs confirm the speedup.", tone: "bad", cat: "market" }
        : { group: "disrupt", title: "Breakthrough results fail to replicate", body: "Independent labs cannot reproduce the numbers.", tone: "good", cat: "market" });
      add(dd, "demandShock", { group: "disrupt" });
    }
    E.sort((a, b) => a.day - b.day);
    return E;
  }

  function fireEvents(s) {
    while (s.firedEvents < s.events.length && s.events[s.firedEvents].day <= s.day) {
      const e = s.events[s.firedEvents++];
      if (e.group && !on(s, e.group)) continue;
      handleEvent(s, e);
    }
  }
  function pushNews(s, n) { s.news.unshift(Object.assign({ day: Math.floor(s.day), tone: "info", cat: "general" }, n)); if (s.news.length > 60) s.news.pop(); }

  function onChapter(s, key) {
    const d = s.day;
    s.unlocked[key] = d;
    if (key === "fabric") {           // grant enough transit for today's traffic, so nothing collapses on unlock
      const st = stats(s);
      s.transit = Math.max(0, Math.ceil((st.supply.web + st.supply.infer) / K.TRANSIT_PER) - K.TRANSIT_FREE);
      log(s, `fabric: starter transit ${s.transit} (+${K.TRANSIT_FREE} free)`);
    }
    if (key === "contracts") { s.nextOffer = d + 5; s.nextBts = d + K.BTS_FIRST; }
    if (key === "investors") s.nextRound = d + 15;
    if (key === "finance") s.creditLimit = creditLimitOf(s);
  }

  function handleEvent(s, e) {
    const NAME = { lattice: "Lattice", photon: "Photon" };
    switch (e.kind) {
      case "chapter":
        s.chapter = Math.max(s.chapter, e.idx); onChapter(s, CHAPTERS[e.idx].key);
        log(s, `chapter ${CHAPTERS[e.idx].key}`); break;
      case "news": pushNews(s, { title: e.title, body: e.body, tone: e.tone, vendor: e.vendor, cat: e.cat || "general", icon: e.icon }); break;
      case "launch": {
        const g = e.gen;
        for (const it of Object.values(s.items)) {
          if (it.role === "gpu" && it.gen === g - 1) { it.base = Math.round(it.base * 0.6); it.oldGen = true; }
        }
        updatePrices(s);
        for (const w of WORKLOADS) s.market.mult[w] *= GEN_DROP[w];
        pushNews(s, { title: `Generation ${g} ships`, body: "Rivals upgrade, so compute prices drop. Older cards resell for less; last gen is on sale.", tone: "bad", icon: "chip", cat: "hardware" });
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
        if (names.length) pushNews(s, { title: `${names.join(" and ")} on sale`, body: m === 0 ? "Pilot quantities. Needs an immersion tank rack." : "Vendor claims a big jump in performance per watt.", tone: "info", icon: "rocket", cat: "vendor" });
        log(s, `exotic model ${m} launch`);
        break;
      }
      case "pitch":
        pushNews(s, { title: "PM-900, 30 % off", body: "Nanofab: \"Adds 25 % memory bandwidth to every GPU in the rack. Fixes your HBM bottleneck.\"", tone: "pitch", vendor: "nanofab", icon: "tag", cat: "vendor" });
        break;
      case "firesale":
        s.items.pm9.price = s.items.pm9.base = Math.round(BASE_ITEMS.pm9.price * PM9_FIRESALE);
        pushNews(s, { title: "PM-900 now 60 % off", body: "\"Limited-time inventory clearance.\"", tone: "pitch", vendor: "nanofab", icon: "tag", cat: "vendor" });
        break;
      case "vendorDeath": {
        let lost = 0;
        for (const d of allOwnedDevices(s)) if (s.items[d.type].vendor === e.vendor && !d.leased) lost += resale(s, d);
        s.vendors[e.vendor].dead = true;
        addLoss(s, "bricked", lost);
        pushNews(s, { title: e.title, body: e.body, tone: "bad", vendor: e.vendor, cat: "vendor" });
        log(s, `vendor ${e.vendor} dead, wrote off ${lost.toFixed(1)}`); break;
      }
      case "bench": {
        for (const v of ["lattice", "photon"]) {
          const t = (s.day - 1200);
          const real = v === s.hidden.realExotic;
          if (!real && s.vendors[v].dead) continue;
          const val = real ? 1.6 * Math.pow(2, t / 180) : 1.6 + 2.0 * (1 - Math.exp(-t / 110));
          s.bench[v].push({ d: Math.floor(s.day), v: +(val * (1 + (nextRand(s) - 0.5) * 0.1)).toFixed(2) });
        }
        break;
      }
      case "incumbentCut": {   // M66: the incumbents answer the real startup
        s.market.gpuCut = K.INCUMBENT_CUT;
        for (const it of Object.values(s.items)) if (it.role === "gpu") it.base = Math.round(it.base * K.INCUMBENT_CUT);
        updatePrices(s);
        pushNews(s, { title: "Kestrel and Heron cut prices 25 %", body: "The incumbents respond to the startups.", tone: "good", icon: "tag", cat: "hardware" });
        log(s, "incumbent price cut"); break;
      }
      case "demandShock": {    // M65
        if (s.hidden.demandCut) {
          s.market.dmult.infer *= K.DEMAND_CUT;
          for (const c of s.contracts.filter(x => x.bts && x.w === "infer"))    // build-to-suit customers need far less too
            pushNews(s, { title: `${c.cust} cancels its build-to-suit deal`, body: "They need far less compute now. No penalty; the fit-out is sunk.", tone: "bad", cat: "contracts" });
          s.contracts = s.contracts.filter(x => !(x.bts && x.w === "infer"));
          pushNews(s, { title: "Inference demand drops 35 %", body: "Labs ship the new algorithm; they need far less compute.", tone: "bad", cat: "market" });
        } else pushNews(s, { title: "Inference demand steady", body: "The hyped paper changed nothing.", tone: "info", cat: "market" });
        log(s, `demand shock real=${s.hidden.demandCut}`); break;
      }
      case "hbmShock":
        Object.assign(s.hbm, { target: e.peak, shortage: true, until: e.until });
        pushNews(s, { title: "HBM shortage: GPU lead times triple", body: `GPU shipping now ${K.SHORT_SHIP_DAYS} days. Prices climbing.`, tone: "bad", cat: "memory", icon: "layers" });
        log(s, `hbm shock peak=${e.peak} until=${e.until}`); break;
      case "hbmEnd":
        Object.assign(s.hbm, { target: 1, shortage: false });
        pushNews(s, { title: "HBM supply normalizes", body: "GPU lead times back to normal.", tone: "good", cat: "memory" });
        log(s, "hbm shock end"); break;
      case "heatWave":
        s.heatWave = { start: s.day, until: e.until, mult: e.mult };
        pushNews(s, { title: "Heat wave: spot power spikes", body: `Prices x${e.mult} until it breaks.`, tone: "bad", cat: "energy", icon: "temp" });
        log(s, `heat wave x${e.mult} until ${e.until}`); break;
      case "outage": {
        s.outage = { start: s.day, until: e.until };
        if (s.ups) pushNews(s, { title: "Grid outage: generator running", body: "UPS carried the load. Diesel is burning.", tone: "info", cat: "facilities", icon: "bolt" });
        else {
          pushNews(s, { title: "Grid outage: everything is down", body: "No backup power. Output stops until the grid returns.", tone: "bad", cat: "facilities", icon: "bolt" });
          if (on(s, "reputation")) { repHit(s, K.REP_OUTAGE); press(s, "outage", 4); }
        }
        log(s, `outage until ${e.until} ups=${s.ups}`); break;
      }
      case "drought":
        s.drought = { start: s.day, until: e.until };
        pushNews(s, { title: "Drought: water use capped", body: "Evaporative cooling loses 40 % capacity.", tone: "bad", cat: "environment", icon: "drop" });
        log(s, `drought until ${e.until}`); break;
      case "policyAnnounce": {
        const p = policyById(s, e.pid); p.announced = true;
        pushNews(s, { title: `Proposed: ${p.title}`, body: `${p.body} Vote on day ${p.vote}.`, tone: "info", cat: "policy", icon: "flag" });
        log(s, `policy ${p.id} announced, vote ${p.vote}`); break;
      }
      case "policySignal": {   // indirect signal: positive with probability p0 (more positives = likelier to pass)
        const p = policyById(s, e.pid), h = s.hidden.policy[p.id];
        const up = nextRand(s) < h.p0, pool = C.POLICY_SIGNALS[up ? "up" : "down"];
        const title = pool[Math.floor(nextRand(s) * pool.length)];
        p.signals.push({ day: Math.floor(s.day), up });
        pushNews(s, { title: `${p.title}: ${title}`, body: "", tone: "info", cat: "policy", icon: up ? "trend" : "warn" });
        log(s, `policy ${p.id} signal ${up ? "up" : "down"}`); break;
      }
      case "policyVote": policyVote(s, policyById(s, e.pid)); break;
    }
  }

  /* ================= model ================= */
  const rackById = (s, id) => s.racks.find(r => r.id === id);
  const rackIndex = (s, id) => s.racks.findIndex(r => r.id === id);
  const itemOf = (s, d) => s.items[d.type];
  const isDead = (s, it) => !!(it.vendor && s.vendors[it.vendor].dead);
  const usedU = (s, r) => r.devices.concat(r.pending).reduce((a, d) => a + itemOf(s, d).u, 0);
  const devKw = (s, r, list) => list.reduce((a, d) => a + itemOf(s, d).kw, 0) * MODES[r.mode].kw;
  function rackKw(s, r) {                                                        // running draw (failed parts draw nothing)
    let k = 0;
    for (const d of r.devices) if (!d.failed) k += s.items[d.type].kw;
    return k * MODES[r.mode].kw;
  }
  const rackKwAll = (s, r) => devKw(s, r, r.devices.concat(r.pending));        // budget (includes failed and incoming)
  const spineCount = s => Object.keys(s.spines).length + s.jobs.filter(j => j.kind === "spine").length;
  const gridKwAll = s => s.racks.reduce((a, r) => a + rackKwAll(s, r), 0) + spineCount(s) * K.SPINE_KW;
  const policyById = (s, id) => s.policies.find(p => p.id === id);
  const hallOf = (s, n) => s.halls[n - 1];
  const hallT = (s, n) => n === 1 ? s.roomT : s.halls[n - 1].roomT;
  const shelfLoad = s => s.shelf.length + s.jobs.filter(j => j.toShelf).length;
  const hbmF = s => on(s, "memory") ? K.HBM_BASE + K.HBM_SLOPE * s.hbm.index : 1;
  function updatePrices(s) {
    const f = hbmF(s);
    for (const it of Object.values(s.items)) it.price = it.role === "gpu" ? Math.round(it.base * f) : it.base;
  }
  function allOwnedDevices(s) {
    const out = [];
    for (const r of s.racks) { for (const d of r.devices) out.push(d); for (const d of r.pending) out.push(d); }
    for (const d of s.shelf) out.push(d);
    for (const j of s.jobs) if (j.dev && (j.toShelf || j.kind === "store")) out.push(j.dev);
    return out;
  }
  function findAnywhere(s, uid) {
    for (const r of s.racks) {
      for (const d of r.devices) if (d.uid === uid) return { d, r, where: "devices" };
      for (const d of r.pending) if (d.uid === uid) return { d, r, where: "pending" };
    }
    for (const d of s.shelf) if (d.uid === uid) return { d, r: null, where: "shelf" };
    return null;
  }

  /* reputation in [-1, 1] around the start value, 0 when the chapter is locked */
  function repOf(s) {
    let v = s.rep;
    for (const b of s.prBoosts) v += b.amt * Math.max(0, 1 - (s.day - b.day) / K.PR_DECAY);
    return clamp(v, 0, 100);
  }
  const repF = s => on(s, "reputation") ? clamp((repOf(s) - K.REP_START) / 40, -1, 1) : 0;
  const repFactor = s => 1 + 0.2 * repF(s);

  function marketAt(s, day) {
    const out = {}, rf = repF(s);
    for (const w of ["web", "train", "infer"]) {
      const m = MARKET[w];
      out[w] = {
        price: m.base * s.market.mult[w] * Math.pow(m.drift, day / 90),
        demand: m.demand * Math.pow(m.growth, day / 360) * s.market.noise[w] * s.market.dmult[w] * (w === "train" ? 1 : 1 + 0.1 * rf),
      };
    }
    out.frontier = on(s, "fabric")
      ? { price: out.train.price * K.FRONTIER_PRICE, demand: K.FRONTIER_DEMAND * Math.pow(K.FRONTIER_GROWTH, Math.max(0, day - s.unlocked.fabric) / 360) }
      : { price: 0, demand: 0 };
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
  const activeAt = (x, day) => !!x && day < x.until && day >= (x.start != null ? x.start : -1);

  /* sell a supply vector: frontier first, then contracts (fixed price), then spot */
  function sellOutput(s, mk, supply, frontierElig, day) {
    const revenue = { web: 0, train: 0, infer: 0, frontier: 0, contracts: 0 }, wRev = { web: 0, train: 0, infer: 0 };
    const cDel = {}, cMiss = {}, lostCap = {};
    let penalties = 0;
    const left = { web: supply.web, train: supply.train, infer: supply.infer };
    if (mk.frontier.demand > 0 && frontierElig > 0) {
      const sold = Math.min(frontierElig, mk.frontier.demand, left.train);
      revenue.frontier = sold * mk.frontier.price; wRev.train += revenue.frontier;
      left.train -= sold;
    }
    if (s.contracts.length) {
      for (const w of ["web", "train", "infer"]) {
        const cs = s.contracts.filter(c => c.w === w && !(c.start > day + 1e-9));   // build-to-suit starts after its lead time
        if (!cs.length) continue;
        const Cu = cs.reduce((a, c) => a + c.units, 0), del = Math.min(left[w], Cu);
        for (const c of cs) {
          const share = del * c.units / Cu, miss = Math.max(0, c.sla * c.units - share);
          cDel[c.id] = share; cMiss[c.id] = miss;
          revenue.contracts += share * c.price; wRev[w] += share * c.price;
          penalties += miss * c.penalty;
        }
        left[w] -= del;
      }
    }
    for (const w of ["web", "train", "infer"]) {
      const S = left[w], D = mk[w].demand, p = mk[w].price;
      revenue[w] = p * (Math.min(S, D) + K.OVERSUPPLY * Math.max(0, S - D));
      wRev[w] += revenue[w];
      lostCap[w] = Math.max(0, S - D);
    }
    const gross = revenue.web + revenue.train + revenue.infer + revenue.frontier + revenue.contracts;
    return { revenue, wRev, gross, cDel, cMiss, penalties, lostCap };
  }

  /* instantaneous economics. opts.day: evaluate at another day (market + season);
     opts.eq: use equilibrium room temperature instead of the current one */
  function stats(s, opts) {
    opts = opts || {};
    const day = opts.day != null ? opts.day : s.day, now = day === s.day;
    const se = seasonAt(day), mk = marketAt(s, day);
    const envOn = on(s, "environment"), energyOn = on(s, "energy"), fabricOn = on(s, "fabric"), opsOn = on(s, "ops");
    const drought = envOn && activeAt(s.drought, day), wave = activeAt(s.heatWave, day);
    const blackout = on(s, "facilities") && activeAt(s.outage, day) && !s.ups;
    const halls = [], H = {};
    for (const h of s.halls) if (h.built) {
      const x = { n: h.n, it: 0, heat: 0, cool: 0, pue: envOn ? K.PUE[h.cooling] : K.PUE_BASE, cooling: h.cooling };
      halls.push(x); H[h.n] = x;
    }
    const perRack = {};
    let kw = 0;
    for (const r of s.racks) {
      const hh = H[r.hall];
      let k = 0;
      for (const d of r.devices) {
        if (d.failed) continue;
        const it = s.items[d.type];
        k += it.kw;
        if (it.cool && !isDead(s, it)) hh.cool += it.cool;
      }
      k *= MODES[r.mode].kw;
      perRack[r.id] = { kw: k };
      kw += k; hh.it += k;
      hh.heat += r.tank ? k * K.TANK_ROOM_HEAT : k;
    }
    for (const key of Object.keys(s.spines)) { const hh = H[+key.split("-")[0]]; hh.it += K.SPINE_KW; hh.heat += K.SPINE_KW; kw += K.SPINE_KW; }
    for (const hh of halls) {
      const h = hallOf(s, hh.n);
      let cap = (s.mech.heat ? se.heatCap - (wave ? K.HEATWAVE_COOL : 0) : 1e6) + hh.cool + (h.crac ? K.CRAC_KW : 0);
      if (drought && h.cooling === "evap") cap *= K.DROUGHT_COOL;
      hh.heatCap = cap;
      hh.tTarget = blackout ? 18 : 18 + 14 * hh.heat / cap;
      hh.roomT = opts.eq ? hh.tTarget : hallT(s, hh.n);
    }
    const supply = { web: 0, train: 0, infer: 0 }, failOut = { web: 0, train: 0, infer: 0 };
    for (const r of s.racks) {
      const pr = perRack[r.id], hh = H[r.hall], base = (r.hall - 1) * K.HALL_RACKS + r.row * K.COLS;
      let nb = 0;
      if (r.col > 0) { const o = s.racks[base + r.col - 1]; nb += perRack[o.id].kw * (o.tank ? K.TANK_ROOM_HEAT : 1); }
      if (r.col < K.COLS - 1) { const o = s.racks[base + r.col + 1]; nb += perRack[o.id].kw * (o.tank ? K.TANK_ROOM_HEAT : 1); }
      const own = pr.kw * (r.tank ? K.TANK_ROOM_HEAT : 1);
      pr.load = (own + 0.3 * nb) / K.RACK_KW;
      pr.inlet = hh.roomT + (s.mech.heat ? 5 * Math.max(0, pr.load - 0.6) : 0);
      pr.throttle = s.mech.heat ? throttleAt(pr.inlet) : 1;
      let netProv = 0, netNeed = 0, boost = 1, bricked = false, gpus = 0;
      for (const d of r.devices) {
        if (d.failed) continue;
        const it = itemOf(s, d);
        if (it.role === "net") netProv += it.net;
        if (it.role === "mem") { if (isDead(s, it)) bricked = true; else boost = Math.max(boost, it.boost); }
      }
      const raw = { web: 0, train: 0, infer: 0 }, rawF = { web: 0, train: 0, infer: 0 };
      for (const d of r.devices) {
        const it = itemOf(s, d), o = deviceOut(s, r, it, boost);
        if (!o) continue;
        if (d.failed) { rawF[o.w] += o.v; continue; }
        raw[o.w] += o.v;
        if (it.role === "gpu" && r.workload === "train" && !r.tank) gpus++;
        netNeed += it.role === "cpu" ? NET_NEED.cpu : it.role === "exotic" ? NET_NEED.exotic : NET_NEED[r.workload];
      }
      pr.netProv = netProv; pr.netNeed = netNeed; pr.trainGpus = gpus;
      pr.netF = !s.mech.network ? 1 : netNeed ? Math.min(1, netProv / netNeed) : 1;
      pr.penalty = bricked ? 0.6 : 1;
      pr.raw = raw; pr.rawFailed = rawF;
    }
    // row spines: pool network across the row, and big training clusters qualify for the frontier market
    let frontierElig = 0;
    const cluster = {};
    if (fabricOn) for (const key of Object.keys(s.spines)) {
      const [h, row] = key.split("-").map(Number), base = (h - 1) * K.HALL_RACKS + row * K.COLS;
      const rs = s.racks.slice(base, base + K.COLS).filter(r => !r.tank);
      const prov = rs.reduce((a, r) => a + perRack[r.id].netProv, 0), need = rs.reduce((a, r) => a + perRack[r.id].netNeed, 0);
      const gpus = rs.reduce((a, r) => a + perRack[r.id].trainGpus, 0);
      cluster[key] = { gpus, frontier: gpus >= K.FRONTIER_MIN_GPUS, racks: rs.map(r => r.id) };
      for (const r of rs) {
        const pr = perRack[r.id];
        if (s.mech.network) pr.netF = need ? Math.min(1, prov / need) : 1;
        pr.spine = key; pr.frontier = cluster[key].frontier;
      }
    }
    for (const r of s.racks) {
      const pr = perRack[r.id];
      const f = MODES[r.mode].out * pr.netF * pr.throttle * pr.penalty;
      pr.out = { web: pr.raw.web * f, train: pr.raw.train * f, infer: pr.raw.infer * f };
      for (const w in supply) { supply[w] += pr.out[w]; failOut[w] += pr.rawFailed[w] * f; }
      if (pr.frontier) frontierElig += pr.out.train;
    }
    // transit caps web + inference output
    let transitF = 1, transitLost = 0;
    if (fabricOn) {
      const need = supply.web + supply.infer, cap = (s.transit + K.TRANSIT_FREE) * K.TRANSIT_PER;
      if (need > cap) {
        transitF = cap / need;
        transitLost = (supply.web * mk.web.price + supply.infer * mk.infer.price) * (1 - transitF);
        supply.web *= transitF; supply.infer *= transitF;
        for (const r of s.racks) { const o = perRack[r.id].out; o.web *= transitF; o.infer *= transitF; }
      }
    }
    let sold = sellOutput(s, mk, supply, frontierElig, day), outageLoss = 0;
    if (blackout) {
      outageLoss = sold.gross;
      for (const r of s.racks) { const o = perRack[r.id].out; o.web = o.train = o.infer = 0; }
      sold = sellOutput(s, mk, { web: 0, train: 0, infer: 0 }, 0, day);
      supply.web = supply.train = supply.infer = 0;
    }
    const { revenue, wRev, gross, lostCap } = sold;
    for (const r of s.racks) {  // attribute revenue back to racks, for the detail panel
      const pr = perRack[r.id]; pr.rev = 0;
      for (const w in supply) if (supply[w] > 0) pr.rev += wRev[w] * pr.out[w] / supply[w];
    }
    // ---- costs
    let nDev = 0, lease = 0;
    for (const r of s.racks) {
      nDev += r.devices.length;
      for (const d of r.devices) if (d.leased) lease += d.leaseRate;
      for (const d of r.pending) if (d.leased) lease += d.leaseRate;
    }
    let facility = 0;
    for (const hh of halls) facility += hh.it * hh.pue;
    const unit = se.powerPrice / K.PUE_BASE;           // price per facility kW-day (PUE 1.3 baked in before ch13)
    const spotF = energyOn && now ? s.power.noise : 1;
    const spike = energyOn && wave ? 1 + (s.heatWave.mult - 1) * (s.solar ? 1 - K.BATTERY_SHAVE : 1) : 1;
    const spot = unit * spotF * spike;
    const solarKw = energyOn && s.solar ? K.SOLAR_KW * (0.5 + 0.5 * se.c) : 0;
    const ppaKw = energyOn && s.ppa && day < s.ppa.end ? s.ppa.kw : 0;
    let draw = Math.max(0, facility - solarKw - ppaKw), dieselKw = 0;
    const outage = on(s, "facilities") && activeAt(s.outage, day);
    if (outage) { if (s.ups) dieselKw = draw; draw = 0; }
    const ppaCost = ppaKw ? ppaKw * s.ppa.price : 0;
    const powerCost = draw * spot + ppaCost;
    const diesel = dieselKw * K.DIESEL;
    const salaries = opsOn ? s.techs * K.SALARY : 0;
    const upkeep = (opsOn ? K.UPKEEP_OPS : K.UPKEEP) + K.UPKEEP_PER_DEV * nDev;
    const transit = fabricOn ? s.transit * K.TRANSIT_COST : 0;
    const interest = (s.debt + (on(s, "finance") ? Math.max(0, -s.cash) : 0)) * K.INTEREST / K.YEAR;   // overdraft pays the same rate
    let waterRate = 0;
    if (envOn && !blackout) for (const hh of halls) if (hh.cooling === "evap") waterRate += hh.it * K.WATER_PER_KW * (1 + 0.5 * Math.max(0, se.c));
    const water = waterRate * K.WATER_PRICE;
    const gridCo2 = K.GRID_CO2 * Math.pow(K.GRID_CO2_FALL, day / K.YEAR);
    const carbon = draw * 24 / 1000 * gridCo2 + dieselKw * 24 / 1000 * K.DIESEL_CO2;
    const carbonTax = s.policyFx.carbonTax * carbon;
    let fines = 0;
    const m = s.policyFx.mandate;
    if (m && day >= m.deadline) for (const hh of halls) if (hh.pue > K.MANDATE_PUE + 1e-9) fines += K.MANDATE_FINE;
    const penalties = sold.penalties;
    const costs = { power: powerCost, upkeep, salaries, transit, interest, lease, water, carbonTax, fines, diesel, penalties };
    let opex = 0;
    for (const k in costs) opex += costs[k];
    // measurable losses (for the end screen)
    const throttleLoss = s.racks.reduce((a, r) => { const pr = perRack[r.id]; return a + (pr.throttle < 1 ? pr.rev * (1 / pr.throttle - 1) : 0); }, 0);
    const failLoss = blackout ? 0 : failOut.web * mk.web.price + failOut.train * mk.train.price + failOut.infer * mk.infer.price;
    const brickLoss = s.racks.reduce((a, r) => { const pr = perRack[r.id]; return a + (pr.penalty < 1 ? pr.rev * (1 / pr.penalty - 1) : 0); }, 0);
    const green = facility > 0 ? Math.min(1, (solarKw + ppaKw) / facility) : 0;
    return { day, se, mk, kw, halls, heatCap: halls[0].heatCap, tTarget: halls[0].tTarget, roomT: halls[0].roomT, roomHeat: halls[0].heat,
      perRack, supply, frontierElig, cluster, transitF, revenue, gross, lostCap, cDel: sold.cDel, cMiss: sold.cMiss,
      powerCost, upkeep, costs, opex, throttleLoss, failLoss, brickLoss, outageLoss, transitLost,
      facility, spot, solarKw, ppaKw, draw, dieselKw, waterRate, carbon, green, blackout, drought, heatWave: wave,
      net: gross - opex };
  }
  const throttleAt = t => t > K.T_LIMIT ? Math.max(0.5, 1 - (t - K.T_LIMIT) * 0.1) : 1;

  function resale(s, d) {
    if (d.leased) return 0;
    const it = itemOf(s, d);
    if (isDead(s, it)) return 0;
    const base = BASE_ITEMS[d.type].price;
    let genBehind = 0, f = 1;
    if (it.role === "gpu") { genBehind = currentGen(s) - it.gen; f = hbmF(s) * s.market.gpuCut; }
    const age = Math.max(0, s.day - d.born);
    return base * 0.55 * f * Math.pow(0.6, Math.max(0, genBehind)) * Math.max(0.3, 1 - age / 1200) * (d.failed ? K.FAILED_RESALE : 1);
  }
  function netWorth(s) {
    let v = s.cash - s.debt;
    for (const d of allOwnedDevices(s)) v += resale(s, d);
    for (const j of s.jobs) if (j.kind === "sell") v += j.value;
    return v;
  }
  function creditLimitOf(s) { return Math.max(-K.BANKRUPT, K.LOAN_LTV * netWorth(s)); }
  /* company value = (net worth + earnings multiple) x reputation factor */
  function companyValue(s) {
    const p = s.profitDays.length ? s.profitDays.reduce((a, x) => a + x, 0) / s.profitDays.length : 0;
    return (netWorth(s) + Math.max(0, p) * K.EARN_DAYS * K.EARN_MULT) * repFactor(s);
  }
  function score(s) {
    if (s.over === "fired" && s.firedScore != null) return s.firedScore;
    return s.equity.own * companyValue(s);
  }

  /* ================= bookkeeping ================= */
  function addLoss(s, key, amt) {
    if (!(amt > 0)) return;
    s.losses[key] += amt;
    const p = periodOf(s.day);
    s.lossBy[key][p] = (s.lossBy[key][p] || 0) + amt;
  }
  /* cash out: capex is depreciated over 3 years (tax), opex hits profit now */
  function spend(s, amt, kind, ledgerKey) {
    s.cash -= amt;
    if (kind === "capex") {
      s.totals.capex += amt;
      s.deprec.push({ rate: amt / K.DEPR_DAYS, until: s.day + K.DEPR_DAYS });
    } else {
      s.totals.opex += amt; s.fin.opex += amt; s.dayAcc.profit -= amt;
      s.ledger[ledgerKey || "other"] += amt;
    }
  }
  const depRate = s => s.deprec.reduce((a, x) => a + (x.until > s.day ? x.rate : 0), 0);
  function repHit(s, amt) { s.rep = clamp(s.rep - amt, 0, 100); }
  function press(s, kind, hit) {
    const p = C.PRESS[kind];
    repHit(s, hit != null ? hit : K.PRESS_HIT);
    s.scandalUntil = s.day + K.SCANDAL_DAYS;
    pushNews(s, { title: p.title, body: p.body, tone: "bad", cat: "press", icon: "news" });
    log(s, `press: ${kind}, rep ${repOf(s).toFixed(1)}`);
  }

  /* ================= actions ================= */
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
  const shipDays = (s, it) => on(s, "memory") && s.hbm.shortage && it.role === "gpu" ? K.SHORT_SHIP_DAYS : K.SHIP_DAYS;
  const exportBlocked = (s, it) => s.policyFx.exportCtl && it.role === "gpu" && it.gen === currentGen(s) && s.exportUsed >= K.EXPORT_QUOTA;
  const repairCost = (s, d) => Math.round(BASE_ITEMS[d.type].price * K.REPAIR_FRAC * 10) / 10;
  const hasJob = (s, uid) => s.jobs.some(j => j.uid === uid || (j.dev && j.dev.uid === uid));

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
  const RACK_ACTIONS = new Set(["buy", "move", "sell", "mode", "workload", "tank", "store", "unstore", "lease", "returnLease"]);
  const GATE = { hire: "ops", fire: "ops", repairPolicy: "ops", repair: "ops", store: "ops", unstore: "ops",
    spine: "fabric", transit: "fabric", signContract: "contracts", declineContract: "contracts", forward: "memory",
    borrow: "finance", repay: "finance", lease: "finance", returnLease: "finance", buildHall: "facilities", ups: "facilities", crac: "facilities",
    ppa: "energy", solar: "energy", cooling: "environment", acceptRound: "investors", declineRound: "investors", buyback: "investors",
    pr: "reputation", lobby: "policy" };
  const no = msg => ({ ok: false, msg });
  const gridNext = s => s.gridTier === 0 ? { kw: K.GRID_KW_UP, cost: K.GRID_COST, days: K.GRID_DAYS }
    : s.gridTier === 1 && on(s, "facilities") ? { kw: K.GRID_KW_UP2, cost: K.GRID_COST2, days: K.GRID_DAYS2 }
    : s.gridTier === 2 && on(s, "facilities") ? { kw: K.GRID_KW_UP3, cost: K.GRID_COST3, days: K.GRID_DAYS3 } : null;
  function ppaQuote(s) {  // tracks the recent spot average (season + noise), a little below it
    const H = s.history.slice(-12);
    const avg = H.length ? H.reduce((a, h) => a + (h.sp || seasonAt(h.d).powerPrice / K.PUE_BASE), 0) / H.length : seasonAt(s.day).powerPrice / K.PUE_BASE;
    return +(avg * K.PPA_DISCOUNT).toFixed(4);
  }
  function roundCost(s) { return Math.max(1, K.BUYBACK_STEP * companyValue(s)); }

  function check(s, a) {
    if (s.over) return no("Game over");
    if (!a || !a.type) return no("Unknown action");
    if (GATE[a.type] && !on(s, GATE[a.type])) return no(`Unlocks in chapter ${CH_IDX[GATE[a.type]] + 1}`);
    const r = a.rack != null ? rackById(s, a.rack) : null;
    if (RACK_ACTIONS.has(a.type) && !r) return no("No such rack");
    switch (a.type) {
      case "buy": case "lease": {
        const it = s.items[a.item];
        if (!it || !isAvail(s, it)) return no("Not on sale");
        if (a.type === "lease" && it.role !== "gpu") return no("Only GPUs can be leased");
        if (exportBlocked(s, it)) return no(`Export quota used (${K.EXPORT_QUOTA}/quarter)`);
        if (a.type === "buy" && s.cash < it.price) return no(`Needs $${it.price}k`);
        const f = fits(s, r, it); if (f) return no(f);
        const days = shipDays(s, it) + K.INSTALL_DAYS;
        return { ok: true, msg: a.type === "buy" ? `$${it.price}k, online in ${days} days` : `Lease $${round2(it.price * K.LEASE_RATE)}k/day, online in ${days} days` };
      }
      case "move": {
        const i = findDev(r, a.uid); if (i < 0) return no("Not in that rack");
        if (a.to === a.rack) return no("Already here");
        const to = rackById(s, a.to); if (!to) return no("No such rack");
        if (hasJob(s, a.uid)) return no("A job is pending on it");
        const f = fits(s, to, itemOf(s, r.devices[i])); if (f) return no(f);
        return { ok: true, msg: `Move, ${K.MOVE_DAYS} day` };
      }
      case "sell": {
        const i = findDev(r, a.uid); if (i < 0) return no("Not in that rack");
        if (r.devices[i].leased) return no("Leased: return it instead");
        if (hasJob(s, a.uid)) return no("A job is pending on it");
        return { ok: true, msg: `Sell for $${Math.round(resale(s, r.devices[i]))}k` };
      }
      case "mode": {
        if (!MODES[a.mode]) return no("Bad mode");
        const k = devKw(s, { mode: a.mode }, r.devices.concat(r.pending));
        if (k > K.RACK_KW + 1e-9) return no(`Rack would draw ${k.toFixed(1)} kW (limit ${K.RACK_KW})`);
        if (gridKwAll(s) - rackKwAll(s, r) + k > s.gridKw + 1e-9) return no(`Grid limit ${s.gridKw} kW`);
        return { ok: true, msg: MODES[a.mode].label };
      }
      case "workload": return WORKLOADS.includes(a.workload) ? { ok: true, msg: a.workload } : no("Bad workload");
      case "tank": {
        if (r.tank) return no("Already a tank");
        if (r.devices.length || r.pending.length) return no("Empty the rack first");
        if (s.jobs.some(j => j.kind === "tank" && j.rack === r.id)) return no("Already converting");
        if (s.cash < K.TANK_COST) return no(`Needs $${K.TANK_COST}k`);
        return { ok: true, msg: `Convert to immersion tank, $${K.TANK_COST}k, ${K.TANK_DAYS} days` };
      }
      case "grid": {
        const g = gridNext(s);
        if (!g) return no(s.gridTier >= 3 ? "Grid fully upgraded" : "Next upgrade unlocks in chapter 11");
        if (s.jobs.some(j => j.kind === "grid")) return no("Upgrade under way");
        if (s.cash < g.cost) return no(`Needs $${g.cost}k`);
        return { ok: true, msg: `Grid to ${g.kw} kW, $${g.cost}k, ${g.days} days` };
      }
      // ---- ch6 operations
      case "hire":
        if (s.techs + s.hires.length >= K.TECH_MAX) return no(`At most ${K.TECH_MAX} technicians`);
        return { ok: true, msg: `Hire: arrives in ${K.HIRE_DAYS} days, $${K.SALARY}k/day` };
      case "fire":
        if (s.techs <= K.TECH_MIN) return no("Keep at least one technician");
        return { ok: true, msg: `Fire: severance $${round2(K.FIRE_PAY_DAYS * K.SALARY)}k` };
      case "repairPolicy": return { ok: true, msg: a.on ? "Auto-repair on" : "Auto-repair off" };
      case "repair": {
        const f = findAnywhere(s, a.uid);
        if (!f || f.where === "pending") return no("No such part");
        if (!f.d.failed) return no("Not broken");
        if (hasJob(s, a.uid)) return no("Already queued");
        if (f.r && a.useSpare !== false && spareFor(s, f.d)) return { ok: true, msg: `Swap in a spare, ${K.SWAP_DAYS} day` };
        const c = repairCost(s, f.d);
        if (s.cash < c) return no(`Needs $${c}k`);
        return { ok: true, msg: `Repair $${c}k: parts ${repairParts(s, f.d)} days + ${K.REPAIR_DAYS} day` };
      }
      case "store": {
        const i = findDev(r, a.uid); if (i < 0) return no("Not in that rack");
        if (r.devices[i].leased) return no("Leased cards can't be shelved");
        if (hasJob(s, a.uid)) return no("A job is pending on it");
        if (shelfLoad(s) >= K.SHELF) return no(`Shelf full (${K.SHELF})`);
        return { ok: true, msg: `To the shelf, ${K.MOVE_DAYS} day` };
      }
      case "unstore": {
        const d = s.shelf.find(x => x.uid === a.uid); if (!d) return no("Not on the shelf");
        if (d.failed) return no("Repair it first");
        const f = fits(s, r, itemOf(s, d)); if (f) return no(f);
        return { ok: true, msg: `Install from shelf, ${K.INSTALL_DAYS} days` };
      }
      // ---- ch7 fabric
      case "spine": {
        const h = hallOf(s, a.hall);
        if (!h || !h.built) return no("No such hall");
        if (!(a.row >= 0 && a.row < K.ROWS)) return no("No such row");
        const key = `${a.hall}-${a.row}`;
        if (s.spines[key] || s.jobs.some(j => j.kind === "spine" && j.key === key)) return no("Row already has a spine");
        if (s.cash < K.SPINE_COST) return no(`Needs $${K.SPINE_COST}k`);
        if (gridKwAll(s) + K.SPINE_KW > s.gridKw + 1e-9) return no(`Grid limit ${s.gridKw} kW`);
        return { ok: true, msg: `Row spine $${K.SPINE_COST}k, ${K.SPINE_DAYS} days, ${K.SPINE_KW} kW` };
      }
      case "transit": {
        const dlt = Math.round(a.delta || 0);
        if (!dlt) return no("No change");
        const tgt = transitTarget(s) + dlt;
        if (tgt < 0) return no("Transit can't go below zero");
        if (tgt > K.TRANSIT_MAX) return no(`At most ${K.TRANSIT_MAX} units`);
        return { ok: true, msg: `Transit ${tgt} units ($${round2(tgt * K.TRANSIT_COST)}k/day) in ${K.TRANSIT_DAYS} days` };
      }
      // ---- ch8 contracts
      case "signContract": {
        const o = s.offers.find(x => x.id === a.id); if (!o) return no("Offer gone");
        if (o.foreign && s.policyFx.exportCtl) return no("Customer barred by export controls");
        if (o.bts && s.cash < o.fitout) return no(`Fit-out needs $${o.fitout}k`);
        return { ok: true, msg: o.bts ? `Build-to-suit: $${o.fitout}k fit-out now, ${o.units} ${o.w} units from day ${Math.round(s.day + o.lead)} for ${o.days} days at $${round2(o.price)}k`
          : `Sign: ${o.units} ${o.w} units for ${o.days} days at $${round2(o.price)}k` };
      }
      case "declineContract": return s.offers.some(x => x.id === a.id) ? { ok: true, msg: "Decline" } : no("Offer gone");
      // ---- ch9 memory
      case "forward": {
        const it = s.items[a.item];
        if (!it || !isAvail(s, it) || it.role !== "gpu") return no("Only GPUs on sale can be ordered forward");
        if (exportBlocked(s, it)) return no(`Export quota used (${K.EXPORT_QUOTA}/quarter)`);
        if (s.cash < it.price) return no(`Needs $${it.price}k`);
        if (shelfLoad(s) >= K.SHELF) return no(`Shelf full (${K.SHELF})`);
        return { ok: true, msg: `$${it.price}k now, to the shelf in ${K.FORWARD_DAYS} days` };
      }
      // ---- ch10 finance
      case "borrow": {
        const amt = a.amount || K.LOAN_STEP;
        if (amt <= 0 || amt % K.LOAN_STEP) return no(`Borrow in $${K.LOAN_STEP}k steps`);
        const lim = Math.max(0, K.LOAN_LTV * netWorth(s));
        if (s.debt + amt > lim + 1e-9) return no(`Credit line $${Math.round(lim)}k (40 % of net worth)`);
        return { ok: true, msg: `Borrow $${amt}k at ${K.INTEREST * 100} %/yr` };
      }
      case "repay": {
        const amt = a.amount || K.LOAN_STEP;
        if (s.debt <= 0) return no("No debt");
        if (amt <= 0) return no("Bad amount");
        if (s.cash < Math.min(amt, s.debt)) return no("Not enough cash");
        return { ok: true, msg: `Repay $${Math.min(amt, s.debt)}k` };
      }
      case "returnLease": {
        const i = findDev(r, a.uid); if (i < 0) return no("Not in that rack");
        if (!r.devices[i].leased) return no("Not leased");
        if (hasJob(s, a.uid)) return no("A job is pending on it");
        return { ok: true, msg: `Return, ${K.SELL_DAYS} day` };
      }
      // ---- ch11 facilities
      case "buildHall": {
        if (s.jobs.some(j => j.kind === "buildHall")) return no("A hall is already under construction");
        const n = a.hall != null ? a.hall : nextHall(s);
        if (n == null) return no("All halls built");
        const h = hallOf(s, n);
        if (!h || n < 2) return no("No such hall");
        if (h.built) return no(`Hall ${n} already built`);
        if (!hallOf(s, n - 1).built) return no(`Build Hall ${n - 1} first`);
        const hc = hallCost(n);
        if (s.cash < hc.cost) return no(`Needs $${hc.cost}k`);
        return { ok: true, msg: `Hall ${n}: $${hc.cost}k, ${hc.days} days` };
      }
      case "ups":
        if (s.ups || s.jobs.some(j => j.kind === "ups")) return no("Already have backup");
        if (s.cash < K.UPS_COST) return no(`Needs $${K.UPS_COST}k`);
        return { ok: true, msg: `UPS + generator: $${K.UPS_COST}k, ${K.UPS_DAYS} days` };
      case "crac": {
        const h = hallOf(s, a.hall);
        if (!h || !h.built) return no("No such hall");
        if (h.crac || s.jobs.some(j => j.kind === "crac" && j.hall === a.hall)) return no("Already upgraded");
        if (s.cash < K.CRAC_COST) return no(`Needs $${K.CRAC_COST}k`);
        return { ok: true, msg: `CRAC +${K.CRAC_KW} kW: $${K.CRAC_COST}k, ${K.CRAC_DAYS} days` };
      }
      // ---- ch12 energy
      case "ppa": {
        if (s.ppa && s.day < s.ppa.end) return no("A PPA is running");
        if (!(a.kw > 0) || a.kw % K.PPA_STEP || a.kw > K.PPA_MAX) return no(`PPA in ${K.PPA_STEP} kW steps up to ${K.PPA_MAX}`);
        const q = ppaQuote(s);
        return { ok: true, msg: `PPA ${a.kw} kW at $${q}k/kW-day for ${K.PPA_DAYS} days ($${round2(a.kw * q)}k/day)` };
      }
      case "solar":
        if (s.solar || s.jobs.some(j => j.kind === "solar")) return no("Already have solar");
        if (s.cash < K.SOLAR_COST) return no(`Needs $${K.SOLAR_COST}k`);
        return { ok: true, msg: `Solar + battery: $${K.SOLAR_COST}k, ${K.SOLAR_DAYS} days` };
      // ---- ch13 environment
      case "cooling": {
        const h = hallOf(s, a.hall);
        if (!h || !h.built) return no("No such hall");
        if (!K.PUE[a.mode]) return no("Bad mode");
        if (h.cooling === a.mode) return no("Already");
        if (s.jobs.some(j => j.kind === "cooling" && j.hall === a.hall)) return no("Changeover under way");
        if (s.cash < K.COOL_SWITCH_COST) return no(`Needs $${K.COOL_SWITCH_COST}k`);
        return { ok: true, msg: `Switch to ${a.mode}: $${K.COOL_SWITCH_COST}k, ${K.COOL_SWITCH_DAYS} days` };
      }
      // ---- ch14 investors
      case "acceptRound": case "declineRound": {
        const o = s.roundOffer;
        if (!o || o.id !== a.id) return no("Offer gone");
        return { ok: true, msg: a.type === "acceptRound" ? `Take $${Math.round(o.amount)}k for ${Math.round(o.pct * 100)} %` : "Decline" };
      }
      case "buyback": {
        if (s.equity.own >= 1 - 1e-9) return no("You own everything");
        const c = roundCost(s);
        if (s.cash < c) return no(`Needs $${Math.round(c)}k`);
        return { ok: true, msg: `Buy back 1 % for $${Math.round(c)}k` };
      }
      // ---- ch15 reputation
      case "pr":
        if (s.cash < K.PR_COST) return no(`Needs $${K.PR_COST}k`);
        return { ok: true, msg: `PR campaign: $${K.PR_COST}k, +${K.PR_GAIN} reputation fading over ${K.PR_DECAY} days` };
      // ---- ch16 policy
      case "lobby": {
        const p = policyById(s, a.policy);
        if (!p || !p.announced) return no("No such proposal");
        if (p.status !== "proposed") return no("Already voted");
        if (p.lobbied) return no("Already lobbied");
        if (a.dir !== 1 && a.dir !== -1) return no("Pick a direction");
        if (s.cash < K.LOBBY_COST) return no(`Needs $${K.LOBBY_COST}k`);
        return { ok: true, msg: `Lobby ${a.dir > 0 ? "for" : "against"}: $${K.LOBBY_COST}k` };
      }
    }
    return no("Unknown action");
  }
  const transitTarget = s => s.transit + s.transitOrders.reduce((a, o) => a + o.delta, 0);
  function spareFor(s, d) { return s.shelf.find(x => x.type === d.type && !x.failed && !x.leased) || null; }
  const repairParts = (s, d) => K.REPAIR_PARTS_DAYS * (shipDays(s, itemOf(s, d)) > K.SHIP_DAYS ? 3 : 1);

  function apply(s, a) {
    const res = check(s, a);
    if (!res.ok) { log(s, `reject ${a && a.type}: ${res.msg}`); return res; }
    const r = a.rack != null ? rackById(s, a.rack) : null;
    const job = { id: s.nextId++, kind: a.type, rack: a.rack != null ? a.rack : null };
    switch (a.type) {
      case "buy": case "lease": {
        const it = s.items[a.item], d = dev(s, a.item), days = shipDays(s, it);
        if (a.type === "buy") spend(s, it.price, "capex");
        else { d.leased = true; d.leaseRate = +(it.price * K.LEASE_RATE).toFixed(4); }
        if (s.policyFx.exportCtl && it.role === "gpu" && it.gen === currentGen(s)) s.exportUsed++;
        if (days > K.SHIP_DAYS) {   // measurable shortage cost: extra days x what the card would earn
          const mk = marketAt(s, s.day), w = it.role === "gpu" ? r.workload : it.only || "web";
          const v = it.role === "gpu" ? Math.min(it.F, it.B * INTENSITY[w]) : 1;
          addLoss(s, "shortage", (days - K.SHIP_DAYS) * v * (mk[w] ? mk[w].price : 0));
        }
        r.pending.push(d);
        Object.assign(job, { dev: d, to: a.rack, phase: "ship", left: days, total: days, work: K.INSTALL_DAYS });
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
        spend(s, K.TANK_COST, "capex");
        Object.assign(job, { phase: "wait", left: K.TANK_DAYS, total: K.TANK_DAYS });
        s.jobs.push(job); break;
      case "grid": {
        const g = gridNext(s);
        spend(s, g.cost, "capex");
        Object.assign(job, { phase: "contract", left: g.days, total: g.days, kw: g.kw });
        s.jobs.push(job); break;
      }
      case "hire": s.hires.push(s.day + K.HIRE_DAYS); break;
      case "fire": {
        s.techs--;
        spend(s, K.FIRE_PAY_DAYS * K.SALARY, "opex", "salaries");
        let over = busyTechs(s) - s.techs;
        for (let i = s.jobs.length - 1; i >= 0 && over > 0; i--) { const j = s.jobs[i]; if (j.phase === "work") { j.phase = "wait"; j.tech = false; over--; } }
        break;
      }
      case "repairPolicy": s.repairAuto = !!a.on; if (s.repairAuto) autoRepairSweep(s); break;
      case "repair": queueRepair(s, a.uid, a.useSpare !== false); break;
      case "store": {
        const [d] = r.devices.splice(findDev(r, a.uid), 1);
        Object.assign(job, { dev: d, phase: "wait", left: K.MOVE_DAYS, total: K.MOVE_DAYS, toShelf: true });
        s.jobs.push(job); break;
      }
      case "unstore": {
        const i = s.shelf.findIndex(x => x.uid === a.uid), [d] = s.shelf.splice(i, 1);
        r.pending.push(d);
        Object.assign(job, { dev: d, to: a.rack, phase: "wait", left: K.INSTALL_DAYS, total: K.INSTALL_DAYS });
        s.jobs.push(job); break;
      }
      case "spine":
        spend(s, K.SPINE_COST, "capex");
        Object.assign(job, { key: `${a.hall}-${a.row}`, phase: "contract", left: K.SPINE_DAYS, total: K.SPINE_DAYS });
        s.jobs.push(job); break;
      case "transit": s.transitOrders.push({ day: s.day + K.TRANSIT_DAYS, delta: Math.round(a.delta) }); break;
      case "signContract": {
        const i = s.offers.findIndex(x => x.id === a.id), [o] = s.offers.splice(i, 1);
        const start = o.bts ? s.day + o.lead : s.day;
        if (o.bts) spend(s, o.fitout, "capex");
        s.contracts.push(Object.assign(o, { signed: s.day, start, end: start + o.days, delivered: 0, missed: 0, penaltyPaid: 0, missDays: 0, streak: 0 }));
        s.contractLog.signed++;
        break;
      }
      case "declineContract": s.offers = s.offers.filter(x => x.id !== a.id); break;
      case "forward": {
        const it = s.items[a.item], d = dev(s, a.item);
        spend(s, it.price, "capex");
        if (s.policyFx.exportCtl && it.gen === currentGen(s)) s.exportUsed++;
        Object.assign(job, { dev: d, phase: "contract", left: K.FORWARD_DAYS, total: K.FORWARD_DAYS, toShelf: true });
        s.jobs.push(job); break;
      }
      case "borrow": { const amt = a.amount || K.LOAN_STEP; s.debt += amt; s.cash += amt; break; }
      case "repay": { const amt = Math.min(a.amount || K.LOAN_STEP, s.debt); s.debt -= amt; s.cash -= amt; break; }
      case "returnLease": {
        const [d] = r.devices.splice(findDev(r, a.uid), 1);
        Object.assign(job, { dev: d, phase: "wait", left: K.SELL_DAYS, total: K.SELL_DAYS });
        s.jobs.push(job); break;
      }
      case "buildHall": {
        const n = a.hall != null ? a.hall : nextHall(s), hc = hallCost(n);
        spend(s, hc.cost, "capex");
        Object.assign(job, { hall: n, phase: "contract", left: hc.days, total: hc.days });
        s.jobs.push(job); break;
      }
      case "ups": case "solar": {
        const cost = a.type === "ups" ? K.UPS_COST : K.SOLAR_COST, days = a.type === "ups" ? K.UPS_DAYS : K.SOLAR_DAYS;
        spend(s, cost, "capex");
        Object.assign(job, { phase: "contract", left: days, total: days });
        s.jobs.push(job); break;
      }
      case "crac":
        spend(s, K.CRAC_COST, "capex");
        Object.assign(job, { hall: a.hall, phase: "contract", left: K.CRAC_DAYS, total: K.CRAC_DAYS });
        s.jobs.push(job); break;
      case "ppa": s.ppa = { kw: a.kw, price: ppaQuote(s), start: s.day, end: s.day + K.PPA_DAYS }; break;
      case "cooling":
        spend(s, K.COOL_SWITCH_COST, "opex", "other");
        Object.assign(job, { hall: a.hall, mode: a.mode, phase: "contract", left: K.COOL_SWITCH_DAYS, total: K.COOL_SWITCH_DAYS });
        s.jobs.push(job); break;
      case "acceptRound": {
        const o = s.roundOffer;
        s.cash += o.amount; s.equity.raised += o.amount; s.equity.rounds++;
        s.equity.own *= (1 - o.pct);
        s.roundOffer = null;
        if (!s.board) {
          const base = trailingRevenue(s, K.BOARD_EVERY);
          s.board = { start: s.day, end: s.day + K.BOARD_EVERY, target: base * (1 + K.BOARD_GROWTH), rev: 0, misses: 0, history: [] };
          pushNews(s, { title: "The board sets a revenue target", body: `$${Math.round(s.board.target)}k over the next ${K.BOARD_EVERY} days.`, tone: "info", cat: "investors", icon: "flag" });
        }
        break;
      }
      case "declineRound": s.roundOffer = null; break;
      case "buyback": {
        const c = roundCost(s);
        s.cash -= c; s.equity.own = Math.min(1, s.equity.own + K.BUYBACK_STEP);
        break;
      }
      case "pr": {
        spend(s, K.PR_COST, "opex", "other");
        if (s.day < s.scandalUntil && nextRand(s) < 0.5) {
          repHit(s, K.PR_BACKFIRE);
          pushNews(s, { title: "PR campaign backfires", body: "Reporters call it spin in the middle of a scandal.", tone: "bad", cat: "press", icon: "news" });
          log(s, "pr backfired");
        } else s.prBoosts.push({ amt: K.PR_GAIN, day: s.day });
        break;
      }
      case "lobby": {
        const p = policyById(s, a.policy);
        spend(s, K.LOBBY_COST, "opex", "other");
        p.lobbied = a.dir; p.shift += a.dir * K.LOBBY_SHIFT;
        if (nextRand(s) < K.LOBBY_LEAK) s.leaks.push({ day: Math.round(s.day + 10 + nextRand(s) * 20), pid: p.id });
        break;
      }
    }
    log(s, `${a.type} ${JSON.stringify(a)}`);
    return res;
  }

  /* repair or swap one failed part (uid) */
  function queueRepair(s, uid, useSpare) {
    const f = findAnywhere(s, uid);
    if (!f || !f.d.failed || f.where === "pending" || hasJob(s, uid)) return false;
    const spare = f.r && useSpare ? spareFor(s, f.d) : null;
    if (spare) {
      s.shelf.splice(s.shelf.indexOf(spare), 1);
      s.jobs.push({ id: s.nextId++, kind: "swap", rack: f.r.id, uid, dev: spare, phase: "wait", left: K.SWAP_DAYS, total: K.SWAP_DAYS, toShelf: true });
      log(s, `swap spare ${spare.uid} for failed ${uid} in ${f.r.id}`);
      return true;
    }
    const c = repairCost(s, f.d);
    if (s.cash < c) return false;
    spend(s, c, "opex", "repairs");
    const parts = repairParts(s, f.d);
    s.jobs.push({ id: s.nextId++, kind: "repair", rack: f.r ? f.r.id : null, uid, phase: "parts", left: parts, total: parts, work: K.REPAIR_DAYS });
    log(s, `repair ${f.d.type} ${uid} $${c}k`);
    return true;
  }
  function autoRepairSweep(s) {
    for (const r of s.racks) for (const d of r.devices) if (d.failed && !hasJob(s, d.uid)) queueRepair(s, d.uid, true);
    for (const d of s.shelf.slice()) if (d.failed && !hasJob(s, d.uid)) queueRepair(s, d.uid, false);
  }

  function finishJob(s, j) {
    const k = j.kind;
    if (k === "buy" || k === "lease" || k === "move" || k === "unstore") {
      const r = rackById(s, j.to), i = r.pending.findIndex(d => d.uid === j.dev.uid);
      if (i >= 0) r.pending.splice(i, 1);
      if (k === "buy" || k === "lease") j.dev.inst = s.day;
      if (j.dev.inst == null) j.dev.inst = s.day;
      r.devices.push(j.dev);
    } else if (k === "sell") { s.cash += j.value; s.totals.resale += j.value; }
    else if (k === "tank") rackById(s, j.rack).tank = true;
    else if (k === "grid") {
      s.gridTier++; s.gridUp = true; s.gridKw = j.kw || K.GRID_KW_UP;
      pushNews(s, { title: "Grid upgrade live", body: `${s.gridKw} kW available.`, tone: "good", icon: "bolt", cat: "facilities" });
    }
    else if (k === "store" || k === "forward") s.shelf.push(j.dev);
    else if (k === "swap") {
      const f = findAnywhere(s, j.uid);
      if (f && f.where === "devices") {
        f.r.devices.splice(f.r.devices.indexOf(f.d), 1);
        if (j.dev.inst == null) j.dev.inst = s.day;
        f.r.devices.push(j.dev); s.shelf.push(f.d);
      } else s.shelf.push(j.dev);    // failed part left meanwhile: spare goes back
    }
    else if (k === "repair") { const f = findAnywhere(s, j.uid); if (f) f.d.failed = false; }
    else if (k === "spine") s.spines[j.key] = true;
    else if (k === "buildHall") {
      const n = j.hall || 2;
      ensureHalls(s);
      s.halls[n - 1].built = true; s.halls[n - 1].roomT = s.roomT; addHallRacks(s, n);
      pushNews(s, { title: `Hall ${n} is open`, body: "18 more racks. Same grid.", tone: "good", cat: "facilities" });
    }
    else if (k === "ups") s.ups = true;
    else if (k === "solar") s.solar = true;
    else if (k === "crac") hallOf(s, j.hall).crac = true;
    else if (k === "cooling") hallOf(s, j.hall).cooling = j.mode;
    log(s, `done ${k} ${j.dev ? j.dev.type : j.rack || j.key || j.hall || ""}`);
  }

  /* ================= ops: failures ================= */
  function hazard(s, d, it, inlet) {
    const age = s.day - (d.inst != null ? d.inst : d.born);
    const ageF = age < K.INFANT_DAYS ? K.INFANT_MULT : age > K.WEAROUT_DAYS ? 1 + (age - K.WEAROUT_DAYS) / K.WEAROUT_SCALE : 1;
    const heatF = s.mech.heat && inlet > K.FAIL_T0 ? Math.pow(2, (inlet - K.FAIL_T0) / K.FAIL_T_DOUBLE) : 1;
    return (K.FAIL_BASE[it.role] || 0) * ageF * heatF;
  }
  function rollFailures(s, st) {
    for (const r of s.racks) {
      const inlet = st.perRack[r.id].inlet;
      for (const d of r.devices) {
        if (d.failed) continue;
        const it = itemOf(s, d);
        if (isDead(s, it)) continue;
        if (nextRand(s, "rngF") < hazard(s, d, it, inlet) * K.DT) {
          d.failed = true; d.failDay = s.day;
          log(s, `failure ${it.name} uid=${d.uid} in ${r.id} inlet=${inlet.toFixed(1)}`);
          if (it.role === "gpu" || it.role === "exotic" || it.role === "net")
            pushNews(s, { title: `${it.name} failed in ${r.id}`, body: s.repairAuto ? "Repair queued." : "Auto-repair is off.", tone: "bad", cat: "ops", icon: "wrench" });
          if (s.repairAuto) queueRepair(s, d.uid, true);
        }
      }
    }
  }

  /* ================= daily systems ================= */
  function trailingRevenue(s, n) {
    const a = s.revDays.slice(-n);
    if (!a.length) return 0;
    return a.reduce((x, y) => x + y, 0) * n / a.length;
  }
  function makeOffer(s) {
    const st = stats(s), mk = st.mk, rf = repF(s), R = () => nextRand(s);
    const roll = R(), w = roll < 0.2 ? "web" : roll < 0.6 ? "train" : "infer";
    const ref = Math.max(st.supply[w], 0.3 * mk[w].demand);
    const units = Math.max(3, Math.round(ref * (0.15 + 0.25 * R())));
    const days = [90, 120, 180, 270][Math.floor(R() * 4)];
    const price = mk[w].price * (1 + (R() * 2 - 1) * K.QUOTE_SPREAD) * (1 + 0.2 * rf);
    const sla = [0.85, 0.9, 0.95][Math.floor(R() * 3)];
    let cust = C.CUSTOMERS[Math.floor(R() * C.CUSTOMERS.length)];
    if (s.policyFx.exportCtl && cust.foreign) cust = C.CUSTOMERS[0];
    const o = { id: "c" + s.nextId++, cust: cust.name, icon: cust.icon, foreign: cust.foreign, w, units, days,
      price: +price.toFixed(4), spot: +mk[w].price.toFixed(4), repAdj: +(1 + 0.2 * rf).toFixed(4), sla, penalty: +(price * K.PENALTY_MULT).toFixed(4), expires: s.day + K.OFFER_EXPIRY };
    s.offers.push(o);
    pushNews(s, { title: `Contract offer: ${cust.name}`, body: `${units} ${w} units x ${days} days at $${round2(price)}k (SLA ${Math.round(sla * 100)} %).`, tone: "info", cat: "contracts", icon: "doc" });
    log(s, `offer ${o.id} ${w} ${units}u ${days}d p=${o.price} spot=${o.spot}`);
  }
  /* build-to-suit: a big customer wants dedicated capacity. Long term, fixed price above spot, high SLA and
     penalty, an up-front fit-out, delivery after a lead time (time to buy the hardware). */
  function makeBts(s) {
    const st = stats(s), mk = st.mk, rf = repF(s), R = () => nextRand(s);
    const w = R() < 0.5 ? "train" : "infer";
    const ref = Math.max(st.supply[w], 0.5 * mk[w].demand);
    const units = Math.max(K.BTS_MIN_UNITS, Math.round(ref * (0.4 + 0.4 * R())));
    const days = [360, 450, 540][Math.floor(R() * 3)];
    const price = mk[w].price * (1 + K.BTS_PREMIUM * R()) * (1 + 0.2 * rf);
    let cust = C.CUSTOMERS[Math.floor(R() * C.CUSTOMERS.length)];
    if (s.policyFx.exportCtl && cust.foreign) cust = C.CUSTOMERS[0];
    const o = { id: "c" + s.nextId++, bts: true, cust: cust.name, icon: cust.icon, foreign: cust.foreign, w, units, days, lead: K.BTS_LEAD,
      fitout: Math.round(units * K.BTS_FIT_PER_UNIT), price: +price.toFixed(4), spot: +mk[w].price.toFixed(4), repAdj: +(1 + 0.2 * rf).toFixed(4),
      sla: K.BTS_SLA, penalty: +(price * K.BTS_PENALTY_MULT).toFixed(4), expires: s.day + K.BTS_EXPIRY };
    s.offers.push(o);
    pushNews(s, { title: `Build-to-suit request: ${cust.name}`, body: `${units} ${w} units x ${days} days at $${round2(price)}k from day ${Math.round(s.day + o.lead)}. Fit-out $${o.fitout}k up front, SLA ${Math.round(o.sla * 100)} %.`, tone: "info", cat: "contracts", icon: "building" });
    log(s, `bts offer ${o.id} ${w} ${units}u ${days}d p=${o.price} fit=${o.fitout}`);
  }
  function makeRound(s) {
    const R = () => nextRand(s);
    const last90 = s.revDays.slice(-90).reduce((a, x) => a + x, 0), prior90 = s.revDays.slice(-180, -90).reduce((a, x) => a + x, 0);
    const g = prior90 > 0 ? clamp(last90 / prior90 - 1, -0.3, 0.6) : 0;
    const pre = companyValue(s) * (1 + g) * (1 + 0.2 * repF(s)) * (0.9 + 0.2 * R());
    const pct = [0.08, 0.12, 0.15, 0.2][Math.floor(R() * 4)];
    const amount = pct / (1 - pct) * pre;
    const vc = C.VCS[Math.floor(R() * C.VCS.length)];
    s.roundOffer = { id: "r" + s.nextId++, vc, pct, amount: Math.round(amount), valuation: Math.round(pre), expires: s.day + K.ROUND_EXPIRY,
      pitch: `"Our board targets are gentle: about +${Math.round(K.PITCH_GROWTH * 100)} % per half-year."` };
    pushNews(s, { title: `${vc} offers $${Math.round(amount)}k for ${Math.round(pct * 100)} %`, body: s.roundOffer.pitch, tone: "pitch", cat: "investors", icon: "tag" });
    log(s, `round offer ${s.roundOffer.id} ${pct} for ${Math.round(amount)} (pre ${Math.round(pre)}, growth ${g.toFixed(2)})`);
  }
  function policyVote(s, p) {
    const h = s.hidden.policy[p.id], prob = clamp(h.p0 + p.shift, 0.02, 0.98);
    const passed = h.u < prob;
    p.status = passed ? "passed" : "failed";
    pushNews(s, { title: `${p.title} ${passed ? "passes" : "fails"}`, body: passed ? p.body : "Back to committee.", tone: passed ? "bad" : "good", cat: "policy", icon: "flag" });
    log(s, `policy ${p.id} vote p=${prob.toFixed(2)} u=${h.u.toFixed(2)} passed=${passed}`);
    if (!passed) return;
    if (p.kind === "carbonTax") s.policyFx.carbonTax = K.CARBON_TAX0;
    if (p.kind === "mandate") s.policyFx.mandate = { deadline: s.day + K.MANDATE_GRACE };
    if (p.kind === "export") {
      s.policyFx.exportCtl = true;
      const barred = s.contracts.filter(c => c.foreign);
      for (const c of barred) pushNews(s, { title: `Contract with ${c.cust} ends`, body: "Customer barred by export controls. No penalty; revenue gone.", tone: "bad", cat: "contracts" });
      s.contracts = s.contracts.filter(c => !c.foreign);
      s.offers = s.offers.filter(o => !o.foreign);
    }
  }

  function daily(s, st) {
    const d = s.day;
    // bookkeeping: trailing revenue and profit windows
    s.revDays.push(+s.dayAcc.rev.toFixed(3)); if (s.revDays.length > 180) s.revDays.shift();
    s.profitDays.push(+s.dayAcc.profit.toFixed(3)); if (s.profitDays.length > 90) s.profitDays.shift();
    const dayRev = s.dayAcc.rev, missed = s.dayAcc.missed;
    s.dayAcc = { rev: 0, profit: 0, missed: {} };
    s.deprec = s.deprec.filter(x => x.until > d);
    // hires arriving and transit orders are handled per step; here: memory walk
    if (on(s, "memory")) {
      const h = s.hbm;
      h.index = clamp(h.index + K.HBM_REVERT * (h.target - h.index) + (nextRand(s) - 0.5) * 2 * K.HBM_VOL, 0.6, 2.5);
      updatePrices(s);
    }
    if (on(s, "energy")) s.power.noise = 1 + (nextRand(s) * 2 - 1) * K.SPOT_NOISE;
    if (on(s, "finance")) s.creditLimit = creditLimitOf(s);
    // contracts: SLA streaks, completion, expiry, new offers
    if (on(s, "contracts")) {
      for (const c of s.contracts) {
        if (missed[c.id]) {
          c.missDays++; c.streak++;
          if (on(s, "reputation")) repHit(s, K.REP_SLA_DAY);
          if (c.streak >= 5 && !c.pressed && on(s, "reputation")) { c.pressed = true; press(s, "sla", 3); }
        } else c.streak = 0;
      }
      for (const c of s.contracts.filter(x => d >= x.end)) {
        const ok = c.missed <= K.CONTRACT_OK_MISS * c.units * c.days;
        s.contractLog[ok ? "fulfilled" : "failed"]++;
        if (ok && on(s, "reputation")) s.rep = clamp(s.rep + K.REP_CONTRACT_OK, 0, 100);
        pushNews(s, { title: `Contract with ${c.cust} ${ok ? "fulfilled" : "ended short"}`, body: `Delivered ${Math.round(c.delivered)} units, penalties $${Math.round(c.penaltyPaid)}k.`, tone: ok ? "good" : "bad", cat: "contracts" });
        log(s, `contract ${c.id} end ok=${ok}`);
      }
      s.contracts = s.contracts.filter(x => d < x.end);
      for (const o of s.offers.filter(x => d >= x.expires)) log(s, `offer ${o.id} expired`);
      s.offers = s.offers.filter(x => d < x.expires);
      if (s.nextOffer >= 0 && d >= s.nextOffer) {
        makeOffer(s);
        const rf = repF(s);
        s.nextOffer = d + Math.max(8, Math.round(K.OFFER_EVERY * (1 - 0.2 * rf) + (nextRand(s) * 2 - 1) * K.OFFER_JITTER));
      }
      if (s.nextBts != null && s.nextBts >= 0 && d >= s.nextBts) {
        makeBts(s);
        s.nextBts = d + Math.round(K.BTS_EVERY + (nextRand(s) * 2 - 1) * K.BTS_JITTER);
      }
    }
    // investors: round offers and the board
    if (on(s, "investors")) {
      if (s.roundOffer && d >= s.roundOffer.expires) { log(s, `round ${s.roundOffer.id} expired`); s.roundOffer = null; }
      if (s.nextRound >= 0 && d >= s.nextRound && !s.roundOffer) {
        makeRound(s);
        s.nextRound = d + K.ROUND_EVERY + Math.round((nextRand(s) * 2 - 1) * 20);
      }
      const b = s.board;
      if (b) {
        b.rev += dayRev;
        if (d >= b.end) {
          const hit = b.rev >= b.target;
          b.history.push({ end: b.end, target: Math.round(b.target), rev: Math.round(b.rev), hit });
          b.misses = hit ? 0 : b.misses + 1;
          log(s, `board review rev=${b.rev.toFixed(0)} target=${b.target.toFixed(0)} hit=${hit} misses=${b.misses}`);
          if (b.misses >= 2) {
            s.firedScore = s.equity.own * companyValue(s) * K.FIRED_SCORE;
            s.over = "fired";
            pushNews(s, { title: "The board fires you", body: "Two missed targets in a row.", tone: "bad", cat: "investors" });
            log(s, "fired");
            return;
          }
          pushNews(s, hit ? { title: "Board target met", body: `Revenue $${Math.round(b.rev)}k vs $${Math.round(b.target)}k.`, tone: "good", cat: "investors" }
            : { title: "Board warning: target missed", body: `Revenue $${Math.round(b.rev)}k vs $${Math.round(b.target)}k. Miss again and you are out.`, tone: "bad", cat: "investors" });
          Object.assign(b, { start: d, end: d + K.BOARD_EVERY, target: Math.max(b.rev, b.target * 0.9) * (1 + K.BOARD_GROWTH), rev: 0 });
        }
      }
    }
    // reputation drift: green sourcing vs peers, drought water, mean reversion, press
    if (on(s, "reputation")) {
      s.rep = clamp(s.rep + clamp((s.env.green - 0.25) * 0.1, -0.03, 0.05) + 0.003 * (K.REP_START - s.rep), 0, 100);
      s.prBoosts = s.prBoosts.filter(b => d - b.day < K.PR_DECAY);
      if (on(s, "environment") && activeAt(s.drought, d)) {
        const evapLoad = st.halls.filter(h => h.cooling === "evap").reduce((a, h) => a + h.it, 0);
        if (evapLoad > 20) {
          repHit(s, K.REP_DROUGHT_DAY);
          const key = "drought" + s.drought.start;
          if (!s.press[key] && nextRand(s) < 0.05) { s.press[key] = true; press(s, "drought"); }
        }
      }
    }
    for (const l of s.leaks.filter(x => d >= x.day)) { if (on(s, "reputation")) press(s, "lobby"); else pushNews(s, Object.assign({ tone: "bad", cat: "press" }, C.PRESS.lobby)); }
    s.leaks = s.leaks.filter(x => d < x.day);
    // M63 pilots: an exotic card reveals its measured field performance after 10 days in a rack
    if (s.mech.disrupt) for (const r of s.racks) for (const dv of r.devices) {
      const it = itemOf(s, dv);
      if (it.role === "exotic" && s.measured[it.vendor] == null && dv.inst != null && d - dv.inst >= K.PILOT_DAYS) {
        s.measured[it.vendor] = it.field;
        pushNews(s, { title: `Pilot result: ${it.name}`, body: `Measured ${Math.round(it.field * 100)} % of the spec sheet in your rack.`, tone: it.field < 0.9 ? "bad" : "good", cat: "vendor", vendor: it.vendor });
        log(s, `pilot ${it.vendor} measured ${it.field}`);
      }
    }
    if (on(s, "ops") && s.repairAuto) autoRepairSweep(s);
    if (s.heatWave && d >= s.heatWave.until) s.heatWave = null;
    if (s.outage && d >= s.outage.until) { s.outage = null; pushNews(s, { title: "Grid power restored", body: "", tone: "good", cat: "facilities" }); }
    if (s.drought && d >= s.drought.until) { s.drought = null; pushNews(s, { title: "Drought over", body: "Water limits lifted.", tone: "good", cat: "environment" }); }
    if (s.ppa && d >= s.ppa.end) { log(s, "ppa ended"); pushNews(s, { title: "PPA term ended", body: "Back to spot power.", tone: "info", cat: "energy" }); s.ppa = null; }
  }

  function closeQuarter(s, q0) {
    const f = s.fin;
    if (on(s, "finance")) {
      const profit = f.rev - f.opex - f.dep, tax = K.TAX * Math.max(0, profit);
      if (tax > 0) { s.cash -= tax; s.ledger.tax += tax; s.totals.tax += tax; addLoss(s, "taxes", tax); }
      log(s, `quarter ${q0} profit=${profit.toFixed(1)} dep=${f.dep.toFixed(1)} tax=${tax.toFixed(1)}`);
    }
    s.fin = { rev: 0, opex: 0, dep: 0 };
    if (s.policyFx.carbonTax > 0) s.policyFx.carbonTax = Math.min(K.CARBON_TAX_MAX, s.policyFx.carbonTax + K.CARBON_TAX_STEP);
    s.exportUsed = 0;
    s.lastQuarter = Object.assign({ q: q0 }, s.ledger);
    s.ledger = newLedger();
  }

  /* ================= time ================= */
  function step(s) {
    const dt = K.DT, st = stats(s);
    s.cash += st.net * dt;
    s.totals.revenue += st.gross * dt; s.totals.power += st.powerCost * dt; s.totals.opex += st.opex * dt;
    const L = s.ledger, c = st.costs;
    L.web += st.revenue.web * dt; L.train += st.revenue.train * dt; L.infer += st.revenue.infer * dt;
    L.frontier += st.revenue.frontier * dt; L.contracts += st.revenue.contracts * dt;
    L.power += c.power * dt; L.upkeep += c.upkeep * dt; L.salaries += c.salaries * dt; L.transit += c.transit * dt;
    L.interest += c.interest * dt; L.lease += c.lease * dt; L.water += c.water * dt; L.carbonTax += c.carbonTax * dt;
    L.fines += c.fines * dt; L.diesel += c.diesel * dt; L.penalties += c.penalties * dt; L.lost += st.throttleLoss * dt;
    s.fin.rev += st.gross * dt; s.fin.opex += st.opex * dt; s.fin.dep += depRate(s) * dt;
    s.dayAcc.rev += st.gross * dt; s.dayAcc.profit += st.net * dt;
    addLoss(s, "throttle", st.throttleLoss * dt); addLoss(s, "failures", st.failLoss * dt); addLoss(s, "sla", c.penalties * dt);
    addLoss(s, "bricked", st.brickLoss * dt); addLoss(s, "fines", c.fines * dt); addLoss(s, "outage", st.outageLoss * dt);
    addLoss(s, "transit", st.transitLost * dt); addLoss(s, "taxes", c.carbonTax * dt);
    const E = s.env;
    E.water += st.waterRate * dt; E.carbon += st.carbon * dt; E.waterRate = st.waterRate; E.carbonRate = st.carbon; E.green = st.green;
    for (const ct of s.contracts) {
      ct.delivered += (st.cDel[ct.id] || 0) * dt;
      const miss = st.cMiss[ct.id] || 0;
      if (miss > 1e-9) { ct.missed += miss * dt; ct.penaltyPaid += miss * ct.penalty * dt; s.dayAcc.missed[ct.id] = true; }
    }
    const a = 1 - Math.exp(-dt / K.THERMAL_TAU);
    for (const hh of st.halls) {
      if (hh.n === 1) s.roomT += (hh.tTarget - s.roomT) * a;
      else { const h = hallOf(s, hh.n); h.roomT += (hh.tTarget - h.roomT) * a; }
    }
    s.halls[0].roomT = s.roomT;
    if (on(s, "ops")) rollFailures(s, st);

    for (const j of s.jobs) if (j.phase === "ship" || j.phase === "contract" || j.phase === "parts") {
      j.left -= dt;
      if (j.left <= 1e-9) {
        if (j.phase === "contract") { j.done = true; finishJob(s, j); }
        else { const w = j.work != null ? j.work : K.INSTALL_DAYS; j.phase = "wait"; j.left = w; j.total = w; }
      }
    }
    for (const j of s.jobs) if (j.phase === "work" && !j.done) { j.left -= dt; if (j.left <= 1e-9) { j.done = true; finishJob(s, j); } }
    s.jobs = s.jobs.filter(j => !j.done);
    let free = s.techs - busyTechs(s);   // assign after progress, so a job never gains a free substep
    for (const j of s.jobs) if (j.phase === "wait" && free > 0) { j.phase = "work"; j.tech = true; free--; }

    const q0 = Math.floor(s.day / 90), d0 = Math.floor(s.day);
    s.day = +(s.day + dt).toFixed(4);
    while (s.hires.length && s.hires[0] <= s.day + 1e-9) { s.hires.shift(); s.techs++; pushNews(s, { title: "New technician starts", body: `${s.techs} on staff.`, tone: "good", cat: "ops", icon: "wrench" }); log(s, `hire arrived, techs=${s.techs}`); }
    if (s.transitOrders.length) {
      for (const o of s.transitOrders) if (o.day <= s.day + 1e-9) { s.transit = Math.max(0, s.transit + o.delta); log(s, `transit now ${s.transit}`); }
      s.transitOrders = s.transitOrders.filter(o => o.day > s.day + 1e-9);
    }
    if (Math.floor(s.day / 90) !== q0) closeQuarter(s, q0);
    if (Math.floor(s.day) !== d0) daily(s, st);
    if (s.over) return;
    if (Math.abs(s.day / 10 - Math.round(s.day / 10)) < 1e-6) {  // demand noise random walk every 10 days
      for (const w of ["train", "infer"]) s.market.noise[w] = clamp(s.market.noise[w] * (1 + (nextRand(s) - 0.5) * 0.08), 0.85, 1.15);
    }
    if (Math.abs(s.day / K.HISTORY_EVERY - Math.round(s.day / K.HISTORY_EVERY)) < 1e-6) sampleHistory(s, st);
    fireEvents(s);
    const floor = on(s, "finance") ? -s.creditLimit : K.BANKRUPT;
    if (s.cash < floor) { s.over = "bankrupt"; log(s, `bankrupt cash=${s.cash.toFixed(1)} floor=${floor.toFixed(1)}`); }
    else if (s.day >= K.END_DAY) { s.over = "end"; log(s, `end networth=${netWorth(s).toFixed(1)} score=${score(s).toFixed(1)}`); }
  }
  function sampleHistory(s, st) {
    st = st || stats(s);
    s.history.push({ d: Math.round(s.day), cash: +s.cash.toFixed(1), worth: +netWorth(s).toFixed(1), net: +st.net.toFixed(2),
      pt: +st.mk.train.price.toFixed(3), pi: +st.mk.infer.price.toFixed(3),
      dt: +st.mk.train.demand.toFixed(1), di: +st.mk.infer.demand.toFixed(1),
      st: +st.supply.train.toFixed(1), si: +st.supply.infer.toFixed(1), t: +s.roomT.toFixed(1),
      sp: +st.spot.toFixed(4), hbm: +s.hbm.index.toFixed(3), rep: +repOf(s).toFixed(1), co2: +st.carbon.toFixed(2) });
    if (s.history.length > 400) s.history.shift();
  }
  /* advance by `days`, in whole substeps. Returns number of substeps taken. */
  function advance(s, days) {
    const n = Math.round(days / K.DT);
    let i = 0;
    for (; i < n && !s.over; i++) step(s);
    return i;
  }

  /* cheap copy for previews: mutable containers are copied, history and logs shared */
  function shallowClone(s) {
    return Object.assign({}, s, {
      racks: s.racks.map(r => Object.assign({}, r, { devices: r.devices.slice(), pending: r.pending.slice() })),
      jobs: s.jobs.slice(), shelf: s.shelf.slice(), halls: s.halls.map(h => Object.assign({}, h)), spines: Object.assign({}, s.spines),
      log: [], cash: s.cash,
    });
  }
  /* state as if the action had fully completed (device installed), for previews and bots */
  function project(s, a) {
    const p = shallowClone(s), r = a.rack != null ? rackById(p, a.rack) : null;
    if (a.type === "buy") { r.devices.push({ uid: -1, type: a.item, born: s.day, inst: s.day }); p.cash -= s.items[a.item].price; }
    else if (a.type === "lease") r.devices.push({ uid: -1, type: a.item, born: s.day, inst: s.day, leased: true, leaseRate: s.items[a.item].price * K.LEASE_RATE });
    else if (a.type === "move") { const [d] = r.devices.splice(findDev(r, a.uid), 1); rackById(p, a.to).devices.push(d); }
    else if (a.type === "sell") { const i = findDev(r, a.uid); p.cash += resale(s, r.devices[i]); r.devices.splice(i, 1); }
    else if (a.type === "store" || a.type === "returnLease") { const i = findDev(r, a.uid); const [d] = r.devices.splice(i, 1); if (a.type === "store") p.shelf.push(d); }
    else if (a.type === "unstore") { const i = p.shelf.findIndex(x => x.uid === a.uid); if (i >= 0) r.devices.push(p.shelf.splice(i, 1)[0]); }
    else if (a.type === "repair") {
      for (const rr of p.racks) { const i = findDev(rr, a.uid); if (i >= 0) rr.devices[i] = Object.assign({}, rr.devices[i], { failed: false }); }
    }
    else if (a.type === "mode") r.mode = a.mode;
    else if (a.type === "workload") r.workload = a.workload;
    else if (a.type === "tank") r.tank = true;
    else if (a.type === "grid") { const g = gridNext(s); if (g) p.gridKw = g.kw; }
    else if (a.type === "spine") p.spines[`${a.hall}-${a.row}`] = true;
    else if (a.type === "cooling") p.halls[a.hall - 1].cooling = a.mode;
    else if (a.type === "crac") p.halls[a.hall - 1].crac = true;
    else if (a.type === "transit") p.transit = Math.max(0, p.transit + Math.round(a.delta));
    return p;
  }

  /* end screen: score, breakdown, biggest measurable losses, lessons, hidden truths */
  function summary(s) {
    const worth = netWorth(s), cv = companyValue(s);
    const p = s.profitDays.length ? s.profitDays.reduce((a, x) => a + x, 0) / s.profitDays.length : 0;
    const losses = Object.keys(LOSS_LABEL).map(k => {
      let worst = null;
      for (const [per, amt] of Object.entries(s.lossBy[k])) if (!worst || amt > worst.amount) worst = { period: per, amount: amt };
      return { key: k, label: LOSS_LABEL[k], total: s.losses[k], worst };
    }).filter(x => x.total > 0.5).sort((a, b) => b.total - a.total);
    const lessons = losses.filter(x => x.key !== "taxes").slice(0, 3).map(x =>
      `You lost $${x.total >= 1000 ? (x.total / 1000).toFixed(1) + "M" : Math.round(x.total) + "k"} to ${x.label}` +
      (x.worst ? `, most of it in ${x.worst.period} ($${Math.round(x.worst.amount)}k)` : "") + ".");
    return {
      score: score(s), over: s.over, own: s.equity.own, companyValue: cv, netWorth: worth, cash: s.cash, debt: s.debt,
      earnings: Math.max(0, p) * K.EARN_DAYS * K.EARN_MULT, profitPerDay: p, repFactor: repFactor(s), reputation: repOf(s),
      raised: s.equity.raised, contracts: Object.assign({}, s.contractLog), carbon: s.env.carbon, water: s.env.water,
      losses, lessons,
      hidden: {
        realExotic: s.hidden.realExotic, fakeExotic: s.hidden.fakeExotic, nanofabDies: s.hidden.nanofabDies, demandCut: s.hidden.demandCut,
        scares: s.hidden.scares.slice().sort((a, b) => a.day - b.day),
        policies: s.policies.map(x => ({ id: x.id, title: x.title, p0: s.hidden.policy[x.id].p0, shift: x.shift, status: x.status })),
        vcPitchGrowth: K.PITCH_GROWTH, boardGrowth: K.BOARD_GROWTH,
      },
    };
  }

  return {
    K, MODES, MARKET, INTENSITY, NET_NEED, CHAPTERS, BASE_ITEMS, SHOP_ORDER, GEN_LAUNCH, WORKLOADS, CONTENT: C, LOSS_LABEL,
    newGame, step, advance, stats, check, apply, project, shallowClone, netWorth, resale, score, summary, companyValue,
    seasonAt, marketAt, rackById, rackIndex, usedU, rackKw, rackKwAll, gridKwAll, shopItems, currentGen, busyTechs, isDead, throttleAt,
    on, repOf, repFactor, hazard, ppaQuote, creditLimitOf, shelfLoad, transitTarget, trailingRevenue, hbmF, gridNext,
    setDebug(v) { DEBUG = !!v; },
  };
});
