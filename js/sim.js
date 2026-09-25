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
  else { root.Sim = Sim; (root.__factories = root.__factories || {}).sim = factory; }
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
    T_LIMIT: 32, THERMAL_TAU: 5,
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
    // v4 contracts core (docs/CONTRACTS_CORE.md): all revenue comes from contracts on the order board
    OFFER_EVERY: 4, OFFER_JITTER: 2, OFFER_EXPIRY: 20, OFFER_EXPIRY_MIN: 10, BOARD_MAX: 6,
    OFFER_CAP_MIN: 0.3, OFFER_CAP_MAX: 1.2, OFFER_STRETCH: 0.25, OFFER_MIN_UNITS: 2,
    LEAD_MIN: 14, LEAD_MAX: 24, QUOTE_SPREAD: 0.15, PENALTY_MULT: 1.5, CONTRACT_OK_MISS: 0.05,
    CONTRACT_PREMIUM: 0.2,      // quotes = price index x (1 + premium) x (1 +- spread): see DECISIONS (v4 balance)
    SLA_WEB: 0.9, SLA_INFER: 0.95, WEB_DAYS: [60, 90, 120, 180], INFER_DAYS: [90, 180, 270, 360],
    JOB_DAYS: [30, 45, 60, 90, 120], JOB_PREMIUM: 0.15, JOB_SPEED: 2, JOB_LATE_PEN: 0.005, JOB_LATE_MAX: 20,
    ANCHOR_UNITS: 15, START_OFFERS: 2, REP_SLA_DAY_MAX: 0.45, REP_JOB_CANCEL: 3,
    SLA_WALK_DAYS: 20,          // a serving customer whose SLA is missed this many days in a row terminates the contract
    RENEW_BEFORE: 10,           // a serving customer on track (SLA met so far) offers a renewal this many days before the end
    // v0.4.2 onboarding grace (telemetry: a new player lost the anchor on day 46): a miss streak that began before
    // GRACE_DAYS is tolerated GRACE_PATIENCE x longer, and the anchor cannot walk before GRACE_DAYS (it only pays less)
    GRACE_DAYS: 90, GRACE_PATIENCE: 2,
    // v0.4.2 web is an unbounded, price-elastic market (designer: "web 需求需要做 inf 下去，满了 web 降低单价"; DECISIONS D61):
    // new web offers are priced x max(WEB_FLOOR, min(1, (WEB_DREF / H)^WEB_EPS)), H = web units a day you already hold.
    // Flat up to the old 30-unit market; ~1-year server payback near H 75; below a server's running cost past ~170.
    // Offer size: at most max(WEB_CAP_MIN, WEB_CAP_FRAC x your web capacity) (sane steps instead of a demand wall)
    WEB_DREF: 30, WEB_EPS: 0.8, WEB_FLOOR: 0.25, WEB_CAP_MIN: 12, WEB_CAP_FRAC: 0.6,
    // once GPUs are unlocked, web customers arrive on their own clock (every WEB_EVERY +- OFFER_JITTER days) instead of
    // taking GPU offers' turns on the board: web never closes now, and it must not crowd out the GPU offer flow
    WEB_EVERY: 8, WEB_BOARD_MAX: 3,
    // v4 player-triggered chapters (DECISIONS D49): one chapter per CH_GAP days at most; a stalled active player gets the
    // next chapter after CH_STALL days
    CH_GAP: 30, CH_STALL: 240,
    // ch8 build-to-suit: big, long, high-SLA offers that need an up-front fit-out (capex) and start after a lead time
    BTS_EVERY: 40, BTS_JITTER: 10, BTS_FIRST: 30, BTS_EXPIRY: 20, BTS_LEAD: 45, BTS_PREMIUM: 0.2, BTS_PENALTY_MULT: 3,
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
    UNSELL_DAYS: 10, CANCEL_FEE: 0.1, CANCEL_FREE_DAYS: 1,   // v4 forgiveness: undo a sale; cancel a queued job
    // ch15 reputation
    REP_START: 60, PR_COST: 120, PR_GAIN: 8, PR_DECAY: 90, PR_BACKFIRE: 5, SCANDAL_DAYS: 45,
    REP_SLA_DAY: 0.15, REP_OUTAGE: 3, REP_CONTRACT_OK: 0.5, REP_DROUGHT_DAY: 0.1, PRESS_HIT: 6,
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
    idle: "idle capacity (hardware with no contract)", cancelled: "cancelled training jobs",
  };
  /* end-screen lesson per loss key (v4): "{x}" = the amount, "{w}" = the worst period clause */
  const LESSON = {
    idle: "You left {x} of capacity idle with no contract to serve{w}.",
    cancelled: "You lost {x} of finished work to cancelled training jobs{w}.",
    sla: "You lost {x} to SLA penalties and late fees{w}.",
  };
  /* v4: contracts are the core loop; `mech.contracts: false` (ablation) = a flat-rate buyer takes all output at the
     market price index up to market demand (the v3 spot market without oversupply), so the game still runs */
  const core = s => s.mech.contracts !== false;
  const isJob = c => c.kind === "train" || c.kind === "frontier";

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
      v: 4, seed, rng: seed ^ 0x9E3779B9, rngF: (seed ^ 0x85EBCA6B) >>> 0, day: 0, cash: K.START_CASH, sandbox: !!opts.sandbox,
      roomT: 24, gridKw: K.GRID_KW, gridUp: false, gridTier: 0, nextId: 1, over: null,
      mech: Object.assign({}, MECH_DEFAULT, opts.mech || {}),
      racks: [], jobs: [], news: [], log: [], history: [], bench: { lattice: [], photon: [] },
      chapter: 0, unlocked: {}, events: [], firedEvents: 0,
      market: { mult: { web: 1, train: 1, infer: 1 }, noise: { web: 1, train: 1, infer: 1 }, dmult: { web: 1, train: 1, infer: 1 }, gpuCut: 1 },
      vendors: {}, items: {},
      ledger: newLedger(), lastQuarter: null, totals: { revenue: 0, power: 0, capex: 0, resale: 0, opex: 0, tax: 0, flow: 0, events: 0 },
      // v0.3: every discrete cash jump that is not the player's own action is logged, so the UI can explain it
      cashEvents: [], cashSeq: 0,
      // ch6 operations
      techs: K.TECHS, hires: [], repairAuto: true, shelf: [],
      // ch7 fabric
      spines: {}, transit: 0, transitOrders: [],
      // v4 contracts core: the order board (offers), signed contracts, the offer timer; ch8 adds build-to-suit (nextBts)
      offers: [], contracts: [], nextOffer: -1, nextBts: -1, contractLog: { signed: 0, fulfilled: 0, failed: 0, cancelled: 0, late: 0 },
      // v4 player-triggered chapters: milestone counters (DECISIONS D49)
      prog: { gpuOrders: 0, heatWaves: 0, outages: 0, missDays: 0, lastChapter: 0 },
      // v4 coyote time for sales: sold devices can be bought back at the sale price for K.BUYBACK_DAYS
      recentlySold: [],
      // v4 automation policies (docs/UI_BACKLOG.md): auto-swap spares, keep N spares of an item, auto-renew contracts
      policy: { autoSwap: false, keepSpares: {}, autoRenew: false },
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
    addHallRacks(s, 1);
    for (const id of ["A1", "A2"]) {
      const r = rackById(s, id);
      r.devices.push(dev(s, "sw"));
      for (let i = 0; i < 8; i++) r.devices.push(dev(s, "cpu"));
    }
    s.events = buildEvents(s);
    log(s, `new game seed=${s.seed} sandbox=${s.sandbox} real=${realExotic} nanofabDies=${nanofabDies} demandCut=${demandCut}`);
    fireEvents(s);
    if (core(s)) startBoard(s);
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
    // world events are dated from early on and skipped (group check at fire time) while their chapter is locked
    const startOf = key => sb ? 0 : ({ memory: 150, energy: 0, facilities: 0, environment: 0 })[key];
    // v4: campaign chapters unlock on player milestones (checkChapters, daily); only chapter 1 is dated. Sandbox: all at d0.
    CHAPTERS.forEach((c, i) => {
      if (c.mech && s.mech[c.mech] === false) return;
      if (sb || i === 0) add(0, "chapter", { idx: i });
    });
    add(0, "news", { title: "Welcome to Halcyon Compute", body: core(s) ? "Two web racks, one customer and $400k. Sign offers on the order board to grow." : "Two racks of web servers and $400k. Grow it.", tone: "info", ...kp(core(s) ? "n.welcome" : "n.welcomeFlat") });
    if (s.mech.gens) {
      const RUMOR = ["", "", "Kestrel C2 and Heron M2 rumored", "Third-generation cards rumored", "Fourth-generation cards rumored", "Fifth-generation cards rumored"];
      GEN_LAUNCH.forEach((d, i) => {
        const g = i + 2;
        add(d - 60 + j(), "news", { title: RUMOR[g], body: `Kestrel C${g} and Heron M${g} expected in about two months.`, tone: "info", cat: "hardware", ...kp("n.rumor", { g }) });
        add(d, "launch", { gen: g });
      });
    }
    // ---- ch9 memory: HBM shocks with leading scare stories; ~1/3 of scares are false alarms
    {
      const st = startOf("memory") + 40, shocks = [];
      for (let t = st + R() * 120; t < K.END_DAY - 90; t += 220 + R() * 160) shocks.push(Math.round(t));
      for (const d of shocks) {
        const lead = 20 + Math.round(R() * 20), si = Math.floor(R() * C.SCARES.length), sc = C.SCARES[si];
        const dur = 45 + Math.round(R() * 45), peak = +(1.6 + R() * 0.4).toFixed(2);
        add(d - lead, "news", { group: "memory", title: sc.title, body: sc.body, tone: "bad", cat: "memory", icon: "layers", ...kp("n.scare" + si) });
        add(d - lead + 10, "news", { group: "memory", title: C.SCARE_FOLLOW.real.title, body: C.SCARE_FOLLOW.real.body, tone: "info", cat: "memory", ...kp("n.scareReal") });
        add(d, "hbmShock", { group: "memory", until: d + dur, peak });
        add(d + dur, "hbmEnd", { group: "memory" });
        s.hidden.scares.push({ day: d - lead, real: true });
      }
      const nFalse = Math.max(1, Math.round(shocks.length / 2));
      for (let i = 0; i < nFalse; i++) {
        const d = Math.round(st + R() * (K.END_DAY - st - 60));
        if (shocks.some(x => Math.abs(x - d) < 60)) continue;
        const si = Math.floor(R() * C.SCARES.length), sc = C.SCARES[si];
        add(d, "news", { group: "memory", title: sc.title, body: sc.body, tone: "bad", cat: "memory", icon: "layers", ...kp("n.scare" + si) });
        add(d + 10, "news", { group: "memory", title: C.SCARE_FOLLOW.fake.title, body: C.SCARE_FOLLOW.fake.body, tone: "info", cat: "memory", ...kp("n.scareFake") });
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
          add(d - 5, "news", { group: "energy", title: "Heat wave forecast next week", body: "Grid operator warns of price spikes.", tone: "bad", cat: "energy", icon: "temp", ...kp("n.heatFore") });
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
        add(d - 12, "news", { group: "environment", title: "Drought watch issued", body: "Water utility may cap industrial use this summer.", tone: "bad", cat: "environment", icon: "drop", ...kp("n.droughtWatch") });
        add(d, "drought", { group: "environment", until: d + dur });
      }
    }
    // ---- ch16 policy proposals are aimed at the player: scheduled when the chapter unlocks (schedulePolicies)
    // ---- ch17 disruption (re-timed v1 chapter 6)
    if (s.mech.disrupt) {
      const D = 1290;
      add(1200, "news", { group: "disrupt", title: "Two startups demo new accelerators", body: "Lattice (inference ASIC) and Photon (optical training). Both need immersion tanks.", tone: "info", cat: "vendor", ...kp("n.startups") });
      add(D, "exoticLaunch", { model: 0 });
      add(1380 + j(), "news", { group: "disrupt", title: `${NAME[Rx]} signs a hyperscaler deal`, body: "Undisclosed volume.", tone: "good", vendor: Rx, cat: "vendor", ...kp("n.hyperDeal", { v: NAME[Rx] }) });
      add(1350 + j(), "news", { group: "disrupt", title: `${NAME[Fx]} pushes its next ship date`, body: "\"A short delay to raise yields.\"", tone: "info", vendor: Fx, cat: "vendor", ...kp("n.shipDelay", { v: NAME[Fx] }) });
      add(1440, "exoticLaunch", { model: 1 });
      add(1450, "incumbentCut", { group: "disrupt" });
      add(1425 + j(), "news", { group: "disrupt", title: `${NAME[Fx]} lead architect departs`, body: "Joins a competitor.", tone: "bad", vendor: Fx, cat: "vendor", ...kp("n.architect", { v: NAME[Fx] }) });
      add(1500, "vendorDeath", { vendor: Fx, title: `${NAME[Fx]} winds down`, body: "Installed units lose firmware support and stop working.", ...kp("n.windDown", { v: NAME[Fx] }) });
      add(1590, "exoticLaunch", { model: 2 });
      add(1330, "pitch", { group: "disrupt" });
      if (s.hidden.nanofabDies) {
        add(1420 + j(), "news", { group: "disrupt", title: "Nanofab sells its only fab", body: "No successor product announced.", tone: "bad", vendor: "nanofab", cat: "vendor", ...kp("n.nanoSells") });
        add(1500, "firesale", { group: "disrupt" });
        add(1560, "vendorDeath", { vendor: "nanofab", title: "Nanofab exits the memory business", body: "PM-900 firmware is withdrawn. Racks holding one run at 60 % until it is pulled.", ...kp("n.nanoExit") });
      } else {
        add(1420 + j(), "news", { group: "disrupt", title: "Nanofab posts a record quarter", body: "PM-900 volume up 40 %.", tone: "good", vendor: "nanofab", cat: "vendor", ...kp("n.nanoRecord") });
      }
      for (let d = 1200; d <= K.END_DAY; d += K.BENCH_EVERY) add(d, "bench", {});
      // M65 demand disruption: a preprint, then either independent reproduction (real) or failure to replicate
      const dd = 1400 + Math.round((R() - 0.5) * 20);
      add(dd - 30, "news", { group: "disrupt", title: "Preprint claims 3x cheaper inference", body: "\"Algorithmic breakthrough\" circulates among AI labs.", tone: "info", cat: "market", ...kp("n.preprint") });
      add(dd - 15, "news", s.hidden.demandCut
        ? { group: "disrupt", title: "Breakthrough reproduced by independent labs", body: "Several labs confirm the speedup.", tone: "bad", cat: "market", ...kp("n.reproduced") }
        : { group: "disrupt", title: "Breakthrough results fail to replicate", body: "Independent labs cannot reproduce the numbers.", tone: "good", cat: "market", ...kp("n.noReplicate") });
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
  /* insert events into the unfired tail of the timeline, keeping it sorted (stable: same-day events keep their order) */
  function addEvents(s, list) {
    const tail = s.events.slice(s.firedEvents).concat(list).sort((a, b) => a.day - b.day);
    s.events = s.events.slice(0, s.firedEvents).concat(tail);
  }
  /* ch16: three proposals with a hidden pass probability, two indirect signals each and a vote, from the unlock day */
  function schedulePolicies(s) {
    if (s.policies.length) return;
    const R = () => nextRand(s), E = [], st = Math.floor(s.day) + (s.sandbox ? 60 : 10);
    C.POLICIES.forEach((pd, i) => {
      const ann = st + i * 70 + Math.round(R() * 20), vote = ann + 60 + Math.round(R() * 60);
      if (ann > K.END_DAY) return;
      const id = "p" + (i + 1);
      s.hidden.policy[id] = { p0: +(0.3 + 0.5 * R()).toFixed(2), u: R() };
      s.policies.push({ id, kind: pd.kind, title: pd.title, body: pd.body, announced: false, announceDay: ann, vote, status: "proposed", shift: 0, lobbied: 0, signals: [] });
      E.push({ day: ann, kind: "policyAnnounce", group: "policy", pid: id });
      E.push({ day: Math.round(ann + (vote - ann) * 0.4), kind: "policySignal", group: "policy", pid: id });
      E.push({ day: Math.round(ann + (vote - ann) * 0.75), kind: "policySignal", group: "policy", pid: id });
      E.push({ day: vote, kind: "policyVote", group: "policy", pid: id });
    });
    addEvents(s, E.filter(e => e.day <= K.END_DAY));
    log(s, `policies scheduled from d${st}`);
  }
  /* i18n (docs/I18N.md I2): `kp(key, params)` tags a news item / event with a language-neutral key the UI translates
     (`<key>.t` = title, `<key>.b` = body). Param values starting with "@" are themselves keys. Never read by the rules. */
  const kp = (k, p) => (p ? { k, p } : { k });
  function pushNews(s, n) { s.news.unshift(Object.assign({ day: Math.floor(s.day), tone: "info", cat: "general" }, n)); if (s.news.length > 60) s.news.pop(); }

  function onChapter(s, key) {
    const d = s.day;
    s.unlocked[key] = d;
    if (key === "fabric") {           // grant enough transit for today's traffic, so nothing collapses on unlock
      const st = stats(s);
      s.transit = Math.max(0, Math.ceil((st.supply.web + st.supply.infer) / K.TRANSIT_PER) - K.TRANSIT_FREE);
      log(s, `fabric: starter transit ${s.transit} (+${K.TRANSIT_FREE} free)`);
    }
    if (key === "contracts") s.nextBts = d + K.BTS_FIRST;       // ch8 long-term deals: build-to-suit offers
    if (key === "policy") schedulePolicies(s);
    s.prog.lastChapter = d;
    if (key === "investors") s.nextRound = d + 15;
    if (key === "finance") s.creditLimit = creditLimitOf(s);
  }

  function handleEvent(s, e) {
    const NAME = { lattice: "Lattice", photon: "Photon" };
    switch (e.kind) {
      case "chapter":
        s.chapter = Math.max(s.chapter, e.idx); onChapter(s, CHAPTERS[e.idx].key);
        log(s, `chapter ${CHAPTERS[e.idx].key}`); break;
      case "news": pushNews(s, Object.assign({ title: e.title, body: e.body, tone: e.tone, vendor: e.vendor, cat: e.cat || "general", icon: e.icon }, e.k ? kp(e.k, e.p) : null)); break;
      case "launch": {
        const g = e.gen;
        for (const it of Object.values(s.items)) {
          if (it.role === "gpu" && it.gen === g - 1) { it.base = Math.round(it.base * 0.6); it.oldGen = true; }
        }
        updatePrices(s);
        for (const w of WORKLOADS) s.market.mult[w] *= GEN_DROP[w];
        pushNews(s, { title: `Generation ${g} ships`, body: "Rivals upgrade, so compute prices drop. Older cards resell for less; last gen is on sale.", tone: "bad", icon: "chip", cat: "hardware", ...kp("n.genShips", { g }) });
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
        if (names.length && on(s, "disrupt")) pushNews(s, { title: `${names.join(" and ")} on sale`, body: m === 0 ? "Pilot quantities. Needs an immersion tank rack." : "Vendor claims a big jump in performance per watt.", tone: "info", icon: "rocket", cat: "vendor", ...kp(m === 0 ? "n.exotic0" : "n.exotic1", { names: names.join(" + ") }) });
        log(s, `exotic model ${m} launch`);
        break;
      }
      case "pitch":
        pushNews(s, { title: "PM-900, 30 % off", body: "Nanofab: \"Adds 25 % memory bandwidth to every GPU in the rack. Fixes your HBM bottleneck.\"", tone: "pitch", vendor: "nanofab", icon: "tag", cat: "vendor", ...kp("n.pitch") });
        break;
      case "firesale":
        s.items.pm9.price = s.items.pm9.base = Math.round(BASE_ITEMS.pm9.price * PM9_FIRESALE);
        pushNews(s, { title: "PM-900 now 60 % off", body: "\"Limited-time inventory clearance.\"", tone: "pitch", vendor: "nanofab", icon: "tag", cat: "vendor", ...kp("n.firesale") });
        break;
      case "vendorDeath": {
        let lost = 0;
        for (const d of allOwnedDevices(s)) if (s.items[d.type].vendor === e.vendor && !d.leased) lost += resale(s, d);
        s.vendors[e.vendor].dead = true;
        addLoss(s, "bricked", lost);
        pushNews(s, Object.assign({ title: e.title, body: e.body, tone: "bad", vendor: e.vendor, cat: "vendor" }, e.k ? kp(e.k, e.p) : null));
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
        pushNews(s, { title: "Kestrel and Heron cut prices 25 %", body: "The incumbents respond to the startups.", tone: "good", icon: "tag", cat: "hardware", ...kp("n.cut") });
        log(s, "incumbent price cut"); break;
      }
      case "demandShock": {    // M65
        if (s.hidden.demandCut) {
          s.market.dmult.infer *= K.DEMAND_CUT;
          for (const c of s.contracts.filter(x => x.bts && x.w === "infer"))    // build-to-suit customers need far less too
            pushNews(s, { title: `${c.cust} cancels its build-to-suit deal`, body: "They need far less compute now. No penalty; the fit-out is sunk.", tone: "bad", cat: "contracts", ...kp("n.btsCancel", { c: c.cust }) });
          s.contracts = s.contracts.filter(x => !(x.bts && x.w === "infer"));
          pushNews(s, { title: "Inference demand drops 35 %", body: "Labs ship the new algorithm; they need far less compute.", tone: "bad", cat: "market", ...kp("n.demandDrop") });
        } else pushNews(s, { title: "Inference demand steady", body: "The hyped paper changed nothing.", tone: "info", cat: "market", ...kp("n.demandSteady") });
        log(s, `demand shock real=${s.hidden.demandCut}`); break;
      }
      case "hbmShock":
        Object.assign(s.hbm, { target: e.peak, shortage: true, until: e.until });
        pushNews(s, { title: "HBM shortage: GPU lead times triple", body: `GPU shipping now ${K.SHORT_SHIP_DAYS} days. Prices climbing.`, tone: "bad", cat: "memory", icon: "layers", ...kp("n.hbmShort", { d: K.SHORT_SHIP_DAYS }) });
        log(s, `hbm shock peak=${e.peak} until=${e.until}`); break;
      case "hbmEnd":
        Object.assign(s.hbm, { target: 1, shortage: false });
        pushNews(s, { title: "HBM supply normalizes", body: "GPU lead times back to normal.", tone: "good", cat: "memory", ...kp("n.hbmEnd") });
        log(s, "hbm shock end"); break;
      case "heatWave":
        s.heatWave = { start: s.day, until: e.until, mult: e.mult }; s.prog.heatWaves++;
        pushNews(s, { title: "Heat wave: spot power spikes", body: `Prices x${e.mult} until it breaks.`, tone: "bad", cat: "energy", icon: "temp", ...kp("n.heatWave", { x: e.mult }) });
        log(s, `heat wave x${e.mult} until ${e.until}`); break;
      case "outage": {
        s.outage = { start: s.day, until: e.until }; s.prog.outages++;
        if (s.ups) pushNews(s, { title: "Grid outage: generator running", body: "UPS carried the load. Diesel is burning.", tone: "info", cat: "facilities", icon: "bolt", ...kp("n.outageUps") });
        else {
          pushNews(s, { title: "Grid outage: everything is down", body: "No backup power. Output stops until the grid returns.", tone: "bad", cat: "facilities", icon: "bolt", ...kp("n.outage") });
          if (on(s, "reputation")) { repHit(s, K.REP_OUTAGE); press(s, "outage", 4); }
        }
        log(s, `outage until ${e.until} ups=${s.ups}`); break;
      }
      case "drought":
        s.drought = { start: s.day, until: e.until };
        pushNews(s, { title: "Drought: water use capped", body: "Evaporative cooling loses 40 % capacity.", tone: "bad", cat: "environment", icon: "drop", ...kp("n.drought") });
        log(s, `drought until ${e.until}`); break;
      case "policyAnnounce": {
        const p = policyById(s, e.pid); p.announced = true;
        pushNews(s, { title: `Proposed: ${p.title}`, body: `${p.body} Vote on day ${p.vote}.`, tone: "info", cat: "policy", icon: "flag", ...kp("n.polPropose", { pol: "@pol." + p.kind, vote: p.vote }) });
        log(s, `policy ${p.id} announced, vote ${p.vote}`); break;
      }
      case "policySignal": {   // indirect signal: positive with probability p0 (more positives = likelier to pass)
        const p = policyById(s, e.pid), h = s.hidden.policy[p.id];
        const up = nextRand(s) < h.p0, pool = C.POLICY_SIGNALS[up ? "up" : "down"];
        const si = Math.floor(nextRand(s) * pool.length), title = pool[si];
        p.signals.push({ day: Math.floor(s.day), up });
        pushNews(s, { title: `${p.title}: ${title}`, body: "", tone: "info", cat: "policy", icon: up ? "trend" : "warn", ...kp("n.polSignal", { pol: "@pol." + p.kind, sig: `@sig.${up ? "up" : "down"}${si}` }) });
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

  /* ---- v4 contract engine ----
     A contract is either SERVING (kind web | infer | bts, or the starting anchor): `units` per day for `days` from `start`,
     paid `price` per delivered unit, `penalty` per unit below `sla` x units; or a JOB (kind train | frontier): `work`
     unit-days by `deadline`, paid `pay` on completion, at most `maxRate` units a day, `lateFee` per day after the
     deadline, cancelled `lateMax` days after it. Frontier jobs only take output from racks in a >= 12-GPU spine cluster. */
  /* the rate a job needs from `day` on to finish by its deadline (as fast as it may once late) */
  function jobNeed(c, day) {
    const rem = Math.max(0, c.work - c.done), left = c.deadline - day;
    return left > 1e-9 ? Math.min(c.maxRate, rem / left) : Math.min(c.maxRate, rem);
  }
  /* missed days in a row a customer tolerates: doubled for a streak that began in the onboarding grace */
  function patience(s, c) { return K.SLA_WALK_DAYS * (s.day - (c.streak || 0) < K.GRACE_DAYS ? K.GRACE_PATIENCE : 1); }
  /* days until serving contract c walks away at its current miss streak (0 = today), or null when it is not at risk.
     The anchor cannot walk before GRACE_DAYS. */
  function walkIn(s, c) {
    if (!c || isJob(c) || c.phantom || !(c.streak > 0)) return null;
    return Math.max(0, patience(s, c) - c.streak, c.anchor ? K.GRACE_DAYS - s.day : 0);
  }
  /* active on `day`: started, and not yet over (serving: before its end; job: work left) */
  const activeC = (c, day) => !(c.start > day + 1e-9) && (isJob(c) ? c.done < c.work - 1e-9 : day < c.end);
  /* allocate every rack's output to contracts, most urgent first (least slack; ties: higher penalty, then id).
     Pass 1 gives each contract what keeps it out of trouble (serving: its SLA minimum; job: the rate that meets its
     deadline) - penalties only start below the SLA, so a small shortfall is spread instead of sinking one customer;
     pass 2 tops serving contracts up to all their units; pass 3 lets jobs use leftover output up to their max rate
     (finishing early). What is left is idle.
     Returns per-contract delivery (cDel), shortfall (cMiss), rack->contract links (alloc) and money rates. */
  function allocate(s, day, mk, perRack, racks) {
    const out = { revenue: { web: 0, train: 0, infer: 0, frontier: 0, contracts: 0 }, gross: 0, accrual: 0, penalties: 0,
      cDel: {}, cMiss: {}, alloc: [], idle: { web: 0, train: 0, infer: 0 }, owed: { web: 0, train: 0, infer: 0 } };
    const pools = { web: [], train: [], infer: [] };
    for (const r of racks) {
      const pr = perRack[r.id];
      pr.to = []; pr.rev = 0;
      for (const w of ["web", "train", "infer"]) if (pr.out[w] > 1e-9) pools[w].push({ r: r.id, left: pr.out[w], fr: !!pr.frontier });
    }
    pools.train.sort((a, b) => (a.fr ? 1 : 0) - (b.fr ? 1 : 0));   // ordinary training uses non-cluster racks first
    const act = [];
    for (const c of s.contracts) {
      if (!activeC(c, day)) continue;
      const job = isJob(c), need = job ? jobNeed(c, day) : c.units;
      const slack = c.phantom ? 1e9 : job ? (c.deadline - day) - Math.max(0, c.work - c.done) / c.maxRate : 0;
      act.push({ c, job, need, slack, got: 0 });
      if (!c.phantom) out.owed[c.w] += need;
    }
    act.sort((a, b) => a.slack - b.slack || b.c.penalty - a.c.penalty || (a.c.id < b.c.id ? -1 : a.c.id > b.c.id ? 1 : 0));
    const take = (x, amt) => {
      for (const p of pools[x.c.w]) {
        if (amt <= 1e-12) break;
        if (p.left <= 1e-12 || (x.c.frontier && !p.fr)) continue;
        const u = Math.min(p.left, amt);
        p.left -= u; amt -= u; x.got += u;
        out.alloc.push({ rack: p.r, id: x.c.id, w: x.c.w, u });
        perRack[p.r].to.push({ id: x.c.id, u });
      }
    };
    for (const x of act) take(x, x.job ? x.need : x.c.sla * x.c.units);
    for (const x of act) if (!x.job) take(x, x.c.units - x.got);
    for (const x of act) if (x.job) take(x, x.c.maxRate - x.got);
    for (const x of act) {
      const c = x.c, del = x.got;
      out.cDel[c.id] = del;
      if (x.job) {
        out.accrual += del * c.pay / c.work;
        out.cMiss[c.id] = Math.max(0, x.need - del);
        if (day >= c.deadline) out.penalties += c.lateFee;
      } else {
        const miss = Math.max(0, c.sla * c.units - del);
        out.cMiss[c.id] = miss;
        const v = del * c.price;
        out.revenue[c.w] += v; out.gross += v;
        out.penalties += miss * c.penalty;
      }
    }
    const val = {};
    for (const x of act) val[x.c.id] = x.job ? x.c.pay / x.c.work : x.c.price;
    for (const l of out.alloc) perRack[l.rack].rev += l.u * val[l.id];
    for (const w of ["web", "train", "infer"]) for (const p of pools[w]) out.idle[w] += p.left;
    return out;
  }
  /* ablation (mech.contracts false): a flat-rate buyer takes output up to market demand at the average contract price
     (index x (1 + CONTRACT_PREMIUM)), so the ablation removes the contract decisions, not the margin */
  function spotSale(s, mk0, perRack, racks, supply, frontierElig) {
    const f = 1 + K.CONTRACT_PREMIUM, mk = {};
    for (const w of ["web", "train", "infer", "frontier"]) mk[w] = { price: mk0[w].price * f, demand: mk0[w].demand };
    const out = { revenue: { web: 0, train: 0, infer: 0, frontier: 0, contracts: 0 }, gross: 0, accrual: 0, penalties: 0,
      cDel: {}, cMiss: {}, alloc: [], idle: { web: 0, train: 0, infer: 0 }, owed: { web: 0, train: 0, infer: 0 } };
    const left = { web: supply.web, train: supply.train, infer: supply.infer }, wRev = { web: 0, train: 0, infer: 0 };
    if (mk.frontier.demand > 0 && frontierElig > 0) {
      const sold = Math.min(frontierElig, mk.frontier.demand, left.train);
      out.revenue.frontier = sold * mk.frontier.price; wRev.train += out.revenue.frontier; left.train -= sold;
    }
    for (const w of ["web", "train", "infer"]) {
      const sold = Math.min(left[w], mk[w].demand);
      out.revenue[w] = sold * mk[w].price; wRev[w] += out.revenue[w];
      out.idle[w] = left[w] - sold;
    }
    out.gross = out.revenue.web + out.revenue.train + out.revenue.infer + out.revenue.frontier;
    for (const r of racks) {
      const pr = perRack[r.id]; pr.rev = 0; pr.to = [];
      for (const w in supply) if (supply[w] > 0) pr.rev += wRev[w] * pr.out[w] / supply[w];
    }
    return out;
  }

  /* instantaneous economics. opts.day: evaluate at another day (market + season);
     opts.eq: use equilibrium room temperature instead of the current one */
  function stats(s, opts) {
    opts = opts || {};
    const day = opts.day != null ? opts.day : s.day, now = day === s.day;
    const se = seasonAt(day), mk = marketAt(s, day);
    const envOn = on(s, "environment"), energyOn = on(s, "energy"), fabricOn = on(s, "fabric"), opsOn = on(s, "ops");
    const heatOn = on(s, "heat");        // v4: seasonal cooling, hot neighbours and throttling start with their chapter
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
      let cap = (heatOn ? se.heatCap - (wave ? K.HEATWAVE_COOL : 0) : 1e6) + hh.cool + (h.crac ? K.CRAC_KW : 0);
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
      pr.inlet = hh.roomT + (heatOn ? 5 * Math.max(0, pr.load - 0.6) : 0);
      pr.throttle = heatOn ? throttleAt(pr.inlet) : 1;
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
    const sell = () => core(s) ? allocate(s, day, mk, perRack, s.racks) : spotSale(s, mk, perRack, s.racks, supply, frontierElig);
    let sold = sell(), outageLoss = 0, supplyPre = null;
    if (blackout) {
      outageLoss = sold.gross + sold.accrual;
      for (const r of s.racks) { const pr = perRack[r.id]; pr.outPre = Object.assign({}, pr.out); pr.out.web = pr.out.train = pr.out.infer = 0; }
      supplyPre = Object.assign({}, supply);
      supply.web = supply.train = supply.infer = 0; frontierElig = 0;
      sold = sell();
    }
    const { revenue, gross } = sold;
    // ---- costs
    let nDev = 0, lease = 0;
    for (const r of s.racks) {
      nDev += r.devices.length;
      for (const d of r.devices) if (d.leased) lease += d.leaseRate;
      for (const d of r.pending) if (d.leased) lease += d.leaseRate;
    }
    for (const j of s.jobs) if (j.kind === "returnLease" && j.dev && j.dev.leased) lease += j.dev.leaseRate;   // billed until it is gone
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
    // v4: output with no contract to serve, valued at the market price index (the end screen's "idle capacity")
    const idleLoss = blackout ? 0 : sold.idle.web * mk.web.price + sold.idle.train * mk.train.price + sold.idle.infer * mk.infer.price;
    const failLoss = blackout ? 0 : failOut.web * mk.web.price + failOut.train * mk.train.price + failOut.infer * mk.infer.price;
    const brickLoss = s.racks.reduce((a, r) => { const pr = perRack[r.id]; return a + (pr.penalty < 1 ? pr.rev * (1 / pr.penalty - 1) : 0); }, 0);
    const green = facility > 0 ? Math.min(1, (solarKw + ppaKw) / facility) : 0;
    return { day, se, mk, kw, halls, heatCap: halls[0].heatCap, tTarget: halls[0].tTarget, roomT: halls[0].roomT, roomHeat: halls[0].heat,
      perRack, supply, frontierElig, cluster, transitF, revenue, gross, cDel: sold.cDel, cMiss: sold.cMiss,
      alloc: sold.alloc, idle: sold.idle, supplyPre: supplyPre || supply, lostCap: sold.idle, owed: sold.owed, accrual: sold.accrual, idleLoss,
      powerCost, upkeep, costs, opex, throttleLoss, failLoss, brickLoss, outageLoss, transitLost,
      facility, spot, solarKw, ppaKw, draw, dieselKw, waterRate, carbon, green, blackout, drought, heatWave: wave,
      net: gross - opex, earn: gross + sold.accrual - opex };
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
  /* a discrete cash change the player did not click (tax, auto-repair, a finished sale): {n, day, amt, kind, label} */
  const CASH_LOG_MAX = 120;   // ~a year of events at 8x between UI reads
  function ensureCashLog(s) {
    if (!s.cashEvents) s.cashEvents = [];
    if (s.cashSeq == null) s.cashSeq = 0;
    if (s.totals.flow == null) s.totals.flow = 0;
    if (s.totals.events == null) s.totals.events = 0;
    // v4 fields on older saves
    if (!s.prog) s.prog = { gpuOrders: 0, heatWaves: 0, outages: 0, missDays: 0, lastChapter: 0 };
    if (!s.recentlySold) s.recentlySold = [];
    if (!s.policy) s.policy = { autoSwap: false, keepSpares: {}, autoRenew: false };
    if (s.contractLog.cancelled == null) Object.assign(s.contractLog, { cancelled: 0, late: 0 });
    for (const k of Object.keys(LOSS_LABEL)) if (s.losses[k] == null) { s.losses[k] = 0; s.lossBy[k] = {}; }
    if (!(s.v >= 4)) {           // a pre-v4 save: give it the contracts core (anchor customer + a running board)
      if (core(s) && !s.contracts.some(c => c.anchor)) {
        const p = +(MARKET.web.base * 1.05).toFixed(4), a = C.ANCHOR;
        s.contracts.unshift({ id: "c" + s.nextId++, kind: "web", anchor: true, cust: a.name, icon: a.icon, foreign: false, w: "web",
          units: K.ANCHOR_UNITS, days: K.END_DAY, lead: 0, price: p, spot: MARKET.web.base, repAdj: 1, sla: K.SLA_WEB,
          penalty: +(p * K.PENALTY_MULT).toFixed(4), signed: s.day, start: s.day, end: K.END_DAY + 1, delivered: 0, missed: 0, penaltyPaid: 0, missDays: 0, streak: 0 });
      }
      if (core(s) && !(s.nextOffer >= 0)) s.nextOffer = Math.floor(s.day) + 1;
      s.v = 4;
      log(s, "migrated save to v4");
    }
  }
  /* `p` (optional) = language-neutral params for the UI (e.g. { c: customer, it: item name }); `label` stays English */
  function logCash(s, amt, kind, label, p) {
    ensureCashLog(s);
    s.cashEvents.push(Object.assign({ n: ++s.cashSeq, day: round2(s.day), amt: round2(amt), kind, label }, p ? { p } : null));
    s.totals.events = (s.totals.events || 0) + amt;      // cumulative: money conservation over a whole game
    if (s.cashEvents.length > CASH_LOG_MAX) s.cashEvents.shift();
    if (DEBUG && Math.abs(amt) >= 10) console.debug(`[sim d${s.day.toFixed(2)}] cash ${amt >= 0 ? "+" : ""}${amt.toFixed(1)} ${kind}: ${label}`);
  }
  const depRate = s => s.deprec.reduce((a, x) => a + (x.until > s.day ? x.rate : 0), 0);
  function repHit(s, amt) { s.rep = clamp(s.rep - amt, 0, 100); }
  function press(s, kind, hit) {
    const p = C.PRESS[kind];
    repHit(s, hit != null ? hit : K.PRESS_HIT);
    s.scandalUntil = s.day + K.SCANDAL_DAYS;
    pushNews(s, { title: p.title, body: p.body, tone: "bad", cat: "press", icon: "news", ...kp("n.press." + kind) });
    log(s, `press: ${kind}, rep ${repOf(s).toFixed(1)}`);
  }

  /* ================= actions ================= */
  function isAvail(s, it) {
    if (it.avail > s.day || isDead(s, it)) return false;
    if ((it.role === "exotic" || it.key === "pm9") && !on(s, "disrupt")) return false;
    if (it.role === "gpu" && !on(s, "gpu")) return false;           // v4: hardware goes on sale with its chapter
    if (it.ch && !on(s, it.ch)) return false;
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
  const orderJob = (s, uid) => uid == null ? null : s.jobs.find(j => (j.kind === "buy" || j.kind === "lease") && j.dev && j.dev.uid === uid) || null;
  const hasJob = (s, uid) => s.jobs.some(j => j.uid === uid || (j.dev && j.dev.uid === uid));

  function fits(s, r, it, mode) {
    const mm = mode || r.mode, m = MODES[mm === "off" ? "std" : mm];   // a parked rack is budgeted as if it ran Standard
    if (it.tank && !r.tank) return fit("Needs an immersion tank rack", "c.needTank");
    if (r.tank && !it.tank && it.role !== "net") return fit("Tank racks only take exotic cards and switches", "c.tankOnly");
    const free = K.RACK_U - usedU(s, r);
    if (free < it.u) return fit(`Needs ${it.u}U, ${free}U free`, "c.needU", { u: it.u, free });
    if (rackKwAll(s, r) + it.kw * m.kw > K.RACK_KW + 1e-9) return fit(`Rack limit ${K.RACK_KW} kW`, "c.rackKw", { kw: K.RACK_KW });
    if (gridKwAll(s) + it.kw * m.kw > s.gridKw + 1e-9) return fit(`Grid limit ${s.gridKw} kW`, "c.grid", { kw: s.gridKw });
    return null;
  }
  function findDev(r, uid) { return r.devices.findIndex(d => d.uid === uid); }
  const RACK_ACTIONS = new Set(["buy", "move", "sell", "mode", "workload", "tank", "store", "unstore", "lease", "returnLease", "reorder"]);
  const GATE = { hire: "ops", fire: "ops", repairPolicy: "ops", repair: "ops", store: "ops", unstore: "ops",
    spine: "fabric", transit: "fabric", forward: "memory",
    borrow: "finance", repay: "finance", lease: "finance", returnLease: "finance", buildHall: "facilities", ups: "facilities", crac: "facilities",
    ppa: "energy", solar: "energy", cooling: "environment", acceptRound: "investors", declineRound: "investors", buyback: "investors",
    pr: "reputation", lobby: "policy" };
  /* check() results: `msg` = the English text (bots, logs and tests match on it); `k` + `p` = a language-neutral key and
     params the UI translates (docs/I18N.md I2); `code` = the rejection class for show-not-tell feedback */
  const CHK_CODE = { "c.needs": "cash", "c.fitoutCash": "cash", "c.cash": "cash", "c.needU": "space", "c.rackKw": "kw", "c.rackDraw": "kw",
    "c.grid": "grid", "c.shelfFull": "shelf" };
  const no = (msg, k, p) => (msg && typeof msg === "object" ? no(msg.msg, msg.k, msg.p) : { ok: false, msg, k, p, code: CHK_CODE[k] || "other" });
  const yes = (msg, k, p) => ({ ok: true, msg, k, p });
  const fit = (msg, k, p) => ({ msg, k, p });
  const needs = x => no(`Needs $${x}k`, "c.needs", { x });
  const gridNext = s => s.gridTier === 0 ? { kw: K.GRID_KW_UP, cost: K.GRID_COST, days: K.GRID_DAYS }
    : s.gridTier === 1 && on(s, "facilities") ? { kw: K.GRID_KW_UP2, cost: K.GRID_COST2, days: K.GRID_DAYS2 }
    : s.gridTier === 2 && on(s, "facilities") ? { kw: K.GRID_KW_UP3, cost: K.GRID_COST3, days: K.GRID_DAYS3 } : null;
  /* grid tier 4 exists to power Hall 3: it may be ordered once Hall 3 stands or is being built (the 90-day feed and the
     120-day hall can overlap), never before (DECISIONS D41) */
  const hall3Started = s => { ensureHalls(s); return s.halls[2].built || s.jobs.some(j => j.kind === "buildHall" && j.hall === 3); };
  /* the workload a GPU earns more on at today's spot prices, when it is the first GPU in its rack (else null: the rack
     keeps the player's choice). Used by the UI as the default on install; bots choose their own workload. */
  function naturalWorkload(s, rackId, key) {
    const r = rackById(s, rackId), it = s.items[key];
    if (!r || !it || it.role !== "gpu" || r.tank) return null;
    if (r.devices.concat(r.pending).some(d => itemOf(s, d).role === "gpu")) return null;
    const mk = marketAt(s, s.day);
    let best = null, bestV = -1;
    for (const w of WORKLOADS) { const v = Math.min(it.F, it.B * INTENSITY[w]) * mk[w].price; if (v > bestV) { bestV = v; best = w; } }
    return best;
  }
  function ppaQuote(s) {  // tracks the recent spot average (season + noise), a little below it
    const H = s.history.slice(-12);
    const avg = H.length ? H.reduce((a, h) => a + (h.sp || seasonAt(h.d).powerPrice / K.PUE_BASE), 0) / H.length : seasonAt(s.day).powerPrice / K.PUE_BASE;
    return +(avg * K.PPA_DISCOUNT).toFixed(4);
  }
  function roundCost(s) { return Math.max(1, K.BUYBACK_STEP * companyValue(s)); }

  function check(s, a) {
    if (s.over) return no("Game over", "c.over");
    if (!a || !a.type) return no("Unknown action", "c.unknown");
    if (GATE[a.type] && !on(s, GATE[a.type])) return no(`Unlocks in chapter ${CH_IDX[GATE[a.type]] + 1}`, "c.locked", { n: CH_IDX[GATE[a.type]] + 1 });
    const r = a.rack != null ? rackById(s, a.rack) : null;
    if (RACK_ACTIONS.has(a.type) && !r) return no("No such rack", "c.noRack");
    switch (a.type) {
      case "buy": case "lease": {
        const it = s.items[a.item];
        if (!it || !isAvail(s, it)) return no("Not on sale", "c.notSale");
        if (a.type === "lease" && it.role !== "gpu") return no("Only GPUs can be leased", "c.leaseGpu");
        if (exportBlocked(s, it)) return no(`Export quota used (${K.EXPORT_QUOTA}/quarter)`, "c.quota", { n: K.EXPORT_QUOTA });
        if (a.type === "buy" && s.cash < it.price) return needs(it.price);
        const f = fits(s, r, it); if (f) return no(f);
        const days = shipDays(s, it) + K.INSTALL_DAYS;
        return a.type === "buy" ? yes(`$${it.price}k, online in ${days} days`, "c.buy", { x: it.price, d: days })
          : yes(`Lease $${round2(it.price * K.LEASE_RATE)}k/day, online in ${days} days`, "c.lease", { x: round2(it.price * K.LEASE_RATE), d: days });
      }
      case "cancelOrder": {   // coyote time: undo a purchase while it is still on the truck
        const j = orderJob(s, a.uid);
        if (!j) return no("No such order", "c.noOrder");
        if (j.phase !== "ship") return no("Already shipped: sell it instead", "c.shipped");
        return j.kind === "buy" ? yes(`Order cancelled: $${round2(j.paid)}k refunded`, "c.orderCancel", { x: round2(j.paid) }) : yes("Lease cancelled", "c.leaseCancel");
      }
      case "move": {
        const i = findDev(r, a.uid); if (i < 0) return no("Not in that rack", "c.notIn");
        if (a.to === a.rack) return no("Already here", "c.here");
        const to = rackById(s, a.to); if (!to) return no("No such rack", "c.noRack");
        if (hasJob(s, a.uid)) return no("A job is pending on it", "c.busy");
        const f = fits(s, to, itemOf(s, r.devices[i])); if (f) return no(f);
        return yes(`Move, ${K.MOVE_DAYS} day`, "c.move", { d: K.MOVE_DAYS });
      }
      case "sell": {
        const i = findDev(r, a.uid); if (i < 0) return no("Not in that rack", "c.notIn");
        if (r.devices[i].leased) return no("Leased: return it instead", "c.leasedSell");
        if (hasJob(s, a.uid)) return no("A job is pending on it", "c.busy");
        return yes(`Sell for $${Math.round(resale(s, r.devices[i]))}k`, "c.sell", { x: Math.round(resale(s, r.devices[i])) });
      }
      case "mode": {
        if (!MODES[a.mode]) return no("Bad mode", "c.bad");
        const k = devKw(s, { mode: a.mode }, r.devices.concat(r.pending));
        if (k > K.RACK_KW + 1e-9) return no(`Rack would draw ${k.toFixed(1)} kW (limit ${K.RACK_KW})`, "c.rackDraw", { kw: k.toFixed(1), max: K.RACK_KW });
        if (gridKwAll(s) - rackKwAll(s, r) + k > s.gridKw + 1e-9) return no(`Grid limit ${s.gridKw} kW`, "c.grid", { kw: s.gridKw });
        return yes(MODES[a.mode].label, "mode." + a.mode);
      }
      case "workload": return WORKLOADS.includes(a.workload) ? yes(a.workload, "wl." + a.workload) : no("Bad workload", "c.bad");
      case "tank": {
        if (r.tank) return no("Already a tank", "c.already");
        if (r.devices.length || r.pending.length) return no("Empty the rack first", "c.emptyFirst");
        if (s.jobs.some(j => j.kind === "tank" && j.rack === r.id)) return no("Already converting", "c.underway");
        if (s.cash < K.TANK_COST) return needs(K.TANK_COST);
        return yes(`Convert to immersion tank, $${K.TANK_COST}k, ${K.TANK_DAYS} days`, "c.tank", { x: K.TANK_COST, d: K.TANK_DAYS });
      }
      case "grid": {
        const g = gridNext(s);
        if (!g) return s.gridTier >= 3 ? no("Grid fully upgraded", "c.gridMax") : no("Next upgrade unlocks in chapter 11", "c.locked", { n: 11 });
        if (s.jobs.some(j => j.kind === "grid")) return no("Upgrade under way", "c.underway");
        if (g.kw === K.GRID_KW_UP3 && !hall3Started(s)) return no("Needs Hall 3 (built or under construction)", "c.needHall3");
        if (s.cash < g.cost) return needs(g.cost);
        return yes(`Grid to ${g.kw} kW, $${g.cost}k, ${g.days} days`, "c.gridUp", { kw: g.kw, x: g.cost, d: g.days });
      }
      // ---- ch6 operations
      case "hire":
        if (s.techs + s.hires.length >= K.TECH_MAX) return no(`At most ${K.TECH_MAX} technicians`, "c.techMax", { n: K.TECH_MAX });
        return yes(`Hire: arrives in ${K.HIRE_DAYS} days, $${K.SALARY}k/day`, "c.hire", { d: K.HIRE_DAYS, x: K.SALARY });
      case "fire":
        if (s.techs <= K.TECH_MIN) return no("Keep at least one technician", "c.techMin");
        return yes(`Fire: severance $${round2(K.FIRE_PAY_DAYS * K.SALARY)}k`, "c.fire", { x: round2(K.FIRE_PAY_DAYS * K.SALARY) });
      case "repairPolicy": return a.on ? yes("Auto-repair on", "c.autoRepOn") : yes("Auto-repair off", "c.autoRepOff");
      case "repair": {
        const f = findAnywhere(s, a.uid);
        if (!f || f.where === "pending") return no("No such part", "c.gone");
        if (!f.d.failed) return no("Not broken", "c.notBroken");
        if (hasJob(s, a.uid)) return no("Already queued", "c.underway");
        if (f.r && a.useSpare !== false && spareFor(s, f.d)) return yes(`Swap in a spare, ${K.SWAP_DAYS} day`, "c.swap", { d: K.SWAP_DAYS });
        const c = repairCost(s, f.d);
        if (s.cash < c) return needs(c);
        return yes(`Repair $${c}k: parts ${repairParts(s, f.d)} days + ${K.REPAIR_DAYS} day`, "c.repair", { x: c, d: repairParts(s, f.d) + K.REPAIR_DAYS });
      }
      case "store": {
        const i = findDev(r, a.uid); if (i < 0) return no("Not in that rack", "c.notIn");
        if (r.devices[i].leased) return no("Leased cards can't be shelved", "c.leasedShelf");
        if (hasJob(s, a.uid)) return no("A job is pending on it", "c.busy");
        if (shelfLoad(s) >= K.SHELF) return no(`Shelf full (${K.SHELF})`, "c.shelfFull", { n: K.SHELF });
        return yes(`To the shelf, ${K.MOVE_DAYS} day`, "c.store", { d: K.MOVE_DAYS });
      }
      case "unstore": {
        const d = s.shelf.find(x => x.uid === a.uid); if (!d) return no("Not on the shelf", "c.gone");
        if (d.failed) return no("Repair it first", "c.repairFirst");
        const f = fits(s, r, itemOf(s, d)); if (f) return no(f);
        return yes(`Install from shelf, ${K.INSTALL_DAYS} days`, "c.unstore", { d: K.INSTALL_DAYS });
      }
      // ---- ch7 fabric
      case "spine": {
        const h = hallOf(s, a.hall);
        if (!h || !h.built) return no("No such hall", "c.noHall");
        if (!(a.row >= 0 && a.row < K.ROWS)) return no("No such row", "c.bad");
        const key = `${a.hall}-${a.row}`;
        if (s.spines[key] || s.jobs.some(j => j.kind === "spine" && j.key === key)) return no("Row already has a spine", "c.already");
        if (s.cash < K.SPINE_COST) return needs(K.SPINE_COST);
        if (gridKwAll(s) + K.SPINE_KW > s.gridKw + 1e-9) return no(`Grid limit ${s.gridKw} kW`, "c.grid", { kw: s.gridKw });
        return yes(`Row spine $${K.SPINE_COST}k, ${K.SPINE_DAYS} days, ${K.SPINE_KW} kW`, "c.spine", { x: K.SPINE_COST, d: K.SPINE_DAYS, kw: K.SPINE_KW });
      }
      case "transit": {
        const dlt = Math.round(a.delta || 0);
        if (!dlt) return no("No change", "c.bad");
        const tgt = transitTarget(s) + dlt;
        if (tgt < 0) return no("Transit can't go below zero", "c.bad");
        if (tgt > K.TRANSIT_MAX) return no(`At most ${K.TRANSIT_MAX} units`, "c.maxUnits", { n: K.TRANSIT_MAX });
        return yes(`Transit ${tgt} units ($${round2(tgt * K.TRANSIT_COST)}k/day) in ${K.TRANSIT_DAYS} days`, "c.transit", { n: tgt, x: round2(tgt * K.TRANSIT_COST), d: K.TRANSIT_DAYS });
      }
      // ---- ch8 contracts
      case "signContract": {
        if (!core(s)) return no("Contracts are switched off in this game", "c.noContracts");
        const o = s.offers.find(x => x.id === a.id); if (!o) return no("Offer gone", "c.gone");
        if (o.foreign && s.policyFx.exportCtl) return no("Customer barred by export controls", "c.barred");
        if (o.bts && s.cash < o.fitout) return no(`Fit-out needs $${o.fitout}k`, "c.fitoutCash", { x: o.fitout });
        return o.bts ? yes(`Build-to-suit: $${o.fitout}k fit-out now, ${o.units} ${o.w} units from day ${Math.round(s.day + o.lead)} for ${o.days} days at $${round2(o.price)}k`, "c.signBts", { x: o.fitout, u: o.units, d: o.days })
          : isJob(o) ? yes(`Sign: ${o.work} unit-days of ${o.kind === "frontier" ? "frontier " : ""}training by day ${Math.round(s.day + o.days)}, $${Math.round(o.pay)}k on completion`, "c.signJob", { w: o.work, d: o.days, x: Math.round(o.pay) })
          : yes(`Sign: ${o.units} ${o.w} units a day for ${o.days} days from day ${Math.round(s.day + (o.lead || 0))} at $${round2(o.price)}k`, "c.signServe", { u: o.units, d: o.days });
      }
      case "declineContract": return s.offers.some(x => x.id === a.id) ? yes("Decline", "c.decline") : no("Offer gone", "c.gone");
      case "reorder": {   // cosmetic: a device's slot in the rack elevation (no rule depends on it)
        const i = findDev(r, a.uid); if (i < 0) return no("Not in that rack", "c.notIn");
        if (!Number.isFinite(+a.index)) return no("Bad position", "c.bad");
        return yes("Moved in the rack", "c.reorder");
      }
      case "cancelJob": return cancelJobCheck(s, a);
      case "policy": return policyCheck(s, a);
      case "undoSell": case "buyBack": {
        const x = (s.recentlySold || []).find(y => y.uid === a.uid);
        if (!x) return no("Not recently sold", "c.gone");
        if (s.cash < x.value) return needs(round2(x.value));
        const dest = undoSellDest(s, x, a.rack);
        if (!dest.ok) return no(dest.msg, dest.k, dest.p);
        return yes(`Buy it back for $${round2(x.value)}k (${dest.rack ? "install in " + dest.rack : "to the shelf"})`, dest.rack ? "c.buyBackRack" : "c.buyBackShelf", { x: round2(x.value), r: dest.rack });
      }
      // ---- ch9 memory
      case "forward": {
        const it = s.items[a.item];
        if (!it || !isAvail(s, it) || it.role !== "gpu") return no("Only GPUs on sale can be ordered forward", "c.fwdGpu");
        if (exportBlocked(s, it)) return no(`Export quota used (${K.EXPORT_QUOTA}/quarter)`, "c.quota", { n: K.EXPORT_QUOTA });
        if (s.cash < it.price) return needs(it.price);
        if (shelfLoad(s) >= K.SHELF) return no(`Shelf full (${K.SHELF})`, "c.shelfFull", { n: K.SHELF });
        return yes(`$${it.price}k now, to the shelf in ${K.FORWARD_DAYS} days`, "c.forward", { x: it.price, d: K.FORWARD_DAYS });
      }
      // ---- ch10 finance
      case "borrow": {
        const amt = a.amount || K.LOAN_STEP;
        if (amt <= 0 || amt % K.LOAN_STEP) return no(`Borrow in $${K.LOAN_STEP}k steps`, "c.bad");
        const lim = Math.max(0, K.LOAN_LTV * netWorth(s));
        if (s.debt + amt > lim + 1e-9) return no(`Credit line $${Math.round(lim)}k (40 % of net worth)`, "c.creditLine", { x: Math.round(lim) });
        return yes(`Borrow $${amt}k at ${K.INTEREST * 100} %/yr`, "c.borrow", { x: amt, r: K.INTEREST * 100 });
      }
      case "repay": {
        const amt = a.amount || K.LOAN_STEP;
        if (s.debt <= 0) return no("No debt", "c.noDebt");
        if (amt <= 0) return no("Bad amount", "c.bad");
        if (s.cash < Math.min(amt, s.debt)) return no("Not enough cash", "c.cash");
        return yes(`Repay $${Math.min(amt, s.debt)}k`, "c.repay", { x: Math.min(amt, s.debt) });
      }
      case "returnLease": {
        const i = findDev(r, a.uid); if (i < 0) return no("Not in that rack", "c.notIn");
        if (!r.devices[i].leased) return no("Not leased", "c.bad");
        if (hasJob(s, a.uid)) return no("A job is pending on it", "c.busy");
        return yes(`Return, ${K.SELL_DAYS} day`, "c.return", { d: K.SELL_DAYS });
      }
      // ---- ch11 facilities
      case "buildHall": {
        if (s.jobs.some(j => j.kind === "buildHall")) return no("A hall is already under construction", "c.underway");
        const n = a.hall != null ? a.hall : nextHall(s);
        if (n == null) return no("All halls built", "c.already");
        const h = hallOf(s, n);
        if (!h || n < 2) return no("No such hall", "c.noHall");
        if (h.built) return no(`Hall ${n} already built`, "c.already");
        if (!hallOf(s, n - 1).built) return no(`Build Hall ${n - 1} first`, "c.hallFirst", { n: n - 1 });
        const hc = hallCost(n);
        if (s.cash < hc.cost) return needs(hc.cost);
        return yes(`Hall ${n}: $${hc.cost}k, ${hc.days} days`, "c.hall", { n, x: hc.cost, d: hc.days });
      }
      case "ups":
        if (s.ups || s.jobs.some(j => j.kind === "ups")) return no("Already have backup", "c.already");
        if (s.cash < K.UPS_COST) return needs(K.UPS_COST);
        return yes(`UPS + generator: $${K.UPS_COST}k, ${K.UPS_DAYS} days`, "c.ups", { x: K.UPS_COST, d: K.UPS_DAYS });
      case "crac": {
        const h = hallOf(s, a.hall);
        if (!h || !h.built) return no("No such hall", "c.noHall");
        if (h.crac || s.jobs.some(j => j.kind === "crac" && j.hall === a.hall)) return no("Already upgraded", "c.already");
        if (s.cash < K.CRAC_COST) return needs(K.CRAC_COST);
        return yes(`CRAC +${K.CRAC_KW} kW: $${K.CRAC_COST}k, ${K.CRAC_DAYS} days`, "c.crac", { kw: K.CRAC_KW, x: K.CRAC_COST, d: K.CRAC_DAYS });
      }
      // ---- ch12 energy
      case "ppa": {
        if (s.ppa && s.day < s.ppa.end) return no("A PPA is running", "c.already");
        if (!(a.kw > 0) || a.kw % K.PPA_STEP || a.kw > K.PPA_MAX) return no(`PPA in ${K.PPA_STEP} kW steps up to ${K.PPA_MAX}`, "c.bad");
        const q = ppaQuote(s);
        return yes(`PPA ${a.kw} kW at $${q}k/kW-day for ${K.PPA_DAYS} days ($${round2(a.kw * q)}k/day)`, "c.ppa", { kw: a.kw, d: K.PPA_DAYS, x: round2(a.kw * q) });
      }
      case "solar":
        if (s.solar || s.jobs.some(j => j.kind === "solar")) return no("Already have solar", "c.already");
        if (s.cash < K.SOLAR_COST) return needs(K.SOLAR_COST);
        return yes(`Solar + battery: $${K.SOLAR_COST}k, ${K.SOLAR_DAYS} days`, "c.solar", { x: K.SOLAR_COST, d: K.SOLAR_DAYS });
      // ---- ch13 environment
      case "cooling": {
        const h = hallOf(s, a.hall);
        if (!h || !h.built) return no("No such hall", "c.noHall");
        if (!K.PUE[a.mode]) return no("Bad mode", "c.bad");
        if (h.cooling === a.mode) return no("Already", "c.already");
        if (s.jobs.some(j => j.kind === "cooling" && j.hall === a.hall)) return no("Changeover under way", "c.underway");
        if (s.cash < K.COOL_SWITCH_COST) return needs(K.COOL_SWITCH_COST);
        return yes(`Switch to ${a.mode}: $${K.COOL_SWITCH_COST}k, ${K.COOL_SWITCH_DAYS} days`, "c.cooling", { m: "@cool." + a.mode, x: K.COOL_SWITCH_COST, d: K.COOL_SWITCH_DAYS });
      }
      // ---- ch14 investors
      case "acceptRound": case "declineRound": {
        const o = s.roundOffer;
        if (!o || o.id !== a.id) return no("Offer gone", "c.gone");
        return a.type === "acceptRound" ? yes(`Take $${Math.round(o.amount)}k for ${Math.round(o.pct * 100)} %`, "c.take", { x: Math.round(o.amount), p: Math.round(o.pct * 100) }) : yes("Decline", "c.decline");
      }
      case "buyback": {
        if (s.equity.own >= 1 - 1e-9) return no("You own everything", "c.already");
        const c = roundCost(s);
        if (s.cash < c) return needs(Math.round(c));
        return yes(`Buy back 1 % for $${Math.round(c)}k`, "c.buyback", { x: Math.round(c) });
      }
      // ---- ch15 reputation
      case "pr":
        if (s.cash < K.PR_COST) return needs(K.PR_COST);
        return yes(`PR campaign: $${K.PR_COST}k, +${K.PR_GAIN} reputation fading over ${K.PR_DECAY} days`, "c.pr", { x: K.PR_COST, n: K.PR_GAIN, d: K.PR_DECAY });
      // ---- ch16 policy
      case "lobby": {
        const p = policyById(s, a.policy);
        if (!p || !p.announced) return no("No such proposal", "c.gone");
        if (p.status !== "proposed") return no("Already voted", "c.voted");
        if (p.lobbied) return no("Already lobbied", "c.already");
        if (a.dir !== 1 && a.dir !== -1) return no("Pick a direction", "c.bad");
        if (s.cash < K.LOBBY_COST) return needs(K.LOBBY_COST);
        return yes(`Lobby ${a.dir > 0 ? "for" : "against"}: $${K.LOBBY_COST}k`, a.dir > 0 ? "c.lobbyFor" : "c.lobbyAgainst", { x: K.LOBBY_COST });
      }
    }
    return no("Unknown action", "c.unknown");
  }
  const transitTarget = s => s.transit + s.transitOrders.reduce((a, o) => a + o.delta, 0);
  function spareFor(s, d) { return s.shelf.find(x => x.type === d.type && !x.failed && !x.leased) || null; }
  const repairParts = (s, d) => K.REPAIR_PARTS_DAYS * (shipDays(s, itemOf(s, d)) > K.SHIP_DAYS ? 3 : 1);

  /* sign an offer on the board: it becomes a contract (a build-to-suit pays its fit-out now) */
  function signOffer(s, o) {
    s.offers.splice(s.offers.indexOf(o), 1);
    const start = s.day + (o.lead || 0);
    if (o.bts && o.fitout > 0) spend(s, o.fitout, "capex");
    const c = Object.assign(o, { signed: s.day, start, delivered: 0, missed: 0, penaltyPaid: 0, missDays: 0, streak: 0 });
    if (isJob(c)) Object.assign(c, { done: 0, deadline: s.day + o.days, end: s.day + o.days + o.lateMax });
    else c.end = start + o.days;
    s.contracts.push(c);
    s.contractLog.signed++;
    return c;
  }
  /* ================= v4 automation policies ================= */
  const POLICY_KEYS = new Set(["autoSwap", "keepSpares", "autoRenew"]);
  function policyCheck(s, a) {
    if (!POLICY_KEYS.has(a.key)) return no("Unknown policy", "c.unknown");
    if (a.key !== "autoRenew" && !on(s, "ops")) return no(`Unlocks in chapter ${CH_IDX.ops + 1}`, "c.locked", { n: CH_IDX.ops + 1 });
    if (a.key === "autoRenew" && !core(s)) return no("Contracts are switched off in this game", "c.noContracts");
    if (a.key === "keepSpares") {
      const it = s.items[a.item];
      if (!it || it.role === "exotic" || it.key === "pm9") return no("Pick a card or part", "c.bad");
      const n = Math.round(+a.n);
      if (!(n >= 0 && n <= K.SHELF)) return no(`0 to ${K.SHELF} spares`, "c.bad");
      return n ? yes(`Keep ${n} ${it.name} on the shelf (auto-order at list price)`, "c.keep", { n, it: "@it." + a.item }) : yes(`Stop keeping ${it.name} spares`, "c.keepOff", { it: "@it." + a.item });
    }
    return yes(`${a.key === "autoSwap" ? "Auto-swap spares" : "Auto-renew contracts"} ${a.on ? "on" : "off"}`, (a.key === "autoSwap" ? "pol.autoSwap" : "board.autoRenew"));
  }
  function policyApply(s, a) {
    if (a.key === "keepSpares") { const n = Math.round(+a.n); if (n > 0) s.policy.keepSpares[a.item] = n; else delete s.policy.keepSpares[a.item]; }
    else s.policy[a.key] = !!a.on;
  }
  /* keepSpares: order spares at list price and normal shipping, straight to the shelf, while below the target */
  function restock(s) {
    for (const [k, n] of Object.entries(s.policy.keepSpares)) {
      const it = s.items[k];
      if (!it || !isAvail(s, it)) continue;
      let have = s.shelf.filter(d => d.type === k && !d.failed && !d.leased).length + s.jobs.filter(j => j.kind === "restock" && j.dev.type === k).length;
      while (have < n && shelfLoad(s) < K.SHELF && s.cash >= it.price && !exportBlocked(s, it)) {
        const d = dev(s, k), days = shipDays(s, it), job = { id: s.nextId++, kind: "restock", rack: null, dev: d, phase: "contract", left: days, total: days, toShelf: true };
        const dep0 = s.deprec.length;
        spend(s, it.price, "capex");
        Object.assign(job, { paid: it.price, day0: s.day, capex: true });
        s.deprec[dep0].job = job.id;
        if (s.policyFx.exportCtl && it.role === "gpu" && it.gen === currentGen(s)) { s.exportUsed++; job.exportQ = Math.floor(s.day / 90); }
        if (it.role === "gpu") { s.prog.gpuOrders++; job.gpu = true; }
        s.jobs.push(job); have++;
        logCash(s, -it.price, "restock", `Auto-ordered a spare ${it.name}`, { it: "@it." + k });
        log(s, `restock ${k} (${have}/${n})`);
      }
    }
  }
  /* autoSwap (without auto-repair): a failed part with a matching spare on the shelf is swapped by a technician */
  function autoSwapSweep(s) {
    for (const r of s.racks) for (const d of r.devices) if (d.failed && !hasJob(s, d.uid) && spareFor(s, d)) queueRepair(s, d.uid, true);
  }
  /* ================= v4 forgiveness: cancel a queued job, undo a sale (docs/GAME_FEEL.md "coyote time") ================= */
  /* undo a purchase or lease while it is still on the truck: exact refund, books restored */
  function cancelOrderJob(s, j) {
    const uid = j.dev.uid, u = j.undo || { day: s.day, paid: j.paid || 0 }, to = rackById(s, j.to);
    s.jobs.splice(s.jobs.indexOf(j), 1);
    const pi = to.pending.findIndex(d => d.uid === uid); if (pi >= 0) to.pending.splice(pi, 1);
    if (u.paid) {
      s.cash += u.paid; s.totals.capex -= u.paid;
      const di = s.deprec.findIndex(x => x.uid === uid);
      if (di >= 0) {   // drop the depreciation entry and what it already accrued this quarter
        if (Math.floor(u.day / 90) === Math.floor(s.day / 90)) s.fin.dep -= s.deprec[di].rate * (s.day - u.day);
        s.deprec.splice(di, 1);
      }
    }
    if (u.exportQ != null && u.exportQ === Math.floor(s.day / 90)) s.exportUsed = Math.max(0, s.exportUsed - 1);
    if (u.gpu) s.prog.gpuOrders = Math.max(0, s.prog.gpuOrders - 1);
    if (u.loss) {
      s.losses.shortage = Math.max(0, s.losses.shortage - u.loss);
      const p = periodOf(u.day); if (s.lossBy.shortage[p] != null) s.lossBy.shortage[p] = Math.max(0, s.lossBy.shortage[p] - u.loss);
    }
    log(s, `cancel order ${j.dev.type} uid=${uid} in ${j.to}, refund ${round2(u.paid)}`);
  }
  /* builds and forward orders refund a declining share: all of it in the first day (or before a technician starts),
     then pro rata to the time left, minus a CANCEL_FEE share */
  const CANCEL_BUILDS = new Set(["tank", "grid", "spine", "buildHall", "ups", "solar", "crac", "cooling", "forward", "restock"]);
  function buildRefund(s, j) {
    const paid = j.paid || 0;
    if (!paid) return 0;
    const fresh = j.phase === "wait" || s.day - (j.day0 != null ? j.day0 : s.day) < K.CANCEL_FREE_DAYS - 1e-9;
    const left = j.total > 0 ? clamp(j.left / j.total, 0, 1) : 1;
    return round2(fresh ? paid : paid * left * (1 - K.CANCEL_FEE));
  }
  /* reverse a queued job's spend in the books, then book the part that is not refunded as a fee (opex) */
  function refundPaid(s, j, back) {
    const paid = j.paid || 0, sameQ = Math.floor((j.day0 || 0) / 90) === Math.floor(s.day / 90);
    if (!paid) return;
    s.cash += paid;
    if (j.capex) {
      s.totals.capex -= paid;
      const di = s.deprec.findIndex(x => x.job === j.id);
      if (di >= 0) { if (sameQ) s.fin.dep -= s.deprec[di].rate * (s.day - j.day0); s.deprec.splice(di, 1); }
    } else {
      const o = j.opexPaid != null ? j.opexPaid : paid;
      s.totals.opex -= o; s.fin.opex -= o; s.dayAcc.profit += o;
      if (sameQ) s.ledger.other = Math.max(0, s.ledger.other - o);
    }
    const fee = round2(paid - back);
    if (fee > 0) spend(s, fee, "opex", "other");
  }
  /* can a device that left rack r (sell/store/returnLease) or is on its way elsewhere (move) go back into r? */
  function fitsBack(s, r, d, counted) {
    const it = itemOf(s, d);
    if (!r || (it.tank && !r.tank) || (r.tank && !it.tank && it.role !== "net")) return false;
    if (K.RACK_U - usedU(s, r) < it.u) return false;
    const m = MODES[r.mode === "off" ? "std" : r.mode];
    if (rackKwAll(s, r) + it.kw * m.kw > K.RACK_KW + 1e-9) return false;
    return counted || gridKwAll(s) + it.kw * m.kw <= s.gridKw + 1e-9;
  }
  const shelfFree = (s, d) => on(s, "ops") && !d.leased && shelfLoad(s) < K.SHELF;
  /* where a cancelled job's device goes: its origin rack if it fits, else the spares shelf; null = nowhere */
  function backDest(s, j) {
    const counted = j.kind === "move";      // a moving device already counts toward the grid budget (target rack)
    if (fitsBack(s, rackById(s, j.rack), j.dev, counted)) return "rack";
    return shelfFree(s, j.dev) ? "shelf" : null;
  }
  function cancelJobCheck(s, a) {
    const j = s.jobs.find(x => x.id === a.id);
    if (!j) return no("No such job", "c.gone");
    const k = j.kind;
    if ((k === "buy" || k === "lease") && j.phase === "ship") return k === "buy" ? yes(`Order cancelled: $${round2(j.paid)}k refunded`, "c.orderCancel", { x: round2(j.paid) }) : yes("Lease cancelled", "c.leaseCancel");
    if (k === "buy" || k === "undoSell") {
      if (!on(s, "ops")) return no("Already delivered: sell it instead (the spares shelf opens in chapter 6)", "c.delivered");
      if (shelfLoad(s) >= K.SHELF) return no(`Already delivered and the shelf is full (${K.SHELF})`, "c.shelfFull", { n: K.SHELF });
      return yes("Already delivered: it goes to the spares shelf (no refund)", "c.toShelfNoRefund");
    }
    if (k === "lease") return yes("Lease handed back before install", "c.leaseCancel");
    if (k === "move" || k === "sell" || k === "store" || k === "returnLease") {
      const dest = backDest(s, j);
      if (!dest) return no("No room to put it back (rack full and no shelf space)", "c.noRoom");
      const where = dest === "rack" ? j.rack : "the shelf", p = { r: dest === "rack" ? j.rack : "@w.shelf" };
      return k === "sell" ? yes(`Keep it: sale cancelled, back to ${where}`, "c.keepIt", p) : yes(`Back to ${where}`, "c.backTo", p);
    }
    if (k === "unstore") return yes("Back to the shelf", "c.backTo", { r: "@w.shelf" });
    if (k === "swap") return yes("Spare goes back to the shelf", "c.backTo", { r: "@w.shelf" });
    if (k === "repair") return j.phase === "work" ? yes("Stop the repair (parts already used, no refund)", "c.stopRepair") : yes(`Cancel the repair: $${round2(j.cost || 0)}k refunded`, "c.refund", { x: round2(j.cost || 0) });
    if (CANCEL_BUILDS.has(k)) return yes(`Cancel: $${round2(buildRefund(s, j))}k of $${round2(j.paid || 0)}k back`, "c.cancelBuild", { x: round2(buildRefund(s, j)), of: round2(j.paid || 0) });
    return no("This job can't be cancelled", "c.bad");
  }
  function cancelJobApply(s, a) {
    const j = s.jobs.find(x => x.id === a.id), k = j.kind;
    if ((k === "buy" || k === "lease") && j.phase === "ship") { cancelOrderJob(s, j); return; }
    s.jobs.splice(s.jobs.indexOf(j), 1);                 // a technician on it is free from the next substep
    const unpend = () => { const r = rackById(s, j.to); const i = r ? r.pending.indexOf(j.dev) : -1; if (i >= 0) r.pending.splice(i, 1); };
    let what = "";
    if (k === "buy" || k === "undoSell") { unpend(); s.shelf.push(j.dev); what = "to shelf"; }
    else if (k === "lease") { unpend(); what = "lease returned"; }
    else if (k === "move" || k === "sell" || k === "store" || k === "returnLease") {
      const dest = backDest(s, j);
      if (k === "move") unpend();
      if (dest === "rack") { const r = rackById(s, j.rack); r.devices.splice(j.at != null ? Math.min(j.at, r.devices.length) : r.devices.length, 0, j.dev); }
      else s.shelf.push(j.dev);
      what = `back to ${dest === "rack" ? j.rack : "shelf"}`;
    } else if (k === "unstore") { unpend(); s.shelf.push(j.dev); what = "back to shelf"; }
    else if (k === "swap") { s.shelf.push(j.dev); what = "spare back to shelf"; }
    else if (k === "repair") {
      if (j.phase !== "work" && j.cost) {
        const c = j.cost, sameQ = Math.floor((j.day0 || 0) / 90) === Math.floor(s.day / 90);
        s.cash += c; s.totals.opex -= c; s.fin.opex -= c; s.dayAcc.profit += c;
        if (sameQ) s.ledger.repairs = Math.max(0, s.ledger.repairs - c);
        logCash(s, c, "refund", `Repair cancelled: $${round2(c)}k refunded`);
        what = `refund ${c}`;
      } else what = "stopped, no refund";
    } else if (CANCEL_BUILDS.has(k)) {
      const back = buildRefund(s, j);
      refundPaid(s, j, back);
      if (j.paid) logCash(s, back, "refund", `Cancelled ${k === "buildHall" ? "Hall " + j.hall : k}: $${round2(back)}k of $${round2(j.paid)}k back`);
      if (j.exportQ != null && j.exportQ === Math.floor(s.day / 90)) s.exportUsed = Math.max(0, s.exportUsed - 1);
      if (j.gpu) s.prog.gpuOrders = Math.max(0, s.prog.gpuOrders - 1);
      what = `refund ${back} of ${j.paid}`;
    }
    log(s, `cancel job ${j.id} ${k} (${what})`);
  }
  /* undo a sale within K.UNSELL_DAYS: pay back exactly what it sold for; it returns to a rack (installed by a
     technician) or to the spares shelf. Leased cards are returned, not sold, so they never appear here. */
  function undoSellDest(s, x, rackId) {
    const it = s.items[x.type];
    const tryRack = id => { const r = id != null ? rackById(s, id) : null; return r && !fits(s, r, it) ? id : null; };
    const rk = rackId != null ? tryRack(rackId) : tryRack(x.rack);
    if (rk) return { ok: true, rack: rk };
    if (on(s, "ops") && shelfLoad(s) < K.SHELF) return { ok: true, rack: null };
    const r = rackId != null ? rackById(s, rackId) : rackById(s, x.rack);
    return { ok: false, msg: r ? ((fits(s, r, it) || { msg: "No room" }).msg) + " (and no shelf space)" : "No room to put it", k: "c.noRoom" };
  }
  function undoSellApply(s, a) {
    const i = s.recentlySold.findIndex(y => y.uid === a.uid), x = s.recentlySold[i], dest = undoSellDest(s, x, a.rack);
    s.recentlySold.splice(i, 1);
    s.cash -= x.value; s.totals.resale -= x.value;
    logCash(s, -x.value, "unsell", `Bought back ${itemOf(s, x.dev).name} for $${round2(x.value)}k`, { it: "@it." + x.dev.type });
    if (dest.rack) {
      rackById(s, dest.rack).pending.push(x.dev);
      s.jobs.push({ id: s.nextId++, kind: "undoSell", rack: dest.rack, dev: x.dev, to: dest.rack, phase: "wait", left: K.INSTALL_DAYS, total: K.INSTALL_DAYS });
    } else s.shelf.push(x.dev);
    log(s, `undo sale ${x.type} uid=${x.uid} -> ${dest.rack || "shelf"} for ${round2(x.value)}`);
  }

  function apply(s, a) {
    const res = check(s, a);
    if (!res.ok) { log(s, `reject ${a && a.type}: ${res.msg}`); return res; }
    const r = a.rack != null ? rackById(s, a.rack) : null;
    const job = { id: s.nextId++, kind: a.type, rack: a.rack != null ? a.rack : null };
    const cash0 = s.cash, dep0 = s.deprec.length, opex0 = s.totals.opex;
    switch (a.type) {
      case "buy": case "lease": {
        const it = s.items[a.item], d = dev(s, a.item), days = shipDays(s, it);
        const undo = { day: s.day, paid: 0 };   // what cancelOrder needs to reverse the order exactly
        if (a.type === "buy") { spend(s, it.price, "capex"); undo.paid = it.price; s.deprec[s.deprec.length - 1].uid = d.uid; }
        else { d.leased = true; d.leaseRate = +(it.price * K.LEASE_RATE).toFixed(4); }
        if (s.policyFx.exportCtl && it.role === "gpu" && it.gen === currentGen(s)) { s.exportUsed++; undo.exportQ = Math.floor(s.day / 90); }
        if (it.role === "gpu") { s.prog.gpuOrders++; undo.gpu = true; }
        if (days > K.SHIP_DAYS) {   // measurable shortage cost: extra days x what the card would earn
          const mk = marketAt(s, s.day), w = it.role === "gpu" ? r.workload : it.only || "web";
          const v = it.role === "gpu" ? Math.min(it.F, it.B * INTENSITY[w]) : 1;
          const loss = (days - K.SHIP_DAYS) * v * (mk[w] ? mk[w].price : 0);
          addLoss(s, "shortage", loss);
          if (loss > 0) undo.loss = loss;
        }
        r.pending.push(d);
        Object.assign(job, { dev: d, to: a.rack, phase: "ship", left: days, total: days, work: K.INSTALL_DAYS, paid: undo.paid, undo });
        s.jobs.push(job); break;
      }
      case "cancelOrder": cancelOrderJob(s, orderJob(s, a.uid)); break;
      case "cancelJob": cancelJobApply(s, a); break;
      case "policy": policyApply(s, a); break;
      case "undoSell": case "buyBack": undoSellApply(s, a); break;
      case "reorder": {
        const i = findDev(r, a.uid), [d] = r.devices.splice(i, 1), to = clamp(Math.round(+a.index), 0, r.devices.length);
        r.devices.splice(to, 0, d);
        break;
      }
      case "move": {
        const at = findDev(r, a.uid), [d] = r.devices.splice(at, 1);
        job.at = at;
        rackById(s, a.to).pending.push(d);
        Object.assign(job, { dev: d, to: a.to, phase: "wait", left: K.MOVE_DAYS, total: K.MOVE_DAYS });
        s.jobs.push(job); break;
      }
      case "sell": {
        const at = findDev(r, a.uid), [d] = r.devices.splice(at, 1);
        Object.assign(job, { dev: d, phase: "wait", left: K.SELL_DAYS, total: K.SELL_DAYS, value: resale(s, d), at });
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
        const at = findDev(r, a.uid), [d] = r.devices.splice(at, 1);
        Object.assign(job, { dev: d, phase: "wait", left: K.MOVE_DAYS, total: K.MOVE_DAYS, toShelf: true, at });
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
      case "signContract": signOffer(s, s.offers.find(x => x.id === a.id)); break;
      case "declineContract": s.offers = s.offers.filter(x => x.id !== a.id); break;
      case "forward": {
        const it = s.items[a.item], d = dev(s, a.item);
        spend(s, it.price, "capex");
        if (s.policyFx.exportCtl && it.gen === currentGen(s)) { s.exportUsed++; job.exportQ = Math.floor(s.day / 90); }
        Object.assign(job, { dev: d, phase: "contract", left: K.FORWARD_DAYS, total: K.FORWARD_DAYS, toShelf: true });
        s.jobs.push(job); break;
      }
      case "borrow": { const amt = a.amount || K.LOAN_STEP; s.debt += amt; s.cash += amt; break; }
      case "repay": { const amt = Math.min(a.amount || K.LOAN_STEP, s.debt); s.debt -= amt; s.cash -= amt; break; }
      case "returnLease": {
        const at = findDev(r, a.uid), [d] = r.devices.splice(at, 1);
        job.at = at;
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
          pushNews(s, { title: "The board sets a revenue target", body: `$${Math.round(s.board.target)}k over the next ${K.BOARD_EVERY} days.`, tone: "info", cat: "investors", icon: "flag", ...kp("n.boardTarget", { x: Math.round(s.board.target), d: K.BOARD_EVERY }) });
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
          pushNews(s, { title: "PR campaign backfires", body: "Reporters call it spin in the middle of a scandal.", tone: "bad", cat: "press", icon: "news", ...kp("n.prBackfire") });
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
    // a queued build/order that cost money remembers what it paid, so cancelJob can refund it (and undo its books)
    if (s.jobs[s.jobs.length - 1] === job && job.paid == null && s.cash < cash0 - 1e-9) {
      job.paid = round2(cash0 - s.cash); job.day0 = s.day; job.capex = s.deprec.length > dep0;
      if (job.capex) s.deprec[dep0].job = job.id;
      else job.opexPaid = round2(s.totals.opex - opex0);
    }
    log(s, `${a.type} ${JSON.stringify(a)}`);
    return res;
  }

  /* repair or swap one failed part (uid) */
  function queueRepair(s, uid, useSpare) {
    const f = findAnywhere(s, uid);
    if (!f || !f.d.failed || f.where === "pending" || hasJob(s, uid)) return false;
    const spare = f.r && useSpare ? spareFor(s, f.d) : null;
    // (a repair job records its cost so cancelJob can refund it before the technician starts)
    if (spare) {
      s.shelf.splice(s.shelf.indexOf(spare), 1);
      s.jobs.push({ id: s.nextId++, kind: "swap", rack: f.r.id, uid, dev: spare, phase: "wait", left: K.SWAP_DAYS, total: K.SWAP_DAYS, toShelf: true });
      log(s, `swap spare ${spare.uid} for failed ${uid} in ${f.r.id}`);
      return true;
    }
    const c = repairCost(s, f.d);
    if (s.cash < c) return false;
    spend(s, c, "opex", "repairs");
    logCash(s, -c, "repair", `Repair: ${itemOf(s, f.d).name}${f.r ? " in " + f.r.id : " on the shelf"}`, { it: "@it." + f.d.type });
    const parts = repairParts(s, f.d);
    s.jobs.push({ id: s.nextId++, kind: "repair", rack: f.r ? f.r.id : null, uid, phase: "parts", left: parts, total: parts, work: K.REPAIR_DAYS, cost: c, day0: s.day });
    log(s, `repair ${f.d.type} ${uid} $${c}k`);
    return true;
  }
  function autoRepairSweep(s) {
    for (const r of s.racks) for (const d of r.devices) if (d.failed && !hasJob(s, d.uid)) queueRepair(s, d.uid, true);
    for (const d of s.shelf.slice()) if (d.failed && !hasJob(s, d.uid)) queueRepair(s, d.uid, false);
  }

  function finishJob(s, j) {
    const k = j.kind;
    if (k === "buy" || k === "lease" || k === "move" || k === "unstore" || k === "undoSell") {
      const r = rackById(s, j.to), i = r.pending.findIndex(d => d.uid === j.dev.uid);
      if (i >= 0) r.pending.splice(i, 1);
      if (k === "buy" || k === "lease") j.dev.inst = s.day;
      if (j.dev.inst == null) j.dev.inst = s.day;
      r.devices.push(j.dev);
    } else if (k === "sell") {
      s.cash += j.value; s.totals.resale += j.value; logCash(s, j.value, "sale", `Sold ${itemOf(s, j.dev).name}${j.rack ? " from " + j.rack : ""}`, { it: "@it." + j.dev.type });
      // coyote time: the buyer holds it for K.UNSELL_DAYS; undoSell returns it for exactly the sale price
      (s.recentlySold = s.recentlySold || []).push({ uid: j.dev.uid, type: j.dev.type, dev: j.dev, value: j.value, rack: j.rack, day: s.day, until: s.day + K.UNSELL_DAYS });
    }
    else if (k === "tank") rackById(s, j.rack).tank = true;
    else if (k === "grid") {
      s.gridTier++; s.gridUp = true; s.gridKw = j.kw || K.GRID_KW_UP;
      pushNews(s, { title: "Grid upgrade live", body: `${s.gridKw} kW available.`, tone: "good", icon: "bolt", cat: "facilities", ...kp("n.gridLive", { kw: s.gridKw }) });
    }
    else if (k === "store" || k === "forward" || k === "restock") s.shelf.push(j.dev);
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
      pushNews(s, { title: `Hall ${n} is open`, body: "18 more racks. Same grid.", tone: "good", cat: "facilities", ...kp("n.hallOpen", { n }) });
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
      if (r.mode === "off") continue;               // parked hardware is powered down: it does not wear or fail
      const inlet = st.perRack[r.id].inlet;
      for (const d of r.devices) {
        if (d.failed) continue;
        const it = itemOf(s, d);
        if (isDead(s, it)) continue;
        if (nextRand(s, "rngF") < hazard(s, d, it, inlet) * K.DT) {
          d.failed = true; d.failDay = s.day;
          log(s, `failure ${it.name} uid=${d.uid} in ${r.id} inlet=${inlet.toFixed(1)}`);
          if (it.role === "gpu" || it.role === "exotic" || it.role === "net")
            pushNews(s, { title: `${it.name} failed in ${r.id}`, body: s.repairAuto ? "Repair queued." : "Auto-repair is off.", tone: "bad", cat: "ops", icon: "wrench", ...kp(s.repairAuto ? "n.failed" : "n.failedManual", { it: "@it." + d.type, r: r.id }) });
          if (s.repairAuto) queueRepair(s, d.uid, true);
          else if (s.policy && s.policy.autoSwap && spareFor(s, d)) queueRepair(s, d.uid, true);
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
  /* ================= v4 order board ================= */
  /* what the player can deliver per workload today: installed output (parked racks count as if on) plus hardware
     that is on its way. Offers scale with this (designer: offers must not outrun the player). */
  function capacity(s, st) { return capacityAt(s, Infinity, st); }
  /* days until a pending device is installed and producing (shipping + install; a queued install counts its work) */
  function pendingEta(s, d) {
    const j = s.jobs.find(x => x.dev && x.dev.uid === d.uid && x.to != null);
    if (!j) return K.INSTALL_DAYS;
    return j.phase === "ship" ? j.left + (j.work != null ? j.work : K.INSTALL_DAYS) : j.left;
  }
  /* capacity on `day`: installed output plus the pending hardware that is installed by then (v0.4.2: the board judges an
     offer by the capacity you will have when it STARTS, not by hardware that arrives too late or never) */
  function capacityAt(s, day, st) {
    st = st || stats(s);
    const cap = { web: 0, train: 0, infer: 0, frontier: st.frontierElig }, dt = day - s.day;
    for (const r of s.racks) {
      const pr = st.perRack[r.id];
      for (const w of ["web", "train", "infer"]) cap[w] += r.mode === "off" ? pr.raw[w] * pr.netF : (pr.outPre || pr.out)[w];   // a blackout is not lost capacity
      for (const d of r.pending) {
        if (dt !== Infinity && pendingEta(s, d) > dt + 1e-9) continue;
        const it = itemOf(s, d);
        if (it.role === "cpu") cap.web += 1;
        else if (it.role === "gpu") cap[r.workload] += Math.min(it.F, it.B * INTENSITY[r.workload]);
      }
    }
    return cap;
  }
  const marketOf = c => c.kind === "frontier" ? "frontier" : c.w;
  /* every signed commitment in market m as a window [a, b) at u units a day: serving = [start, end) at its units (a
     signed-but-not-started contract counts from its start); job = from today to its deadline at the rate it still needs */
  function commitments(s, m) {
    const out = [];
    for (const c of s.contracts) {
      if (c.phantom || marketOf(c) !== m) continue;
      if (isJob(c)) {
        if (c.done >= c.work - 1e-9) continue;
        out.push({ id: c.id, a: Math.max(s.day, c.start || 0), b: c.deadline > s.day + 1e-9 ? c.deadline : c.end, u: jobNeed(c, s.day) });
      } else if (c.end > s.day) out.push({ id: c.id, a: c.start, b: c.end, u: c.units });
    }
    return out;
  }
  /* the most units a day market m is committed to at any time in [from, to) (active + signed-future contracts) */
  function commitmentPeak(s, m, from, to) {
    const L = commitments(s, m).filter(x => x.b > from + 1e-9 && x.a < to - 1e-9);
    let peak = 0;
    for (const t of [from, ...L.map(x => x.a).filter(t => t > from)]) {
      let u = 0;
      for (const x of L) if (x.a <= t + 1e-9 && x.b > t + 1e-9) u += x.u;
      if (u > peak) peak = u;
    }
    return peak;
  }
  /* can you deliver offer o? capacity at its start (installs finished by then) minus the peak of everything already
     committed over its window. over = signing it would overbook you */
  function deliverable(s, o, st) {
    st = st || stats(s);
    const m = marketOf(o), job = isJob(o);
    const start = s.day + (job ? 0 : (o.lead || 0)), end = start + Math.max(1, o.days || 1);
    const need = Math.max(1e-9, +o.units || (job ? o.work / o.days : 0));
    const cap = capacityAt(s, start, st)[m] || 0, peak = commitmentPeak(s, m, start, end);
    const free = Math.max(0, cap - peak);
    return { market: m, need, cap, peak, free, start, end, frac: free / need, load: (peak + need) / Math.max(1e-9, cap), over: peak + need > cap + 1e-6 };
  }
  /* commitments vs capacity per serving market over the next `horizon` days: the worst shortfall and when it starts
     (checked at today, every contract start and every pending install); short > 0 = you are overbooked */
  function overbook(s, st, horizon) {
    st = st || stats(s);
    horizon = horizon || 90;
    const res = {}, to = s.day + horizon;
    const etas = [];
    for (const r of s.racks) for (const d of r.pending) etas.push(s.day + pendingEta(s, d));
    for (const m of ["web", "train", "infer"]) {
      const L = commitments(s, m);
      const pts = [s.day, ...L.map(x => x.a), ...etas].filter(t => t >= s.day - 1e-9 && t < to);
      let worst = { short: 0, at: null, cap: 0, owe: 0 };
      for (const t of pts) {
        let owe = 0;
        for (const x of L) if (x.a <= t + 1e-9 && x.b > t + 1e-9) owe += x.u;
        if (owe <= 0) continue;
        const cap = capacityAt(s, t, st)[m], short = owe - cap;
        if (short > worst.short + 1e-9) worst = { short, at: t, cap, owe };
      }
      res[m] = worst;
    }
    return res;
  }
  /* the cheapest capacity on sale for a workload: $ per unit a day, including a share of a switch */
  function bestCard(s, w) {
    if (w === "web") return { k: "cpu", u: 1, price: s.items.cpu.price, per: s.items.cpu.price + s.items.sw.price / 16 };
    let best = null;
    for (const k of shopItems(s)) {
      const it = s.items[k];
      if (it.role !== "gpu") continue;
      const u = Math.min(it.F, it.B * INTENSITY[w]), per = (it.price + s.items.sw.price / 4) / u;
      if (!best || per < best.per) best = { k, u, price: it.price, per };
    }
    return best;
  }
  /* how many cards of `key` would still fit on the floor for workload w (rack U and kW, the grid, one switch slot
     per rack that has none; racks already running GPUs on another workload are skipped) */
  function roomFor(s, key, w) {
    const it = s.items[key];
    if (!it) return 0;
    let n = 0, grid = s.gridKw - gridKwAll(s);
    for (const r of s.racks) {
      if (!!r.tank !== !!it.tank) continue;
      const all = r.devices.concat(r.pending);
      if (it.role === "gpu" && r.workload !== w && all.some(d => itemOf(s, d).role === "gpu")) continue;
      const m = MODES[r.mode === "off" ? "std" : r.mode], kw = it.kw * m.kw;
      const sw = all.some(d => itemOf(s, d).role === "net") ? 0 : 1;
      let k = Math.min(Math.floor((K.RACK_U - usedU(s, r) - sw) / it.u), Math.floor((K.RACK_KW - rackKwAll(s, r) - sw * 0.4) / kw));
      k = Math.max(0, Math.min(k, Math.floor(grid / kw)));
      grid -= k * kw; n += k;
    }
    return n;
  }
  /* units already promised per market (serving units, jobs at their nominal rate); build-to-suit is extra demand */
  function held(s) {
    const h = { web: 0, train: 0, infer: 0, frontier: 0 };
    for (const c of s.contracts) {
      if (c.bts || c.phantom) continue;
      if (c.kind === "frontier") h.frontier += c.work / c.days;
      else if (c.kind === "train") h.train += c.work / c.days;
      else h[c.w] += c.units;
    }
    return h;
  }
  const pickOf = (s, a) => a[Math.floor(nextRand(s) * a.length)];
  function customer(s) {
    let cust = pickOf(s, C.CUSTOMERS);
    if (s.policyFx.exportCtl && cust.foreign) cust = C.CUSTOMERS[0];
    return cust;
  }
  /* units the player owes per market today (everything signed, build-to-suit included; jobs at their nominal rate) */
  function owedNow(s) {
    const o = { web: 0, train: 0, infer: 0, frontier: 0 };
    for (const c of s.contracts) o[c.kind === "frontier" ? "frontier" : c.w] += isJob(c) ? c.work / c.days : c.units;
    return o;
  }
  /* one offer on the board. kind: web | infer | train | frontier (uniform among the kinds the player has unlocked, can
     plausibly serve, and whose market still has open demand). Size = 0.3-1.2x what the player can DELIVER: free capacity
     (capacity, incl. hardware on its way, minus what is owed) plus what half the cash on hand can buy; a quarter of
     the time a "stretch" of 1.2-1.6x that; always capped by the market's open demand */
  /* web price elasticity (D61): the factor on the index for the NEXT web contract when you already hold h units a day */
  const webPriceAt = h => Math.max(K.WEB_FLOOR, Math.min(1, Math.pow(K.WEB_DREF / Math.max(1e-9, h), K.WEB_EPS)));
  const webPriceF = (s, extra) => webPriceAt(held(s).web + (extra || 0));
  /* after the GPU chapter, a player with no GPU hardware and no GPU work always has one starter GPU offer on the board */
  function needsStarter(s) {
    if (!core(s) || !on(s, "gpu")) return false;
    if (s.offers.some(o => !o.bts && (o.w === "train" || o.w === "infer"))) return false;
    if (s.contracts.some(c => !c.phantom && c.w !== "web")) return false;
    // installed GPUs only: an order that is cancelled while it ships must leave the game unchanged (cancelOrder test)
    return !s.racks.some(r => r.devices.some(d => itemOf(s, d).role === "gpu"));
  }
  function makeOffer(s, force) {
    const st = stats(s), mk = st.mk, rf = repF(s), R = () => nextRand(s);
    const cap = capacity(s, st), H = held(s), f = fleet(s), owed = owedNow(s);
    const kinds = [];
    // GPU markets: a full market sends no offers (demand grows 1.25-2.2x a year). Web never fills: it gets cheaper (D61)
    const openOf = w => w === "web" ? Infinity : Math.max(0, mk[w].demand - H[w]);
    const add = (kind, w, market) => {
      const card = bestCard(s, w === "frontier" ? "train" : w), m = w === "frontier" ? "frontier" : w;
      const c = cap[m], free = Math.max(0, c - owed[m]);
      const afford = card && kind !== "frontier" ? Math.min(Math.max(0, s.cash - 50) * 0.5 / card.per, roomFor(s, card.k, w) * card.u) : 0;
      const canBuy = card && s.cash >= card.price + s.items.sw.price;
      // nothing to serve it with and can't afford a card (a starter offer is shown anyway: it is the goal to save for)
      if (kind !== "web" && kind !== "frontier" && c < 0.5 && !canBuy && force !== "starter") return;
      const open = openOf(market);
      if (open < K.OFFER_MIN_UNITS) return;
      kinds.push({ kind, w, market, card, cap: c, free, afford, open, weight: 1 });   // every open market gets its share of the board
    };
    if (force === "web") add("web", "web", "web");
    else if (force === "starter") { add("infer", "infer", "infer"); add("train", "train", "train"); }
    else {
      if (on(s, "gpu")) { add("infer", "infer", "infer"); add("train", "train", "train"); }
      if (on(s, "fabric") && (cap.frontier > 0 || f.rowTrainMax >= 8)) add("frontier", "train", "frontier");
      if (!kinds.length || !core(s) || !on(s, "gpu")) add("web", "web", "web");   // after ch3 web has its own clock (webClock)
    }
    if (!kinds.length) return null;
    const tot = kinds.reduce((a, k) => a + k.weight, 0);
    let x = R() * tot, pick = kinds[kinds.length - 1];
    for (const k of kinds) { x -= k.weight; if (x <= 0) { pick = k; break; } }
    const { kind, w, market, card } = pick;
    // a first offer in a market the player has no hardware for is at most one card's worth (never a stretch)
    const first = card && pick.cap < 0.5 && kind !== "web", deliver = first ? card.u : pick.free + pick.afford;
    const starter = force === "starter";
    const stretch = !first && R() < K.OFFER_STRETCH;
    let units = starter ? card.u * (0.8 + 0.8 * R())            // one rack's worth: a switch + 1-2 cards
      : first ? card.u * (0.5 + 0.35 * R())            // slack for the 8 days of shipping and install
      : deliver * (stretch ? 1.2 + 0.4 * R() : K.OFFER_CAP_MIN + (K.OFFER_CAP_MAX - K.OFFER_CAP_MIN) * R());
    if (force === "web" && s.day === 0) units = 4 + Math.round(4 * R());               // the two starter offers: small
    units = Math.min(units, pick.open, kind === "web" ? Math.max(K.WEB_CAP_MIN, K.WEB_CAP_FRAC * cap.web) : Infinity);
    units = Math.max(K.OFFER_MIN_UNITS, Math.round(units));
    const cust = customer(s), spread = (1 + K.CONTRACT_PREMIUM) * (1 + (R() * 2 - 1) * K.QUOTE_SPREAD), repAdj = 1 + 0.2 * rf;
    const pf = market === "web" ? webPriceAt(H.web) : 1, P = mk[market].price * pf, ttl = K.OFFER_EXPIRY_MIN + Math.round(R() * (K.OFFER_EXPIRY - K.OFFER_EXPIRY_MIN));
    const o = { id: "c" + s.nextId++, kind, cust: cust.name, icon: cust.icon, foreign: cust.foreign, w, spot: +mk[market].price.toFixed(4),
      repAdj: +repAdj.toFixed(4), stretch, expires: s.day + ttl, ttl };
    if (starter) o.starter = true;
    if (pf < 1) o.pf = +pf.toFixed(4);           // the web volume discount it was signed at (a renewal keeps it, D61)
    if (kind === "train" || kind === "frontier") {
      const days = pickOf(s, starter ? K.JOB_DAYS.filter(x => x >= 60) : K.JOB_DAYS), work = Math.max(K.OFFER_MIN_UNITS * days, Math.round(units * days));
      const pay = work * P * (1 + K.JOB_PREMIUM) * spread * repAdj;
      Object.assign(o, { units: +(work / days).toFixed(2), days, lead: 0, work, pay: +pay.toFixed(2), price: +(pay / work).toFixed(4),
        maxRate: +(work / days * K.JOB_SPEED).toFixed(3), lateFee: +(pay * K.JOB_LATE_PEN).toFixed(3), lateMax: K.JOB_LATE_MAX,
        sla: 1, frontier: kind === "frontier" });
      o.penalty = o.lateFee;
    } else {
      const price = P * spread * repAdj;
      Object.assign(o, { units, days: pickOf(s, kind === "web" ? K.WEB_DAYS : K.INFER_DAYS), lead: K.LEAD_MIN + Math.round(R() * (K.LEAD_MAX - K.LEAD_MIN)),
        price: +price.toFixed(4), sla: kind === "web" ? K.SLA_WEB : K.SLA_INFER, penalty: +(price * K.PENALTY_MULT).toFixed(4) });
    }
    s.offers.push(o);
    pushNews(s, { title: `Offer: ${cust.name}`, body: offerText(o), tone: "info", cat: "contracts", icon: "doc", ...kp(isJob(o) ? "n.offerJob" : "n.offer", { c: cust.name, w: "@wl." + o.w, u: o.units, d: o.days, x: Math.round(o.pay || 0), work: o.work || 0 }) });
    log(s, `offer ${o.id} ${kind} ${o.units}u x${o.days}d p=${o.price} idx=${o.spot} cap=${pick.cap.toFixed(1)} free=${pick.free.toFixed(1)} afford=${pick.afford.toFixed(1)} stretch=${stretch}`);
    return o;
  }
  function offerText(o) {
    if (o.kind === "train" || o.kind === "frontier")
      return `${o.kind === "frontier" ? "Frontier training" : "Training"} job: ${o.work} unit-days within ${o.days} days, $${Math.round(o.pay)}k on completion.`;
    return `${o.units} ${o.w} units a day for ${o.days} days at $${round2(o.price)}k from day ${Math.round(o.expires - o.ttl + o.lead)} (SLA ${Math.round(o.sla * 100)} %).`;
  }
  /* day 0: the anchor customer (already signed, the whole game: the old starting income) + two small web offers */
  function startBoard(s) {
    const p = +(MARKET.web.base * 1.05).toFixed(4), a = C.ANCHOR;
    s.contracts.push({ id: "c" + s.nextId++, kind: "web", anchor: true, cust: a.name, icon: a.icon, foreign: false, w: "web",
      units: K.ANCHOR_UNITS, days: K.END_DAY, lead: 0, price: p, spot: MARKET.web.base, repAdj: 1, sla: K.SLA_WEB,
      penalty: +(p * K.PENALTY_MULT).toFixed(4), signed: 0, start: 0, end: K.END_DAY + 1, delivered: 0, missed: 0, penaltyPaid: 0, missDays: 0, streak: 0 });
    for (let i = 0; i < K.START_OFFERS; i++) makeOffer(s, "web");
    s.nextOffer = K.OFFER_EVERY;
  }
  /* the renewal of serving contract c: same customer, units and term, today's price, starting when c ends */
  function renewalOffer(s, c) {
    // a renewal re-prices to today's index but keeps the volume discount the customer signed at (D61): your existing book
    // does not get cheaper because you grew; only new customers see the lower price
    const mk = marketAt(s, s.day), rf = repF(s), P = mk[c.w].price * (c.pf || 1);
    const spread = (1 + K.CONTRACT_PREMIUM) * (1 + (nextRand(s) * 2 - 1) * K.QUOTE_SPREAD), repAdj = 1 + 0.2 * rf;
    const price = c.bts ? P * (1 + K.BTS_PREMIUM * nextRand(s)) * repAdj : P * spread * repAdj;
    const ttl = Math.max(1, Math.round(c.end - s.day));
    const o = { id: "c" + s.nextId++, kind: c.kind || c.w, renewOf: c.id, cust: c.cust, icon: c.icon, foreign: c.foreign, w: c.w,
      units: c.units, days: c.days, lead: +(c.end - s.day).toFixed(2), price: +price.toFixed(4), spot: +mk[c.w].price.toFixed(4), repAdj: +repAdj.toFixed(4),
      sla: c.sla, penalty: +(price * (c.bts ? K.BTS_PENALTY_MULT : K.PENALTY_MULT)).toFixed(4), expires: c.end, ttl, stretch: false };
    if (c.bts) Object.assign(o, { bts: true, fitout: 0 });      // the fit-out is already built
    if (c.pf) o.pf = c.pf;
    s.offers.push(o);
    pushNews(s, { title: `Renewal offer: ${c.cust}`, body: `Same ${o.units} ${o.w} units for another ${o.days} days at $${round2(o.price)}k (was $${round2(c.price)}k).`, tone: "info", cat: "contracts", icon: "doc", ...kp("n.renewal", { c: c.cust, u: o.units, d: o.days, x: Math.round(o.price * 1000), was: Math.round(c.price * 1000) }) });
    log(s, `renewal offer ${o.id} for ${c.id} p=${o.price} (was ${c.price})`);
    return o;
  }
  /* build-to-suit (ch8 long-term deals): a big customer wants dedicated capacity. Long term, fixed price above the
     index, high SLA and penalty, an up-front fit-out, delivery after a lead time (time to buy the hardware) */
  function makeBts(s) {
    const st = stats(s), mk = st.mk, rf = repF(s), R = () => nextRand(s), cap = capacity(s, st);
    const w = R() < 0.5 ? "train" : "infer";
    const ref = Math.max(cap[w], 0.25 * mk[w].demand);
    const units = Math.max(K.BTS_MIN_UNITS, Math.round(ref * (0.4 + 0.4 * R())));
    const days = [360, 450, 540][Math.floor(R() * 3)];
    const price = mk[w].price * (1 + K.BTS_PREMIUM * R()) * (1 + 0.2 * rf);
    const cust = customer(s);
    const o = { id: "c" + s.nextId++, kind: "bts", bts: true, cust: cust.name, icon: cust.icon, foreign: cust.foreign, w, units, days, lead: K.BTS_LEAD,
      fitout: Math.round(units * K.BTS_FIT_PER_UNIT), price: +price.toFixed(4), spot: +mk[w].price.toFixed(4), repAdj: +(1 + 0.2 * rf).toFixed(4),
      sla: K.BTS_SLA, penalty: +(price * K.BTS_PENALTY_MULT).toFixed(4), expires: s.day + K.BTS_EXPIRY, ttl: K.BTS_EXPIRY };
    s.offers.push(o);
    pushNews(s, { title: `Build-to-suit request: ${cust.name}`, body: `${units} ${w} units x ${days} days at $${round2(price)}k from day ${Math.round(s.day + o.lead)}. Fit-out $${o.fitout}k up front, SLA ${Math.round(o.sla * 100)} %.`, tone: "info", cat: "contracts", icon: "building", ...kp("n.bts", { c: cust.name, u: units, w: "@wl." + w, d: days, x: o.fitout }) });
    log(s, `bts offer ${o.id} ${w} ${units}u ${days}d p=${o.price} fit=${o.fitout}`);
  }
  /* daily: contract streaks and reputation, endings, cancellations, expiring offers, new offers */
  function dailyContracts(s, st, missed) {
    const d = s.day;
    let hits = 0;
    for (const c of s.contracts) {
      if (missed[c.id]) {
        c.missDays++; c.streak++; hits++;
        if (c.streak >= 5 && !c.pressed && on(s, "reputation")) { c.pressed = true; press(s, "sla", 3); }
      } else c.streak = 0;
    }
    if (hits) s.prog.missDays++;
    if (hits && on(s, "reputation")) repHit(s, Math.min(K.REP_SLA_DAY_MAX, hits * K.REP_SLA_DAY));
    // renewals: a serving customer whose SLA has held so far offers the same deal, re-priced to today's market, to start
    // when the current one ends; with the autoRenew policy it is signed on the spot
    for (const c of s.contracts.slice()) {
      if (isJob(c) || c.anchor || c.renewOffered || c.walked || c.streak > 0 || c.end - d > K.RENEW_BEFORE || d >= c.end) continue;
      const elapsed = Math.max(1, Math.min(c.days, d - c.start));
      if (c.missed > K.CONTRACT_OK_MISS * c.units * elapsed || (c.foreign && s.policyFx.exportCtl)) continue;
      c.renewOffered = true;
      const o = renewalOffer(s, c);
      if (s.policy.autoRenew) {
        const i = s.offers.indexOf(o), res = check(s, { type: "signContract", id: o.id });
        if (i >= 0 && res.ok) {
          signOffer(s, o);
          logCash(s, 0, "renew", `Auto-renewed ${c.cust}: ${o.units} ${o.w} units x ${o.days} days at $${round2(o.price)}k`, { c: c.cust });
          log(s, `auto-renew ${c.id} -> ${o.id}`);
        }
      }
    }
    // sustained failure: the customer walks away (penalties stop, the revenue too; counts as a failed contract)
    for (const c of s.contracts.filter(x => !isJob(x) && d < x.end && walkIn(s, x) === 0)) {
      c.end = d; c.walked = true;
      s.offers = s.offers.filter(o => o.renewOf !== c.id);                    // no renewal from a customer who left
      s.contracts = s.contracts.filter(x => !(x.renewOf === c.id && x.start > d - 1e-9));
      if (on(s, "reputation")) repHit(s, K.REP_JOB_CANCEL);
      logCash(s, 0, "contractLost", `${c.cust} terminated: ${c.streak} days of missed deliveries ($${Math.round(c.penaltyPaid)}k in penalties)`, { c: c.cust });
      pushNews(s, { title: `${c.cust} walks away`, body: `${c.streak} days of missed deliveries. Contract terminated; penalties paid $${Math.round(c.penaltyPaid)}k.`, tone: "bad", cat: "contracts", icon: "doc", ...kp("n.walk", { c: c.cust, d: c.streak, x: Math.round(c.penaltyPaid) }) });
      log(s, `contract ${c.id} terminated after ${c.streak} missed days`);
    }
    for (const c of s.contracts.filter(x => !isJob(x) && d >= x.end)) {
      const ok = !c.walked && c.missed <= K.CONTRACT_OK_MISS * c.units * c.days;
      s.contractLog[ok ? "fulfilled" : "failed"]++;
      if (ok && on(s, "reputation")) s.rep = clamp(s.rep + K.REP_CONTRACT_OK, 0, 100);
      if (!c.walked) pushNews(s, { title: `Contract with ${c.cust} ${ok ? "fulfilled" : "ended short"}`, body: `Delivered ${Math.round(c.delivered)} units, penalties $${Math.round(c.penaltyPaid)}k.`, tone: ok ? "good" : "bad", cat: "contracts", ...kp(ok ? "n.fulfilled" : "n.short", { c: c.cust, u: Math.round(c.delivered), x: Math.round(c.penaltyPaid) }) });
      log(s, `contract ${c.id} end ok=${ok}`);
    }
    for (const c of s.contracts.filter(x => isJob(x) && d >= x.deadline + x.lateMax)) {
      const lost = c.pay * c.done / c.work;
      s.contractLog.failed++; s.contractLog.cancelled++;
      addLoss(s, "cancelled", lost);
      if (on(s, "reputation")) repHit(s, K.REP_JOB_CANCEL);
      logCash(s, 0, "contractCancel", `${c.cust} cancelled a late training job: $${Math.round(lost)}k of work unpaid, $${Math.round(c.penaltyPaid)}k in late fees`, { c: c.cust, x: Math.round(lost) });
      pushNews(s, { title: `${c.cust} cancels a late training job`, body: `${Math.round(c.done / c.work * 100)} % done, never paid. Late fees $${Math.round(c.penaltyPaid)}k.`, tone: "bad", cat: "contracts", icon: "doc", ...kp("n.jobCancel", { c: c.cust, p: Math.round(c.done / c.work * 100), x: Math.round(c.penaltyPaid) }) });
      log(s, `job ${c.id} cancelled done=${c.done.toFixed(1)}/${c.work} lost=${lost.toFixed(1)}`);
    }
    s.contracts = s.contracts.filter(x => isJob(x) ? d < x.deadline + x.lateMax : d < x.end);
    for (const o of s.offers.filter(x => d >= x.expires)) log(s, `offer ${o.id} expired`);
    s.offers = s.offers.filter(x => d < x.expires);
    if (s.nextOffer >= 0 && d >= s.nextOffer) {
      // after ch3 web offers have their own clock and their own board room (WEB_BOARD_MAX), so they never block GPU arrivals
      const own = o => !o.bts && !(core(s) && on(s, "gpu") && o.w === "web");
      const board = s.offers.filter(own).length;
      if (board < K.BOARD_MAX) makeOffer(s);
      const after = s.offers.filter(own).length;
      // arrivals do not speed up when the player declines (the market's appetite is the limit); an empty board refills
      s.nextOffer = board >= K.BOARD_MAX ? d + 2
        : after === 0 ? d + 1 + Math.floor(nextRand(s) * 2)
        : d + Math.max(1, Math.round(K.OFFER_EVERY * (1 - 0.2 * repF(s)) + (nextRand(s) * 2 - 1) * K.OFFER_JITTER));
    }
    if (needsStarter(s)) { const o = makeOffer(s, "starter"); if (o) log(s, `starter gpu offer ${o.id}`); }
    // web's own arrival clock after the GPU chapter (D61)
    if (on(s, "gpu")) {
      if (!(s.nextWeb >= 0)) s.nextWeb = d + K.WEB_EVERY;
      else if (d >= s.nextWeb) {
        if (s.offers.filter(o => !o.bts && o.w === "web").length < K.WEB_BOARD_MAX) makeOffer(s, "web");
        s.nextWeb = d + Math.max(1, Math.round(K.WEB_EVERY + (nextRand(s) * 2 - 1) * K.OFFER_JITTER));
      }
    }
    if (on(s, "contracts") && s.nextBts != null && s.nextBts >= 0 && d >= s.nextBts) {
      makeBts(s);
      s.nextBts = d + Math.round(K.BTS_EVERY + (nextRand(s) * 2 - 1) * K.BTS_JITTER);
    }
  }

  /* ================= v4 player-triggered chapters (DECISIONS D49) ================= */
  function fleet(s) {
    let racks = 0, devices = 0, gpus = 0, trainGpus = 0, hall1 = 0;
    const rowTrain = {};
    for (const r of s.racks) {
      if (r.devices.length) { racks++; if (r.hall === 1) hall1++; }
      for (const d of r.devices) {
        devices++;
        if (s.items[d.type].role !== "gpu") continue;
        gpus++;
        if (r.workload === "train" && !r.tank) { trainGpus++; const k = r.hall + "-" + r.row; rowTrain[k] = (rowTrain[k] || 0) + 1; }
      }
    }
    let rowTrainMax = 0;
    for (const k in rowTrain) rowTrainMax = Math.max(rowTrainMax, rowTrain[k]);
    return { racks, devices, gpus, trainGpus, hall1, rowTrainMax };
  }
  const cheapestGpu = s => Math.min(s.items.c1.price, s.items.m1.price);
  /* is chapter `key`'s milestone met? state only (deterministic). The hints in content.js say the same in words. */
  function milestone(s, key, st, f) {
    const d = s.day;
    switch (key) {
      case "power": return (core(s) ? s.contractLog.signed >= 2 : d >= 45) || f.racks >= 4 || gridKwAll(s) > 0.35 * s.gridKw;   // ablation: v0.3 day
      case "gpu": return s.cash >= cheapestGpu(s) + s.items.sw.price || s.contractLog.fulfilled >= 2;
      case "heat": return f.gpus >= 6 || (f.gpus >= 2 && (seasonAt(d).c > 0.5 || seasonAt(d + 60).c > 0.5));
      case "gens": { const next = GEN_LAUNCH.find(g => g > d); return f.gpus >= 4 && (next == null || next - d <= 75 || d > GEN_LAUNCH[0]); }
      case "ops": return f.devices >= 30 || f.gpus >= 8;
      case "fabric": return f.trainGpus >= 8 || f.gpus >= 14;
      case "contracts": return s.contractLog.fulfilled >= 5;
      case "memory": return s.prog.gpuOrders >= 10;
      case "finance": {
        if (trailingRevenue(s, 90) >= 500) return true;
        const short = ["web", "train", "infer"].some(w => st.owed[w] > st.supplyPre[w] + 0.5);
        return short && s.cash < cheapestGpu(s);
      }
      case "facilities": return f.hall1 >= 15 || gridKwAll(s) >= 0.85 * s.gridKw;
      case "energy": return st.opex > 0 && st.costs.power >= st.opex / 3;
      case "environment": return s.prog.heatWaves >= 1;
      case "investors": return trailingRevenue(s, 180) >= 2000;
      case "reputation": return s.prog.missDays >= 3 || s.prog.outages >= 1;
      case "policy": return st.carbon >= 2;
      case "disrupt": return d >= 1200 && (s.unlocked.gens != null || !s.mech.gens);
    }
    return false;
  }
  /* the next chapter (ablated ones are stepped over) unlocks once its milestone holds, not before its earliest day and
     at most one per K.CH_GAP days. An active player (2+ GPUs) who is stuck gets it after K.CH_STALL days anyway. */
  function nextChapter(s) {
    let i = s.chapter + 1;
    while (i < CHAPTERS.length && CHAPTERS[i].mech && s.mech[CHAPTERS[i].mech] === false) i++;
    return i < CHAPTERS.length ? i : null;
  }
  function checkChapters(s, st) {
    if (s.sandbox) return;
    const i = nextChapter(s);
    if (i == null) return;
    const c = CHAPTERS[i], since = s.day - s.prog.lastChapter;
    if (s.day < c.day || since < K.CH_GAP) return;
    const f = fleet(s);
    const met = milestone(s, c.key, st, f), stall = since >= K.CH_STALL && s.chapter >= 2 && f.gpus >= 2;
    if (!met && !stall) return;
    s.chapter = i; onChapter(s, c.key);
    log(s, `chapter ${c.key} (${met ? "milestone" : "stall fallback"})`);
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
    pushNews(s, { title: `${vc} offers $${Math.round(amount)}k for ${Math.round(pct * 100)} %`, body: s.roundOffer.pitch, tone: "pitch", cat: "investors", icon: "tag", ...kp("n.round", { v: vc, x: Math.round(amount), p: Math.round(pct * 100), g: Math.round(K.PITCH_GROWTH * 100) }) });
    log(s, `round offer ${s.roundOffer.id} ${pct} for ${Math.round(amount)} (pre ${Math.round(pre)}, growth ${g.toFixed(2)})`);
  }
  function policyVote(s, p) {
    const h = s.hidden.policy[p.id], prob = clamp(h.p0 + p.shift, 0.02, 0.98);
    const passed = h.u < prob;
    p.status = passed ? "passed" : "failed";
    pushNews(s, { title: `${p.title} ${passed ? "passes" : "fails"}`, body: passed ? p.body : "Back to committee.", tone: passed ? "bad" : "good", cat: "policy", icon: "flag", ...kp(passed ? "n.polPass" : "n.polFail", { pol: "@pol." + p.kind, b: "@pol." + p.kind + ".b" }) });
    log(s, `policy ${p.id} vote p=${prob.toFixed(2)} u=${h.u.toFixed(2)} passed=${passed}`);
    if (!passed) return;
    if (p.kind === "carbonTax") s.policyFx.carbonTax = K.CARBON_TAX0;
    if (p.kind === "mandate") s.policyFx.mandate = { deadline: s.day + K.MANDATE_GRACE };
    if (p.kind === "export") {
      s.policyFx.exportCtl = true;
      const barred = s.contracts.filter(c => c.foreign);
      for (const c of barred) pushNews(s, { title: `Contract with ${c.cust} ends`, body: "Customer barred by export controls. No penalty; revenue gone.", tone: "bad", cat: "contracts", ...kp("n.barred", { c: c.cust }) });
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
    // v4 contracts core: SLA streaks, endings, cancelled jobs, expiring offers, new offers (every day from day 0)
    if (core(s)) dailyContracts(s, st, missed);
    s.recentlySold = (s.recentlySold || []).filter(x => d < x.until);
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
            pushNews(s, { title: "The board fires you", body: "Two missed targets in a row.", tone: "bad", cat: "investors", ...kp("n.fired") });
            log(s, "fired");
            return;
          }
          pushNews(s, hit ? { title: "Board target met", body: `Revenue $${Math.round(b.rev)}k vs $${Math.round(b.target)}k.`, tone: "good", cat: "investors", ...kp("n.boardMet", { x: Math.round(b.rev), t: Math.round(b.target) }) }
            : { title: "Board warning: target missed", body: `Revenue $${Math.round(b.rev)}k vs $${Math.round(b.target)}k. Miss again and you are out.`, tone: "bad", cat: "investors", ...kp("n.boardMiss", { x: Math.round(b.rev), t: Math.round(b.target) }) });
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
    for (const l of s.leaks.filter(x => d >= x.day)) { if (on(s, "reputation")) press(s, "lobby"); else pushNews(s, Object.assign({ tone: "bad", cat: "press" }, C.PRESS.lobby, kp("n.press.lobby"))); }
    s.leaks = s.leaks.filter(x => d < x.day);
    // M63 pilots: an exotic card reveals its measured field performance after 10 days in a rack
    if (s.mech.disrupt) for (const r of s.racks) for (const dv of r.devices) {
      const it = itemOf(s, dv);
      if (it.role === "exotic" && s.measured[it.vendor] == null && dv.inst != null && d - dv.inst >= K.PILOT_DAYS) {
        s.measured[it.vendor] = it.field;
        pushNews(s, { title: `Pilot result: ${it.name}`, body: `Measured ${Math.round(it.field * 100)} % of the spec sheet in your rack.`, tone: it.field < 0.9 ? "bad" : "good", cat: "vendor", vendor: it.vendor, ...kp("n.pilot", { it: "@it." + it.key, p: Math.round(it.field * 100) }) });
        log(s, `pilot ${it.vendor} measured ${it.field}`);
      }
    }
    if (on(s, "ops") && s.repairAuto) autoRepairSweep(s);
    else if (on(s, "ops") && s.policy.autoSwap) autoSwapSweep(s);
    if (on(s, "ops") && Object.keys(s.policy.keepSpares).length) restock(s);
    if (s.heatWave && d >= s.heatWave.until) s.heatWave = null;
    if (s.outage && d >= s.outage.until) { s.outage = null; pushNews(s, { title: "Grid power restored", body: "", tone: "good", cat: "facilities", ...kp("n.restored") }); }
    if (s.drought && d >= s.drought.until) { s.drought = null; pushNews(s, { title: "Drought over", body: "Water limits lifted.", tone: "good", cat: "environment", ...kp("n.droughtOver") }); }
    if (s.ppa && d >= s.ppa.end) { log(s, "ppa ended"); pushNews(s, { title: "PPA term ended", body: "Back to spot power.", tone: "info", cat: "energy", ...kp("n.ppaEnd") }); s.ppa = null; }
    checkChapters(s, st);
  }

  function closeQuarter(s, q0) {
    const f = s.fin;
    if (on(s, "finance")) {
      const profit = f.rev - f.opex - f.dep, tax = K.TAX * Math.max(0, profit);
      if (tax > 0) {
        s.cash -= tax; s.ledger.tax += tax; s.totals.tax += tax; addLoss(s, "taxes", tax);
        logCash(s, -tax, "tax", `Quarterly tax: ${Math.round(K.TAX * 100)} % of $${Math.round(profit)}k profit`);
      }
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
    ensureCashLog(s);
    s.cash += st.net * dt; s.totals.flow += st.net * dt;
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
    addLoss(s, "transit", st.transitLost * dt); addLoss(s, "taxes", c.carbonTax * dt); addLoss(s, "idle", st.idleLoss * dt);
    const E = s.env;
    E.water += st.waterRate * dt; E.carbon += st.carbon * dt; E.waterRate = st.waterRate; E.carbonRate = st.carbon; E.green = st.green;
    let doneJobs = null;
    for (const ct of s.contracts) {
      const del = st.cDel[ct.id] || 0, miss = st.cMiss[ct.id] || 0;
      ct.delivered += del * dt;
      if (isJob(ct)) {
        ct.done = Math.min(ct.work, ct.done + del * dt);
        if (s.day >= ct.deadline && !(ct.start > s.day + 1e-9)) { ct.penaltyPaid += ct.lateFee * dt; ct.late = true; s.dayAcc.missed[ct.id] = true; }
        if (ct.done >= ct.work - 1e-9) (doneJobs = doneJobs || []).push(ct);
      } else if (miss > 1e-9) { ct.missed += miss * dt; ct.penaltyPaid += miss * ct.penalty * dt; s.dayAcc.missed[ct.id] = true; }
    }
    if (doneJobs) for (const c of doneJobs) completeJob(s, c);
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
    while (s.hires.length && s.hires[0] <= s.day + 1e-9) { s.hires.shift(); s.techs++; pushNews(s, { title: "New technician starts", body: `${s.techs} on staff.`, tone: "good", cat: "ops", icon: "wrench", ...kp("n.hired", { n: s.techs }) }); log(s, `hire arrived, techs=${s.techs}`); }
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
  /* a training job's work is done: paid in one lump (a logged cash event), the contract closes */
  function completeJob(s, c) {
    const pay = c.pay, key = c.kind === "frontier" ? "frontier" : "train";
    s.cash += pay; s.totals.revenue += pay; s.fin.rev += pay; s.dayAcc.rev += pay; s.dayAcc.profit += pay; s.ledger[key] += pay;
    logCash(s, pay, "contract", `${c.kind === "frontier" ? "Frontier training" : "Training"} job for ${c.cust} done${c.late ? " (late)" : ""}`, { c: c.cust });
    s.contracts.splice(s.contracts.indexOf(c), 1);
    s.contractLog.fulfilled++;
    if (c.late) s.contractLog.late++;
    else if (on(s, "reputation")) s.rep = clamp(s.rep + K.REP_CONTRACT_OK, 0, 100);
    pushNews(s, { title: `${c.cust}: training job done`, body: `Paid $${Math.round(pay)}k${c.late ? `, after $${Math.round(c.penaltyPaid)}k in late fees` : ""}.`, tone: c.late ? "info" : "good", cat: "contracts", icon: "doc", ...kp(c.late ? "n.jobDoneLate" : "n.jobDone", { c: c.cust, x: Math.round(pay), f: Math.round(c.penaltyPaid) }) });
    log(s, `job ${c.id} done pay=${pay.toFixed(1)} late=${!!c.late}`);
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
    const money = v => `$${v >= 1000 ? (v / 1000).toFixed(1) + "M" : Math.round(v) + "k"}`;
    const top = losses.filter(x => x.key !== "taxes").slice(0, 3);
    const lessons = top.map(x => {
      const w = x.worst ? `, most of it in ${x.worst.period} ($${Math.round(x.worst.amount)}k)` : "";
      return LESSON[x.key] ? LESSON[x.key].replace("{x}", money(x.total)).replace("{w}", w) : `You lost ${money(x.total)} to ${x.label}${w}.`;
    });
    return {
      score: score(s), over: s.over, own: s.equity.own, companyValue: cv, netWorth: worth, cash: s.cash, debt: s.debt,
      earnings: Math.max(0, p) * K.EARN_DAYS * K.EARN_MULT, profitPerDay: p, repFactor: repFactor(s), reputation: repOf(s),
      raised: s.equity.raised, carbon: s.env.carbon, water: s.env.water,
      contracts: Object.assign({}, s.contractLog, { active: s.contracts.length, penalties: s.losses.sla, idle: s.losses.idle, cancelledWork: s.losses.cancelled }),
      losses, lessons, lessonKeys: top.map(x => x.key),
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
    // v4 contracts core + player-triggered chapters
    contractsOn: core, isJob, jobNeed, capacity, capacityAt, commitmentPeak, deliverable, overbook, walkIn, patience, needsStarter, webPriceF, webPriceAt, bestCard, held, roomFor, owedNow, fleet, milestone, nextChapter, makeOffer, LESSON,
    seasonAt, marketAt, rackById, rackIndex, usedU, rackKw, rackKwAll, gridKwAll, shopItems, currentGen, busyTechs, isDead, throttleAt,
    on, repOf, repFactor, hazard, naturalWorkload, logCash, ppaQuote, creditLimitOf, shelfLoad, transitTarget, trailingRevenue, hbmF, gridNext, hallCost, HALL_LETTERS,
    setDebug(v) { DEBUG = !!v; },
  };
});
