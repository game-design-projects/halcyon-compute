/* Halcyon Compute — DOM layer (v2, 17 chapters). All game rules live in sim.js; this file only draws and forwards input
 * through Sim.check / Sim.apply. Classic script, no dependencies, works from file://.
 * URL params: ?seed=123  ?debug=1 (console logging)  ?speed=4  ?play=campaign|sandbox (skip the menu)
 */
(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  const K = Sim.K, C = Sim.CONTENT, CH = Sim.CHAPTERS;
  const params = new URLSearchParams(location.search);
  const DEBUG = params.has("debug");
  Sim.setDebug(DEBUG);
  const dlog = (...a) => { if (DEBUG) console.log("[ui]", ...a); };
  const DAYS_PER_SEC = 2;
  const SAVE_KEY = "halcyon.save.v2", META_KEY = "halcyon.meta.v2", SLOT_KEY = n => `halcyon.slot.${n}`, SET_KEY = "halcyon.settings";
  /* every new user-visible string goes through L(key, params) (js/strings.js; pass B swaps in the i18n layer) */
  const L = window.L || ((k, p) => k);
  const QOL = window.QOL;

  let S = null;
  let seed = params.has("seed") ? (+params.get("seed") >>> 0) : Math.floor(Math.random() * 1e6);
  const V = {
    speed: 1, lastSpeed: 1, mode: "role", hall: 1, selected: "A1", selDev: null, armed: null, lease: false,
    seenChapter: -1, chapQueue: [], newsKey: "", acc: 0, overShown: false, sig: "", drawer: null, pop: null,
    newsCat: "all", tab: "rack", newsSeen: -1, newsSeenFor: null, menu: true, ppaKw: 100, confirm: null, confirmT: 0, saveBucket: -1, sandbox: false,
    down: false, lastFull: 0, wfLast: false, perf: { frames: 0, worst: 0, samples: [] },
    // game feel (display only): previous-state snapshot for the event diff, rolling counters, gauge ghosts
    fxPrev: null, cashOff: 0, scoreOff: 0, cashT: null, scoreT: null, cashPeak: 0, ghostFrac: 1, ghostHold: 0,
    fillPrev: {}, earnAcc: {}, earnLast: {}, earnT: 0, steamT: 0, finalQ: false, lastCount: -1, tilt: 0,
    // v0.3: pace ghost rows, one-time cards (first offer / scare / proposal / VC round), warnings, seen offers + cash events
    ghost: null, pace: null, firsts: {}, cardQueue: [], warned: {}, offersSeen: new Set(), cashSeen: 0, flowPrev: null,
    // v0.4 pass A: multi-select, blueprint clipboard, last order (R), undo stack, skip-to-event, hover, board highlight
    multi: new Set(), clip: null, lastOrder: null, undo: null, skip: null, hover: null, hoverRack: null, affT: 0, alertsT: 0, alerts: [],
    apSeen: null, beatT: 0, hl: null, boardSeen: new Set(),
  };
  const UNDO = QOL ? QOL.undoStack(20) : null;
  /* ================= settings (localStorage, guarded) ================= */
  const SET_DEFAULT = { master: 1, sfx: 1, hum: 1, reduced: null, cb: false, scale: 1, ap: { offer: true, fail: true, cash: true, sla: true }, apTouched: false, campaigns: 0 };
  let SET = JSON.parse(JSON.stringify(SET_DEFAULT));
  try { const raw = JSON.parse(localStorage.getItem(SET_KEY) || "null"); if (raw) SET = Object.assign(SET, raw, { ap: Object.assign({}, SET.ap, raw.ap || {}) }); } catch (e) { /* storage blocked */ }
  function saveSettings() { try { localStorage.setItem(SET_KEY, JSON.stringify(SET)); } catch (e) { /* storage blocked */ } }
  const PACE_ON = params.get("pace") !== "0";      // ?pace=0 turns the ghost off (A/B frame-time measurement)
  /* the pace chip compares you with the HUMAN-PACED bots (Casual = humanized greedy, Expert = humanized planner); the
     full-speed greedy/planner are measurement tools and are not shown to players (UI_BACKLOG bug 5) */
  const PACE_POLS = ["casual", "expert"];
  const BOTNAME = k => (window.Bots && Bots.LABELS && Bots.LABELS[k]) || k;
  const STZ = () => (window.Stage && Stage.z) || 1;   // current stage zoom: viewport px = stage px x STZ()
  const FXON = () => !!window.FX, SND = (name, arg, gap) => { if (window.SFX) SFX.play(name, arg, gap); };

  /* ================= palette: read from CSS tokens (single source of truth) ================= */
  const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const COL = {};
  function loadColors() {
    for (const k of ["web", "train", "infer", "net", "cool", "tank", "mem", "frontier", "contract", "good", "bad", "warn", "pitch", "info",
      "hot", "cold", "mid", "pow-lo", "pow-hi", "free-lo", "free-hi", "none", "debt", "rep", "carbon", "water", "equity", "vc",
      "lattice", "photon", "row0", "row1", "row2", "haz-lo", "haz-mid", "haz-hi", "lease", "fail"]) COL[k] = cssVar("--c-" + k) || "#888888";
    COL.pow = cssVar("--pow-c") || "#E2A91C"; COL.sel = cssVar("--sel") || "#FFD24A";
    COL.hudGood = cssVar("--hud-good") || "#7FE0A8"; COL.hudBad = cssVar("--hud-bad") || "#FF8466";
  }
  loadColors();
  try { matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { loadColors(); renderAll(); }); } catch (e) { /* old browsers */ }

  const ROLE = () => ({
    web:   { name: "Web",        color: COL.web, icon: "globe" },
    train: { name: "Training",   color: COL.train, icon: "brain" },
    infer: { name: "Inference",  color: COL.infer, icon: "bubble" },
    net:   { name: "Network",    color: COL.net, icon: "switch" },
    cool:  { name: "Cooling",    color: COL.cool, icon: "snow" },
    tank:  { name: "Immersion tank", color: COL.tank, icon: "drop" },
    empty: { name: "Empty rack", color: "transparent", icon: "plus" },
  });
  let R = ROLE();
  const ITEM_COLOR = it => it.role === "cpu" ? COL.web : it.role === "net" ? COL.net : it.role === "cool" ? COL.cool
    : it.role === "mem" ? COL.mem : it.role === "exotic" ? COL.tank : it.fam === "C" ? COL.train : COL.infer;
  const MODE_ICON = { eco: "leaf", std: "gauge", boost: "rocket", off: "power" };
  const KIND = { web: ["globe", "web"], infer: ["bubble", "infer"], train: ["brain", "train"], frontier: ["star", "frontier"], bts: ["building", "contract"] };
  const kindOf = o => o.bts ? "bts" : o.kind || o.w;
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const MAP_MODES = [
    { key: "role", label: "Role", icon: "layers", ch: "racks" },
    { key: "power", label: "Power", icon: "bolt", ch: "power" },
    { key: "heat", label: "Heat", icon: "temp", ch: "heat" },
    { key: "gen", label: "Generation", icon: "clock", ch: "gens" },
    { key: "fail", label: "Failures", icon: "cross", ch: "ops" },
    { key: "cluster", label: "Cluster", icon: "net", ch: "fabric" },
    { key: "free", label: "Free space", icon: "plus", ch: "racks" },
  ];
  const ramps = () => ({ heat: [COL.cold, COL.mid, COL.hot], power: [COL["pow-lo"], COL.pow, COL["pow-hi"]], free: [COL["free-lo"], COL.good, COL["free-hi"]],
    fail: [COL["haz-lo"], COL["haz-mid"], COL["haz-hi"]] });
  const CUST_ICON = { flask: "flask", cart: "cart", heart: "heart", play: "film", robot: "robot", globe: "globe", bank: "bank", game: "game" };
  const NEWS_CAT = {
    hardware: ["chip", "Hardware"], ops: ["wrench", "Operations"], market: ["trend", "Market"], contracts: ["hand", "Contracts"],
    memory: ["layers", "Memory"], energy: ["bolt", "Energy"], facilities: ["building", "Facilities"], environment: ["drop", "Environment"],
    investors: ["pie", "Investors"], press: ["news", "Press"], policy: ["flag", "Policy"], vendor: ["rocket", "Vendors"], general: ["globe", "General"],
  };
  /* per-chapter icons (one per content.js bullet) and where the new UI lives */
  const CH_META = {
    racks: { icons: ["plus", "switch", "globe", "wrench"], col: "web", where: "Catalog under the floor: drag a card onto a rack (or tap the card, then the rack). A rack without a switch shows a red NO SWITCH badge. Space pauses, 1-4 set speed." },
    power: { icons: ["bolt", "coin", "gauge"], col: "pow", where: "Click the power chip in the top bar to upgrade the grid. Power mode is in the rack panel." },
    gpu: { icons: ["chip", "brain", "gauge", "trend"], col: "train", where: "Rack panel (right): Training / Inference toggle and this chart for the rack's cards. The first GPU in a rack sets the workload it suits. Market chart below the floor." },
    heat: { icons: ["sun", "temp", "flame", "snow"], col: "hot", where: "Heat map mode shows every rack's inlet temperature." },
    gens: { icons: ["clock", "news", "trend", "tag"], col: "warn", where: "Generation map mode; OLD GEN badges in the catalog." },
    ops: { icons: ["cross", "wrench", "person", "box"], col: "fail", where: "Wrench chip: hire / fire and auto-repair. Spares shelf under the floor. Failures map mode." },
    fabric: { icons: ["switch", "rocket", "globe"], col: "frontier", where: "Spine slot at the right end of each row, with an N/12 cluster meter; transit chip in the top bar; Cluster map mode." },
    contracts: { icons: ["doc", "hand", "warn", "trend"], col: "contract", where: "New offers pop up above the floor with Sign / Decline buttons. Details and active contracts: the Contracts button (top right)." },
    memory: { icons: ["layers", "truck", "news", "lock"], col: "mem", where: "HBM index in the catalog header. Drag a GPU onto the shelf to order it forward." },
    finance: { icons: ["bank", "tag", "coin"], col: "debt", where: "Finance drawer (chart icon). Buy / Lease switch on the catalog." },
    facilities: { icons: ["building", "bolt", "battery", "snow"], col: "info", where: "Hall 2 / Hall 3 tabs above the floor; Energy drawer (bolt icon) for UPS, CRAC and the grid." },
    energy: { icons: ["trend", "leaf", "sun"], col: "carbon", where: "Energy drawer: PPA stepper, solar, spot-price chart." },
    environment: { icons: ["drop", "snow", "warn", "leaf"], col: "water", where: "Energy drawer: cooling mode per hall, water and carbon gauges." },
    investors: { icons: ["coin", "flag", "warn", "pie"], col: "vc", where: "Finance drawer (chart icon): VC offers, board target, buyback. The score chip now shows your equity value." },
    reputation: { icons: ["star", "warn", "news"], col: "rep", where: "Star chip in the top bar; Public drawer (flag icon) for PR." },
    policy: { icons: ["flag", "trend", "bank", "bubble"], col: "bad", where: "Public drawer: proposals, vote countdowns, signals, lobbying." },
    disrupt: { icons: ["rocket", "gauge", "tag", "brain"], col: "tank", where: "Benchmarks chart; convert an empty rack to an immersion tank in the rack panel." },
  };

  /* ================= helpers ================= */
  const icon = (id, style) => `<svg class="i"${style ? ` style="${style}"` : ""}><use href="#${id}"/></svg>`;
  const money = k => { const a = Math.abs(k), sg = k < 0 ? "−" : ""; return a >= 1000 ? `${sg}$${(a / 1000).toFixed(2)}M` : `${sg}$${Math.round(a)}k`; };
  const perDay = k => `${k >= 0 ? "+" : "−"}$${Math.abs(k).toFixed(1)}k/d`;
  const pct = v => `${Math.round(v * 100)} %`;
  const esc = t => String(t == null ? "" : t).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const clamp01 = v => Math.max(0, Math.min(1, v));
  function lerp(a, b, t) {
    const pa = a.replace("#", "").match(/\w\w/g).map(h => parseInt(h, 16)), pb = b.replace("#", "").match(/\w\w/g).map(h => parseInt(h, 16));
    return "#" + pa.map((v, i) => Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, "0")).join("");
  }
  function ramp(stops, t) {
    t = clamp01(t);
    const seg = (stops.length - 1) * t, i = Math.min(Math.floor(seg), stops.length - 2);
    return lerp(stops[i], stops[i + 1], seg - i);
  }
  const on = key => Sim.on(S, key);
  const rack = id => Sim.rackById(S, id);
  const item = k => S.items[k];
  const dateOf = day => { const doy = Math.floor(day) % 360; return `${MONTHS[Math.floor(doy / 30)]} ${doy % 30 + 1}, Y${Math.floor(day / 360) + 1}`; };
  function rackRole(r) {
    const all = r.devices.concat(r.pending).map(d => item(d.type));
    if (r.tank) return "tank";
    if (!all.length) return "empty";
    if (all.some(i => i.role === "gpu")) return r.workload;
    if (all.some(i => i.role === "exotic")) return "tank";
    if (all.some(i => i.role === "cpu")) return "web";
    if (all.some(i => i.role === "cool")) return "cool";
    return "net";
  }
  /* P0-2: a rack whose parts need network but that has no switch (installed or on its way) earns nothing,
     unless a row spine pools a neighbour's switches for it */
  const NEEDS_NET = it => it.role === "cpu" || it.role === "gpu" || it.role === "exotic";
  function switchless(r, pr) {
    if (r.devices.concat(r.pending).some(d => item(d.type).role === "net")) return false;
    return !(pr && pr.spine && pr.netF >= 1);
  }
  const noSwitch = (r, pr) => switchless(r, pr) && r.devices.concat(r.pending).some(d => NEEDS_NET(item(d.type)));
  const genBehind = r => {
    const g = r.devices.map(d => item(d.type)).filter(i => i.role === "gpu").map(i => i.gen);
    return g.length ? Sim.currentGen(S) - Math.min(...g) : null;
  };
  const hallRacks = n => S.racks.filter(r => r.hall === n);
  const builtHalls = () => S.halls.filter(h => h.built).map(h => h.n);
  const hallLetters = n => Sim.HALL_LETTERS[n - 1] || "ABC";
  const hasJob = uid => S.jobs.some(j => j.uid === uid || (j.dev && j.dev.uid === uid));
  function findDev(uid) {
    for (const r of S.racks) for (const d of r.devices) if (d.uid === uid) return { d, r };
    const d = S.shelf.find(x => x.uid === uid);
    return d ? { d, r: null } : null;
  }
  function spark(vals, w, h, color, opts) {
    opts = opts || {};
    if (vals.length < 2) return `<svg viewBox="0 0 ${w} ${h}"></svg>`;
    const lo = opts.lo != null ? opts.lo : Math.min(...vals), hi = opts.hi != null ? opts.hi : Math.max(...vals), span = Math.max(1e-9, hi - lo);
    const x = i => (i / (vals.length - 1)) * (w - 4) + 2, y = v => h - 3 - ((v - lo) / span) * (h - 6);
    const d = vals.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
    const ref = opts.ref != null ? `<line x1="2" x2="${w - 2}" y1="${y(opts.ref)}" y2="${y(opts.ref)}" stroke="${color}" stroke-dasharray="2 3" opacity=".5"/>` : "";
    return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="${esc(opts.label || "trend")}">${ref}<path d="${d}" fill="none" stroke="${color}" stroke-width="${opts.sw || 1.8}" vector-effect="non-scaling-stroke"/><circle cx="${x(vals.length - 1)}" cy="${y(vals[vals.length - 1])}" r="2.5" fill="${color}"/></svg>`;
  }
  function arcGauge(frac, color, big, small) {
    const f = clamp01(frac), r = 40, cx = 50, cy = 50, a0 = Math.PI, a1 = Math.PI * (1 - f);
    const p = a => `${(cx + r * Math.cos(a)).toFixed(1)},${(cy - r * Math.sin(a)).toFixed(1)}`;
    return `<svg viewBox="0 0 100 60" role="img" aria-label="${esc(small)}"><path d="M${p(a0)} A${r} ${r} 0 0 1 ${p(0)}" fill="none" stroke="var(--tile)" stroke-width="10" stroke-linecap="round"/>
      ${f > 0.005 ? `<path d="M${p(a0)} A${r} ${r} 0 0 1 ${p(a1)}" fill="none" stroke="${color}" stroke-width="10" stroke-linecap="round"/>` : ""}
      <text x="50" y="48" text-anchor="middle" class="v" style="font-size:15px">${esc(big)}</text></svg><span>${esc(small)}</span>`;
  }
  function pieSVG(own, color) {
    const a = own * 2 * Math.PI, large = own > 0.5 ? 1 : 0, x = 50 + 44 * Math.sin(a), y = 50 - 44 * Math.cos(a);
    const slice = own >= 0.999 ? `<circle cx="50" cy="50" r="44" fill="${color}"/>` : `<path d="M50 50 L50 6 A44 44 0 ${large} 1 ${x.toFixed(2)} ${y.toFixed(2)} Z" fill="${color}"/>`;
    return `<svg viewBox="0 0 100 100" role="img" aria-label="Your ownership ${pct(own)}"><circle cx="50" cy="50" r="44" fill="${COL.vc}" opacity=".35"/>${slice}<text x="50" y="56" text-anchor="middle" class="v" style="font-size:17px;fill:var(--white)">${pct(own)}</text></svg>`;
  }

  /* ============ action buttons: every button that changes the game goes through Sim.check / act ============ */
  const CONFIRM_MS = 4000;
  function actBtn(a, label, opts) {
    opts = opts || {};
    const key = JSON.stringify(a), res = Sim.check(S, a);
    const armed = opts.confirm && V.confirm === key && performance.now() - V.confirmT < CONFIRM_MS;
    const cls = ["btn", opts.cls || "", armed ? "confirm" : "", res.ok ? "" : "dim"].join(" ");
    // unaffordable / invalid = rendered disabled (dim, price red via CSS, aria-disabled, the reason as tooltip); a click still
    // reaches act(), which refuses it with show-not-tell feedback. refreshAfford() re-checks these live as cash moves.
    return `<button class="${cls}" data-act='${esc(key)}' data-afford${opts.confirm ? " data-confirm" : ""} title="${esc(res.msg)}"${res.ok ? "" : ' aria-disabled="true"'}${!label && opts.title ? ` aria-label="${esc(opts.title)}"` : ""}>${opts.icon ? icon(opts.icon) : ""}${armed ? `Tap again: ${label || opts.title || ""}` : label}</button>`;
  }

  /* ================= storage (optional: every call guarded) ================= */
  const store = {
    get(k) { try { return window.localStorage ? localStorage.getItem(k) : null; } catch (e) { return null; } },
    set(k, v) { try { if (window.localStorage) localStorage.setItem(k, v); return true; } catch (e) { dlog("save failed", e && e.message); return false; } },
    del(k) { try { if (window.localStorage) localStorage.removeItem(k); } catch (e) { /* ignore */ } },
  };
  function saveGame(reason) {
    if (!S || S.over) return;
    const t0 = performance.now();
    const ok = store.set(SAVE_KEY, JSON.stringify(S)) &&
      store.set(META_KEY, JSON.stringify({ seed: S.seed, sandbox: S.sandbox, day: Math.floor(S.day), score: Math.round(Sim.score(S)), at: Date.now() }));
    dlog("autosave", reason, "day", Math.floor(S.day), ok ? "ok" : "failed", (performance.now() - t0).toFixed(1) + "ms");
  }
  /* a resumable save: v2/v3 saves are migrated by the sim (ensureCashLog → v4); v4 is current */
  function validSave(st) { return !!st && typeof st === "object" && [2, 3, 4].includes(st.v) && !st.over && Array.isArray(st.racks) && Array.isArray(st.jobs) && st.items != null; }
  function readMeta() { try { const m = JSON.parse(store.get(META_KEY) || "null"); return m && store.get(SAVE_KEY) ? m : null; } catch (e) { return null; } }
  function loadGame() {
    try {
      const st = JSON.parse(store.get(SAVE_KEY) || "null");
      return validSave(st) ? st : null;
    } catch (e) { dlog("load failed", e && e.message); return null; }
  }

  /* ================= game lifecycle ================= */
  function resetView() {
    Object.assign(V, { hall: 1, selected: "A1", selDev: null, armed: null, lease: false, chapQueue: [], overShown: false, acc: 0,
      drawer: null, pop: null, newsCat: "all", confirm: null, wfLast: false,
      fxPrev: null, cashOff: 0, scoreOff: 0, cashT: null, scoreT: null, cashPeak: S.cash, ghostFrac: 1, ghostHold: 0,
      fillPrev: {}, earnAcc: {}, earnLast: {}, finalQ: false, lastCount: -1,
      apSeen: null, hl: null, hover: null, hoverRack: null, boardSeen: new Set(), keepItem: null });
    V.multi = new Set();
    if (V.skip) { V.skip = null; $("skipbtn").setAttribute("aria-pressed", "false"); document.body.classList.remove("skipping"); }
    $("hovercard").hidden = true;
    if (UNDO) UNDO.clear();
    if (FXON()) { FX.clearAll(); FX.clearRackAnims(); }
    document.body.classList.remove("blackout", "finalq");
    V.newsKey = newsKey();
    V.saveBucket = Math.floor(S.day / 30) * 1000 + Math.floor(S.day / 90);
    // one-time cards: a continued game has already seen whatever exists by now
    V.cardQueue = []; V.warned = {}; V.overRows = null;
    V.offersSeen = new Set(S.offers.map(o => o.id));
    V.cashSeen = S.cashSeq || 0; V.flowPrev = null;
    const past = key => S.unlocked && S.unlocked[key] != null && S.day - S.unlocked[key] > 20;
    V.firsts = { offer: past("contracts") || S.contractLog.signed > 0, scare: past("memory"), policy: S.policies.some(p => p.announced) && past("policy"),
      round: S.equity.rounds > 0 || past("investors") };
    closeDrawer(); closePop();
    startGhost();
  }
  /* pace ghost: greedy + planner replay this seed in a worker, never past the player's day (js/pace.js) */
  function startGhost() {
    if (V.ghost) { V.ghost.stop(); V.ghost = null; }
    V.pace = null;
    if (!PACE_ON || !window.Pace || !window.Bots) { renderPace(); return; }
    const s0 = S;
    V.ghost = Pace.start({ seed: S.seed, sandbox: !!S.sandbox, day: S.day, pols: PACE_POLS,
      onRows: m => {
        if (S !== s0) return;
        const first = !V.pace;
        V.pace = m;
        if (first || (DEBUG && m.rows.planner && m.rows.planner.day % 60 === 0)) dlog("[pace]", JSON.stringify(m.rows), m.fallback ? "(main thread)" : "");
        renderPace();
        if (V.overRows) V.overRows(m);
      },
      log: (...a) => dlog("[pace]", ...a) });
  }
  function start(newSeed, opts) {
    opts = opts || {};
    seed = newSeed >>> 0;
    V.sandbox = !!opts.sandbox;
    S = Sim.newGame(seed, { sandbox: V.sandbox });
    TELE.start(seed, { sandbox: V.sandbox });
    V.teleSnap = -1;
    resetView();
    V.seenChapter = -1;
    if (V.sandbox) { V.seenChapter = S.chapter; showSandboxCard(); }
    setUrl();
    dlog("start seed", seed, "sandbox", V.sandbox);
    hideMenu();
    renderAll();
    maybeChapter();
  }
  function continueGame() {
    const st = loadGame();
    if (!st) { nope("No saved game", $("m-continue")); return; }
    resumeState(st, "autosave");
  }
  /* resume a saved state (autosave, a manual slot or an imported file). The telemetry log starts a new "continued" session. */
  function resumeState(st, how) {
    S = st; seed = S.seed; V.sandbox = !!S.sandbox;
    if (V.ghost) { V.ghost.stop(); V.ghost = null; }
    if (UNDO) UNDO.clear();
    TELE.start(seed, { sandbox: V.sandbox, continued: true, day: S.day });
    TELE.event(S.day, "load", { how, v: S.v });
    TELE.snap(S, Sim.score(S));
    V.teleSnap = Math.floor(S.day / 10);
    resetView();
    V.seenChapter = S.chapter;
    setUrl();
    dlog("resume", how, "day", S.day, "v", S.v);
    hideMenu();
    V.speed = 0;
    renderAll();
    toast(`Welcome back: ${dateOf(S.day)} (paused)`);
  }
  function setUrl() {
    try { const url = new URL(location.href); url.searchParams.set("seed", seed); url.searchParams.delete("play"); history.replaceState(null, "", url); } catch (e) { /* file:// may refuse */ }
  }

  /* the first GPU into a GPU-less rack sets the rack to the workload that card earns more on (Sim.naturalWorkload);
     issued as a normal workload action before the order so the drag preview, the sim and the bots all agree */
  function wlDefault(a) {
    if (!["buy", "lease", "move", "unstore"].includes(a.type)) return null;
    const rid = a.type === "move" ? a.to : a.rack;
    const f = a.item ? null : findDev(a.uid), key = a.item || (f && f.d.type);
    const w = key && Sim.naturalWorkload(S, rid, key);
    return w && rack(rid) && rack(rid).workload !== w ? { type: "workload", rack: rid, workload: w } : null;
  }
  /* every state change goes through here (telemetry records it). opts: src = the element that asked (for "no" feedback),
     quiet = part of a batch (blueprint paste, fill, bulk): no toast / render, the caller renders once; noUndo = an undo itself */
  function act(a, opts) {
    opts = opts || {};
    const res = Sim.check(S, a);
    if (!res.ok) { TELE.action(S.day, a, false, res.msg); nope(res.msg, opts.src, a); dlog("rejected", a, res.msg); return false; }
    const cash0 = S.cash;
    const wl = wlDefault(a);
    if (wl) { TELE.action(S.day, wl, true); Sim.apply(S, wl); dlog("workload default", wl); }
    const pre = UNDO && !opts.noUndo ? QOL.undoPre(S, a) : null;
    TELE.action(S.day, a, true);
    Sim.apply(S, a);
    if (pre) { const e = QOL.undoEntry(pre, a, S); if (e) { if (opts.group) e.group = opts.group; UNDO.push(e); dlog("undo push", e.kind, a.type, opts.group || ""); } }
    if ((a.type === "buy" || a.type === "lease") && a.item) V.lastOrder = { type: a.type, item: a.item };
    V.cashSeen = S.cashSeq || 0;      // the player's own action explains its cash change and any event it caused (its toast says so)
    V.flowPrev = { cash: S.cash, flow: S.totals.flow || 0 };
    const d = S.cash - cash0;
    if (Math.abs(d) > 0.5) flashCash(d);
    if (a.to) V.selected = a.to; else if (a.rack && !["sell", "store", "returnLease"].includes(a.type)) V.selected = a.rack;
    if (["sell", "store", "returnLease"].includes(a.type) || (a.type === "repair" && false)) V.selDev = null;
    V.confirm = null;
    dlog("action", a, res.msg);
    sr(res.msg);
    if ((a.type === "buy" || a.type === "lease") && a.item) {
      const it = item(a.item);
      if (a.type === "buy" && FXON() && !opts.quiet) fxAtRack(a.rack, c => FX.floatText(c.x, c.top, `−${money(it.price)}`, "#FF8466", 15));
    } else if (!opts.quiet && !QUIET_ACTS.has(a.type)) toast(res.msg + (wl ? ` · ${a.to || a.rack} set to ${R[wl.workload].name}` : ""));
    if (!opts.quiet) renderAll();
    fxAct(a, opts);
    return true;
  }
  /* actions whose result is shown on screen (floats, links, the rack itself), not in a toast */
  const QUIET_ACTS = new Set(["transit", "hire", "fire", "borrow", "repay", "repairPolicy", "mode", "workload", "reorder", "cancelJob", "undoSell", "buyBack",
    "policy", "signContract", "declineContract", "cancelOrder", "sell", "store", "unstore", "move", "repair", "returnLease"]);

  /* ================= show, don't tell: "no" feedback (docs/I18N.md feel table) =================
   * No sentence: the element wobbles, a low bonk, and the missing resource flashes (cash chip / rack / grid chip / shelf).
   * The reason stays available as the element's tooltip and in an aria-live region (#sr) for screen readers. */
  function nope(msg, el, a) {
    const why = QOL ? QOL.reason(msg) : "other";
    SND("bonk", null, 110);
    sr(msg);
    if (S) TELE.event(S.day, "nope", { why, msg: String(msg).slice(0, 80) });
    dlog("nope", why, msg);
    wobble(el);
    if (why === "cash") {
      pulse($("h-cashchip"), "fx-nocash", 520);
      const pr = el && el.querySelector ? el.querySelector(".price") : null;
      if (pr) pulse(pr, "fx-pricebad", 800);
    }
    const rid = a && (a.to || a.rack);
    if ((why === "space" || why === "kw") && rid) {
      if (FXON()) FX.rackAnim(rid, "fx-nope", 420);
      if (V.selected === rid) pulse(document.querySelector(`#detail .g[data-g="${why === "space" ? "u" : "kw"}"]`), "fx-gpulse", 900);
    }
    if (why === "grid") pulse($("h-power"), "fx-nogrid", 900);
    if (why === "shelf") pulse($("shelf-wrap"), "fx-nope-el", 450);
  }
  function pulse(el, cls, ms) {
    if (!el) return;
    el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls);
    clearTimeout(el["_t" + cls]); el["_t" + cls] = setTimeout(() => el.classList.remove(cls), ms);
  }
  function wobble(el) {
    if (!el || !el.animate || (FXON() && FX.reduced)) return;
    try { el.animate([0, -6, 5, -3, 0].map(x => ({ translate: `${x}px 0` })), { duration: 250, easing: "ease-out" }); } catch (e) { /* no WAAPI */ }
  }
  function sr(t) { const el = $("sr"); if (el) el.textContent = String(t || ""); }
  /* feedback for a successful player action: physical placement gets a squash "thunk" + dust + drop sound */
  const PLACE = new Set(["buy", "lease", "move", "unstore"]), STAMP = new Set(["signContract", "acceptRound", "buildHall", "grid", "ups", "solar", "ppa", "pr", "lobby", "spine", "crac", "cooling", "buyback", "tank", "forward"]);
  /* coyote time: after a purchase, an "Undo" toast for 2 real seconds while the order is still shipping (full refund) */
  const UNDO_MS = 2000;
  function showUndo(a) {
    const j = S.jobs.slice().reverse().find(x => x.kind === a.type && x.to === a.rack && x.phase === "ship" && x.dev);
    if (!j) return;
    const op = { type: "cancelOrder", uid: j.dev.uid }, el = $("undo");
    V.undo = { op, until: performance.now() + UNDO_MS };
    $("undo-msg").textContent = `${item(j.dev.type).name} ordered for ${j.to}`;
    $("undo-btn").dataset.act = JSON.stringify(op);
    el.classList.remove("show"); void el.offsetWidth;   // restart the countdown bar
    el.style.setProperty("--undo-ms", UNDO_MS + "ms");
    el.classList.add("show");
    dlog("undo offered", op);
  }
  function hideUndo(why) { if (!V.undo) return; V.undo = null; $("undo").classList.remove("show"); dlog("undo closed", why); }
  function undoTick(now) {   // expire after 2 s, or as soon as the order leaves the truck (8x speed)
    if (!V.undo) return;
    if (now > V.undo.until) hideUndo("timeout");
    else if (!Sim.check(S, V.undo.op).ok) hideUndo("shipped");
  }
  function fxAct(a, opts) {
    opts = opts || {};
    if (a.type === "cancelOrder") { hideUndo("used"); SND("pickup"); return; }
    if (a.type === "signContract") { linkFx(a.id); return; }
    if (a.type === "declineContract") { SND("pickup"); return; }
    if (opts.quiet) return;          // a batch (fill, paste, bulk): the caller plays one consolidated cue
    if (a.type === "buy" || a.type === "lease") showUndo(a);
    if (PLACE.has(a.type)) {
      const id = a.to || a.rack;
      SND("drop");
      if (FXON()) {
        FX.rackAnim(id, "fx-thunk", 360, 0, false, "cubic-bezier(.3,1.6,.5,1)");
        const c = FX.rackCenter(id);
        if (c) FX.dust(c.x, c.bottom - 4, c.w * 0.8);
      }
    } else if (STAMP.has(a.type)) SND("stamp");
    else if (a.type === "borrow") SND("chaching", a.amount || K.LOAN_STEP);
    else if (["sell", "store", "returnLease", "repair"].includes(a.type)) SND("pickup");
    else SND("tick", 4, 40);
  }

  /* signing: the new contract's link colour flies from the board to every rack that will serve it (its start day, today's
     hardware), and those racks pulse. No rack yet = the catalog pulses (build capacity before the start date). */
  function linkFx(cid) {
    const c = S.contracts.find(x => x.id === cid);
    if (!c) return;
    const st2 = Sim.stats(S, { day: Math.max(S.day, c.start || S.day) + 0.01 });
    const racks = [...new Set(st2.alloc.filter(l => l.id === cid).map(l => l.rack))];
    const col = QOL ? QOL.linkColor(cid) : "#5AD1E6";
    dlog("[board] signed", cid, c.cust, "served by", racks.join(",") || "none yet");
    TELE.event(S.day, "linked", { id: cid, racks });
    SND("link");
    const b = $("offerstrip").getBoundingClientRect();
    const pill = document.querySelector(`[data-contract="${cid}"]`);
    if (pill) pulse(pill, "fx-newpill", 900);
    if (!racks.length) { pulse($("tray"), "fx-hint", 1200); return; }
    racks.forEach((rid, i) => {
      if (!FXON()) return;
      const el = FX.rackEl(rid);
      if (!el) return;
      setTimeout(() => FX.fly(b.left + 70 * STZ(), b.top + b.height / 2, el, "link", col, () => FX.rackAnim(rid, "fx-link", 800)), i * 90);
    });
  }

  /* ================= skip to the next event (fast-forward until something needs you) ================= */
  const SKIP_MAX_DAYS = 120, SKIP_DAYS_PER_FRAME = 3;
  function skipSnap() {
    let failed = 0;
    for (const r of S.racks) for (const d of r.devices) if (d.failed) failed++;
    const cm = Sim.stats(S).cMiss || {};
    return { offers: new Set(S.offers.map(o => o.id)), failed, chapter: S.chapter, contracts: S.contracts.map(c => c.id).join(), cashSeq: S.cashSeq || 0,
      miss: Object.keys(cm).filter(k => cm[k] > 1e-6).length };
  }
  function toggleSkip() {
    if (!S || S.over) return;
    if (V.skip) { stopSkip("button"); return; }
    V.skip = { until: S.day + SKIP_MAX_DAYS, snap: skipSnap(), d0: S.day };
    $("skipbtn").setAttribute("aria-pressed", "true");
    document.body.classList.add("skipping");
    TELE.event(S.day, "skip", { on: true });
    dlog("[skip] start", S.day.toFixed(1));
  }
  function stopSkip(why, el) {
    if (!V.skip) return;
    dlog("[skip] stop", why, "after", (S.day - V.skip.d0).toFixed(1), "days");
    TELE.event(S.day, "skip", { on: false, why, days: +(S.day - V.skip.d0).toFixed(1) });
    V.skip = null;
    $("skipbtn").setAttribute("aria-pressed", "false");
    document.body.classList.remove("skipping");
    setSpeed(0);
    if (el) pulse(el, "fx-attn", 1400);
  }
  /* what changed since the skip began → the element to point at (or null = keep going) */
  function skipReason() {
    const P = V.skip.snap;
    if (S.over) return ["over", null];
    if (S.chapter !== P.chapter) return ["chapter", $("goal")];
    if (S.offers.some(o => !P.offers.has(o.id))) return ["offer", $("offerstrip")];
    let failed = 0;
    for (const r of S.racks) for (const d of r.devices) if (d.failed) failed++;
    if (failed > P.failed) return ["failure", $("alertbtn")];
    if (S.contracts.map(c => c.id).join() !== P.contracts) return ["contract", $("offerstrip")];
    if ((S.cashEvents || []).some(e => e.n > P.cashSeq && Math.abs(e.amt) >= 10)) return ["cash", $("h-cashchip")];
    const st = Sim.stats(S), miss = Object.keys(st.cMiss || {}).filter(k => st.cMiss[k] > 1e-6).length;
    if (miss > P.miss) return ["sla", $("offerstrip")];
    if (S.cash < 0 || S.day >= V.skip.until) return [S.cash < 0 ? "cash<0" : "max", $("h-cashchip")];
    if (V.cardQueue.length) return ["card", null];
    return null;
  }
  function skipFrame() {
    for (let i = 0; i < SKIP_DAYS_PER_FRAME && V.skip; i++) {
      Sim.advance(S, 1);
      const tb = Math.floor(S.day / 10);
      if (tb !== V.teleSnap) { V.teleSnap = tb; TELE.snap(S, Sim.score(S)); }
      const why = skipReason();
      if (why) stopSkip(why[0], why[1]);
    }
  }

  /* ================= auto-pause (settings): stop time when something needs you ================= */
  function autoPause(st) {
    if (!S || S.over || !V.speed || V.skip) return;
    if (V.apDay === S.day) return;      // only when the sim moved (a substep), not every frame
    V.apDay = S.day;
    const ap = SET.ap || {};
    const prev = V.apSeen;
    let failed = 0;
    for (const r of S.racks) for (const d of r.devices) if (d.failed) failed++;
    const miss = Object.keys(st.cMiss || {}).some(k => st.cMiss[k] > 1e-6);
    const now = { offers: new Set(S.offers.map(o => o.id)), failed, neg: S.cash < 0, miss };
    V.apSeen = now;
    if (!prev) return;
    let why = null, el = null;
    if (ap.offer && S.offers.some(o => !prev.offers.has(o.id))) { why = "offer"; el = $("offerstrip"); }
    else if (ap.fail && failed > prev.failed) { why = "fail"; el = $("alertbtn"); }
    else if (ap.cash && now.neg && !prev.neg) { why = "cash"; el = $("h-cashchip"); }
    else if (ap.sla && miss && !prev.miss) { why = "sla"; el = $("offerstrip"); }
    if (!why) return;
    setSpeed(0);
    pulse(el, "fx-attn", 1400);
    pulse(document.querySelector('.speed [data-speed="0"]'), "fx-attn", 1400);
    sr(L("fb.paused", { why }));
    TELE.event(S.day, "autopause", { why });
    dlog("[autopause]", why);
  }

  /* ================= live affordability: every cost-bearing control re-checks while cash moves ================= */
  function refreshAfford(force) {
    const now = performance.now();
    if (!force && now - V.affT < 250) return;
    V.affT = now;
    for (const b of document.querySelectorAll("#stage [data-act]")) {
      if (b._k !== b.dataset.act) { b._k = b.dataset.act; try { b._a = JSON.parse(b._k); } catch (e) { b._a = null; } }
      if (!b._a) continue;
      const res = Sim.check(S, b._a), dim = !res.ok;
      if (b.classList.contains("dim") !== dim) {
        b.classList.toggle("dim", dim);
        if (dim) b.setAttribute("aria-disabled", "true"); else b.removeAttribute("aria-disabled");
      }
      // actBtn titles are the check message; hand-written buttons keep their explanation and gain the reason when refused
      if (b.hasAttribute("data-afford")) { if (b.title !== res.msg) b.title = res.msg; }
      else { if (b._t0 == null) b._t0 = b.title || ""; const t = dim && !b.hasAttribute("data-keep-title") ? `${b._t0}${b._t0 ? " · " : ""}${res.msg}` : b._t0; if (b.title !== t) b.title = t; }
    }
    const leasing = V.lease && on("finance");
    for (const el of document.querySelectorAll("#tray .item[data-item]")) {
      const it = item(el.dataset.item);
      const bad = !(leasing && it.role === "gpu") && S.cash < it.price;
      if (el.classList.contains("unaff") !== bad) { el.classList.toggle("unaff", bad); if (bad) el.setAttribute("aria-disabled", "true"); else el.removeAttribute("aria-disabled"); }
    }
  }

  /* ================= loop ================= */
  let last = performance.now();
  function running() { return S && V.speed > 0 && !S.over && !anyModal(); }
  function frame(now) {
    const t0 = performance.now();
    const dtSec = Math.min(0.25, (now - last) / 1000); last = now;
    if (running()) {
      V.acc += dtSec * DAYS_PER_SEC * V.speed;
      const steps = Math.floor(V.acc / K.DT);
      if (steps > 0) {
        V.acc -= steps * K.DT; Sim.advance(S, steps * K.DT);
        const tb = Math.floor(S.day / 10);
        if (tb !== V.teleSnap) { V.teleSnap = tb; TELE.snap(S, Sim.score(S)); }
      }
    }
    if (S && V.skip && !S.over && !anyModal() && !(drag && drag.started)) skipFrame();
    const tSim = performance.now();
    let tRen = tSim, tAft = tSim, tFx = tSim;
    if (S) {
      const dragging = drag && drag.started;
      let st = null;
      if (!dragging && !V.down) {
        const sig = signature();
        if ((sig !== V.sig && now - V.lastFull > 200) || now - V.lastFull > 1000) st = renderAll();
        else { st = Sim.stats(S); renderHUD(st); renderProgress(); }
        tRen = performance.now();
        afterTick();
        autoPause(st);
        refreshAfford();
        if (now - V.alertsT > 500) { V.alertsT = now; renderAlerts(st); }
        if (V.hover && now - V.hover.t > 1000) refreshHover();
        tAft = performance.now();
      }
      fxFrame(st || Sim.stats(S), dtSec, now);
      tFx = performance.now();
      undoTick(now);
      if (V.ghost && !S.over) V.ghost.to(S.day);          // posts to the worker only when the day changes
      if (dragging && anyModal()) cancelDrag("a card opened");
      autosave();
    }
    if (FXON()) FX.tick(now);
    const ft = performance.now() - t0;
    V.perf.frames++; if (ft > V.perf.worst) V.perf.worst = ft;
    if (V.profOn) { (V.fprof = V.fprof || []).push([ft, tSim - t0, tRen - tSim, tAft - tRen, tFx - tAft, performance.now() - tFx]); if (V.fprof.length > 3000) V.fprof.shift(); }
    if (V.perf.samples.length >= 2000) V.perf.samples.shift(); V.perf.samples.push(ft);
    requestAnimationFrame(frame);
  }
  const newsKey = () => S.news.length ? `${S.news.length}|${S.news[0].day}|${S.news[0].title}` : "0";
  function signature() {
    let devs = 0, failed = 0;
    for (const r of S.racks) { devs += r.devices.length * 7 + r.pending.length; for (const d of r.devices) if (d.failed) failed++; }
    return [S.jobs.length, newsKey(), S.chapter, devs, failed, S.shelf.length, S.gridKw, S.over, S.offers.length, S.contracts.length,
      Object.keys(S.spines).length, builtHalls().join(), S.roundOffer ? S.roundOffer.id : "", S.techs, S.hires.length, S.transit, S.debt, S.ups, S.solar, !!S.ppa,
      S.halls.map(h => h.cooling + h.crac).join(), S.policies.map(p => p.status + p.announced + p.signals.length).join(), !!S.outage, !!S.heatWave, !!S.drought, S.hbm.shortage].join("|");
  }
  function afterTick() {
    TELE.tick();
    const k = newsKey();
    if (k !== V.newsKey) {
      const oldTop = V.newsKey; V.newsKey = k;
      const fresh = [];
      for (const n of S.news) { if (`${S.news.length}|${n.day}|${n.title}` === oldTop || fresh.length >= 4) break; if (n.day >= Math.floor(S.day) - 2) fresh.push(n); }
      const hot = fresh.filter(n => n.tone === "bad" || n.tone === "pitch" || n.tone === "good");
      if (hot.length) toast(hot[0].title, true);
    }
    maybeChapter();
    if (!S.over) { checkOffers(); checkFirsts(); checkRunway(); }
    checkCash();
    maybeCard();
    if (S.over && !V.overShown) {
      V.overShown = true; store.del(SAVE_KEY); store.del(META_KEY);
      if (S.over === "end") { showOver(); return; }
      // make losing legible: the racks power down one by one with a descending tone, then the lessons screen
      dlog("fx: power down", S.over);
      SND("powerDown");
      document.body.classList.add("blackout");
      if (FXON()) S.racks.filter(r => r.devices.length).forEach((r, i) => FX.rackAnim(r.id, "fx-off", 420, i * 60, true, "ease-in"));
      const s0 = S;   // a new game started during the power-down must not get this game's end screen
      setTimeout(() => { if (S === s0) showOver(); }, FXON() && !FX.reduced ? 1800 : 150);
    }
  }

  /* ================= game feel: event layer (display only; never touches sim numbers) =================
   * Diffs the previous vs current state once per sim day (or after an action) and emits effects:
   * install, fail, sale, outage start/end, launch, vendor death, quarter, milestone, throttle, final quarter.
   * Every frame it also rolls the counters, eases the cash gauge ghost, floats money and steam, and drives the hum. */
  const MILESTONES = [[1000, "$1M"], [10000, "$10M"], [100000, "$100M"]];
  const outageOn = () => on("facilities") && !!S.outage && S.day >= S.outage.start;
  function fxSnap(st) {
    const inst = new Map(), pend = new Set(), failed = new Set(), thr = new Set(), nosw = new Set();
    for (const r of S.racks) {
      for (const d of r.devices) { inst.set(d.uid, r.id); if (d.failed) failed.add(d.uid); }
      for (const d of r.pending) pend.add(d.uid);
      const pr = st.perRack[r.id];
      if (pr && pr.throttle < 1) thr.add(r.id);
      if (pr && r.devices.some(d => NEEDS_NET(item(d.type))) && !(pr.netF > 0)) nosw.add(r.id);   // dark: no switch carries it
    }
    const sells = new Map();
    for (const j of S.jobs) if (j.kind === "sell") sells.set(j.id, j);
    const dead = Object.keys(S.vendors).filter(v => S.vendors[v].dead);
    return { day: S.day, inst, pend, failed, thr, nosw, sells, dead, gen: Sim.currentGen(S), q: S.lastQuarter ? S.lastQuarter.q : null,
      outage: outageOn(), dark: outageOn() && !S.ups, score: Sim.score(S), cash: S.cash };
  }
  function rackOrder(hall) {   // column-major sweep: the wave runs along the rows like a breaker trip
    return S.racks.filter(r => r.hall === hall).sort((a, b) => a.col - b.col || a.row - b.row);
  }
  function fxAtRack(id, fn) { if (!FXON()) return; const c = FX.rackCenter(id); if (c) fn(c); }
  function fxEvents(P, N, st) {
    const fx = FXON();
    // installs (pending -> installed): green sparks, LEDs light up
    let n = 0;
    for (const [uid, rid] of N.inst) if (!P.inst.has(uid) && P.pend.has(uid) && n++ < 6) {
      SND("install", null, 120);
      if (fx) { FX.rackAnim(rid, "fx-on", 700); fxAtRack(rid, c => FX.sparks(c.x, c.y, "#7FE0A8", 22, 240)); }
    }
    // a switch plugged in: the dark rack powers up with a light sweep
    n = 0;
    for (const rid of P.nosw) if (!N.nosw.has(rid) && n++ < 6) {
      SND("powerUp", null, 300);
      if (fx) FX.rackAnim(rid, "fx-sweep", 750);
      dlog("fx: power-up sweep", rid);
    }
    // failures: red sparks + smoke where it broke
    n = 0;
    for (const uid of N.failed) if (!P.failed.has(uid) && n++ < 6) {
      const rid = N.inst.get(uid);
      SND("fail", null, 150);
      if (fx && rid) { FX.rackAnim(rid, "fx-jolt", 420); fxAtRack(rid, c => { FX.sparks(c.x, c.y, "#FF6A4A", 26, 280); FX.smoke(c.x, c.top + 10, 6); }); }
      dlog("fx: failure", uid, rid);
    }
    // completed sales: cha-ching, pitch by amount, "+$Xk" rising from the rack it left
    for (const [id, j] of P.sells) if (!N.sells.has(id)) {
      SND("chaching", j.value || 1);
      if (fx) fxAtRack(j.rack, c => FX.floatText(c.x, c.top, `+${money(j.value || 0)}`, "#FFD24A", 16));
    }
    // throttling begins: a soft warning beep + an orange puff (rate-limited)
    for (const rid of N.thr) if (!P.thr.has(rid)) {
      SND("warn", null, 4000);
      if (fx) fxAtRack(rid, c => FX.sparks(c.x, c.top + 6, "#FFB054", 8, 120));
      break;
    }
    // grid outage: strong shake + red flash + alarm + racks go black one by one; relight in a wave on restore
    if (N.outage && !P.outage) {
      dlog("fx: outage start", { ups: !!S.ups });
      if (N.dark) {
        SND("alarm"); SND("powerDown");
        if (fx) {
          FX.shake(0.9); FX.flash("#E0402A", 700, 0.45);
          for (const hall of builtHalls()) rackOrder(hall).forEach((r, i) => FX.rackAnim(r.id, "fx-off", 380, 120 + i * 55, true, "ease-in"));
        }
        document.body.classList.add("blackout");
      } else { SND("warn"); if (fx) { FX.shake(0.35); FX.flash("#E0A43A", 450, 0.22); } }
    } else if (!N.outage && P.outage) {
      dlog("fx: outage end");
      document.body.classList.remove("blackout");
      if (P.dark) {
        SND("powerUp");
        if (fx) {
          FX.clearRackAnims(e => e.hold);
          FX.flash("#FFFFFF", 350, 0.18);
          for (const hall of builtHalls()) rackOrder(hall).forEach((r, i) => FX.rackAnim(r.id, "fx-relight", 520, i * 45));
        }
      }
    }
    // generation launch: prices crash (medium shake + low boom), said where the prices live
    if (N.gen > P.gen) {
      dlog("fx: gen launch", N.gen);
      SND("launch");
      if (fx) {
        FX.shake(0.5); FX.flash("#E0A43A", 400, 0.16);
        const m = $("market-chart").getBoundingClientRect();
        if (m.width && m.bottom > 0 && m.top < innerHeight) FX.floatText(m.left + m.width / 2, m.top + m.height / 2, `Gen ${N.gen} ships · prices ↓`, "#FF8466", 18);
      }
    }
    // vendor death: medium shake + crunch; red sparks on every rack holding a bricked part
    const newDead = N.dead.filter(v => !P.dead.includes(v));
    if (newDead.length) {
      dlog("fx: vendor death", newDead);
      SND("crunch");
      if (fx) {
        FX.shake(0.5);
        for (const r of hallRacks(V.hall)) if (r.devices.some(d => newDead.includes(item(d.type).vendor))) {
          FX.rackAnim(r.id, "fx-jolt", 420);
          fxAtRack(r.id, c => { FX.sparks(c.x, c.y, "#FF6A4A", 18, 220); FX.smoke(c.x, c.top + 10, 4); });
        }
      }
    }
    // quarter close: white flash + chime + a tally card
    if (N.q != null && N.q !== P.q) {
      SND("chime");
      if (fx) FX.flash("#FFFFFF", 380, 0.28);
      quarterCard(S.lastQuarter);
    }
    // score milestones: confetti from the score chip
    for (const [m, label] of MILESTONES) if (P.score < m && N.score >= m) {
      dlog("fx: milestone", label);
      SND("fanfare");
      toast(`Score passed ${label}`, true);
      if (fx) { const r = $("h-score").getBoundingClientRect(); FX.confetti(r.left + r.width / 2, r.bottom, 90, 0.8); }
    }
  }
  function fxFrame(st, dt, now) {
    if (S.over && V.overShown) { if (window.SFX) SFX.setHum(0, 1, false, true); return; }
    const N = V.fxPrev && S.day === V.fxPrev.day ? null : fxSnap(st);
    if (N) {
      const P = V.fxPrev;
      if (P) {
        const dDays = N.day - P.day;
        fxEvents(P, N, st);
        // money floaters: accumulate each visible rack's exact earnings; a big jump (fast-forward / load) is not "earned on screen"
        if (dDays > 0 && dDays <= 3) for (const r of hallRacks(V.hall)) { const pr = st.perRack[r.id]; if (pr && pr.rev > 0) V.earnAcc[r.id] = (V.earnAcc[r.id] || 0) + pr.rev * dDays; }
        else if (dDays > 3) V.earnAcc = {};
        // discrete cash / score jumps roll (display only); continuous earnings are shown exactly
        const flow = Math.abs(st.net) * Math.max(0, dDays) * 3 + 2;
        const dc = N.cash - P.cash, ds = N.score - P.score;
        if (dDays <= 3 && Math.abs(dc) > flow) V.cashOff += dc;
        if (dDays <= 3 && Math.abs(ds) > Math.max(flow * 3, Math.abs(P.score) * 0.002 + 2)) V.scoreOff += ds;
      }
      V.fxPrev = N;
    }
    // cash rolled by an action (buy/sell/borrow) happens between days: catch it too
    if (V.fxPrev && S.cash !== V.fxPrev.cash && S.day === V.fxPrev.day) { V.cashOff += S.cash - V.fxPrev.cash; V.fxPrev.cash = S.cash; }
    const tau = FXON() && FX.reduced ? 0.05 : 0.38, k = 1 - Math.exp(-dt / tau);
    const big = Math.abs(V.cashOff) > 10;
    V.cashOff = Math.abs(V.cashOff) < 0.5 ? 0 : V.cashOff * (1 - k);
    V.scoreOff = Math.abs(V.scoreOff) < 0.5 ? 0 : V.scoreOff * (1 - k);
    if (big) SND("tick", 2, 70);   // Balatro-style ticking while a big change rolls
    $("h-cash").textContent = money(S.cash - V.cashOff);
    runway(dt, now);
    // bankruptcy danger: a screen-edge vignette that deepens as the runway shrinks; a heartbeat under 30 days
    const rwd = runwayDays(st), rdays = rwd ? rwd.days : Infinity;
    if (FXON()) FX.danger(rdays < 60 ? Math.min(1, (60 - rdays) / 60) : 0);
    if (rdays < 30 && running()) SND("heartbeat", null, 1100);
    // final quarter: gold frame, drum-roll countdown over the last 10 days
    const left = K.END_DAY - S.day;
    if (left <= 90 && !V.finalQ && !S.over) {
      V.finalQ = true; document.body.classList.add("finalq");
      toast("Final quarter: make it count"); SND("drum", 0);
      dlog("fx: final quarter");
    }
    const cd = Math.ceil(left);
    if (V.finalQ && cd <= 10 && cd !== V.lastCount && cd > 0) {
      V.lastCount = cd; SND("drum", 10 - cd);
      try { $("h-when").animate([{ transform: "scale(1.12)" }, { transform: "scale(1)" }], { duration: 260, easing: "ease-out" }); } catch (e) { /* no WAAPI */ }
    }
    // spatial particles: money floaters and heat steam, only while time runs and for the visible hall
    const live = running() && !(V.fxPrev && V.fxPrev.dark);
    if (FXON() && live && !FX.reduced) {
      if (now - V.earnT > 220) {
        V.earnT = now;
        let best = null, amt = 0;
        for (const id in V.earnAcc) if (V.earnAcc[id] > amt && now - (V.earnLast[id] || 0) > 1400) { best = id; amt = V.earnAcc[id]; }
        if (best && amt >= 0.1) {
          const c = FX.rackCenter(best);
          if (c) {
            FX.floatText(c.x, c.top + 4, `+${amt < 10 ? "$" + amt.toFixed(1) + "k" : money(amt)}`, "#7FE0A8", Math.min(22, 11 + 4 * Math.log10(1 + amt * 2)));
            SND("coin", amt, 450);
          }
          V.earnAcc[best] = 0; V.earnLast[best] = now;
        }
      }
      if (on("heat") && now - V.steamT > 380) {
        V.steamT = now;
        for (const r of hallRacks(V.hall)) {
          const pr = st.perRack[r.id];
          if (!pr || pr.inlet <= 30 || !r.devices.length) continue;
          const c = FX.rackCenter(r.id);
          if (c) { FX.steam(c.x, c.top + 6); if (pr.inlet > K.T_LIMIT) FX.steam(c.x, c.top + 6); }
        }
      }
    }
    if (window.SFX) SFX.setHum(st.kw, S.gridKw, running(), !!(V.fxPrev && V.fxPrev.dark));
    if (drag && drag.started && drag.card && FXON() && !FX.reduced) {   // tilt settles back when the pointer stops
      V.tilt *= Math.exp(-dt * 9);
      drag.card.style.rotate = V.tilt.toFixed(2) + "deg";
    }
  }
  /* cash gauge = runway above the bankruptcy line relative to your peak; a damage ghost shows what a drop took */
  function runway(dt, now) {
    const el = $("h-runway"); if (!el) return;
    const floor = on("finance") ? -S.creditLimit : K.BANKRUPT;
    V.cashPeak = Math.max(V.cashPeak || 0, S.cash);
    const frac = clamp01((S.cash - floor) / Math.max(1, V.cashPeak - floor));
    if (frac >= V.ghostFrac) { V.ghostFrac = frac; V.ghostHold = now; }
    else if (now - V.ghostHold > 450) V.ghostFrac += (frac - V.ghostFrac) * (1 - Math.exp(-dt / 0.3));
    if (!el._i) el._i = { ghost: el.querySelector(".ghostbar"), now: el.querySelector(".now") };
    el._i.now.style.width = (frac * 100).toFixed(1) + "%";
    el._i.ghost.style.width = (V.ghostFrac * 100).toFixed(1) + "%";
    el._i.now.style.background = frac < 0.15 ? COL.hudBad : frac < 0.35 ? "#E0A43A" : COL.hudGood;
    const chip = $("h-cashchip");
    chip.classList.toggle("danger", frac < 0.15);
    chip.title = `Cash and current net income per day. Bar: cash above the bankruptcy line (${money(floor)}) relative to your peak (${money(V.cashPeak)}).`;
  }
  /* quarter tally card: revenue − costs = profit, ticking up; display only, pointer-events none */
  let qcardT;
  function quarterCard(Q) {
    const el = $("qcard"); if (!el || !Q) return;
    const rev = Q.web + Q.train + Q.infer + Q.frontier + Q.contracts;
    const cost = Q.power + Q.upkeep + Q.salaries + Q.transit + Q.interest + Q.lease + Q.water + Q.diesel + Q.carbonTax + Q.fines + Q.penalties + Q.repairs + Q.other + Q.tax;
    const profit = rev - cost, q = Q.q;
    el.innerHTML = `<div class="qh">${icon("trend")}Q${q % 4 + 1} Y${Math.floor(q / 4) + 1} closed</div>
      <div class="qr"><span>Revenue</span><b style="color:var(--hud-good)">+${money(rev)}</b></div><div class="qr"><span>Costs</span><b style="color:var(--hud-bad)">−${money(cost)}</b></div>
      ${Q.tax > 0.5 ? `<div class="qr"><span>incl. tax</span><b style="color:var(--hud-bad)">−${money(Q.tax)}</b></div>` : ""}<div class="qr qp"><span>Profit</span><b id="qcard-p">$0k</b></div>`;
    el.classList.remove("show"); void el.offsetWidth; el.classList.add("show");
    const pEl = $("qcard-p");
    pEl.style.color = profit >= 0 ? "var(--hud-good)" : "var(--hud-bad)";
    if (FXON()) FX.tween(0, profit, 900, "outCubic", v => { pEl.textContent = money(v); }, () => { pEl.textContent = money(profit); });
    else pEl.textContent = money(profit);
    clearTimeout(qcardT); qcardT = setTimeout(() => el.classList.remove("show"), 3600);
    dlog("fx: quarter", q, { rev: rev.toFixed(1), cost: cost.toFixed(1) });
  }
  function autosave() {
    if (S.over) return;
    const b = Math.floor(S.day / 30) * 1000 + Math.floor(S.day / 90);
    if (b !== V.saveBucket) { V.saveBucket = b; saveGame(S.day % 90 < 1 ? "quarter" : "30 days"); }
  }
  const anyDialogOpen = () => document.querySelector("dialog[open]") != null;
  const anyModal = () => anyDialogOpen() || V.menu;

  /* ================= rendering ================= */
  function renderAll() {
    if (!S) return;
    const t0 = performance.now();
    R = ROLE();
    if (!rack(V.selected) || rack(V.selected).hall !== V.hall) { const hr = hallRacks(V.hall); V.selected = hr.length ? hr[0].id : null; }
    const st = Sim.stats(S);
    V.sig = signature(); V.lastFull = performance.now();
    // __game.V.profOn = true collects per-renderer timings in V.prof (perf investigations; off by default)
    const P = V.profOn ? (name, fn) => { const t = performance.now(); fn(); V.prof[name] = (V.prof[name] || 0) + performance.now() - t; } : (name, fn) => fn();
    if (V.profOn && !V.prof) V.prof = {};
    P("hud", () => renderHUD(st)); P("drawerBtns", renderDrawerBtns); P("banners", () => renderBanners(st)); P("goal", () => renderGoal(st)); P("board", () => renderOffers(st));
    P("halls", renderHallTabs); P("modes", renderModes); P("floor", () => renderFloor(st)); P("shelf", renderShelf);
    P("detail", () => renderDetail(st)); P("tray", renderTray); P("market", renderMarket); P("bench", renderBench); P("news", renderNews);
    if (V.profOn) V.prof.n = (V.prof.n || 0) + 1;
    if (V.drawer) renderDrawer(st);
    if (V.pop) renderPop(st);
    if (!V.hudRO) {   // --hud-h follows the HUD's height without forcing a synchronous layout in every render (perf)
      const setH = hh => { if (hh && hh !== V.hudH) { V.hudH = hh; document.documentElement.style.setProperty("--hud-h", hh + "px"); } };
      if (window.ResizeObserver) { V.hudRO = new ResizeObserver(() => setH($("hud").offsetHeight)); V.hudRO.observe($("hud")); }
      else V.hudRO = true;
      setH($("hud").offsetHeight);
    }
    document.body.classList.toggle("armed", !!V.armed);
    document.body.classList.toggle("leasing", V.lease && on("finance"));
    const dt = performance.now() - t0;
    if (DEBUG && dt > 12) console.log("[ui] slow renderAll", dt.toFixed(1) + "ms");
    return st;
  }

  function barChip(el, ic, color, val, cap, unitTxt, projVal, over, fmt) {
    fmt = fmt || (v => Math.round(v));
    const p = v => Math.max(0, Math.min(100, v / cap * 100));
    const d = projVal != null ? projVal - val : 0;
    el.classList.toggle("over", !!over);
    // built once, then patched in place so the bar widths can ease (CSS transition) instead of being replaced every frame
    let b = el._bc;
    if (!b || b.ic !== ic || b.color !== color) {
      el.innerHTML = `${icon(ic, `color:${color}`)}<div><span class="big"></span> <small></small><span class="delta"></span>
        <div class="bar"><i class="proj" style="background:${color}"></i><i class="now" style="background:${color}"></i></div></div>`;
      b = el._bc = { ic, color, big: el.querySelector(".big"), small: el.querySelector("small"), delta: el.querySelector(".delta"), proj: el.querySelector("i.proj"), now: el.querySelector("i.now"), v: {} };
    }
    const setT = (k, node, txt) => { if (b.v[k] !== txt) { b.v[k] = txt; node.textContent = txt; } };
    setT("big", b.big, fmt(val));
    setT("small", b.small, `/ ${fmt(cap)} ${unitTxt}`);
    setT("delta", b.delta, Math.abs(d) >= .05 ? `${d > 0 ? "+" : "−"}${Math.abs(d).toFixed(1)}` : "");
    b.delta.style.color = d > 0 ? COL.hudBad : COL.hudGood;
    const wNow = p(val).toFixed(1) + "%", wProj = projVal != null ? p(projVal).toFixed(1) + "%" : "0%";
    if (b.v.w !== wNow) { b.v.w = wNow; b.now.style.width = wNow; }
    if (b.v.wp !== wProj) { b.v.wp = wProj; b.proj.style.width = wProj; b.proj.style.display = projVal != null ? "" : "none"; }
  }
  function show(el, v) { if (el.hidden === v) el.hidden = !v; }
  function transitNeed(st) {
    const raw = (st.supply.web + st.supply.infer) / (st.transitF || 1);
    return raw / K.TRANSIT_PER;
  }
  function renderHUD(st, proj) {
    $("h-cash").textContent = money(S.cash - V.cashOff);   // cashOff: the rolling (display-only) remainder of a discrete jump
    const rate = $("h-rate");
    const rw = !proj && S && !S.over ? runwayDays(st) : null;
    rate.textContent = perDay(st.net) + (proj ? `  →  ${perDay(proj.net)}` : "") + (rw && rw.days < 180 ? ` · ~${Math.round(rw.days)} d to bankrupt` : "");
    rate.style.color = (proj || st).net >= 0 ? COL.hudGood : COL.hudBad;
    rate.title = rw ? `At the current rate (${perDay(rw.net)}) cash hits the bankruptcy line (${money(bankruptFloor())}) in about ${Math.round(rw.days)} days.` : "";
    // technicians
    const busy = Sim.busyTechs(S), waiting = S.jobs.filter(j => j.phase === "wait").length, ops = on("ops");
    const nT = ops ? S.techs : K.TECHS;
    $("h-techs").innerHTML = `${icon("wrench")}<div><div class="pips">${Array.from({ length: nT }, (_, i) => `<b class="${i >= busy ? "on" : ""}"></b>`).join("")}${ops ? S.hires.map(() => `<b class="hire"></b>`).join("") : ""}</div>${waiting ? `<small>+${waiting} queued</small>` : ops ? `<small>${S.repairAuto ? "auto-repair" : "manual repair"}</small>` : ""}</div>`;
    $("h-techs").classList.toggle("click", ops);
    // date
    const qi = Math.floor(S.day / 90), se = st.se;
    const sIcon = se.name === "winter" ? "snow" : "sun", sCol = se.name === "summer" ? "#FFB054" : se.name === "winter" ? "#8FC4FF" : "#C9D86A";
    const quarters = K.END_DAY / 90;
    $("h-when").innerHTML = `${icon(sIcon, `color:${sCol}`)}<div><span class="big">${dateOf(S.day)}</span>${V.speed === 0 ? `<span class="pausedtag">PAUSED</span>` : ""}<div class="timeline">${Array.from({ length: quarters }, (_, i) => `<i class="${i < qi ? "past" : i === qi ? "now" : ""}"></i>`).join("")}</div></div>`;
    $("h-when").title = `${se.name}. Day ${Math.floor(S.day)} of ${K.END_DAY}.`;
    // power
    const pw = $("h-power");
    barChip(pw, "bolt", COL.pow, st.kw, S.gridKw, "kW", proj && proj.kw, false);
    pw.title = `Drawing ${st.kw.toFixed(0)} kW now, ${Sim.gridKwAll(S).toFixed(0)} kW with orders. Grid ${S.gridKw} kW. Click for grid upgrades.`;
    pw.classList.toggle("lockmask", !on("power"));
    // heat: the hottest hall
    const ht = $("h-heat");
    let hot = st.halls[0];
    for (const h of st.halls) if (h.roomT > hot.roomT) hot = h;
    const tProj = proj ? Math.max(...proj.halls.map(h => h.roomT)) : null;
    barChip(ht, "temp", COL.hudBad, hot.roomT, K.T_LIMIT, "°C", tProj, hot.roomT > K.T_LIMIT - 1.5, v => v.toFixed(1));
    ht.classList.toggle("near", on("heat") && hot.roomT > K.T_LIMIT - 3.5 && hot.roomT <= K.T_LIMIT - 1.5);   // gauge glows before the limit
    const arrow = hot.tTarget > hot.roomT + 0.1 ? "rising" : hot.tTarget < hot.roomT - 0.1 ? "falling" : "steady";
    ht.title = st.halls.map(h => `Hall ${h.n}: ${h.roomT.toFixed(1)} °C → ${h.tTarget.toFixed(1)}, cooling ${h.heatCap.toFixed(0)} kW`).join("\n") + `\nRoom is ${arrow}. Racks throttle above ${K.T_LIMIT} °C inlet.`;
    ht.classList.toggle("lockmask", !on("heat"));
    // transit
    const tr = $("h-transit");
    show(tr, on("fabric"));
    if (on("fabric")) {
      const need = transitNeed(st), cap = S.transit + K.TRANSIT_FREE;
      barChip(tr, "globe", "#8FC4FF", need, cap, "transit", null, need > cap + 1e-6, v => v.toFixed(v < 10 ? 1 : 0));
      tr.title = `Internet transit: traffic needs ${need.toFixed(1)} units, you have ${cap} (${K.TRANSIT_FREE} free). Short transit caps web + inference output. Click to change.`;
    }
    // debt
    const db = $("h-debt");
    show(db, on("finance"));
    if (on("finance")) {
      const lim = Math.max(0, K.LOAN_LTV * Sim.netWorth(S));
      db.innerHTML = `${icon("bank", `color:${COL.debt}`)}<div><span class="big">${money(S.debt)}</span> <small>debt</small><div class="bar"><i style="width:${Math.min(100, S.debt / Math.max(1, lim) * 100)}%;background:${COL.debt}"></i></div></div>`;
      db.title = `Debt ${money(S.debt)} of a ${money(lim)} credit line (40 % of net worth), ${K.INTEREST * 100} %/yr. Click for Finance.`;
    }
    // reputation
    const rp = $("h-rep");
    show(rp, on("reputation"));
    if (on("reputation")) {
      const rv = Sim.repOf(S), stars = Math.round(rv / 20);
      rp.innerHTML = `${icon("star", `color:${COL.rep}`)}<div><span class="big">${Math.round(rv)}</span> <small>rep</small><div class="gauge" style="color:${COL.rep}">${Array.from({ length: 5 }, (_, i) => `<b class="${i < stars ? "on" : ""}"></b>`).join("")}</div></div>`;
      rp.title = `Reputation ${rv.toFixed(1)} / 100 (start 60). Moves contracts, demand and valuation. Click for PR and policy.`;
      rp.classList.toggle("warnchip", S.day < S.scandalUntil);
    }
    // carbon
    const cb = $("h-carbon");
    show(cb, on("environment"));
    if (on("environment")) {
      cb.innerHTML = `${icon("leaf", `color:${COL.carbon}`)}<div><span class="big">${st.carbon.toFixed(1)}</span> <small>t/day</small><div class="bar"><i style="width:${Math.round(st.green * 100)}%;background:${COL.carbon}"></i></div></div>`;
      cb.title = `Carbon ${st.carbon.toFixed(2)} t CO2 per day, ${Math.round(S.env.carbon)} t so far. Bar = green share of power (${pct(st.green)}).`;
    }
    // equity
    const eq = $("h-equity");
    show(eq, on("investors"));
    if (on("investors")) {
      eq.innerHTML = `${icon("pie", `color:${COL.equity}`)}<div><span class="big">${Math.round(S.equity.own * 100)} %</span> <small>yours</small></div>`;
      eq.title = `You own ${(S.equity.own * 100).toFixed(1)} % of Halcyon. Click for investors.`;
    }
    // score
    const sc = Sim.score(S);
    $("h-score").innerHTML = `${icon("flag", "color:var(--sel)")}<div><span class="big">${money(sc - V.scoreOff)}</span><small style="display:block">score · worth ${money(Sim.netWorth(S))}</small></div>`;
    renderPace(sc);
    $("h-score").title = on("investors") ? "Score = your equity % × company value (net worth + 2 years of earnings) × reputation factor."
      : "Score = net worth (cash + resale − debt) + 2 years of current earnings.";
    document.querySelectorAll(".speed button").forEach(b => b.setAttribute("aria-pressed", +b.dataset.speed === V.speed));
    document.body.classList.toggle("paused", V.speed === 0);
  }
  function renderDrawerBtns() {
    const vis = { contracts: Sim.contractsOn(S), finance: true, energy: on("facilities") || on("energy") || on("environment"), affairs: on("reputation") || on("policy") };
    const dots = {
      contracts: S.offers.length, finance: S.roundOffer ? 1 : 0, energy: (S.outage ? 1 : 0) + (S.heatWave ? 1 : 0) + (S.drought ? 1 : 0),
      affairs: S.policies.filter(p => p.announced && p.status === "proposed").length,
    };
    for (const k of Object.keys(vis)) {
      const b = $("db-" + k); show(b, vis[k]);
      b.setAttribute("aria-pressed", V.drawer === k);
      const dot = b.querySelector(".dot");
      if (dots[k]) { dot.hidden = false; dot.textContent = dots[k]; } else dot.hidden = true;
      b.classList.toggle("hot", false);   // v0.4: the order board on screen carries "offers waiting" (badge + fly-in)
    }
  }

  function renderBanners(st) {
    const B = [];
    const left = x => `${Math.max(0, Math.ceil(x.until - S.day))} d left`;
    if (on("facilities") && S.outage && S.day >= S.outage.start) B.push(S.ups ? ["warn", "bolt", "Grid outage: generator running", "Diesel costs money and carbon.", left(S.outage)]
      : ["bad", "bolt", "Grid outage: everything is down", "No backup power. Contracts miss their SLA.", left(S.outage)]);
    if (S.heatWave && S.day >= S.heatWave.start) B.push(["bad", "temp", `Heat wave: spot power ×${S.heatWave.mult}`, `Cooling −${K.HEATWAVE_COOL} kW per hall.${S.solar ? " Battery shaves the spike." : ""}`, left(S.heatWave)]);
    if (on("environment") && S.drought && S.day >= S.drought.start) B.push(["warn", "drop", "Drought: water capped", "Evaporative halls lose 40 % cooling.", left(S.drought)]);
    if (on("memory") && S.hbm.shortage) B.push(["warn", "layers", "HBM shortage", `GPU shipping ${K.SHORT_SHIP_DAYS} days, prices up. Forward orders skip the queue.`, `index ${S.hbm.index.toFixed(2)}`]);
    if (S.board && S.board.misses === 1) B.push(["bad", "flag", "Board warning", "Miss the next revenue target and you are fired.", `${Math.ceil(S.board.end - S.day)} d to review`]);
    if (S.policyFx.mandate && S.day < S.policyFx.mandate.deadline + 1 && st.halls.some(h => h.pue > K.MANDATE_PUE + 1e-9))
      B.push(["warn", "flag", "Efficiency mandate", `Every hall must reach PUE ${K.MANDATE_PUE} (evaporative) or pay fines.`, `${Math.max(0, Math.ceil(S.policyFx.mandate.deadline - S.day))} d`]);
    $("banners").innerHTML = B.map(([cls, ic, t, sub, right]) => `<div class="banner ${cls}">${icon(ic)}<span>${t} <small>${sub}</small></span><span class="t">${right}</span></div>`).join("");
  }

  function renderGoal(st) {
    const ch = CH[S.chapter].key, left = K.END_DAY - Math.floor(S.day);
    let tip;
    switch (ch) {
      case "racks": tip = S.offers.length ? "Sign offers you can deliver, then build the racks to serve them." : "Idle racks earn nothing: switch them Off."; break;
      case "power": tip = "Power is money. Idle racks cost nothing; eco mode trades output for power."; break;
      case "gpu": tip = "Match cards to work: compute cards to training, bandwidth cards to inference. Check the roofline in the rack panel."; break;
      case "heat": tip = S.day % 360 < 210 ? `Summer peaks around day ${360 * Math.floor(S.day / 360) + 200}. Heat builds slowly: prepare before it arrives.` : "Heat is easing. Watch your inlet temperatures next summer."; break;
      case "gens": tip = "New generations cut prices. Sell old cards before launches if you plan to replace them."; break;
      case "ops": { const f = S.racks.reduce((a, r) => a + r.devices.filter(d => d.failed).length, 0); tip = f ? `${f} failed part${f > 1 ? "s" : ""} on the floor. Spares swap in 1 day; repairs wait for parts.` : "Hot and brand-new parts fail most. Keep a spare or two on the shelf."; break; }
      case "fabric": tip = "Put 12+ training GPUs in one row with a spine to sell frontier training at 1.6x. Keep transit ahead of traffic."; break;
      case "contracts": tip = S.offers.length ? `${S.offers.length} offer${S.offers.length > 1 ? "s" : ""} waiting above the floor: Sign or Decline. Don't promise more than you can deliver.` : "Contracts lock today's price: a hedge before a known launch. New offers pop up above the floor."; break;
      case "memory": tip = S.hbm.shortage ? "Shortage: GPUs ship in 18 days. Forward orders and spares beat the queue." : "Scare stories come before shortages, but not every scare is real. Watch the follow-up news."; break;
      case "finance": tip = "Debt costs 9 %/yr. Leasing suits the generation you will replace soon."; break;
      case "facilities": { const nb = builtHalls().length; tip = nb >= 3 ? "Three halls on one grid: the 1000 kW tier keeps them all powered." : nb === 2 ? `Two halls share one grid. Consider the next grid tier${S.gridTier < 2 ? " (700 kW)" : ""}; Hall 3 adds 18 more racks.` : "Hall 2 doubles your floor. Outages hit harder without a UPS."; break; }
      case "energy": tip = "A PPA locks cheap green power for 540 days. Size it to your base load: unused PPA power is still paid for."; break;
      case "environment": tip = S.drought ? "Drought: evaporative halls lose cooling and reputation." : "Evaporative cooling is cheap until a drought. Chillers cost PUE."; break;
      case "investors": tip = S.board ? `Board target: ${money(S.board.rev)} of ${money(S.board.target)} revenue, ${Math.ceil(S.board.end - S.day)} days left.` : "VC money grows you faster, but every round dilutes your score and brings a board."; break;
      case "reputation": tip = `Reputation ${Math.round(Sim.repOf(S))}. SLA misses and outages cost it; fulfilled contracts and green power earn it.`; break;
      case "policy": tip = "Proposals pass or fail on a vote date. Signals hint at the odds; lobbying shifts them."; break;
      default: tip = "Read the benchmarks and the news before you bet. A pilot card costs little and tells the truth.";
    }
    // player-triggered chapters: the next unlock and its milestone (content.js `hint`), so progress is something you do
    const ni = Sim.nextChapter(S), nc = ni != null ? CH[ni] : null;
    const next = S.sandbox ? `<span class="nextch">Sandbox</span>` : nc ? `<span class="nextch" title="${esc(L("goal.next"))}: ${esc(nc.title)}. ${esc(nc.hint)}${S.day < nc.day ? ` (${esc(L("goal.nextFrom", { d: nc.day }))})` : ""}">${icon("lock")}<b>${esc(nc.title)}</b><span>${esc(nc.hint)}</span></span>`
      : `<span class="nextch">${icon("check")}${esc(L("goal.last"))}</span>`;
    $("goal").innerHTML = `<span class="gflag">${icon("flag", "color:var(--c-warn)")}</span><b>${CH[S.chapter].title}</b><span class="gtip" title="${esc(tip)}">${tip}</span>${next}`;
    $("goal").title = `${left} days left`;
  }

  function renderHallTabs() {
    const el = $("halltabs");
    if (!on("facilities") && builtHalls().length < 2) { el.innerHTML = ""; return; }
    const hj = S.jobs.find(j => j.kind === "buildHall");
    el.innerHTML = S.halls.map(h => {
      const n = h.n, built = h.built;
      const sub = built ? `${hallRacks(n).filter(r => r.devices.length).length}/${K.HALL_RACKS}` : hj && hj.hall === n ? `${Math.ceil(hj.left)} d` : "not built";
      return `<button data-hall="${n}" aria-pressed="${V.hall === n}">${icon("building")}Hall ${n} <small>${sub}</small></button>`;
    }).join("");
  }

  function renderModes() {
    const el = $("modes");
    const ms = MAP_MODES.filter(m => on(m.ch));
    if (!ms.some(m => m.key === V.mode)) V.mode = "role";
    el.innerHTML = ms.map(m => `<button data-mode="${m.key}" aria-pressed="${V.mode === m.key}" title="${m.label} map (V cycles)" aria-label="${m.label}">${icon(m.icon)}<span class="mlab">${m.label}</span></button>`).join("");
    renderLegend();
  }
  function renderLegend() {
    const LG = $("legend"), RP = ramps();
    const keys = list => `<div class="keys">${list.map(([c, n]) => `<span><i style="background:${c}"></i>${n}</span>`).join("")}</div>`;
    if (V.mode === "role") LG.innerHTML = keys(["web", "train", "infer", "tank"].filter(k => k !== "tank" || on("disrupt")).filter(k => k === "web" || on("gpu")).map(k => [R[k].color, R[k].name]));
    else if (V.mode === "gen") LG.innerHTML = keys([[COL.good, "Current"], [COL.warn, "One behind"], [COL.bad, "Two behind"]]);
    else if (V.mode === "cluster") LG.innerHTML = keys([0, 1, 2].map(i => [COL["row" + i], `Row ${builtHalls().map(n => hallLetters(n)[i]).join("/")} spine`]).concat([[COL.none, "No spine"]])) + `<span>${icon("star", `color:${COL.frontier};width:14px;height:14px`)} = frontier cluster (${K.FRONTIER_MIN_GPUS}+ training GPUs)</span>`;
    else {
      const lab = { heat: ["22 °C", "36 °C"], power: ["0 kW", "30 kW"], free: ["Full", "20U free"], fail: ["Safe", "1 %/day"] }[V.mode];
      LG.innerHTML = `<span>${lab[0]}</span><span class="ramp" style="background:linear-gradient(90deg,${RP[V.mode].join(",")})"></span><span>${lab[1]}</span>${V.mode === "fail" ? `<span>${icon("cross", `color:${COL.fail};width:14px;height:14px`)} failed part</span>` : ""}`;
    }
  }

  function rackHazard(r, pr) {
    let h = 0;
    for (const d of r.devices) if (!d.failed) h += Sim.hazard(S, d, item(d.type), pr.inlet);
    return h;
  }
  function rackColor(r, st) {
    const role = rackRole(r), pr = st.perRack[r.id], RP = ramps();
    if (V.mode === "role") return r.devices.length ? R[role].color : R[role].color + "55";
    if (V.mode === "heat") return ramp(RP.heat, (pr.inlet - 22) / 14);
    if (V.mode === "power") return ramp(RP.power, pr.kw / K.RACK_KW);
    if (V.mode === "gen") { const g = genBehind(r); return g == null ? COL.none : [COL.good, COL.warn, COL.bad][Math.min(2, g)]; }
    if (V.mode === "fail") return r.devices.length ? ramp(RP.fail, rackHazard(r, pr) / 0.01) : COL.none;
    if (V.mode === "cluster") {
      if (!pr.spine) return COL.none;
      const c = COL["row" + r.row];
      return pr.trainGpus > 0 ? c : lerp(c, COL.none, 0.55);
    }
    return ramp(RP.free, (K.RACK_U - Sim.usedU(S, r)) / K.RACK_U);
  }
  const jobFor = id => S.jobs.find(j => j.to === id || (j.kind === "tank" && j.rack === id) || ((j.kind === "repair" || j.kind === "swap") && j.rack === id));
  const jobFrac = j => Math.max(0, j.left / j.total);
  function jobLabel(j) {
    if (j.phase === "ship") return [icon("truck"), `${Math.ceil(j.left)}d`];
    if (j.phase === "parts") return [icon("box"), `${Math.ceil(j.left)}d`];
    if (j.phase === "wait") return [icon("wrench"), "queued"];
    return [icon("wrench"), `${Math.ceil(j.left)}d`];
  }

  /* placeholder for a hall that is not built yet: cost/days from the sim, one generic build button */
  function unbuiltHallHTML(n) {
    const hj = S.jobs.find(j => j.kind === "buildHall"), hc = Sim.hallCost(n), HLs = hallLetters(n);
    const body = hj && hj.hall === n ? `<span>Under construction: ${Math.ceil(hj.left)} days left</span><div class="bar"><i style="width:${Math.round((1 - jobFrac(hj)) * 100)}%"></i></div>`
      : hj ? `<span>Hall ${hj.hall} is under construction: ${Math.ceil(hj.left)} days left. One hall at a time.</span>`
      : `<span>${K.HALL_RACKS} more racks (${HLs[0]}1–${HLs[2]}${K.COLS}) on the same grid. ${money(hc.cost)}, ${hc.days} days to build.</span>${n > 1 && !S.halls[n - 2].built ? `<span class="sub">Build Hall ${n - 1} first.</span>` : ""}${actBtn({ type: "buildHall", hall: n }, `Build Hall ${n} · ${money(hc.cost)}`, { confirm: true, cls: "primary", icon: "building" })}`;
    return `<div class="hall2">${icon("building", "width:40px;height:40px")}<span class="big">Hall ${n}</span>${body}</div>`;
  }
  function renderFloor(st) {
    const F = $("floor");
    const curHall = S.halls[V.hall - 1];
    if (!curHall || !curHall.built) {
      F.innerHTML = unbuiltHallHTML(V.hall);
      return;
    }
    let h = "";
    const nowMs = performance.now();
    [[1, "cold", "Cold aisle"], [3, "hot", "Hot aisle"], [5, "cold", "Cold aisle"], [7, "hot", "Hot aisle"]].forEach(([row, k, l]) =>
      h += `<div class="aisle ${k}" style="grid-row:${row}">${icon(k === "cold" ? "snow" : "flame")}${l}</div>`);
    const hall = S.halls[V.hall - 1];
    [2, 4, 6].forEach((row, k) => h += `<div class="crac" style="grid-row:${row}" title="Room cooling unit ${k + 1}${hall.crac ? " (upgraded)" : ""}">${icon("snow")}<span>CRAC${hall.crac ? "+" : ""}</span></div>`);
    // grid / hall summary column
    const hs = st.halls.find(x => x.n === V.hall);
    const g = Sim.gridNext(S), gridJob = S.jobs.find(j => j.kind === "grid");
    const gridBody = gridJob ? `<span>${icon("wrench")} ${Math.ceil(gridJob.left)} days</span>`
      : g && on("power") ? actBtn({ type: "grid" }, `${g.kw} kW · ${money(g.cost)}`, { confirm: true, cls: "primary", icon: "bolt" }) : `<span>${S.gridTier ? "Upgraded" : ""}</span>`;
    h += `<div class="hall" title="Utility feed and hall climate">${icon("bolt", "width:26px;height:26px;color:var(--pow-c)")}<span class="big">Grid</span><span>${st.kw.toFixed(0)} / ${S.gridKw} kW</span>${gridBody}
      ${hs ? `<span style="margin-top:6px">${icon("temp")} ${hs.roomT.toFixed(1)} °C</span><span>${hs.cooling === "evap" ? "Evaporative" : "Chiller"}${on("environment") ? ` · PUE ${hs.pue}` : ""}</span>` : ""}</div>`;
    // spine slots at row ends, each with the row's frontier-cluster meter (P1: "6/12 and nothing happens" was invisible)
    for (let row = 0; row < 3; row++) {
      const key = `${V.hall}-${row}`, pos = `grid-row:${[2, 4, 6][row]}`;
      if (!on("fabric")) { h += `<div class="spine locked" style="${pos}"></div>`; continue; }
      const job = S.jobs.find(j => j.kind === "spine" && j.key === key), cl = st.cluster[key];
      const cm = clusterMeter(V.hall, row, st), meter = `<span class="cmeter${cm.n >= K.FRONTIER_MIN_GPUS ? " full" : ""}"><i style="width:${Math.round(cm.f * 100)}%"></i></span><span class="cnum">${cm.n}/${K.FRONTIER_MIN_GPUS}</span>`;
      if (S.spines[key]) h += `<div class="spine built${cl && cl.frontier ? " frontier" : ""}" style="${pos}" data-spine="${key}" title="${esc(cm.tip)}">${icon(cl && cl.frontier ? "star" : "switch", cl && cl.frontier ? `color:${COL.frontier}` : "")}${meter}<span>${cl && cl.frontier ? `×${K.FRONTIER_PRICE}` : "GPU"}</span></div>`;
      else if (job) h += `<div class="spine" style="${pos}" title="Spine under construction. ${esc(cm.tip)}">${icon("wrench")}<span>${Math.ceil(job.left)}d</span><span class="prog"><i style="width:${Math.round((1 - jobFrac(job)) * 100)}%"></i></span>${meter}</div>`;
      else {
        const k2 = JSON.stringify({ type: "spine", hall: V.hall, row }), armed = V.confirm === k2 && performance.now() - V.confirmT < CONFIRM_MS;
        h += `<button class="spine${V.armed && V.armed.kind === "spine" ? " armed-target" : ""}" style="${pos}" data-spine="${key}" data-act='${esc(k2)}' data-confirm title="Row spine: pools the row's GPUs into one cluster. ${money(K.SPINE_COST)}, ${K.SPINE_DAYS} days, ${K.SPINE_KW} kW. Click twice or drag the spine card here. ${esc(cm.tip)}">${icon(armed ? "check" : "plus")}<span>${armed ? "confirm" : "spine"}</span>${armed ? `<span>${money(K.SPINE_COST)}</span>` : cm.n ? meter : ""}</button>`;
      }
    }
    for (const r of hallRacks(V.hall)) {
      const row = [2, 4, 6][r.row], col = r.col + 2;
      const role = rackRole(r), free = K.RACK_U - Sim.usedU(S, r), job = jobFor(r.id), pr = st.perRack[r.id];
      const pos = `grid-row:${row};grid-column:${col}`;
      const prog = job ? `<span class="prog" data-prog="${r.id}">${progInner(job)}</span>` : "";
      const tgt = V.armed ? " armed-target" : "", ms = V.multi.has(r.id) ? " msel" : "";
      if (role === "empty" || (r.tank && !r.devices.length && !r.pending.length)) {
        h += `<button class="rack empty${r.tank ? " tank" : ""}${tgt}${ms}" style="${pos}" data-rack="${r.id}" aria-pressed="${r.id === V.selected}" aria-label="${r.id}: ${r.tank ? "empty immersion tank" : "empty rack"}, ${free}U free"><span class="plus">${icon(r.tank ? "drop" : "plus")}</span><span class="id">${r.id}</span>${prog}</button>`;
        continue;
      }
      const flags = [];
      if (pr.throttle < 1) flags.push("flame");
      if (pr.penalty < 1 || r.devices.some(d => Sim.isDead(S, item(d.type)))) flags.push("warn");
      else if (pr.netF < 1) flags.push("net");
      const gb = genBehind(r); if (gb != null && gb >= 2) flags.push("clock");
      if (pr.frontier && pr.trainGpus) flags.push("star");
      const nFail = r.devices.filter(d => d.failed).length, nLease = r.devices.concat(r.pending).filter(d => d.leased).length;
      if (nLease) flags.push("tag");   // leased parts: a tag icon (the rack tile is too short for a text badge at 720p)
      const nosw = noSwitch(r, pr);
      // v4 links: the contracts this rack's output goes to, as coloured segments (width = units); unallocated output = idle
      const to = {};
      for (const x of pr.to || []) to[x.id] = (to[x.id] || 0) + x.u;
      const made = (pr.out ? pr.out.web + pr.out.train + pr.out.infer : 0), used = Object.values(to).reduce((a, x) => a + x, 0);
      const idle = r.mode !== "off" && Sim.contractsOn(S) && made - used >= Math.max(1.5, 0.25 * made) && !nosw;
      const links = Object.keys(to).length || idle ? `<span class="links">${Object.entries(to).map(([id, u]) => `<i style="background:${QOL.linkColor(id)};flex:${u.toFixed(2)}"></i>`).join("")}${idle ? `<i class="idle" style="flex:${(made - used).toFixed(2)}"></i>` : ""}</span>` : "";
      const tip = `${r.id}: ${R[role].name}. ${perDay(pr.rev)}, ${pr.kw.toFixed(1)} kW, inlet ${pr.inlet.toFixed(1)} °C, ${free}U free${nosw ? ". No switch: delivers nothing" : ""}${r.mode === "off" ? ". Off" : idle ? `. ${L("rack.idle")}` : ""}${pr.netF < 1 && !nosw ? `, network short (${Math.round(pr.netF * 100)} %)` : ""}${pr.throttle < 1 ? `, throttled to ${Math.round(pr.throttle * 100)} %` : ""}${nFail ? `, ${nFail} failed` : ""}${nLease ? `, ${nLease} leased` : ""}`;
      // idle life (display only): fan speed follows the rack's kW, LED blink rate follows how much of it is delivered.
      // Negative animation-delay keeps the phase continuous across the floor's re-renders.
      const load = clamp01(pr.kw / K.RACK_KW), util = pr.rev > 0.01 ? clamp01(pr.throttle * Math.min(1, pr.netF == null ? 1 : pr.netF)) : 0;
      const fanDur = 1.7 - 1.35 * load, ledDur = 0.3 + 1.5 * (1 - util), tS = nowMs / 1000;
      const fan = pr.kw > 0.05 ? `<span class="fan" style="animation-duration:${fanDur.toFixed(2)}s;animation-delay:${(-(tS % fanDur)).toFixed(2)}s"></span>` : "";
      const led = util > 0 ? ` style="animation-duration:${ledDur.toFixed(2)}s;animation-delay:${(-(tS % ledDur)).toFixed(2)}s"` : "";
      const fillCol = rackColor(r, st), prevCol = V.fillPrev[r.id];
      V.fillPrev[r.id] = fillCol;
      const fillStyle = prevCol && prevCol !== fillCol ? `background:${prevCol}" data-fill="${fillCol}` : `background:${fillCol}`;   // cross-fade: start at the old colour
      const st8 = `${nosw ? " nosw" : ""}${pr.throttle < 1 ? " hot" : ""}${r.mode === "off" ? " off" : ""}${idle ? " idle" : ""}`;
      h += `<button class="rack ${r.row === 1 ? "front-bottom" : "front-top"}${r.tank ? " tank" : ""}${tgt}${ms}${st8}" style="${pos}" data-rack="${r.id}" aria-pressed="${r.id === V.selected}" aria-label="${esc(tip)}">
        <span class="fill" style="${fillStyle}"></span>${fan}<span class="front${util > 0 ? " blink" : ""}${nFail ? " bad" : ""}"${led}></span>
        ${pr.rev > 0.05 ? `<span class="earn">$${pr.rev.toFixed(1)}k</span>` : ""}
        <span class="flags">${flags.map(f => icon(f, f === "star" ? `color:${COL.frontier}` : f === "tag" ? `color:${COL.lease}` : "")).join("")}</span><span class="id">${r.id}</span>${free ? `<span class="free">${free}U</span>` : ""}
        ${nFail ? `<span class="xmark" title="${nFail} failed">${icon("cross")}</span>` : ""}${nosw ? `<span class="noswitch" aria-hidden="true">${icon("unplug")}</span>` : ""}${r.mode === "off" ? `<span class="offmark" aria-hidden="true">${icon("power")}</span>` : ""}${links}${prog}</button>`;
    }
    F.innerHTML = h;
    floorLife(F, nowMs);
  }
  /* frontier cluster progress for one row: installed training GPUs (non-tank racks), toward FRONTIER_MIN_GPUS */
  function clusterMeter(hall, row, st) {
    const rs = S.racks.filter(r => r.hall === hall && r.row === row && !r.tank);
    const n = rs.reduce((a, r) => a + ((st.perRack[r.id] || {}).trainGpus || 0), 0);
    const coming = rs.reduce((a, r) => a + (r.workload === "train" ? r.pending.filter(d => item(d.type).role === "gpu").length : 0), 0);
    const hasSpine = !!S.spines[`${hall}-${row}`], RL = hallLetters(hall)[row], need = K.FRONTIER_MIN_GPUS;
    const tip = `Row ${RL} cluster: ${n}/${need} training GPUs${coming ? ` (+${coming} on the way)` : ""} → frontier training ×${K.FRONTIER_PRICE} at ${need}` +
      (n >= need ? (hasSpine ? ". Frontier price active." : ". Build the row spine to unlock it.") : `. ${need - n} more${hasSpine ? "" : ", plus a row spine"}. Partial clusters earn the normal training price.`);
    return { n, coming, f: Math.min(1, n / need), tip, hasSpine, L: RL };
  }
  /* post-render juice for the floor: colour cross-fades, cold-air drift phase, calendar tint, rack animations */
  function floorLife(F, nowMs) {
    F.style.setProperty("--drift-delay", (-((nowMs / 1000) % 1.6)).toFixed(2) + "s");
    const doy = S.day % 360, warm = Math.cos(2 * Math.PI * (doy - 200) / 360);   // summer peaks ~day 200 (same as the goal hint)
    F.style.setProperty("--season", warm > 0 ? `rgba(255,140,40,${(0.07 * warm).toFixed(3)})` : `rgba(70,140,255,${(0.07 * -warm).toFixed(3)})`);
    const fades = F.querySelectorAll("[data-fill]");
    if (fades.length) requestAnimationFrame(() => fades.forEach(el => { el.style.background = el.dataset.fill; el.removeAttribute("data-fill"); }));
    if (FXON()) {
      FX.afterFloor(F);
      if (V.rectHall !== V.hall) { V.rectHall = V.hall; FX.clearRects(); }
      if (!V.floorRO && window.ResizeObserver) { V.floorRO = new ResizeObserver(() => FX.clearRects()); V.floorRO.observe(F); }
    }
    if (V.hl) applyHighlight();
  }

  /* a job's progress chip on the floor: icon, days, bar, and a ✕ that cancels it (sim cancelJob) when that is allowed */
  function cancelX(j) {
    const res = Sim.check(S, { type: "cancelJob", id: j.id });
    return res.ok ? `<span class="jx" role="button" tabindex="0" data-canceljob="${j.id}" title="${esc(L("job.cancel"))}: ${esc(res.msg)}" aria-label="${esc(L("job.cancel"))}">${icon("cross")}</span>` : "";
  }
  /* cached by what the chip shows (phase, whole days, bar %, cash bucket for the ✕ check): renderProgress runs every frame */
  const progCache = new Map();
  function progInner(j) {
    const w = Math.round((1 - jobFrac(j)) * 100), key = `${j.id}|${j.phase}|${Math.ceil(j.left)}|${w}|${Math.floor(S.cash / 5)}`;
    const c = progCache.get(j.id);
    if (c && c.key === key) return c.html;
    const [ic, txt] = jobLabel(j);
    const html = `${ic}${txt}${cancelX(j)}<i style="width:${w}%"></i>`;
    if (progCache.size > 400) progCache.clear();
    progCache.set(j.id, { key, html });
    return html;
  }
  function renderProgress() {
    document.querySelectorAll("[data-prog]").forEach(el => {
      const j = jobFor(el.dataset.prog); if (!j) return;
      const html = progInner(j);
      if (el._h !== html) { el._h = html; el.innerHTML = html; }
    });
    const jl = $("jobs");
    if (jl) {
      const k = S.jobs.filter(j => j.to === V.selected || j.rack === V.selected).map(j => `${j.id}${j.phase}${Math.round(j.left * 10)}`).join() + "|" + V.selected + "|" + Math.floor(S.cash / 5);
      if (jl._k !== k) { jl._k = k; const html = jobsHTML(); if (jl._h !== html) { jl._h = html; jl.innerHTML = html; } }
    }
    renderSold();
  }

  function renderShelf() {
    const wrap = $("shelf-wrap");
    show(wrap, on("ops"));
    if (!on("ops")) return;
    const incoming = S.jobs.filter(j => j.toShelf);
    let h = "";
    for (const d of S.shelf) {
      const it = item(d.type), armed = V.armed && V.armed.kind === "shelf" && V.armed.uid === d.uid;
      h += `<button class="slot card${d.failed ? " failed" : ""}" data-drag="shelf" data-uid="${d.uid}" aria-pressed="${!!armed}" style="background:${ITEM_COLOR(it)}" title="${esc(it.name)}${d.failed ? " (failed: click to repair)" : ""}. Drag onto a rack to install, or onto a failed part to swap.">${icon(it.icon)}<span>${esc(it.name.split(" ").pop())}</span></button>`;
    }
    for (const j of incoming) {
      const it = item(j.dev.type);
      const what = j.kind === "forward" ? `Forward order ${it.name}: arrives in ${Math.ceil(j.left)} days` : j.kind === "swap" ? `Failed part returning after swap` : `${it.name} coming to the shelf`;
      h += `<div class="slot incoming" title="${esc(what)}">${icon(j.kind === "forward" || j.kind === "restock" ? "truck" : "wrench")}<span>${j.kind === "swap" ? "swap" : esc(it.name.split(" ").pop())}</span><span>${Math.ceil(j.left)}d</span>${cancelX(j)}<span class="sp" style="width:${Math.round((1 - jobFrac(j)) * 100)}%"></span></div>`;
    }
    for (let i = S.shelf.length + incoming.length; i < K.SHELF; i++) h += `<div class="slot"></div>`;
    $("shelf").innerHTML = h;
    // compact header (the stage has no room for the hint line): count inline, the how-to in the tooltip
    $("shelf-n").textContent = `${Sim.shelfLoad(S)}/${K.SHELF}`;
    $("shelf-wrap").querySelector(".shelf-head").title = `Spares shelf, ${Sim.shelfLoad(S)}/${K.SHELF}. Drag a card from a rack to store it; drag a spare onto a failed part to swap it in 1 day.${on("memory") ? " Drag a GPU from the catalog here to order it forward (today's price, 45 days)." : ""}`;
  }

  function renderTray() {
    const shop = Sim.shopItems(S), cg = Sim.currentGen(S), leasing = V.lease && on("finance");
    // header: HBM index + buy/lease switch
    let tools = "";
    if (on("memory")) {
      const hv = S.history.slice(-60).map(x => x.hbm).filter(x => x != null);
      tools += `<span class="hbm" title="HBM memory price index. GPU prices = base x (0.55 + 0.45 x index).">${icon("layers", `color:${COL.mem}`)}HBM <b>${S.hbm.index.toFixed(2)}</b>${spark(hv, 90, 24, COL.mem, { ref: 1, label: "HBM index" })}${S.hbm.shortage ? `<span class="badge-short">SHORTAGE</span>` : ""}</span>`;
    }
    if (on("finance")) tools += `<span class="buylease" role="group" aria-label="Buy or lease"><button data-lease="0" aria-pressed="${!leasing}">${icon("coin")}Buy</button><button data-lease="1" aria-pressed="${leasing}">${icon("tag")}Lease</button></span>`;
    $("tray-title").innerHTML = `<h2>Catalog</h2><span class="soldbar" id="soldbar" aria-live="polite"></span><span class="tthint">${leasing ? `Leasing: no upfront cost, ${(K.LEASE_RATE * 100).toFixed(2)} % of list price per day. GPUs only.` : `Drag onto a rack (or tap a card, then a rack). Ships in ${K.SHIP_DAYS} days, then a technician installs it in ${K.INSTALL_DAYS}.`}</span><span class="tools">${tools}</span>`;
    let h = shop.map(k => {
      const it = item(k), color = ITEM_COLOR(it), canLease = it.role === "gpu";
      let badge = "";
      if (leasing && canLease) badge = `<span class="badge lease">LEASE $${(it.price * K.LEASE_RATE).toFixed(2)}k/d</span>`;
      else if (it.key === "pm9") badge = `<span class="badge pitch">${it.price <= Sim.BASE_ITEMS.pm9.price * 0.5 ? "60 % OFF" : "30 % OFF"}</span>`;
      else if (it.role === "exotic") badge = `<span class="badge pilot">NEW TECH</span>`;
      else if (it.role === "gpu" && it.gen < cg) badge = `<span class="badge old">OLD GEN</span>`;
      else if (it.avail > 0 && S.day - it.avail < 40) badge = `<span class="badge">NEW</span>`;
      const fb = (it.role === "gpu" || it.role === "exotic") ? `<span class="fb" title="Spec sheet: compute and memory bandwidth">${icon("cpu", "width:12px;height:12px")}<i style="width:${Math.min(100, it.F * 1.6)}%;background:${COL.train}"></i>${icon("layers", "width:12px;height:12px")}<i style="width:${Math.min(100, it.B * 1.6)}%;background:${COL.infer}"></i></span>` : "";
      const extra = it.cool ? `, +${it.cool} kW cooling` : it.net ? `, carries ${it.net} network` : it.boost ? ", +25 % GPU bandwidth in its rack (vendor claim)" : it.tank ? `, runs ${it.only === "train" ? "training" : "inference"} only, immersion tank rack only` : "";
      const armed = V.armed && V.armed.kind === "new" && V.armed.item === k;
      const dim = leasing && !canLease ? ' style="opacity:.45"' : "";
      return `<button class="item" data-drag="new" data-item="${k}" data-lease="${canLease ? 1 : 0}" aria-pressed="${!!armed}"${dim} title="${esc(`${it.name}: ${it.u}U, ${it.kw} kW, ${money(it.price)}${it.F ? `, compute ${it.F}, bandwidth ${it.B}` : ""}${extra}`)}">${badge}
        <span class="top"><span class="av" style="background:${color}">${icon(it.icon)}</span><strong>${it.name}</strong></span>
        <span class="ublocks">${"<b></b>".repeat(it.u)}</span>${fb}
        <span class="row"><span>${icon("bolt", "color:var(--pow-c)")}${it.kw}</span><span class="price">${money(it.price)}</span></span>
      </button>`;
    }).join("");
    if (on("fabric")) {
      const armed = V.armed && V.armed.kind === "spine";
      h += `<button class="item facility" data-drag="spine" aria-pressed="${!!armed}" title="Row spine switch: drag onto the slot at the end of a row (or onto any rack in it). Pools the row into one training cluster.">
        <span class="top"><span class="av" style="background:${COL.frontier}">${icon("net")}</span><strong>Row spine</strong></span>
        <span class="sub" style="font-size:11.5px;color:var(--ink-2)">${K.SPINE_DAYS} days to build</span>
        <span class="row"><span>${icon("bolt", "color:var(--pow-c)")}${K.SPINE_KW}</span><span class="price">${money(K.SPINE_COST)}</span></span></button>`;
    }
    $("tray").innerHTML = h;
    $("soldbar")._h = null;
    renderSold();
    refreshAfford(true);
  }
  /* "Sold · Undo" chips: a sale can be bought back for exactly its price within K.UNSELL_DAYS (sim undoSell); the bar is
     the countdown in game days. Next to the shelf and catalog, so the fix sits where the mistake is noticed. */
  function renderSold() {
    const el = $("soldbar"); if (!el || !S) return;
    const list = (S.recentlySold || []).filter(x => x.until > S.day).slice(-3).reverse();
    const html = list.map(x => {
      const it = item(x.type), f = clamp01((x.until - S.day) / K.UNSELL_DAYS);
      return `<span class="soldchip">${icon("coin")}<span>${esc(L("sold.chip", { name: it.name.split(" ").pop() }))}</span>${actBtn({ type: "undoSell", uid: x.uid, rack: x.rack }, L("sold.undo"), { cls: "slim2", icon: "undoarrow" })}<i style="width:${(f * 100).toFixed(1)}%"></i></span>`;
    }).join("");
    // rebuild only when the list or a rounded countdown changes (buttons must not be replaced under the pointer)
    const key = list.map(x => x.uid + ":" + Math.ceil(x.until - S.day)).join() + "|" + (S.cash >= 0);
    if (el._h === key) { el.querySelectorAll(".soldchip").forEach((c, i) => { const x = list[i]; if (x) c.querySelector("i").style.width = (clamp01((x.until - S.day) / K.UNSELL_DAYS) * 100).toFixed(1) + "%"; }); return; }
    if (V.down) return;
    el._h = key; el.innerHTML = html;
  }

  function jobsHTML() {
    if (!V.selected) return "";
    const mine = S.jobs.filter(j => j.to === V.selected || j.rack === V.selected);
    return mine.map(j => {
      const [ic, txt] = jobLabel(j);
      const verb = { sell: "Selling", move: "Moving in", tank: "Building tank", store: "To the shelf", unstore: "From the shelf", returnLease: "Returning lease",
        repair: j.phase === "parts" ? "Waiting for parts" : "Repairing", swap: "Swapping in a spare" }[j.kind] || (j.phase === "ship" ? "Shipping" : "Installing");
      return `<div>${ic}<span>${verb}${j.dev ? " " + esc(item(j.dev.type).name) : ""}</span><span style="text-align:right">${txt}</span>${cancelX(j) || "<span></span>"}<span class="t"><i style="width:${Math.round((1 - jobFrac(j)) * 100)}%"></i></span></div>`;
    }).join("");
  }

  function rooflineSVG(r, extraKey, title) {
    const keys = [...new Set(r.devices.concat(r.pending).map(d => d.type).filter(k => item(k).role === "gpu").concat(extraKey && item(extraKey) && item(extraKey).role === "gpu" ? [extraKey] : []))];
    if (!keys.length) return "";
    const W = 280, H = 118, x0 = 26, y0 = 100, xs = I => x0 + (Math.log2(I) + 2) / 5 * (W - x0 - 8), maxY = Math.max(...keys.map(k => item(k).F)) * 1.25, ys = v => y0 - v / maxY * 88;
    let h = `<line x1="${x0}" y1="${y0}" x2="${W - 6}" y2="${y0}" stroke="var(--line)"/><line x1="${x0}" y1="8" x2="${x0}" y2="${y0}" stroke="var(--line)"/>`;
    for (const w of Sim.WORKLOADS) {
      const x = xs(Sim.INTENSITY[w]), cur = r.workload === w;
      h += `<line x1="${x}" y1="10" x2="${x}" y2="${y0}" stroke="${R[w].color}" stroke-dasharray="3 3" stroke-width="${cur ? 2 : 1}" opacity="${cur ? 1 : .5}"/><text x="${x + 3}" y="18" style="fill:${R[w].color};font-weight:${cur ? 600 : 400}">${R[w].name}</text>`;
    }
    const boost = r.devices.some(d => item(d.type).role === "mem" && !Sim.isDead(S, item(d.type)) && !d.failed) ? 1.25 : 1;
    keys.forEach(k => {
      const it = item(k), pts = [];
      for (let e = -2; e <= 3.01; e += 0.25) { const I = Math.pow(2, e); pts.push(`${xs(I).toFixed(1)},${ys(Math.min(it.F, it.B * boost * I)).toFixed(1)}`); }
      const I = Sim.INTENSITY[r.workload], v = Math.min(it.F, it.B * boost * I);
      h += `<polyline points="${pts.join(" ")}" fill="none" stroke="${ITEM_COLOR(it)}" stroke-width="2.5" opacity="${k === extraKey ? .6 : 1}"/>`;
      h += `<circle cx="${xs(I)}" cy="${ys(v)}" r="4" fill="${ITEM_COLOR(it)}" stroke="var(--panel)" stroke-width="1.5"/><text x="${xs(I) + 6}" y="${ys(v) + 4}" style="fill:var(--ink);font-weight:600">${it.name.split(" ")[1]} ${v.toFixed(1)}</text>`;
    });
    h += `<text x="${x0}" y="${H - 2}">math per byte →</text><text x="2" y="12">out</text>`;
    const it0 = item(keys[0]), I0 = Sim.INTENSITY[r.workload];
    const bound = it0.B * boost * I0 < it0.F ? "memory-bound" : "compute-bound";
    return `<div class="roof"><div class="sub">${title || `${icon("gauge", "width:14px;height:14px;vertical-align:-2px")} Roofline: ${it0.name} is <b>${bound}</b> on ${R[r.workload].name.toLowerCase()}`}</div><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Roofline chart">${h}</svg></div>`;
  }

  function devInfoHTML(r, pr) {
    const d = r.devices.find(x => x.uid === V.selDev);
    if (!d) return "";
    const it = item(d.type), age = Math.floor(S.day - (d.inst != null ? d.inst : d.born));
    const haz = on("ops") ? Sim.hazard(S, d, it, pr.inlet) : 0;
    const job = hasJob(d.uid);
    const tags = [d.failed ? `<span class="tagpill fail">FAILED</span>` : `<span class="tagpill ok">RUNNING</span>`, d.leased ? `<span class="tagpill lease">LEASED $${d.leaseRate.toFixed(2)}k/d</span>` : ""].join("");
    const btns = [];
    if (d.failed && !job) {
      const spare = S.shelf.some(x => x.type === d.type && !x.failed);
      btns.push(actBtn({ type: "repair", uid: d.uid }, spare ? "Swap in spare" : "Repair", { icon: "wrench" }));
      if (spare) btns.push(actBtn({ type: "repair", uid: d.uid, useSpare: false }, "Repair instead", { icon: "box" }));
    }
    if (d.leased && !job) btns.push(actBtn({ type: "returnLease", rack: r.id, uid: d.uid }, "Return lease", { icon: "tag" }));
    if (!d.leased && !job && on("ops")) btns.push(actBtn({ type: "store", rack: r.id, uid: d.uid }, "To shelf", { icon: "box" }));
    if (!d.leased && !job) btns.push(actBtn({ type: "sell", rack: r.id, uid: d.uid }, `Sell ${money(Sim.resale(S, d))}`, { icon: "coin" }));
    return `<div class="devinfo"><div class="row"><b>${esc(it.name)}</b>${tags}</div>
      <div class="kv"><span>Age ${age} d</span>${on("ops") ? `<span>Failure risk ${(haz * 100).toFixed(2)} %/day</span>` : ""}${job ? `<span>${icon("wrench", "width:13px;height:13px")} job pending</span>` : ""}</div>
      ${btns.length ? `<div class="row">${btns.join("")}</div>` : ""}</div>`;
  }

  /* the contracts a rack serves, in their link colours (or "idle: no contract") */
  function serveLine(pr) {
    if (!Sim.contractsOn(S)) return "";
    const to = {};
    for (const x of pr.to || []) to[x.id] = (to[x.id] || 0) + x.u;
    const ids = Object.keys(to);
    if (!ids.length) return (pr.out && pr.out.web + pr.out.train + pr.out.infer > 0.05) ? ` · <span class="idletag">${esc(L("rack.idle"))}</span>` : "";
    return " · " + ids.map(id => { const c = S.contracts.find(x => x.id === id); return `<span class="servetag" style="--lc:${QOL.linkColor(id)}">${esc(c ? c.cust.split(" ")[0] : id)} ${to[id].toFixed(1)}u</span>`; }).join(" ");
  }
  function renderDetail(st) {
    const r = V.selected && rack(V.selected);
    $("tab-rack-lbl").textContent = r ? `Rack ${r.id}` : "Rack";
    if (!r) { $("detail").innerHTML = `<h2>${icon("building")}Hall ${V.hall}</h2><div class="sub" style="margin-top:6px">Not built yet. ${on("facilities") ? `Build it from the Hall ${V.hall} tab or the Energy drawer.` : ""}</div>`; return; }
    const role = rackRole(r), pr = st.perRack[r.id], unit = 10.2;
    let elev = "";
    r.devices.forEach(d => {
      const it = item(d.type), dead = Sim.isDead(S, it);
      const cls = ["dev", d.failed ? "failed" : "", d.leased ? "leased" : ""].join(" ");
      elev += `<button class="${cls}" data-drag="dev" data-rack="${r.id}" data-uid="${d.uid}"${d.failed ? ` data-drop-fail="${d.uid}"` : ""} aria-pressed="${V.selDev === d.uid}" style="height:${it.u * unit}px;background-color:${dead ? "#555555" : ITEM_COLOR(it)}" title="${esc(`${it.name}, ${it.u}U, ${it.kw} kW${dead ? ", DEAD (vendor gone)" : ""}${d.failed ? ", FAILED: drop a spare here or click to repair" : ""}${d.leased ? ", leased" : ""}. Drag to another rack to move, to the shelf to store, or to the bin to ${d.leased ? "return" : `sell for ${money(Sim.resale(S, d))}`}`)}">${it.u > 1 || it.role === "net" ? icon(dead ? "warn" : d.failed ? "cross" : it.icon) : ""}</button>`;
    });
    r.pending.forEach(d => { const it = item(d.type); elev += `<div class="pend" style="height:${it.u * unit}px" title="${esc(it.name)}, on its way">${it.u > 1 ? icon("truck") : ""}</div>`; });
    const free = K.RACK_U - Sim.usedU(S, r);
    if (free) elev += `<div class="e" style="height:${free * unit}px"></div>`;
    const g = (ic, col, v, label, key) => `<div class="g"${key ? ` data-g="${key}"` : ""}>${icon(ic, `color:${col}`)}<div class="track"><i style="width:${Math.round(clamp01(v) * 100)}%;background:${col}"></i></div><small>${label}</small></div>`;
    const hasGpu = r.devices.concat(r.pending).some(d => item(d.type).role === "gpu");
    const nFail = r.devices.filter(d => d.failed).length;
    const nosw = noSwitch(r, pr);
    const status = role === "empty" ? (r.tank ? "Empty tank. Takes Lattice/Photon cards and a switch." : "Drag hardware here to start using this rack")
      : nosw ? `<span class="nosw-status">${icon("switch")} No switch: this rack earns <b>$0</b> until one is installed</span>`
      : nFail ? `${icon("cross", `color:${COL.fail}`)} ${nFail} failed part${nFail > 1 ? "s" : ""}: click it to repair, or drop a spare on it`
      : pr.penalty < 1 ? `${icon("warn")} Unsupported part is crashing this rack (60 %)`
      : pr.throttle < 1 ? `${icon("flame")} Too hot: running at ${Math.round(pr.throttle * 100)} %`
      : pr.netF < 1 && pr.netNeed > 0 ? `${icon("net")} Network short: ${pr.netProv} of ${pr.netNeed} needed`
      : r.mode === "off" ? `${icon("power")} ${esc(L("rack.off"))}`
      : `${perDay(pr.rev)} revenue${pr.frontier && pr.trainGpus ? " · frontier cluster" : ""}${serveLine(pr)}`;
    const wl = on("gpu") && hasGpu && !r.tank ? `<div class="wl" role="group" aria-label="Workload">${Sim.WORKLOADS.map(w => `<button data-wl="${w}" aria-pressed="${r.workload === w}" style="${r.workload === w ? `background:${R[w].color}` : ""}">${icon(R[w].icon, "width:14px;height:14px")}${R[w].name}</button>`).join("")}</div>` : "";
    // power modes: Off (park idle hardware: 0 kW, 0 output) from chapter 1; Eco / Boost with the power chapter
    const modeKeys = Object.keys(Sim.MODES).filter(k => on("power") || k === "std" || k === "off");
    const modes = r.devices.length || r.pending.length ? `<div class="seg" role="group" aria-label="Power mode">${modeKeys.map(k => { const m = Sim.MODES[k]; return `<button data-pmode="${k}" aria-pressed="${r.mode === k}" title="${m.label}: ${Math.round(m.out * 100)} % output, ${Math.round(m.kw * 100)} % power">${icon(MODE_ICON[k] || "gauge")}${m.label}</button>`; }).join("")}</div>` : "";
    const meas = [], seen = new Set();
    for (const d of r.devices) {
      const it = item(d.type);
      if (it.role !== "exotic" || seen.has(it.key)) continue;
      seen.add(it.key);
      if (Sim.isDead(S, it)) meas.push(`<div class="meas bad">${icon("warn")} ${it.name}: vendor gone, card is dead weight</div>`);
      else if (S.measured[it.vendor] != null) meas.push(`<div class="meas ${S.measured[it.vendor] < 0.95 ? "bad" : "good"}">${icon("gauge")} ${it.name} measured: <b>${Math.round(S.measured[it.vendor] * 100)} %</b> of its spec sheet</div>`);
      else meas.push(`<div class="meas">${icon("clock")} ${it.name}: measuring field performance (${K.PILOT_DAYS} days in a rack)…</div>`);
    }
    const swBtn = nosw ? `<div class="addsw">${actBtn({ type: "buy", item: "sw", rack: r.id }, `Add switch · ${money(item("sw").price)}`, { cls: "primary", icon: "switch" })}<span class="sub">Every rack needs one (${K.SWITCH_NET} network, ${K.SHIP_DAYS + K.INSTALL_DAYS} days).</span></div>` : "";
    const tankBtn = on("disrupt") && !r.tank && !r.devices.length && !r.pending.length && !jobFor(r.id)
      ? `<div style="margin-top:10px">${actBtn({ type: "tank", rack: r.id }, `Convert to immersion tank · ${money(K.TANK_COST)}`, { confirm: true, icon: "drop" })}</div>` : "";
    const armedItem = V.armed && V.armed.kind === "new" ? V.armed.item : null;
    let clusterLine = "";
    if (on("fabric") && !r.tank && (hasGpu || S.spines[`${r.hall}-${r.row}`])) {
      const cm = clusterMeter(r.hall, r.row, st);
      clusterLine = `<div class="clusterline" title="${esc(cm.tip)}">${icon(cm.n >= K.FRONTIER_MIN_GPUS && cm.hasSpine ? "star" : "net", `color:${COL.frontier}`)}<span>Row ${cm.L} cluster <b>${cm.n}/${K.FRONTIER_MIN_GPUS}</b> training GPUs → frontier ×${K.FRONTIER_PRICE}${cm.hasSpine ? "" : " <small>(needs a spine)</small>"}</span><span class="cmeter wide${cm.n >= K.FRONTIER_MIN_GPUS ? " full" : ""}"><i style="width:${Math.round(cm.f * 100)}%"></i></span></div>`;
    }
    $("detail").innerHTML = `
      <h2><span style="width:14px;height:14px;border-radius:3px;background:${role === "empty" ? "var(--line)" : R[role].color};display:inline-block"></span>${r.id}<span class="sub" style="font-family:var(--sans);font-weight:400">${R[role].name}${builtHalls().length > 1 ? ` · Hall ${r.hall}` : ""}</span>${role !== "empty" ? `<span class="rtools"><button class="btn slim2" data-dup="${r.id}" title="${esc(L("rack.duplicateTip"))}">${icon("copy")}${esc(L("rack.duplicate"))}</button></span>` : ""}</h2>
      <div class="sub" style="display:flex;align-items:center;gap:6px;margin-top:4px">${status}</div>${swBtn}
      <div class="rack-detail">
        <div class="elev" data-drop-rack="${r.id}" title="Front view, 20U">${elev}</div>
        <div class="gauges">
          ${g("temp", ramp(ramps().heat, (pr.inlet - 22) / 14), (pr.inlet - 18) / 18, `Inlet ${pr.inlet.toFixed(1)} °C${pr.throttle < 1 ? " · throttling" : ""}`)}
          ${g("bolt", "var(--pow-c)", pr.kw / K.RACK_KW, `${pr.kw.toFixed(1)} of ${K.RACK_KW} kW`, "kw")}
          ${g("net", "#8FC4FF", pr.netNeed ? Math.min(1, pr.netProv / pr.netNeed) : pr.netProv ? 1 : 0, `Network ${pr.netProv} / ${pr.netNeed.toFixed(0)}${pr.spine ? " (row spine)" : ""}`)}
          ${g("plus", "var(--ok-c)", free / K.RACK_U, `${free}U free`, "u")}
          ${wl}${modes}
        </div>
      </div>
      ${clusterLine}
      ${devInfoHTML(r, pr)}
      ${on("gpu") ? rooflineSVG(r, armedItem) : ""}
      ${meas.join("")}
      <div class="jobs" id="jobs">${jobsHTML()}</div>
      ${tankBtn}
      <div class="bin" data-drop-sell>${icon("coin")}Drop hardware here to sell${on("finance") ? " (or return a lease)" : ""}</div>`;
  }

  /* ---------- charts ---------- */
  function renderMarket() {
    const H = S.history.filter(h => h.d <= S.day);
    const svg = $("market-chart");
    const showIt = on("gpu");
    $("market-legend").innerHTML = showIt ? `<span style="color:${COL.train}"><i style="background:currentColor"></i>You · training</span><span style="color:${COL.train}"><i class="dash"></i>demand</span><span style="color:${COL.infer}"><i style="background:currentColor"></i>You · inference</span><span style="color:${COL.infer}"><i class="dash"></i>demand</span>` : "";
    if (!showIt || H.length < 2) { svg.innerHTML = `<text x="160" y="75" text-anchor="middle">Opens with chapter 3</text>`; return; }
    const W = 320, x0 = 30, y0 = 118, maxD = Math.max(20, ...H.map(h => Math.max(h.dt, h.di, h.st, h.si))) * 1.1;
    const d0 = H[0].d, span = Math.max(180, H[H.length - 1].d - d0);
    const x = d => x0 + (d - d0) / span * (W - x0 - 60), y = v => y0 - v / maxD * 104;
    const path = key => H.map((h, i) => `${i ? "L" : "M"}${x(h.d).toFixed(1)},${y(h[key]).toFixed(1)}`).join("");
    const lastH = H[H.length - 1], yearAgo = H.find(h => h.d >= lastH.d - 360) || H[0];
    const chg = (a, b) => { const p = (a / b - 1) * 100; return `${p >= 0 ? "▲" : "▼"}${Math.abs(p).toFixed(0)} %`; };
    const gens = Sim.GEN_LAUNCH.filter(g => g > d0 && g <= lastH.d && on("gens"));
    svg.innerHTML = `
      <line x1="${x0}" y1="${y0}" x2="${W - 60}" y2="${y0}" stroke="var(--line)"/>
      ${gens.map(g => `<line x1="${x(g)}" x2="${x(g)}" y1="10" y2="${y0}" stroke="var(--line)" stroke-dasharray="2 3"/><text x="${x(g) + 2}" y="14" style="font-size:9px">gen</text>`).join("")}
      ${[0, 0.5, 1].map(f => `<text x="${x0 - 4}" y="${y(maxD / 1.1 * f) + 4}" text-anchor="end">${Math.round(maxD / 1.1 * f)}</text>`).join("")}
      <path d="${path("dt")}" fill="none" stroke="${COL.train}" stroke-width="1.5" stroke-dasharray="4 3"/>
      <path d="${path("di")}" fill="none" stroke="${COL.infer}" stroke-width="1.5" stroke-dasharray="4 3"/>
      <path d="${path("st")}" fill="none" stroke="${COL.train}" stroke-width="2.5"/>
      <path d="${path("si")}" fill="none" stroke="${COL.infer}" stroke-width="2.5"/>
      <text x="${W - 56}" y="${y0 - 70}" style="fill:${COL.train};font-weight:600">$${(lastH.pt * 1000).toFixed(0)}/u·d</text>
      <text x="${W - 56}" y="${y0 - 57}" style="fill:${COL.train}">${chg(lastH.pt, yearAgo.pt)} yr</text>
      <text x="${W - 56}" y="${y0 - 30}" style="fill:${COL.infer};font-weight:600">$${(lastH.pi * 1000).toFixed(0)}/u·d</text>
      <text x="${W - 56}" y="${y0 - 17}" style="fill:${COL.infer}">${chg(lastH.pi, yearAgo.pi)} yr</text>
      <text x="${x0}" y="${y0 + 14}">day ${d0}</text><text x="${x(lastH.d)}" y="${y0 + 14}" text-anchor="end">now</text>
      <text x="${W - 56}" y="${y0 + 14}">price</text>`;
  }
  function renderBench() {
    const svg = $("bench-chart"), B = S.bench, card = $("bench-card");
    card.classList.toggle("lockmask", !B.lattice.length && !B.photon.length);
    if (!B.lattice.length && !B.photon.length) { svg.innerHTML = `<text x="150" y="70" text-anchor="middle">No emerging hardware yet</text>`; return; }
    const W = 300, x0 = 26, y0 = 112, all = B.lattice.concat(B.photon), maxV = Math.max(4, ...all.map(p => p.v)) * 1.15;
    const dMax = Math.max(...all.map(p => p.d)), dMin = Math.min(...all.map(p => p.d)), span = Math.max(120, dMax - dMin);
    const x = d => x0 + (d - dMin) / span * (W - x0 - 90), y = v => y0 - v / maxV * 100;
    let h = `<line x1="${x0}" y1="${y0}" x2="${W - 8}" y2="${y0}" stroke="var(--line)"/>
      <rect x="${x(dMax) + 6}" y="8" width="${W - x(dMax) - 14}" height="${y0 - 8}" fill="var(--tile)" opacity=".4"/>
      <text x="${x(dMax) + 30}" y="66" style="font-size:24px;font-family:var(--display)">?</text><text x="${x(dMax) + 12}" y="${y0 - 6}">no roadmap</text>`;
    for (const [v, col, name] of [["lattice", COL.lattice, "Lattice"], ["photon", COL.photon, "Photon"]]) {
      const P = B[v]; if (!P.length) continue;
      h += `<path d="${P.map((p, i) => `${i ? "L" : "M"}${x(p.d).toFixed(1)},${y(p.v).toFixed(1)}`).join("")}" fill="none" stroke="${col}" stroke-width="2.5"/>`;
      const l = P[P.length - 1];
      h += `<circle cx="${x(l.d)}" cy="${y(l.v)}" r="3.5" fill="${col}"/><text x="${x(l.d) - 4}" y="${y(l.v) - 7}" text-anchor="end" style="fill:${col};font-weight:600">${name} ${l.v.toFixed(1)}${S.vendors[v].dead ? " (dead)" : ""}</text>`;
    }
    h += `<text x="${x0}" y="${y0 + 14}">${dateOf(dMin).split(", ")[1]}</text><text x="${x(dMax)}" y="${y0 + 14}" text-anchor="end">now</text>`;
    svg.innerHTML = h;
  }
  function renderNews() {
    const TONE = { info: [COL.info, "news"], good: [COL.good, "trend"], bad: [COL.bad, "warn"], pitch: [COL.pitch, "tag"] };
    const cats = [...new Set(S.news.map(n => n.cat || "general"))].filter(c => NEWS_CAT[c]);
    if (V.newsCat !== "all" && !cats.includes(V.newsCat)) V.newsCat = "all";
    $("newsfilter").innerHTML = cats.length > 1 ? `<button data-newscat="all" aria-pressed="${V.newsCat === "all"}">All</button>` +
      cats.map(c => `<button data-newscat="${c}" aria-pressed="${V.newsCat === c}" title="${NEWS_CAT[c][1]}">${icon(NEWS_CAT[c][0])}<span class="nlab">${NEWS_CAT[c][1]}</span></button>`).join("") : "";
    // the News tab shows a dot with the number of items that arrived while another tab was open
    const newest = S.news.length ? S.news[0].day : -1;
    if (V.newsSeenFor !== S || V.tab === "news") { V.newsSeenFor = S; V.newsSeen = newest; }
    const unseen = S.news.filter(n => n.day > V.newsSeen).length, dot = $("tab-news").querySelector(".dot");
    dot.hidden = !unseen; dot.textContent = unseen > 9 ? "9+" : String(unseen);
    const list = S.news.filter(n => V.newsCat === "all" || (n.cat || "general") === V.newsCat).slice(0, 14);
    $("newsfeed").innerHTML = list.map(n => {
      const [c, ic] = TONE[n.tone] || TONE.info;
      return `<div class="ev${S.day - n.day < 20 ? " fresh" : ""}" data-news="${esc(n.cat || "general")}" title="${esc(n.body || "")}"><span class="av" style="background:${c}">${icon(n.icon || ic)}</span><span><strong>${esc(n.title)}</strong><span>${esc(n.body || "")}</span><span class="when" style="display:block">${dateOf(n.day)}${n.cat && NEWS_CAT[n.cat] ? ` · ${NEWS_CAT[n.cat][1]}` : ""}</span></span></div>`;
    }).join("") || `<div class="sub">Nothing here yet.</div>`;
  }

  /* ================= popovers (technicians, transit, grid) ================= */
  function openPop(kind, anchor) {
    if (V.pop === kind) { closePop(); return; }
    V.pop = kind;
    const pop = $("pop"), hud = $("hud").getBoundingClientRect(), a = anchor.getBoundingClientRect(), z = STZ();
    pop.hidden = false;
    renderPop(Sim.stats(S));
    // rects are viewport px; the popover lives inside the zoomed #stage, so its left/top are stage px (÷ zoom)
    const w = pop.offsetWidth, left = Math.max(8, Math.min((a.left - hud.left) / z, $("hud").offsetWidth - w - 8));
    pop.style.left = left + "px"; pop.style.top = ((a.bottom - hud.top) / z) + "px";
    dlog("pop", kind);
  }
  function closePop() { V.pop = null; const p = $("pop"); if (p) p.hidden = true; }
  document.addEventListener("change", e => { if (e.target && e.target.id === "keep-item") { V.keepItem = e.target.value; if (V.pop) renderPop(Sim.stats(S)); } });
  function renderPop(st) {
    const pop = $("pop");
    if (document.activeElement && document.activeElement.id === "keep-item") return;   // don't close an open dropdown
    if (V.pop === "techs") {
      const busy = Sim.busyTechs(S), queue = S.jobs.filter(j => j.phase === "wait").length, parts = S.jobs.filter(j => j.phase === "parts").length;
      pop.innerHTML = `<h3>${icon("wrench")}Technicians</h3>
        <div class="stepper"><button data-act='{"type":"fire"}' title="Fire one: severance ${money(K.FIRE_PAY_DAYS * K.SALARY)}" aria-label="Fire a technician">${icon("minus")}</button>
          <div class="val"><span class="big">${S.techs}${S.hires.length ? ` <small>+${S.hires.length} hiring</small>` : ""}</span><small>$${(S.techs * K.SALARY).toFixed(2)}k/day in salaries</small></div>
          <button data-act='{"type":"hire"}' title="Hire one: arrives in ${K.HIRE_DAYS} days" aria-label="Hire a technician">${icon("plus")}</button></div>
        <div class="kv"><span>Busy</span><b>${busy} / ${S.techs}</b></div><div class="kv"><span>Jobs queued</span><b>${queue}</b></div><div class="kv"><span>Waiting for parts</span><b>${parts}</b></div>
        <button class="toggle" data-act='${JSON.stringify({ type: "repairPolicy", on: !S.repairAuto })}' data-keep-title aria-pressed="${S.repairAuto}"><span class="sw"></span><span><b>Auto-repair</b><br><small>${S.repairAuto ? "Failed parts are swapped (spare) or repaired automatically" : "You decide what to repair"}</small></span></button>
        <button class="toggle" data-act='${esc(JSON.stringify({ type: "policy", key: "autoSwap", on: !S.policy.autoSwap }))}' data-keep-title aria-pressed="${!!S.policy.autoSwap}" title="${esc(L("pol.autoSwapTip"))}"><span class="sw"></span><span><b>${esc(L("pol.autoSwap"))}</b></span></button>
        ${keepSparesHTML()}`;
    } else if (V.pop === "alerts") {
      pop.innerHTML = alertsHTML();
    } else if (V.pop === "transit") {
      const need = transitNeed(st), cap = S.transit + K.TRANSIT_FREE, tgt = Sim.transitTarget(S);
      pop.innerHTML = `<h3>${icon("globe")}Internet transit</h3>
        <div class="stepper"><button data-act='{"type":"transit","delta":-1}' aria-label="Less transit">${icon("minus")}</button>
          <div class="val"><span class="big">${tgt + K.TRANSIT_FREE}</span><small>${tgt !== S.transit ? `now ${cap}, changes in ${K.TRANSIT_DAYS} days` : `units · $${(S.transit * K.TRANSIT_COST).toFixed(1)}k/day`}</small></div>
          <button data-act='{"type":"transit","delta":1}' aria-label="More transit">${icon("plus")}</button></div>
        <div class="meter"><i style="width:${Math.min(100, need / Math.max(1, cap) * 100)}%;background:${need > cap ? COL.bad : COL.good}"></i></div>
        <div class="kv"><span>Traffic needs</span><b>${need.toFixed(1)} units</b></div>
        <div class="kv"><span>Output carried</span><b>${pct(st.transitF)}</b></div>
        <div class="sub">1 unit per ${K.TRANSIT_PER} web + inference output. ${K.TRANSIT_FREE} units are free; each extra costs $${K.TRANSIT_COST}k/day.</div>
        <div class="buyrow">${actBtn({ type: "transit", delta: 5 }, "+5")}${actBtn({ type: "transit", delta: Math.max(1, Math.ceil(need) - K.TRANSIT_FREE - tgt) }, "Match traffic", { cls: "primary" })}</div>`;
    } else if (V.pop === "grid") {
      const g = Sim.gridNext(S), job = S.jobs.find(j => j.kind === "grid");
      pop.innerHTML = `<h3>${icon("bolt", "color:var(--pow-c)")}Grid</h3>
        <div class="kv"><span>Drawing now</span><b>${st.kw.toFixed(0)} kW</b></div><div class="kv"><span>With orders</span><b>${Sim.gridKwAll(S).toFixed(0)} kW</b></div><div class="kv"><span>Grid limit</span><b>${S.gridKw} kW</b></div>
        ${gridLadder()}
        ${job ? `<div class="sub">${icon("wrench")} Upgrade to ${job.kw} kW: ${Math.ceil(job.left)} days left</div>` : g ? actBtn({ type: "grid" }, `Upgrade to ${g.kw} kW · ${money(g.cost)} · ${g.days} d`, { confirm: true, cls: "primary", icon: "bolt" })
          : `<div class="sub">${gridNote()}</div>`}`;
    }
  }

  /* policy keepSpares: pick a part, keep N on the shelf (auto-ordered at list price) */
  function keepSparesHTML() {
    const shop = Sim.shopItems(S).filter(k => { const it = item(k); return it.role !== "exotic" && k !== "pm9"; });
    if (!V.keepItem || !shop.includes(V.keepItem)) V.keepItem = Object.keys(S.policy.keepSpares)[0] || shop.find(k => item(k).role === "gpu") || shop[0];
    const k = V.keepItem, n = S.policy.keepSpares[k] || 0;
    const act = d => JSON.stringify({ type: "policy", key: "keepSpares", item: k, n: Math.max(0, Math.min(K.SHELF, n + d)) });
    return `<div class="keep" title="${esc(L("pol.keepTip"))}"><b>${esc(L("pol.keep"))}</b><select id="keep-item" aria-label="${esc(L("pol.keep"))}">${shop.map(x => `<option value="${x}"${x === k ? " selected" : ""}>${esc(item(x).name)}${S.policy.keepSpares[x] ? ` (${S.policy.keepSpares[x]})` : ""}</option>`).join("")}</select>
      <div class="stepper sm"><button data-act='${esc(act(-1))}' data-keep-title aria-label="Fewer">${icon("minus")}</button><div class="val"><span class="big">${n}</span></div><button data-act='${esc(act(1))}' data-keep-title aria-label="More">${icon("plus")}</button></div></div>`;
  }
  /* the four grid tiers (250 / 400 / 700 / 1000 kW) as a ladder: owned, under way, next */
  const GRID_TIERS = () => [[K.GRID_KW, 0, 0], [K.GRID_KW_UP, K.GRID_COST, K.GRID_DAYS], [K.GRID_KW_UP2, K.GRID_COST2, K.GRID_DAYS2], [K.GRID_KW_UP3, K.GRID_COST3, K.GRID_DAYS3]];
  function gridNote() { return S.gridTier >= 3 ? "Fully upgraded (top tier)." : `The ${GRID_TIERS()[S.gridTier + 1][0]} kW tier unlocks with chapter 11.`; }
  function gridLadder() {
    const job = S.jobs.find(j => j.kind === "grid");
    return `<div class="gridladder" role="list" aria-label="Grid tiers">${GRID_TIERS().map(([kw, cost, days], i) => {
      const st = i <= S.gridTier ? "own" : job && i === S.gridTier + 1 ? "busy" : "";
      return `<span role="listitem" class="gt ${st}" title="${i === 0 ? "Starting feed" : `${money(cost)}, ${days} days${i >= 2 ? ", from chapter 11" : ""}`}">${st === "own" ? icon("check") : st === "busy" ? icon("wrench") : icon("bolt")}<b>${kw}</b><small>kW</small></span>`;
    }).join("")}</div>`;
  }

  /* ================= drawers ================= */
  const DRAWERS = { contracts: ["Contracts", "hand"], finance: ["Finance", "trend"], energy: ["Energy & facilities", "bolt"], affairs: ["Reputation & policy", "flag"] };
  function openDrawer(k) {
    if (S) TELE.event(S.day, "drawer", { k, open: V.drawer !== k });
    if (V.drawer === k) { closeDrawer(); return; }
    V.drawer = k; closePop();
    $("drawer").classList.add("open"); $("drawer").setAttribute("aria-hidden", "false");
    renderDrawer(Sim.stats(S)); renderDrawerBtns();
    dlog("drawer", k);
  }
  function closeDrawer() { V.drawer = null; const d = $("drawer"); d.classList.remove("open"); d.setAttribute("aria-hidden", "true"); if (S) renderDrawerBtns(); }
  function renderDrawer(st) {
    const k = V.drawer; if (!k) return;
    $("drawer-title").innerHTML = `${icon(DRAWERS[k][1])} ${DRAWERS[k][0]}`;
    $("drawer-sub").textContent = V.speed ? "game running" : "paused";
    const body = $("drawer-body"), top = body.scrollTop;
    body.innerHTML = k === "contracts" ? contractsHTML(st) : k === "finance" ? financeHTML(st) : k === "energy" ? energyHTML(st) : affairsHTML(st);
    body.scrollTop = top;
  }
  const sect = (ic, title, sub, inner, cls) => `<section class="sect ${cls || ""}"><h3>${icon(ic)}${title}${sub ? `<span class="sub">${sub}</span>` : ""}</h3>${inner}</section>`;

  function contractsHTML(st) {
    const offers = S.offers.slice().sort((a, b) => a.expires - b.expires).map(o => offerCard(o, st)).join("");
    const act = S.contracts.map(c => {
      const k = kindOf(c), col = QOL.linkColor(c.id);
      const racks = [...new Set((st.alloc || []).filter(l => l.id === c.id).map(l => l.rack))];
      const head = `<div class="kv"><span><i class="swatch" style="background:${col}"></i>${icon((KIND[k] || KIND.web)[0], "width:14px;height:14px;vertical-align:-2px")} <b>${esc(c.cust)}</b> · ${esc(L("kind." + k))}${Sim.isJob(c) ? "" : ` · ${c.units}u at $${(c.price * 1000).toFixed(0)}`}</span>`;
      const served = `<div class="sub">${icon("link", "width:13px;height:13px;vertical-align:-2px")} ${esc(racks.length ? L("board.served", { racks: racks.join(", ") }) : L("board.unserved"))}</div>`;
      if (Sim.isJob(c)) {
        const f = clamp01(c.done / c.work), tf = clamp01((S.day - c.signed) / Math.max(1, c.deadline - c.signed)), late = S.day > c.deadline;
        return `<div class="contract" style="border-color:${col}">${head}<span>${late ? `<b style="color:${COL.bad}">late ${Math.ceil(S.day - c.deadline)} d</b>` : `due in ${Math.ceil(c.deadline - S.day)} d`}</span></div>
          <div class="meter" title="Work done vs time elapsed (the line)"><i style="width:${f * 100}%;background:${f + 1e-6 >= tf ? COL.good : COL.warn}"></i><em style="left:${tf * 100}%"></em></div>
          <div class="kv"><span>${Math.round(c.done)} / ${Math.round(c.work)} u·d · pays ${money(c.pay)}</span><span>${(st.cDel[c.id] || 0).toFixed(1)} u/d now</span></div>${served}</div>`;
      }
      if (S.day < c.start) {
        const lead = Math.max(1, c.start - (c.signed != null ? c.signed : c.start - (c.lead || K.BTS_LEAD))), f = clamp01(1 - (c.start - S.day) / lead);
        return `<div class="contract" style="border-color:${col}">${head}<span>starts in ${Math.ceil(c.start - S.day)} d</span></div>
          <div class="meter slim" title="Lead time until delivery starts"><i style="width:${f * 100}%;background:${COL.warn}"></i></div>${served}</div>`;
      }
      const el = Math.max(0.01, S.day - c.start), tf = clamp01(el / c.days), delF = c.delivered / (c.units * el);
      const missing = (st.cMiss[c.id] || 0) > 1e-6;
      return `<div class="contract" style="border-color:${col}">${head}<span>${Math.ceil(c.end - S.day)} d left</span></div>
        <div class="meter slim" title="Time elapsed"><i style="width:${tf * 100}%;background:var(--ink-2)"></i></div>
        <div class="meter" title="Delivered vs promised; the line is the SLA"><i style="width:${clamp01(delF) * 100}%;background:${delF + 1e-6 >= c.sla ? COL.good : COL.bad}"></i><em style="left:${c.sla * 100}%"></em></div>
        <div class="kv"><span>Delivered ${pct(Math.min(1, delF))} (SLA ${pct(c.sla)})${missing ? ` · <b style="color:${COL.bad}">missing now</b>` : ""}</span><span>penalties ${money(c.penaltyPaid)}</span></div>${served}</div>`;
    }).join("");
    const Lg = S.contractLog;
    const renew = `<button class="toggle" data-act='${esc(JSON.stringify({ type: "policy", key: "autoRenew", on: !S.policy.autoRenew }))}' data-keep-title aria-pressed="${!!S.policy.autoRenew}" title="${esc(L("board.autoRenewTip"))}"><span class="sw"></span><span><b>${esc(L("board.autoRenew"))}</b></span></button>`;
    return sect("doc", "Offers", `${S.offers.length}`, `<div class="ocards">${offers || `<div class="sub">${esc(L("board.none"))}</div>`}</div>${renew}`)
      + sect("hand", "Active contracts", `${S.contracts.length}`, act || `<div class="sub">—</div>`)
      + sect("flag", "Track record", "", `<div class="kv"><span>Signed</span><b>${Lg.signed}</b></div><div class="kv"><span>Fulfilled</span><b>${Lg.fulfilled}</b></div><div class="kv"><span>Ended short</span><b>${Lg.failed}</b></div><div class="kv"><span>Cancelled / late</span><b>${Lg.cancelled || 0} / ${Lg.late || 0}</b></div>`);
  }

  function waterfallSVG(Q) {
    const rev = [["Web", Q.web, COL.web], ["Train", Q.train, COL.train], ["Infer", Q.infer, COL.infer], ["Frontier", Q.frontier, COL.frontier], ["Contracts", Q.contracts, COL.contract]];
    const cost = [["Power", Q.power, COL.pow], ["Staff", Q.upkeep + Q.salaries, COL.net], ["Transit", Q.transit, "#8FC4FF"], ["Interest", Q.interest, COL.debt], ["Leases", Q.lease, COL.lease],
      ["Water", Q.water, COL.water], ["Diesel", Q.diesel, COL.hot], ["Carbon tax", Q.carbonTax, COL.carbon], ["Fines", Q.fines, COL.bad], ["Penalties", Q.penalties, COL.bad],
      ["Repairs", Q.repairs, COL.fail], ["Other", Q.other, COL.info], ["Tax", Q.tax, COL.vc]];
    const items = rev.filter(x => x[1] > 0.5).concat(cost.filter(x => x[1] > 0.5).map(x => [x[0], -x[1], x[2]]));
    const n = items.length + 1, W = 400, base = 170, w = Math.min(38, (W - 20) / n - 4), gap = (W - 20 - n * w) / Math.max(1, n - 1);
    let run = 0, lo = 0, hi = 0;
    for (const it of items) { run += it[1]; lo = Math.min(lo, run); hi = Math.max(hi, run); }
    const span = Math.max(1, hi - lo), sc = v => v * 140 / span, yOf = v => base - 20 - sc(v - lo) + sc(0) * 0;
    const Y = v => 20 + (hi - v) / span * 140;
    run = 0; let x = 10, h = `<line x1="4" y1="${Y(0)}" x2="${W - 4}" y2="${Y(0)}" stroke="var(--line)"/>`;
    for (const [name, v, c] of items) {
      const a = run, b = run + v, top = Y(Math.max(a, b)), hgt = Math.max(1, Math.abs(Y(a) - Y(b)));
      h += `<rect x="${x}" y="${top}" width="${w}" height="${hgt}" rx="2" fill="${c}"/><text class="v" x="${x + w / 2}" y="${top - 3}" text-anchor="middle" style="font-size:10px">${v >= 0 ? "+" : "−"}${money(Math.abs(v)).replace("$", "")}</text>
        <text x="${x + w / 2}" y="${base + 12}" text-anchor="end" transform="rotate(-35 ${x + w / 2} ${base + 12})" style="font-size:9.5px">${name}</text>`;
      run = b; x += w + gap;
    }
    const top = Y(Math.max(0, run)), hgt = Math.max(1, Math.abs(Y(0) - Y(run)));
    h += `<rect x="${x}" y="${top}" width="${w}" height="${hgt}" rx="2" fill="var(--ink)"/><text class="v" x="${x + w / 2}" y="${top - 3}" text-anchor="middle" style="font-size:10px">${money(run)}</text><text x="${x + w / 2}" y="${base + 12}" text-anchor="end" transform="rotate(-35 ${x + w / 2} ${base + 12})" style="font-size:9.5px">Net</text>`;
    void yOf;
    return `<svg viewBox="0 0 ${W} 215" role="img" aria-label="Quarter waterfall">${h}</svg>`;
  }
  function financeHTML(st) {
    const useLast = V.wfLast && S.lastQuarter;
    const Q = useLast ? S.lastQuarter : S.ledger, q = useLast ? S.lastQuarter.q : Math.floor(S.day / 90);
    let out = sect("trend", `Y${Math.floor(q / 4) + 1} Q${q % 4 + 1} ${useLast ? "results" : "so far"}`, "",
      `<div class="buylease" role="group" style="justify-self:start"><button data-wf="0" aria-pressed="${!useLast}">This quarter</button><button data-wf="1" aria-pressed="${!!useLast}"${S.lastQuarter ? "" : " disabled"}>Last quarter</button></div>
       <div class="wfall">${waterfallSVG(Q)}</div>${Q.lost > 0.5 ? `<div class="sub">${icon("flame", `color:${COL.hot};width:14px;height:14px`)} Throttling cost ${money(Q.lost)} of revenue this quarter.</div>` : ""}
       ${on("finance") ? `<div class="sub">Tax: ${K.TAX * 100} % of positive quarterly profit (revenue − opex − depreciation over 3 years).</div>` : ""}`);
    if (on("finance")) {
      const nw = Sim.netWorth(S), lim = Math.max(0, K.LOAN_LTV * nw);
      out += sect("bank", "Credit line", `${K.INTEREST * 100} %/yr`,
        `<div class="stepper"><button data-act='{"type":"repay","amount":${K.LOAN_STEP}}' title="Repay ${money(K.LOAN_STEP)}" aria-label="Repay">${icon("minus")}</button>
          <div class="val"><span class="big">${money(S.debt)}</span><small>debt · $${(S.debt * K.INTEREST / K.YEAR).toFixed(2)}k/day interest</small></div>
          <button data-act='{"type":"borrow","amount":${K.LOAN_STEP}}' title="Borrow ${money(K.LOAN_STEP)}" aria-label="Borrow">${icon("plus")}</button></div>
         <div class="meter"><i style="width:${Math.min(100, S.debt / Math.max(1, lim) * 100)}%;background:${COL.debt}"></i></div>
         <div class="kv"><span>Credit line (40 % of net worth)</span><b>${money(lim)}</b></div>
         <div class="kv"><span>Bankrupt below</span><b>${money(-S.creditLimit)} cash</b></div>`);
      const leased = [];
      for (const r of S.racks) for (const d of r.devices.concat(r.pending)) if (d.leased) leased.push({ r, d, pending: r.pending.includes(d) });
      const tot = leased.reduce((a, x) => a + x.d.leaseRate, 0);
      out += sect("tag", "Leases", `${leased.length} · $${tot.toFixed(2)}k/day`, leased.length ? `<div class="leaselist">${leased.map(x =>
        `<div><span>${esc(item(x.d.type).name)} <small class="sub">in ${x.r.id}</small></span><span>$${x.d.leaseRate.toFixed(2)}k/d</span>${x.pending ? `<span class="sub">arriving</span>` : actBtn({ type: "returnLease", rack: x.r.id, uid: x.d.uid }, "Return")}</div>`).join("")}</div>`
        : `<div class="sub">Flip the catalog switch to <b>Lease</b> and drag a GPU onto a rack. Leased cards don't count toward net worth.</div>`);
    }
    if (on("investors")) {
      const cv = Sim.companyValue(S), o = S.roundOffer;
      let inner = `<div class="pie">${pieSVG(S.equity.own, COL.equity)}<div style="display:grid;gap:4px;flex:1"><div class="kv"><span>Company value</span><b>${money(cv)}</b></div><div class="kv"><span>Your score</span><b>${money(Sim.score(S))}</b></div><div class="kv"><span>Raised</span><b>${money(S.equity.raised)}</b></div><div class="kv"><span>Rounds</span><b>${S.equity.rounds}</b></div></div></div>`;
      if (o) inner += `<div class="vc"><div class="kv"><span>${icon("person", `color:${COL.vc};width:15px;height:15px`)} <b>${esc(o.vc)}</b></span><span>expires ${Math.ceil(o.expires - S.day)} d</span></div>
          <div class="kv"><span>Offers <b>${money(o.amount)}</b> for <b>${pct(o.pct)}</b></span><span>valuation ${money(o.valuation)}</span></div>
          <span class="biased">VC PITCH</span><q>${esc(o.pitch.replace(/^"|"$/g, ""))}</q>
          <div class="acts buyrow">${actBtn({ type: "acceptRound", id: o.id }, "Accept", { cls: "good", confirm: true, icon: "check" })}${actBtn({ type: "declineRound", id: o.id }, "Decline", { icon: "cross" })}</div></div>`;
      else inner += `<div class="sub">No offer on the table. VCs call every ~${K.ROUND_EVERY} days.</div>`;
      if (S.board) {
        const b = S.board, tf = clamp01((S.day - b.start) / (b.end - b.start));
        inner += `<div class="kv"><span>${icon("flag", "width:14px;height:14px")} Board target: revenue in ${Math.ceil(b.end - S.day)} d</span><b>${money(b.rev)} / ${money(b.target)}</b></div>
          <div class="meter" title="Revenue so far vs target; the line is time elapsed"><i style="width:${clamp01(b.rev / b.target) * 100}%;background:${b.rev / b.target >= tf ? COL.good : COL.warn}"></i><em style="left:${tf * 100}%"></em></div>
          <div class="kv"><span>History</span><span class="hist">${b.history.map(x => `<b style="background:${x.hit ? COL.good : COL.bad}" title="target ${money(x.target)}, revenue ${money(x.rev)}">${icon(x.hit ? "check" : "cross")}</b>`).join("") || "—"}</span></div>
          ${b.misses ? `<div class="sub" style="color:${COL.bad}">${icon("warn", "width:14px;height:14px")} One miss. Another and the board fires you.</div>` : ""}`;
      }
      if (S.equity.own < 1) inner += `<div class="buyrow">${actBtn({ type: "buyback" }, "Buy back 1 %", { icon: "pie", confirm: true })}</div>`;
      out += sect("pie", "Investors", `you own ${pct(S.equity.own)}`, inner);
    }
    return out;
  }

  function facCard(ic, color, title, sub, status, btn) {
    return `<div class="fcard${status === "owned" ? " done" : ""}"><div class="top"><span class="av" style="background:${color}">${icon(ic)}</span>${title}</div><div class="sub">${sub}</div>${status === "owned" ? `<div class="sub" style="color:${COL.good}">${icon("check", "width:14px;height:14px")} Installed</div>` : status || btn || ""}</div>`;
  }
  const buildingStatus = j => j ? `<div class="sub">${icon("wrench", "width:14px;height:14px")} ${Math.ceil(j.left)} days left</div><div class="meter slim"><i style="width:${(1 - jobFrac(j)) * 100}%;background:${COL.sel}"></i></div>` : null;
  function energyHTML(st) {
    let out = "";
    const jobOf = (kind, hall) => S.jobs.find(j => j.kind === kind && (hall == null || j.hall === hall));
    const cards = [];
    const g = Sim.gridNext(S);
    cards.push(facCard("bolt", COL.pow, `Grid ${S.gridKw} kW`, (g ? `Next tier: ${g.kw} kW, ${g.days} days` : S.gridTier >= 3 ? "Top tier (4 of 4)" : gridNote()) + gridLadder(),
      buildingStatus(jobOf("grid")) || (g || S.gridTier < 3 ? null : "owned"), g ? actBtn({ type: "grid" }, `${money(g.cost)}`, { confirm: true, cls: "primary" }) : ""));
    if (on("facilities")) {
      for (const h of S.halls.filter(x => x.n > 1)) {
        const hc = Sim.hallCost(h.n), HLs = hallLetters(h.n);
        cards.push(facCard("building", COL.info, `Hall ${h.n}`, `${K.HALL_RACKS} racks (${HLs[0]}1–${HLs[2]}${K.COLS}), same grid. ${hc.days} days.${!h.built && !S.halls[h.n - 2].built ? ` Needs Hall ${h.n - 1}.` : ""}`,
          h.built ? "owned" : buildingStatus(jobOf("buildHall", h.n)), actBtn({ type: "buildHall", hall: h.n }, money(hc.cost), { confirm: true, cls: "primary" })));
      }
      cards.push(facCard("battery", COL.good, "UPS + generator", "Rides through grid outages. Burns diesel while it runs.", S.ups ? "owned" : buildingStatus(jobOf("ups")), actBtn({ type: "ups" }, money(K.UPS_COST), { confirm: true, cls: "primary" })));
      for (const h of S.halls.filter(x => x.built)) cards.push(facCard("snow", COL.cool, `CRAC upgrade · Hall ${h.n}`, `+${K.CRAC_KW} kW cooling, ${K.CRAC_DAYS} days.`, h.crac ? "owned" : buildingStatus(jobOf("crac", h.n)), actBtn({ type: "crac", hall: h.n }, money(K.CRAC_COST), { confirm: true, cls: "primary" })));
    }
    if (on("energy")) cards.push(facCard("sun", COL.rep, "Solar + battery", `0–${K.SOLAR_KW} kW by season; battery shaves ${K.BATTERY_SHAVE * 100} % of spot spikes.`, S.solar ? "owned" : buildingStatus(jobOf("solar")), actBtn({ type: "solar" }, money(K.SOLAR_COST), { confirm: true, cls: "primary" })));
    out += sect("building", "Facilities", "", `<div class="buyrow">${cards.join("")}</div>`);
    if (on("energy")) {
      const sp = S.history.slice(-72).map(h => h.sp).filter(x => x != null);
      let ppa;
      if (S.ppa && S.day < S.ppa.end) {
        const tf = clamp01((S.day - S.ppa.start) / (S.ppa.end - S.ppa.start));
        ppa = `<div class="kv"><span>${icon("leaf", `color:${COL.carbon};width:14px;height:14px`)} PPA ${S.ppa.kw} kW at $${(S.ppa.price * 1000).toFixed(1)}/kW·d</span><b>${Math.ceil(S.ppa.end - S.day)} d left</b></div>
          <div class="meter" title="Term elapsed"><i style="width:${tf * 100}%;background:${COL.carbon}"></i></div>
          <div class="kv"><span>Facility draw now</span><b>${st.facility.toFixed(0)} kW${st.facility < S.ppa.kw ? ` <small style="color:${COL.bad}">(PPA unused ${(S.ppa.kw - st.facility).toFixed(0)} kW)</small>` : ""}</b></div>`;
      } else {
        const q = Sim.ppaQuote(S);
        ppa = `<div class="stepper"><button data-ppa="-1" aria-label="Smaller PPA">${icon("minus")}</button><div class="val"><span class="big">${V.ppaKw} kW</span><small>${K.PPA_DAYS} days at $${(q * 1000).toFixed(1)}/kW·d = $${(V.ppaKw * q).toFixed(1)}k/day</small></div><button data-ppa="1" aria-label="Bigger PPA">${icon("plus")}</button></div>
          <div class="meter" title="PPA size vs today's facility draw"><i style="width:${Math.min(100, V.ppaKw / Math.max(1, st.facility) * 100)}%;background:${V.ppaKw > st.facility ? COL.warn : COL.carbon}"></i></div>
          <div class="kv"><span>Facility draw now</span><b>${st.facility.toFixed(0)} kW</b></div>
          <div class="buyrow">${actBtn({ type: "ppa", kw: V.ppaKw }, `Sign PPA ${V.ppaKw} kW`, { confirm: true, cls: "good", icon: "leaf" })}</div>
          <div class="sub">Unused PPA power is still paid for. The quote follows the recent spot average.</div>`;
      }
      out += sect("trend", "Power price", `spot $${(st.spot * 1000).toFixed(1)}/kW·d`, `<div class="hbm">${spark(sp, 360, 60, COL.pow, { label: "Spot power price" })}</div>
        <div class="kv"><span>Green share</span><b>${pct(st.green)}</b></div>${st.solarKw ? `<div class="kv"><span>Solar now</span><b>${st.solarKw.toFixed(0)} kW</b></div>` : ""}${st.dieselKw ? `<div class="kv"><span>Generator</span><b>${st.dieselKw.toFixed(0)} kW</b></div>` : ""}` + ppa);
    }
    if (on("environment")) {
      const hallsHTML = S.halls.filter(h => h.built).map(h => {
        const hs = st.halls.find(x => x.n === h.n), job = jobOf("cooling", h.n);
        return `<div class="kv"><span>${icon("building", "width:14px;height:14px")} Hall ${h.n} · PUE ${hs ? hs.pue : "-"}</span>${job ? `<span class="sub">switching: ${Math.ceil(job.left)} d</span>` : ""}</div>
          <div class="buylease" role="group">${["evap", "chiller"].map(m => `<button data-act='${esc(JSON.stringify({ type: "cooling", hall: h.n, mode: m }))}' data-confirm aria-pressed="${h.cooling === m}" title="${m === "evap" ? `Evaporative: PUE ${K.PUE.evap}, uses water` : `Chiller: PUE ${K.PUE.chiller}, no water`}. Switching costs ${money(K.COOL_SWITCH_COST)} and ${K.COOL_SWITCH_DAYS} days.">${icon(m === "evap" ? "drop" : "snow")}${m === "evap" ? "Evaporative" : "Chiller"}${V.confirm === JSON.stringify({ type: "cooling", hall: h.n, mode: m }) ? " ?" : ""}</button>`).join("")}</div>`;
      }).join("");
      const co2 = S.history.slice(-72).map(h => h.co2).filter(x => x != null);
      out += sect("drop", "Cooling & environment", S.drought ? "drought!" : "", hallsHTML +
        `<div class="gpair"><div class="gaugec">${arcGauge(st.waterRate / 400, COL.water, `${Math.round(st.waterRate)}`, "water m³/day")}</div><div class="gaugec">${arcGauge(st.carbon / 3, COL.carbon, st.carbon.toFixed(1), "t CO2/day")}</div></div>
         <div class="kv"><span>Totals</span><b>${Math.round(S.env.water)} m³ water · ${Math.round(S.env.carbon)} t CO2</b></div>
         <div class="hbm">${spark(co2, 360, 40, COL.carbon, { label: "Carbon per day" })}</div>
         ${S.policyFx.carbonTax ? `<div class="kv"><span>Carbon tax</span><b>$${Math.round(S.policyFx.carbonTax * 1000)}/t</b></div>` : ""}`);
    }
    return out;
  }

  function affairsHTML(st) {
    let out = "";
    if (on("reputation")) {
      const rv = Sim.repOf(S), hist = S.history.slice(-72).map(h => h.rep).filter(x => x != null), scandal = S.day < S.scandalUntil;
      out += sect("star", "Reputation", `${rv.toFixed(1)} / 100`, `<div class="gpair"><div class="gaugec">${arcGauge(rv / 100, COL.rep, Math.round(rv), "reputation")}</div><div class="hbm" style="align-self:center">${spark(hist, 200, 60, COL.rep, { ref: K.REP_START, label: "Reputation" })}</div></div>
        <div class="sub">Moves contract offers and prices (±20 %), web and inference demand (±10 %), valuation and your score factor (×${Sim.repFactor(S).toFixed(2)}).</div>
        ${scandal ? `<div class="sub" style="color:${COL.bad}">${icon("warn", "width:14px;height:14px")} A scandal is live for ${Math.ceil(S.scandalUntil - S.day)} more days: PR may backfire.</div>` : ""}
        <div class="buyrow">${actBtn({ type: "pr" }, `PR campaign · ${money(K.PR_COST)}`, { confirm: true, cls: "primary", icon: "news" })}</div>
        <div class="sub">+${K.PR_GAIN} reputation that fades over ${K.PR_DECAY} days.</div>`);
    }
    if (on("policy")) {
      const ps = S.policies.filter(p => p.announced).map(p => {
        const span = p.vote - p.announceDay, tf = clamp01((S.day - p.announceDay) / span);
        const sigs = p.signals.map(x => `<b style="background:${x.up ? COL.good : COL.bad}" title="${x.up ? "Signal: more likely to pass" : "Signal: less likely to pass"} (${dateOf(x.day)})">${icon(x.up ? "trend" : "warn")}</b>`).join("") + Array.from({ length: Math.max(0, 2 - p.signals.length) }, () => `<b class="q" title="Signal still to come">?</b>`).join("");
        const lob = p.status === "proposed" ? (p.lobbied ? `<div class="sub">${icon("bank", "width:14px;height:14px")} You lobbied ${p.lobbied > 0 ? "for" : "against"} it (${p.lobbied > 0 ? "+" : "−"}${K.LOBBY_SHIFT * 100} % odds).</div>`
          : `<div class="buyrow">${actBtn({ type: "lobby", policy: p.id, dir: 1 }, "Lobby for", { confirm: true, icon: "trend" })}${actBtn({ type: "lobby", policy: p.id, dir: -1 }, "Lobby against", { confirm: true, icon: "warn" })}</div>`) : "";
        return `<div class="policy"><div class="top">${icon("flag", `color:${COL.bad}`)}<b>${esc(p.title)}</b><span class="status ${p.status}">${p.status.toUpperCase()}</span></div>
          <div class="sub">${esc(p.body)}</div>
          ${p.status === "proposed" ? `<div class="kv"><span>Vote on ${dateOf(p.vote)}</span><b>${Math.ceil(p.vote - S.day)} d</b></div><div class="meter slim"><i style="width:${tf * 100}%;background:${COL.warn}"></i></div>` : ""}
          <div class="signals">Signals ${sigs}</div>${lob}</div>`;
      }).join("");
      const fx = S.policyFx, eff = [];
      if (fx.carbonTax) eff.push(`${icon("leaf", "width:14px;height:14px")} Carbon tax $${Math.round(fx.carbonTax * 1000)}/t (rises each quarter)`);
      if (fx.mandate) eff.push(`${icon("gauge", "width:14px;height:14px")} Efficiency mandate: PUE ≤ ${K.MANDATE_PUE} ${S.day < fx.mandate.deadline ? `by ${dateOf(fx.mandate.deadline)}` : "now enforced"}`);
      if (fx.exportCtl) eff.push(`${icon("lock", "width:14px;height:14px")} Export controls: newest GPUs ${S.exportUsed}/${K.EXPORT_QUOTA} this quarter`);
      out += sect("flag", "Policy", "", (ps || `<div class="sub">No proposals yet. Watch the news.</div>`) +
        `<div class="sub">Lobbying costs ${money(K.LOBBY_COST)} and shifts the odds by ${K.LOBBY_SHIFT * 100} %. ${K.LOBBY_LEAK * 100} % chance the press finds out.</div>` +
        (eff.length ? `<div style="display:grid;gap:4px">${eff.map(e => `<div class="kv"><span>${e}</span></div>`).join("")}</div>` : ""));
    }
    return out || `<div class="sub">Unlocks with chapter 15.</div>`;
  }

  /* ================= v4 order board: THE primary element (CONTRACTS_CORE.md) =================
   * Visible from day 0. Each offer shows its kind, its terms (serving: units × days, start; jobs: work, pay, deadline),
   * its price vs the market index, whether you can deliver it (spare capacity vs need) and big Sign / Decline buttons.
   * Below the offers: every active contract as a pill in its link colour; the racks serving it carry the same colour. */
  const OFFER_STRIP_MAX = 3;
  const kindCol = k => k === "frontier" ? COL.frontier : k === "bts" ? COL.contract : R[k] ? R[k].color : COL.contract;
  function offerTerms(o) {
    const lead = Math.round(o.lead || 0);
    if (Sim.isJob(o)) return [L("board.work", { w: Math.round(o.work) }), money(o.pay), L("board.due", { d: o.days })];
    const t = [L("board.term", { u: o.units, d: o.days })];
    if (o.bts) t.push(L("board.fitout", { x: money(o.fitout) }));
    else if (lead > 0) t.push(L("board.starts", { d: lead }));
    return t;
  }
  function offerCard(o, st) {
    const k = kindOf(o), [ic] = KIND[k] || KIND.web, f = QOL.offerFit(Sim, S, o, st);
    const diff = o.spot ? (o.price / o.spot - 1) * 100 : 0, up = diff >= 0, left = Math.max(0, o.expires - S.day);
    const ttl = o.ttl || (o.bts ? K.BTS_EXPIRY : K.OFFER_EXPIRY);
    const kindName = L("kind." + k);
    const tip = `${o.cust}: ${kindName}. ${offerTerms(o).join(" · ")}. SLA ${pct(o.sla)}, penalty $${(o.penalty * 1000).toFixed(0)}/missed u·d${Sim.isJob(o) ? `, late fee ${money(o.lateFee || 0)}/d` : ""}.`;
    const fresh = !V.boardSeen.has(o.id);        // only a new card slides in (the board re-renders every second)
    V.boardSeen.add(o.id);
    return `<div class="ocard k-${k}${o.stretch ? " stretch" : ""}${fresh ? " fresh" : ""}" style="--wc:${kindCol(k)}" data-offer="${o.id}" title="${esc(tip)}">
      <div class="ot"><span class="av" style="background:${kindCol(k)}" title="${esc(kindName)}">${icon(ic)}</span><span class="on"><b>${esc(o.cust)}</b><small><em>${esc(kindName)}</em> · ${offerTerms(o).map(esc).join(" · ")}</small></span>
        <span class="op"><b>$${(o.price * 1000).toFixed(0)}</b><small>/u·d</small><small class="${up ? "up" : "down"}" title="${esc(L("board.vsIndex", { sign: up ? "+" : "−", p: Math.abs(diff).toFixed(0) }))}">${up ? "▲" : "▼"}${Math.abs(diff).toFixed(0)} %</small></span></div>
      <div class="oa">${actBtn({ type: "signContract", id: o.id }, o.bts ? `${L("board.sign")} · ${money(o.fitout)}` : L("board.sign"), { cls: "good sign", icon: "hand", confirm: !!o.bts })}${actBtn({ type: "declineContract", id: o.id }, "", { cls: "decl", icon: "cross", title: L("board.decline") })}<span class="ofit ${f.level}" title="${esc(L("board.freeTip"))}"><span class="bar"><i style="width:${Math.min(100, f.frac * 100).toFixed(0)}%"></i></span><span>${esc(L("board.free", { free: f.free < 10 ? f.free.toFixed(1).replace(/\.0$/, "") : Math.round(f.free), need: +f.need.toFixed(1) }))}</span></span><small class="expd" title="${esc(L("board.expires", { d: Math.ceil(left) }))}">${icon("clock", "width:12px;height:12px")}${Math.ceil(left)}d</small></div>
      <span class="exp" aria-hidden="true"><i style="width:${Math.min(100, left / ttl * 100).toFixed(0)}%"></i></span></div>`;
  }
  function contractPill(c, st) {
    const k = kindOf(c), [ic] = KIND[k] || KIND.web, col = QOL.linkColor(c.id), miss = (st.cMiss[c.id] || 0) > 1e-6;
    let f, left, sub;
    if (Sim.isJob(c)) { f = clamp01(c.done / c.work); left = c.deadline - S.day; sub = `${Math.round(f * 100)} %`; }
    else if (S.day < c.start) { f = 0; left = c.start - S.day; sub = `${c.units}u`; }
    else { const el = Math.max(0.01, S.day - c.start); f = clamp01(c.delivered / (c.units * el)); left = c.end - S.day; sub = `${c.units}u`; }
    const racks = [...new Set((st.alloc || []).filter(l => l.id === c.id).map(l => l.rack))];
    const tip = `${c.cust} · ${L("kind." + k)} · ${Sim.isJob(c) ? `${Math.round(c.done)}/${Math.round(c.work)} u·d, due in ${Math.ceil(c.deadline - S.day)} d` : S.day < c.start ? `starts in ${Math.ceil(c.start - S.day)} d` : `delivered ${pct(Math.min(1, f))} (SLA ${pct(c.sla)}), ${Math.ceil(c.end - S.day)} d left`}. ${racks.length ? L("board.served", { racks: racks.join(", ") }) : L("board.unserved")}`;
    return `<button class="cpill${miss ? " miss" : ""}${S.day < c.start ? " soon" : ""}${c.anchor ? " anchor" : ""}" data-contract="${c.id}" style="--lc:${col}" title="${esc(tip)}"><i class="sw"></i>${icon(ic)}<span>${esc(c.cust.split(" ")[0])}</span><small>${sub}</small><span class="m"><i style="width:${(f * 100).toFixed(0)}%"></i>${Sim.isJob(c) ? "" : `<em style="left:${c.sla * 100}%"></em>`}</span><small class="d">${Math.max(0, Math.ceil(left))}d</small></button>`;
  }
  function renderOffers(st) {
    const el = $("offerstrip");
    const vis = Sim.contractsOn(S);
    show(el, vis);
    if (!vis) { el.innerHTML = ""; return; }
    const list = S.offers.slice().sort((a, b) => a.expires - b.expires).slice(0, OFFER_STRIP_MAX);
    const nextIn = S.nextOffer != null ? Math.max(0, Math.ceil(S.nextOffer - S.day)) : null;
    const head = `<div class="oshead" data-drawer="contracts" title="Contracts: offers, active contracts, track record"><span class="bt">${icon("hand")}<b>${esc(L("board.title"))}</b><span class="badge" id="board-badge">${S.offers.length}</span></span>
      ${S.offers.length > OFFER_STRIP_MAX ? `<button class="btn slim" data-drawer="contracts">${esc(L("board.more", { n: S.offers.length - OFFER_STRIP_MAX }))}</button>` : nextIn != null ? `<small>${esc(L("board.next", { d: nextIn }))}</small>` : ""}
      <button class="toggle mini" data-act='${esc(JSON.stringify({ type: "policy", key: "autoRenew", on: !S.policy.autoRenew }))}' data-keep-title aria-pressed="${!!S.policy.autoRenew}" title="${esc(L("board.autoRenewTip"))}"><span class="sw"></span><small>${esc(L("board.autoRenew"))}</small></button></div>`;
    const cards = list.map(o => offerCard(o, st)).join("") + Array.from({ length: OFFER_STRIP_MAX - list.length }, (_, i) => `<div class="ocard empty">${i === 0 && !list.length ? `${icon("mail")}<small>${esc(L("board.none"))}</small>` : ""}</div>`).join("");
    const pills = S.contracts.map(c => contractPill(c, st)).join("");
    if (V.boardSeen.size > 100) V.boardSeen = new Set(S.offers.map(o => o.id));   // bounded: only live offers matter
    if (previewCache.size > 30) previewCache.clear();
    el.innerHTML = head + cards + `<div class="cpills" role="list" aria-label="${esc(L("board.active"))}">${pills}</div>`;
    if (V.hl) applyHighlight();
  }
  /* hover an offer = the racks that would serve it light up; hover a contract pill = the racks serving it */
  function highlightRacks(racks, col, key) {
    V.hl = racks && Object.keys(racks).length ? { racks, col, key } : null;
    applyHighlight();
  }
  function applyHighlight() {
    document.querySelectorAll("#floor .rack.hl").forEach(e => e.classList.remove("hl"));
    if (!V.hl) return;
    for (const id of Object.keys(V.hl.racks)) { const e = document.querySelector(`#floor [data-rack="${id}"]:not([data-drag])`); if (e) { e.classList.add("hl"); e.style.setProperty("--hl", V.hl.col); } }
  }
  const previewCache = new Map();
  function offerPreview(id) {
    const o = S.offers.find(x => x.id === id);
    if (!o) return null;
    const c = previewCache.get(id);
    if (c && c.day === Math.floor(S.day) && c.sig === V.sig) return c.racks;
    const racks = QOL.servePreview(Sim, S, o);
    previewCache.set(id, { day: Math.floor(S.day), sig: V.sig, racks });
    return racks;
  }
  /* new offers fly into the board's badge with a chime (no toast sentence) */
  function checkOffers() {
    if (!Sim.contractsOn(S)) return;
    let n = 0;
    for (const o of S.offers) {
      if (V.offersSeen.has(o.id)) continue;
      V.offersSeen.add(o.id);
      dlog("[offer] new", o.id, o.kind, o.cust, o.units, o.days, o.price, o.bts ? "bts" : "");
      if (n++) continue;
      SND("chime", null, 400);
      const k = kindOf(o);
      if (FXON()) requestAnimationFrame(() => {
        const b = $("board-badge"), st = Stage.rect || { x: 0, y: 0, w: innerWidth };
        if (b) FX.fly(st.x + st.w - 40 * STZ(), st.y + 90 * STZ(), b, (KIND[k] || KIND.web)[0], kindCol(k));
      });
      sr(`${o.cust}: ${L("kind." + kindOf(o))}`);
    }
  }

  /* ================= v0.3: one-time cards (pause + explain; first event of a system is a decision) ================= */
  function queueCard(c) { if (!V.cardQueue.some(x => x.key === c.key)) { V.cardQueue.push(c); dlog("card queued", c.key); } }
  function maybeCard() {
    if (!S || !V.cardQueue.length || anyDialogOpen() || V.menu || V.down || (drag && drag.started) || S.over) return;
    showCard(V.cardQueue.shift());
  }
  function showCard(c) {
    $("kt").textContent = c.title; $("ksub").textContent = c.sub || "";
    $("kbody").innerHTML = c.body; $("kfoot").innerHTML = c.foot || `<button class="end" data-close>Got it</button>`;
    $("card").dataset.key = c.key;
    if (c.pause && V.speed) setSpeed(0);   // warnings only: the game stays paused after "Got it" (DECISIONS D46)
    openDialog($("card"));
    SND(c.sound || "warn");
    dlog("card", c.key);
  }
  const SCARE_TITLES = new Set(C.SCARES.map(x => x.title));
  /* the GPU to forward-order on a scare card: the current-generation card of the family the player runs most, or the
     cheapest GPU you can AFFORD; null when none is affordable (then the card only offers "Wait and see") */
  function bestForwardCard() {
    const cg = Sim.currentGen(S), shop = Sim.shopItems(S);
    let c = 0, m = 0;
    for (const r of S.racks) for (const d of r.devices) { const it = item(d.type); if (it.role === "gpu") it.fam === "C" ? c++ : m++; }
    const fam = m > c ? "m" : "c";
    const ok = k => k && shop.includes(k) && Sim.check(S, { type: "forward", item: k }).ok;
    if (ok(fam + cg)) return fam + cg;
    const cheap = shop.filter(k => item(k).role === "gpu" && ok(k)).sort((a, b) => item(a).price - item(b).price);
    return cheap[0] || null;
  }
  function checkFirsts() {
    if (on("memory") && !V.firsts.scare) {
      const n = S.news.find(x => x.cat === "memory" && SCARE_TITLES.has(x.title) && x.day >= (S.unlocked.memory || 0));
      if (n) {
        V.firsts.scare = true;
        const k = bestForwardCard(), it = k && item(k);
        queueCard({ key: "scare", title: "Memory scare: forward-order now?", sub: `${dateOf(S.day)} · game paused`,
          body: `<div class="kv big"><span>${icon("layers", `color:${COL.mem}`)} <b>${esc(n.title)}</b></span></div><div class="sub">${esc(n.body)}</div>
            <ul class="plain"><li>${icon("news")}<span>If it is real, memory (HBM) prices climb and GPUs ship in <b>${K.SHORT_SHIP_DAYS}</b> days instead of ${K.SHIP_DAYS}. About 1 in 3 scare stories is false: a follow-up story ~10 days later tells which.</span></li>
            <li>${icon("lock")}<span>A <b>forward order</b> buys a GPU at today's price; it lands on your spares shelf in ${K.FORWARD_DAYS} days, ready to install.</span></li>
            <li>${icon("help")}<span>Later: drag a GPU from the catalog onto the spares shelf. The HBM index sits in the catalog header.</span></li></ul>`,
          foot: `${k ? actBtn({ type: "forward", item: k }, `Forward-order ${it.name} · ${money(it.price)}`, { cls: "primary", icon: "truck" }) : ""}<button class="end" data-close>Wait and see</button>` });
      }
    }
    if (on("policy") && !V.firsts.policy) {
      const p = S.policies.find(x => x.announced && x.status === "proposed");
      if (p) {
        V.firsts.policy = true;
        queueCard({ key: "policy", title: `Proposed law: ${p.title}`, sub: `vote on ${dateOf(p.vote)} · game paused`,
          body: `<div class="sub">${esc(p.body)}</div><ul class="plain"><li>${icon("trend")}<span>Two news signals before the vote hint whether it will pass.</span></li>
            <li>${icon("bank")}<span><b>Lobbying</b> costs ${money(K.LOBBY_COST)} and shifts the odds by ${K.LOBBY_SHIFT * 100} %; there is a ${K.LOBBY_LEAK * 100} % chance the press finds out (reputation hit).</span></li>
            <li>${icon("help")}<span>Later: the Reputation &amp; policy drawer (flag icon, top right).</span></li></ul>`,
          foot: `${actBtn({ type: "lobby", policy: p.id, dir: -1 }, "Lobby against", { icon: "warn" })}${actBtn({ type: "lobby", policy: p.id, dir: 1 }, "Lobby for", { icon: "trend" })}<button class="end" data-close>Ignore</button>` });
      }
    }
    if (on("investors") && !V.firsts.round && S.roundOffer) {
      V.firsts.round = true;
      const o = S.roundOffer;
      queueCard({ key: "round", title: `${o.vc}: ${money(o.amount)} for ${pct(o.pct)}`, sub: `expires in ${Math.ceil(o.expires - S.day)} days · game paused`,
        body: `<span class="biased">VC PITCH</span><q>${esc(o.pitch.replace(/^"|"$/g, ""))}</q><ul class="plain">
          <li>${icon("coin")}<span>Cash now to grow faster. Your score becomes your share (${pct(S.equity.own)} → ${pct(S.equity.own * (1 - o.pct))}) of the company's value.</span></li>
          <li>${icon("flag")}<span>Taking money brings a board with revenue targets every ${K.BOARD_EVERY} days. Miss two in a row and you are fired. Pitches are biased.</span></li>
          <li>${icon("help")}<span>Later: the Finance drawer (chart icon, top right).</span></li></ul>`,
        foot: `${actBtn({ type: "acceptRound", id: o.id }, "Accept", { cls: "good", icon: "check" })}${actBtn({ type: "declineRound", id: o.id }, "Decline", { icon: "cross" })}<button class="end" data-close>Decide later</button>` });
    }
  }

  /* ================= v0.3: bankruptcy warning (P1) ================= */
  const bankruptFloor = () => on("finance") ? -S.creditLimit : K.BANKRUPT;
  /* days until bankrupt at the current net rate (the worse of today's rate and the last week's average), or null */
  function runwayDays(st) {
    const pd = S.profitDays.slice(-7), avg = pd.length >= 3 ? pd.reduce((a, x) => a + x, 0) / pd.length : st.net;
    const net = Math.min(st.net, avg);
    if (net >= -0.01) return null;
    return { days: Math.max(0, (S.cash - bankruptFloor()) / -net), net };
  }
  function checkRunway() {
    if (S.over) return;
    const st = Sim.stats(S), R0 = runwayDays(st), rw = R0 && R0.days, floor = bankruptFloor();
    const body = why => `<div class="kv big"><span>${icon("coin")} Cash <b>${Math.abs(S.cash) < 1 ? "$" + S.cash.toFixed(1) + "k" : money(S.cash)}</b></span><b style="color:${COL.bad}">bankrupt below ${money(floor)}</b></div>
      <div class="sub">${why}</div><ul class="plain">
      <li>${icon("coin")}<span>Sell idle or losing hardware: drag a part from the rack panel to the bin.</span></li>
      <li>${icon("leaf")}<span>Put racks on Eco to cut the power bill; stop buying until income is positive.</span></li>
      ${on("finance") ? `<li>${icon("bank")}<span>Borrow or return leases in the Finance drawer.</span></li>` : ""}
      ${on("ops") ? `<li>${icon("person")}<span>Idle technicians cost $${K.SALARY}k/day each: fire the ones you don't need.</span></li>` : ""}</ul>`;
    if (S.cash < 0 && !V.warned.neg) {
      V.warned.neg = true;
      queueCard({ key: "neg", pause: true, sound: "alarm", title: "Cash is below zero", sub: `${dateOf(S.day)} · game paused`,
        body: body(R0 ? `At your current rate (${perDay(R0.net)}) you are about <b>${Math.round(rw)} days</b> from bankruptcy.` : "Income is positive right now, but there is little room left.") });
    }
    if (rw != null && rw < 30 && !V.warned.rw) {
      V.warned.rw = true;
      queueCard({ key: "runway", pause: true, sound: "alarm", title: `About ${Math.max(1, Math.round(rw))} days of cash left`, sub: `${dateOf(S.day)} · game paused`,
        body: body(`You are losing ${perDay(R0.net).replace("−", "")}. At this rate you go bankrupt around <b>${dateOf(S.day + rw)}</b>.`) });
      dlog("[warn] runway", rw.toFixed(1), "cash", S.cash.toFixed(1), "floor", floor.toFixed(1));
    }
    if (V.warned.rw && (rw == null || rw > 90)) V.warned.rw = false;      // re-arm once the danger passed
  }

  /* ================= v0.3: every discrete cash jump is explained (P2) ================= */
  function checkCash() {
    const seq = S.cashSeq || 0, flow = S.totals.flow || 0;
    let logged = 0;
    const news = (S.cashEvents || []).filter(e => e.n > V.cashSeen);
    for (const e of news) logged += e.amt;
    cashEventFx(news);
    // v0.3 kinds keep a short explanation toast (tax, repair, sale); the v4 kinds are shown, not told (cashEventFx)
    const big = news.filter(e => Math.abs(e.amt) >= 10 && TOLD.has(e.kind));
    if (big.length) toast(big.slice(0, 3).map(e => `${e.amt >= 0 ? "+" : "−"}${money(Math.abs(e.amt))}: ${e.label}`).join(" · "), "keep");
    if (news.length) dlog("[cash] events", news.map(e => `${e.kind} ${e.amt}`).join(", "));
    V.cashSeen = seq;
    const P = V.flowPrev;
    if (P) {   // anything left over is a jump nobody logged: say so, never stay silent (and flag it in debug)
      const gap = (S.cash - P.cash) - (flow - P.flow) - logged;
      if (Math.abs(gap) >= 10) { toast(`Cash ${gap >= 0 ? "+" : "−"}${money(Math.abs(gap))}: one-off (see the Finance drawer)`, "keep"); console.warn("[ui] unexplained cash jump", gap.toFixed(1), "day", S.day); }
    }
    V.flowPrev = { cash: S.cash, flow };
  }

  /* v4 cash events as signals: money floats from where it happened, losses get a short red screen-edge vignette,
     contract outcomes fly to / flash on the order board, all with a sound; no sentences (tooltips keep the label) */
  const TOLD = new Set(["tax", "repair", "sale"]);
  function cashEventFx(list) {
    if (!list.length) return;
    requestAnimationFrame(() => { if (S) cashEventFxNow(list); });   // rects read at the next frame start (no forced layout)
  }
  function cashEventFxNow(list) {
    const fx = FXON(), cr = $("h-cashchip").getBoundingClientRect(), br = $("offerstrip").getBoundingClientRect();
    const floatAt = (r, txt, col, size) => { if (fx && r && r.width) FX.floatText(r.left + r.width / 2, r.bottom + 6, txt, col, size || 15); };
    let tot = 0, lossBig = 0;
    for (const e of list) {
      const amt = e.amt || 0;
      // a job paid: the money rises from the board (no sparks: at 8x they kept the whole screen in the canvas's dirty rect)
      if (e.kind === "contract") { SND("chaching", amt || 1); floatAt(br, `+${money(amt)}`, "#7FE0A8", 18); }
      else if (e.kind === "contractLost" || e.kind === "contractCancel") {
        SND(e.kind === "contractLost" ? "crunch" : "fail", null, 300);
        const cust = (e.label || "").split(/ terminated| cancelled/)[0];
        floatAt(br, `✕ ${cust || L("fb.cancelled")}`, "#FF8466", 16);
        if (fx) FX.vignette(0.7);
        pulse($("offerstrip"), "fx-nope-el", 450);
      } else if (e.kind === "renew") { SND("chime", null, 400); floatAt(br, `↻ ${L("fb.renewed")}`, "#5AD1E6", 15); }
      else if (e.kind === "restock") { floatAt($("shelf-wrap").getBoundingClientRect(), `−${money(-amt)}`, "#FF8466", 13); SND("drop", null, 300); }
      else if (e.kind === "refund") SND("chaching", amt || 1, 300);
      tot += amt;
      if (amt < 0 && e.kind !== "restock") lossBig += -amt;
    }
    if (Math.abs(tot) >= 10) floatAt(cr, `${tot >= 0 ? "+" : "−"}${money(Math.abs(tot))}`, tot >= 0 ? "#7FE0A8" : "#FF8466", 15);
    if (fx && lossBig >= Math.max(40, 0.08 * Math.max(0, S.cash))) FX.vignette(Math.min(1, 0.4 + lossBig / Math.max(200, S.cash)));
  }

  /* ================= v0.3: pace chip (P0-3) ================= */
  function renderPace(sc) {
    const el = $("h-pace"); if (!el) return;
    const vis = !!S && PACE_ON && !!window.Pace;
    show(el, vis);
    if (!vis) return;
    const you = sc != null ? sc : Sim.score(S), P = (V.pace && V.pace.rows) || {}, g = P[PACE_POLS[0]], p = P[PACE_POLS[1]], today = Math.floor(S.day);
    const lag = x => x && !x.over && x.day < today - 2;
    const vals = [you, g ? g.score : 0, p ? p.score : 0], max = Math.max(1, ...vals.map(v => Math.abs(v)));
    const verdict = !g ? "…" : L(you >= g.score ? "pace.ahead" : "pace.behind", { a: BOTNAME(PACE_POLS[0]) });
    const col = !g ? COL.hudGood : you >= g.score ? COL.hudGood : COL.hudBad;
    const bar = (v, c, t) => `<i title="${esc(t)}" style="width:${Math.max(2, Math.abs(v) / max * 100).toFixed(1)}%;background:${c}"></i>`;
    const key = [Math.round(you), g && Math.round(g.score), g && g.day, p && Math.round(p.score), p && p.day, today].join("|");
    if (el._k === key) return;
    el._k = key;
    const fmt = x => x ? money(x.score) + (lag(x) ? `<span class="lag"> d${x.day}</span>` : "") : "…";
    el.innerHTML = `${icon("trend", `color:${col}`)}<div><span class="big" style="color:${col}">${verdict}</span>
      <small class="pr">${BOTNAME(PACE_POLS[0])[0]} ${fmt(g)} · ${BOTNAME(PACE_POLS[1])[0]} ${p ? fmt(p) : V.ghost && V.ghost.mode === "main" ? "n/a" : "…"}</small>
      <div class="pacebars">${bar(vals[0], COL.sel, `You ${money(you)}`)}${bar(vals[1], COL.net, `${BOTNAME(PACE_POLS[0])} ${g ? money(g.score) : "…"}`)}${bar(vals[2], COL.train, `${BOTNAME(PACE_POLS[1])} ${p ? money(p.score) : "…"}`)}</div></div>`;
    el.title = `${L("pace.vs", { a: BOTNAME(PACE_POLS[0]), b: BOTNAME(PACE_POLS[1]) })}: two human-paced bots play your seed (${S.sandbox ? "sandbox" : "campaign"}) alongside you, up to today and never ahead.\nYou ${money(you)} · ${BOTNAME(PACE_POLS[0])} ${g ? money(g.score) + ` (day ${g.day})` : "…"} · ${BOTNAME(PACE_POLS[1])} ${p ? money(p.score) + ` (day ${p.day})` : "…"}\n${BOTNAME(PACE_POLS[0])} plays like a busy greedy player; ${BOTNAME(PACE_POLS[1])} like an attentive planner. Both act a few times a month.`;
  }

  /* ================= dialogs: chapter cards ================= */
  function maybeChapter() {
    if (!S) return;
    if (S.chapter > V.seenChapter) {
      for (let i = V.seenChapter + 1; i <= S.chapter; i++) if (!CH[i].mech || S.mech[CH[i].mech] !== false) V.chapQueue.push(i);
      V.seenChapter = S.chapter;
    }
    if (V.chapQueue.length && !anyDialogOpen() && !V.menu) showChapter(V.chapQueue.shift(), true);
  }
  function showChapter(i, fresh) {
    if (S) TELE.event(S.day, "chapter", { i, key: CH[i] && CH[i].key, fresh: !!fresh });
    const c = CH[i], m = CH_META[c.key] || { icons: [], col: "info", where: "" };
    const col = COL[m.col] || COL.info;
    $("ct").textContent = c.title;
    $("csub").textContent = `Chapter ${i + 1} of ${CH.length} · ${dateOf(S.day)} · game paused`;
    $("cbody").innerHTML = `<ul>${c.bullets.map((b, k) => `<li style="--i:${k}"><span class="av" style="background:${col}">${icon(m.icons[k] || "flag")}</span><span>${esc(b)}</span></li>`).join("")}</ul>
      ${c.key === "gpu" ? chapterRoofline() : ""}
      ${m.where ? `<div class="where">${icon("help", "width:16px;height:16px")}<span><b>Where to find it:</b> ${esc(m.where)}</span></div>` : ""}`;
    openDialog($("chapter"));
    dlog("chapter card", i, c.key);
    if (fresh && i > 0) {   // a newly unlocked chapter is a small celebration: confetti over the card + a soft chord
      SND("chord");
      V.chapFly = true;
      if (FXON()) { const r = $("chapter").getBoundingClientRect(); FX.confetti(r.left + r.width / 2, r.top + 8, 80, 0.9); }
    }
    renderAll();
  }
  /* ch3 picture: the same roofline chart as the rack panel, for one card of each family (plain-language caption) */
  function chapterRoofline() {
    const v = (k, w) => +Math.min(item(k).F, item(k).B * Sim.INTENSITY[w]).toFixed(1);
    const demo = (w, t) => rooflineSVG({ devices: [{ type: "c1" }, { type: "m1" }], pending: [], workload: w }, null, t);
    return `<div class="chroof"><div class="pair">${demo("train", `<b style="color:${R.train.color}">On training</b>: Kestrel C1 makes ${v("c1", "train")}, Heron M1 ${v("m1", "train")}`)}${demo("infer", `<b style="color:${R.infer.color}">On inference</b>: Heron M1 makes ${v("m1", "infer")}, Kestrel C1 ${v("c1", "infer")}`)}</div>
      <div class="sub">Each line is one card. Left chart: training (lots of math per byte), where Kestrel C1 earns more. Right chart: inference (little math per byte), where Heron M1 earns more. A card's output is the lower of its two limits.</div></div>`;
  }
  function showSandboxCard() {
    $("ct").textContent = "Sandbox";
    $("csub").textContent = "All 17 chapters unlocked · game paused";
    $("cbody").innerHTML = `<div class="sub">Every mechanic is live from day 0. Events keep their dates (launches, outages, policies, startups). Same 1800 days.</div>
      <div class="chaps">${CH.map((c, i) => { const m = CH_META[c.key]; return `<span><span class="av" style="background:${COL[m.col] || COL.info}">${icon(m.icons[0])}</span>${i + 1}. ${esc(c.title)}</span>`; }).join("")}</div>`;
    openDialog($("chapter"));
  }
  function openDialog(d) { if (!d.open) d.showModal(); if (FXON()) FX.hostCanvas(d); }   // the one fx canvas follows the modal into the top layer
  for (const id of ["chapter", "over", "card"]) $(id).addEventListener("close", () => { if (FXON()) FX.hostCanvas(document.querySelector("dialog[open]")); });
  $("card").addEventListener("close", () => { if (!S) return; dlog("card closed", $("card").dataset.key); renderAll(); setTimeout(() => { maybeChapter(); maybeCard(); }, 0); });
  document.querySelectorAll("dialog [data-close]").forEach(b => b.addEventListener("click", () => b.closest("dialog").close()));
  $("chapter").addEventListener("close", () => { renderAll(); setTimeout(() => { maybeChapter(); maybeCard(); }, 0); });
  $("helpbtn").addEventListener("click", () => { if (S) openKeys(); });
  $("chapter").addEventListener("close", () => {   // a newly unlocked chapter: its flag flies into the goal bar
    if (!V.chapFly || !S) return;
    V.chapFly = false;
    const g = $("goal").querySelector(".gflag"), r = $("stage").getBoundingClientRect();
    if (FXON() && g) FX.fly(r.left + r.width / 2, r.top + r.height / 2, g, "flag", COL.warn, () => pulse($("goal"), "fx-attn", 1200));
  });

  /* ================= keyboard overlay (?) ================= */
  function openKeys() {
    const K2 = [["Space", "key.space"], ["1 2 3 4", "key.speed"], ["N", "key.skip"], ["V", "key.v"], ["M", "key.m"], ["F", "key.f"], ["R", "key.r"],
      ["Ctrl/⌘ C", "key.copy"], ["Ctrl/⌘ V", "key.paste"], ["Ctrl/⌘ D", "key.dup"], ["Ctrl/⌘ Z", "key.undo"], ["A", "key.alerts"], ["O", "key.settings"],
      ["Esc", "key.esc"], ["?", "key.help"], ["Shift", "key.shift"], ["Shift", "key.shiftClick"], ["Right-click", "key.right"]];
    $("ky-t").textContent = L("keys.title");
    $("ky-body").innerHTML = `<div class="keys">${K2.map(([k, t]) => `<div><kbd>${esc(k)}</kbd><span>${esc(L(t))}</span></div>`).join("")}</div>`;
    $("ky-foot").innerHTML = S ? `<button class="btn" id="ky-chap">${icon("help")}${esc(L("keys.chapter"))}</button><button class="end" data-close>OK</button>` : `<button class="end" data-close>OK</button>`;
    openDialog($("keys"));
    TELE.event(S ? S.day : null, "keys", {});
  }
  $("keys").addEventListener("click", e => {
    if (e.target.closest("#ky-chap")) { $("keys").close(); showChapter(S.chapter); }
    else if (e.target.closest("[data-close]")) $("keys").close();
  });

  /* ================= settings: sound, display, auto-pause, saves ================= */
  function applySettings(why) {
    if (window.SFX) { SFX.setVolume("master", SET.master); SFX.setVolume("sfx", SET.sfx); SFX.setVolume("hum", SET.hum); }
    if (FXON()) FX.setReduced(SET.reduced);
    document.documentElement.toggleAttribute("data-cb", !!SET.cb);
    if (window.Stage && Stage.setScale && Stage.z && (V.scaleSet !== (SET.scale || 1))) {
      V.scaleSet = SET.scale || 1;
      Stage.setScale(V.scaleSet);
      try { window.dispatchEvent(new Event("resize")); } catch (e) { /* old browsers */ }   // the fx canvas re-reads the zoom
    }
    loadColors();
    dlog("[settings] apply", why || "", JSON.stringify(SET));
  }
  const slotMeta = n => { try { const x = JSON.parse(store.get(SLOT_KEY(n)) || "null"); return x && x.meta ? x.meta : null; } catch (e) { return null; } };
  function settingsHTML() {
    const rng = (k, lbl) => `<label class="srow"><span>${esc(L(lbl))}</span><input type="range" min="0" max="100" step="5" data-set="${k}" value="${Math.round((SET[k] == null ? 1 : SET[k]) * 100)}"><b>${Math.round((SET[k] == null ? 1 : SET[k]) * 100)}</b></label>`;
    const tog = (path, lbl, val) => `<button class="toggle" data-settog="${path}" aria-pressed="${!!val}"><span class="sw"></span><span>${esc(L(lbl))}</span></button>`;
    const slots = [1, 2, 3].map(n => {
      const m = slotMeta(n);
      return `<div class="slotrow"><b>${esc(L("set.slot", { n }))}</b><small>${m ? `${m.sandbox ? "Sandbox" : "Campaign"} · seed ${m.seed} · ${esc(dateOf(m.day))} · ${money(m.score)}` : esc(L("set.empty"))}</small>
        <button class="btn" data-slot-save="${n}"${S && !S.over ? "" : " disabled"}>${icon("download")}${esc(L("set.save"))}</button><button class="btn" data-slot-load="${n}"${m ? "" : " disabled"}>${icon("play1")}${esc(L("set.load"))}</button></div>`;
    }).join("");
    return `<section class="sect"><h3>${icon("sound")}${esc(L("set.sound"))}</h3>${rng("master", "set.master")}${rng("sfx", "set.sfx")}${rng("hum", "set.hum")}</section>
      <section class="sect"><h3>${icon("expand")}${esc(L("set.display"))}</h3>
        <label class="srow"><span>${esc(L("set.reduced"))}</span><select data-setsel="reduced"><option value=""${SET.reduced == null ? " selected" : ""}>System</option><option value="1"${SET.reduced === true ? " selected" : ""}>On</option><option value="0"${SET.reduced === false ? " selected" : ""}>Off</option></select></label>
        <label class="srow"><span>${esc(L("set.scale"))}</span><select data-setsel="scale">${[[1, L("set.scaleAuto")], [0.9, "90 %"], [0.8, "80 %"], [0.7, "70 %"]].map(([v, t]) => `<option value="${v}"${+SET.scale === v ? " selected" : ""}>${esc(t)}</option>`).join("")}</select></label>
        <label class="srow"><span>${esc(L("set.lang"))}</span><select disabled><option>${esc(L("set.langSoon"))}</option></select></label>
        ${tog("cb", "set.cb", SET.cb)}</section>
      <section class="sect"><h3>${icon("pause")}${esc(L("set.autopause"))}</h3><div class="togs">${tog("ap.offer", "set.ap.offer", SET.ap.offer)}${tog("ap.fail", "set.ap.fail", SET.ap.fail)}${tog("ap.cash", "set.ap.cash", SET.ap.cash)}${tog("ap.sla", "set.ap.sla", SET.ap.sla)}</div></section>
      <section class="sect"><h3>${icon("box")}${esc(L("set.saves"))}</h3>${slots}
        <div class="buyrow"><button class="btn" id="st-export"${S && !S.over ? "" : " disabled"}>${icon("download")}${esc(L("set.export"))}</button><button class="btn" id="st-import">${icon("box")}${esc(L("set.import"))}</button><button class="btn" id="st-log"${TELE.log ? "" : " disabled"}>${icon("doc")}${esc(L("set.log"))}</button></div></section>`;
  }
  function openSettings() {
    $("st-t").textContent = L("set.title");
    $("st-body").innerHTML = settingsHTML();
    openDialog($("settings"));
    TELE.event(S ? S.day : null, "settings", {});
  }
  $("settings").addEventListener("input", e => {
    const k = e.target.dataset && e.target.dataset.set;
    if (!k) return;
    SET[k] = +e.target.value / 100;
    e.target.nextElementSibling.textContent = e.target.value;
    saveSettings(); applySettings("volume");
    if (k !== "hum") SND("tick", 4, 60);
  });
  $("settings").addEventListener("change", e => {
    const k = e.target.dataset && e.target.dataset.setsel;
    if (!k) return;
    SET[k] = k === "reduced" ? (e.target.value === "" ? null : e.target.value === "1") : +e.target.value;
    saveSettings(); applySettings(k);
    if (S) renderAll();
  });
  $("settings").addEventListener("click", e => {
    const t = e.target;
    const tg = t.closest("[data-settog]");
    if (tg) {
      const path = tg.dataset.settog.split(".");
      if (path[0] === "ap") { SET.ap[path[1]] = !SET.ap[path[1]]; SET.apTouched = true; } else SET[path[0]] = !SET[path[0]];
      tg.setAttribute("aria-pressed", String(path[0] === "ap" ? SET.ap[path[1]] : SET[path[0]]));
      saveSettings(); applySettings(tg.dataset.settog);
      if (S) { R = ROLE(); renderAll(); }
      return;
    }
    const sv = t.closest("[data-slot-save]");
    if (sv && S && !S.over) {
      const n = +sv.dataset.slotSave, meta = { seed: S.seed, sandbox: S.sandbox, day: Math.floor(S.day), score: Math.round(Sim.score(S)), at: Date.now() };
      const ok = store.set(SLOT_KEY(n), JSON.stringify({ meta, s: S }));
      TELE.event(S.day, "saveSlot", { n, ok });
      dlog("[save] slot", n, ok ? "ok" : "failed");
      if (ok) { $("st-body").innerHTML = settingsHTML(); pulse($("st-body").querySelector(`[data-slot-load="${n}"]`), "fx-attn", 900); sr(L("set.saved")); SND("stamp"); }
      else nope("Storage blocked", sv);
      return;
    }
    const ld = t.closest("[data-slot-load]");
    if (ld) {
      let st = null;
      try { const x = JSON.parse(store.get(SLOT_KEY(+ld.dataset.slotLoad)) || "null"); st = x && x.s; } catch (err) { st = null; }
      if (!validSave(st)) { nope(L("set.bad"), ld); return; }
      $("settings").close();
      resumeState(st, "slot" + ld.dataset.slotLoad);
      return;
    }
    if (t.closest("#st-export")) { exportSave(); return; }
    if (t.closest("#st-import")) { $("st-file").value = ""; $("st-file").click(); return; }
    if (t.closest("#st-log")) { exportLog(); return; }
    if (t.closest("[data-close]")) $("settings").close();
  });
  /* export / import the whole state as JSON (a save is just JSON.stringify(S); the sim migrates old versions) */
  async function exportSave() {
    if (!S) return;
    const name = `halcyon-save-seed${S.seed}-d${Math.floor(S.day)}.json`, body = JSON.stringify(S);
    TELE.event(S.day, "exportSave", { bytes: body.length });
    try {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([body], { type: "application/json" })); a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      sr(name); SND("stamp");
      dlog("[save] exported", name, body.length);
    } catch (e) {
      try { await navigator.clipboard.writeText(body); toast("Download blocked here: save copied to the clipboard"); } catch (e2) { nope("Export failed", $("st-export")); }
    }
  }
  $("st-file").addEventListener("change", e => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      let st = null;
      try { const x = JSON.parse(String(rd.result)); st = x && x.s && x.meta ? x.s : x; } catch (err) { st = null; }
      if (!validSave(st)) { nope(L("set.bad"), $("st-import")); dlog("[save] import rejected"); return; }
      if ($("settings").open) $("settings").close();
      dlog("[save] import", f.name, "v", st.v, "day", st.day);
      resumeState(st, "import");
    };
    rd.readAsText(f);
  });
  $("m-load").addEventListener("click", openSettings);

  /* ================= end screen ================= */
  /* end-screen lesson icons by loss key (Sim.summary lessonKeys; v4 adds idle, cancelled, sla) */
  const LESSON_ICON = { idle: "power", cancelled: "cross", sla: "warn", throttle: "flame", failures: "wrench", shortage: "truck", bricked: "rocket",
    fines: "flag", outage: "bolt", transit: "globe", taxes: "coin" };
  function showOver() {
    try { TELE.snap(S, Sim.score(S)); TELE.end(S, Sim.summary(S)); } catch (e) { dlog("tele end", e); }
    if (V.skip) stopSkip("over");
    // auto-pause is on by default for the first campaign only (unless the player changed it)
    if (!S.sandbox) { SET.campaigns = (SET.campaigns || 0) + 1; if (!SET.apTouched) SET.ap = { offer: false, fail: false, cash: true, sla: false }; saveSettings(); }
    const sm = Sim.summary(S), H = sm.hidden, NAME = { lattice: "Lattice", photon: "Photon" };
    $("ot").textContent = S.over === "bankrupt" ? "Bankrupt" : S.over === "fired" ? "The board fired you" : "Five years are up";
    $("osub").textContent = `seed ${seed}${S.sandbox ? " · sandbox" : ""}`;
    const kvs = (a, b) => `<div class="kv"><span>${a}</span><b>${b}</b></div>`;
    const breakdown = `<div class="sect"><h3>${icon("flag")}Score breakdown</h3>
      ${kvs("Net worth (cash + resale − debt)", money(sm.netWorth))}${kvs("+ Earnings multiple (2 years of profit)", money(sm.earnings))}
      ${kvs(`× Reputation factor (${Math.round(sm.reputation)} rep)`, "×" + sm.repFactor.toFixed(2))}${kvs("= Company value", money(sm.companyValue))}
      ${kvs("× Your ownership", pct(sm.own))}${S.over === "fired" ? kvs("× Fired penalty", "×" + K.FIRED_SCORE) : ""}${kvs("<b>Score</b>", money(sm.score))}
      <div class="kv"><span>${esc(L("end.contracts"))}</span><b>${sm.contracts.signed} / ${sm.contracts.fulfilled} / ${sm.contracts.failed} / ${sm.contracts.cancelled || 0} / ${sm.contracts.late || 0}</b></div>
      <div class="kv"><span>Carbon · water</span><b>${Math.round(sm.carbon)} t · ${Math.round(sm.water)} m³</b></div></div>`;
    const maxLoss = Math.max(1, ...sm.losses.map(l => l.total));
    const lessons = `<div class="sect"><h3>${icon("warn")}Your three biggest lessons</h3>
      ${sm.lessons.map((t, i) => `<div class="lesson" data-lesson="${esc((sm.lessonKeys || [])[i] || "")}"><span class="av">${icon(LESSON_ICON[(sm.lessonKeys || [])[i]] || "warn")}</span><span>${esc(t)}</span></div>`).join("") || `<div class="sub">No measurable losses. Impressive.</div>`}
      ${sm.losses.slice(0, 6).map(l => `<div class="kv"><span>${esc(l.label)}</span><b>${money(l.total)}</b></div><div class="meter slim"><i style="width:${l.total / maxLoss * 100}%;background:${COL.bad}"></i></div>`).join("")}</div>`;
    const truths = [
      ["rocket", `<b>${NAME[H.realExotic]}</b> was the real thing; <b>${NAME[H.fakeExotic]}</b> was hype (60 % of its spec sheet in the field, then shut down on day 1500).`],
      ["layers", `Nanofab PM-900: ${H.nanofabDies ? "the vendor <b>died</b> on day 1560 and bricked every PM-900" : "the vendor <b>survived</b>; the PM-900 was a fair deal"}.`],
      ["brain", `The inference "breakthrough" was ${H.demandCut ? "<b>real</b>: demand fell 35 %" : "<b>hype</b>: demand never moved"}.`],
      ["news", `HBM scare stories: ${H.scares.map(x => `d${x.day} ${x.real ? "<b>real</b>" : "false"}`).join(", ") || "none"}.`],
      ["flag", `Policies: ${H.policies.map(p => `${esc(p.title)} — true odds ${pct(p.p0)}${p.shift ? ` (${p.shift > 0 ? "+" : "−"}${pct(Math.abs(p.shift))} lobbying)` : ""}, ${p.status}`).join("; ")}.`],
      ["person", `The VC pitch promised board targets of +${pct(H.vcPitchGrowth)} per half-year; the board actually asked for +${pct(H.boardGrowth)}.`],
    ];
    const curtain = `<div class="sect"><h3>${icon("help")}Behind the curtain</h3>${truths.map(([ic, t]) => `<div class="truth">${icon(ic)}<span>${t}</span></div>`).join("")}</div>`;
    const [PA, PB] = PACE_POLS;
    const rows = { you: { score: sm.score, done: true }, [PA]: { score: null, day: 0 }, [PB]: { score: null, day: 0 } };
    const drawBots = () => {
      const max = Math.max(1, ...Object.values(rows).map(r => r.score || 0));
      const bar = (k, name, col) => { const r = rows[k]; return `<div class="bar"><span>${name}</span><i style="width:${r.score == null ? 0 : Math.max(1, r.score / max * 100)}%;background:${col}"></i><b>${r.score == null ? "…" : money(r.score)}${r.est ? `<span class="est" title="Stopped at day ${r.day} to keep the page responsive">EST d${r.day}</span>` : ""}</b>${k !== "you" && !r.done ? `<span></span><span class="prog"><i style="display:block;width:${r.day / K.END_DAY * 100}%"></i></span>` : ""}</div>`; };
      $("bots").innerHTML = `<div class="sub" style="font-weight:600">${esc(L("pace.vs", { a: BOTNAME(PA), b: BOTNAME(PB) }))} (founder equity, same seed)</div>${bar("you", "You", COL.sel)}${bar(PA, BOTNAME(PA), COL.net)}${bar(PB, BOTNAME(PB), COL.train)}
        <div class="sub">Same seed, same events, human-paced: ${BOTNAME(PA)} plays greedy, ${BOTNAME(PB)} plans ahead.</div>`;
    };
    $("obody").innerHTML = `<div class="score"><div class="tally" id="tally"></div><div class="scorelabel">${icon("flag")}SCORE <small>founder equity value</small></div><div class="big" id="final-score" style="font-size:38px" title="Score = your ownership × company value. Net worth is only one input.">${money(sm.score)}</div><div class="sub">${S.over === "bankrupt" ? "Cash fell below your credit line." : S.over === "fired" ? "Two missed board targets in a row. Your equity counts at half." : `Founder equity value after ${Math.floor(S.day)} days.`}</div><div id="bots" style="display:grid;gap:8px"></div></div>
      <div class="cols">${breakdown}${lessons}</div>${curtain}`;
    drawBots();
    openDialog($("over"));
    runTally(sm);
    // v0.3: the pace ghost already played the bots up to today; the worker finishes them (instant at day 1800)
    if (V.ghost && V.ghost.mode === "worker") {
      const t0 = performance.now();
      const upd = m => {
        if (!m || !m.rows) return;
        for (const p of [PA, PB]) { const x = m.rows[p]; if (x) rows[p] = x.over ? { score: x.score, day: x.day, done: true } : { score: null, day: x.day }; }
        drawBots();
        if (rows[PA].done && rows[PB].done) { dlog("[pace] end screen bots done in", (performance.now() - t0).toFixed(0) + "ms"); V.overRows = null; }
      };
      V.overRows = upd;
      upd(V.pace);
      V.ghost.finish();
    } else runBots(rows, drawBots);
  }
  /* last bullet: the score tallies up step by step (net worth + earnings, × reputation, × ownership), Balatro-style.
   * Each step's number is the exact value from Sim.summary; the big number rolls between them. */
  function runTally(sm) {
    const el = $("tally"), big = $("final-score"); if (!el || !big) return;
    const steps = [["Net worth", money(sm.netWorth), sm.netWorth], ["+ Earnings multiple", money(sm.earnings), sm.netWorth + sm.earnings],
      [`× Reputation`, "×" + sm.repFactor.toFixed(2), sm.companyValue]];
    if (sm.own < 0.999) steps.push(["× Your ownership", pct(sm.own), sm.companyValue * sm.own]);
    if (S.over === "fired") steps.push(["× Fired", "×" + K.FIRED_SCORE, sm.score]);
    steps[steps.length - 1][2] = sm.score;
    el.innerHTML = steps.map(([a, b], i) => `<div class="trow" data-i="${i}"><span>${esc(a)}</span><b>${esc(b)}</b></div>`).join("");
    const fast = !FXON() || FX.reduced, gap = fast ? 60 : 520;
    // the big number is always the SCORE: it rolls from 0 to the final score while the breakdown rows land
    // (rolling through the intermediate net worth read as "the result is net worth")
    if (FXON() && !fast) { big.textContent = money(0); FX.tween(0, sm.score, 250 + steps.length * gap, "outCubic", x => { big.textContent = money(x); }, () => { big.textContent = money(sm.score); }); }
    else big.textContent = money(sm.score);
    steps.forEach(([, ,], i) => setTimeout(() => {
      if (!$("tally") || $("tally") !== el) return;   // dialog replaced (replay)
      el.querySelector(`[data-i="${i}"]`).classList.add("in");
      SND("tick", i * 3);
      if (i === steps.length - 1) setTimeout(() => {
        big.textContent = money(sm.score);
        big.classList.add("landed");
        if (S.over === "end") {
          SND("fanfare");
          if (FXON()) { const r = big.getBoundingClientRect(); FX.confetti(r.left + r.width / 2, r.top + r.height / 2, 120, 1); FX.sparks(r.left + r.width / 2, r.top + r.height / 2, "#FFD24A", 30, 320); }
        }
        dlog("fx: tally done", sm.score.toFixed(1));
      }, fast ? 60 : 460);
    }, 250 + i * gap));
  }
  function runBots(rows, draw) {
    const BUDGET = 8000, SLICE = 14, runId = (V.botRun = (V.botRun || 0) + 1);
    const queue = PACE_POLS.slice();
    const next = () => {
      const pol = queue.shift(); if (!pol || runId !== V.botRun) return;
      const s = Sim.newGame(seed, { sandbox: V.sandbox }), mem = {}, fn = Bots.POLICIES[pol];
      let used = 0;
      const slice = () => {
        if (runId !== V.botRun) return;
        const t0 = performance.now();
        try {
          while (!s.over && performance.now() - t0 < SLICE) { fn(s, mem); Sim.advance(s, 1); }
        } catch (e) { console.error("[ui] bot failed", pol, e); rows[pol] = { score: Sim.score(s), est: true, day: Math.floor(s.day) }; draw(); next(); return; }
        used += performance.now() - t0;
        rows[pol].day = Math.floor(s.day);
        if (s.over) { rows[pol] = { score: Sim.score(s), done: true, day: Math.floor(s.day) }; dlog("bot", pol, rows[pol].score.toFixed(0), used.toFixed(0) + "ms"); draw(); next(); return; }
        if (used > BUDGET) { rows[pol] = { score: Sim.score(s), est: true, done: true, day: Math.floor(s.day) }; dlog("bot budget hit", pol, s.day); draw(); next(); return; }
        draw();
        setTimeout(slice, 0);
      };
      setTimeout(slice, 20);
    };
    next();
  }
  $("new-game").addEventListener("click", () => { $("over").close(); V.botRun++; if (V.ghost) { V.ghost.stop(); V.ghost = null; } V.overRows = null; showMenu(); });
  $("same-seed").addEventListener("click", () => { $("over").close(); V.botRun++; start(seed, { sandbox: V.sandbox }); });

  /* ================= main menu ================= */
  function showMenu(inGame) {
    V.menu = true;
    show($("m-export"), !!TELE.log);
    show($("m-tele"), !!TELE.endpoint);
    $("m-tele-sub").textContent = TELE.enabled() ? "On: anonymous, no personal data. Click to turn off." : "Off. Click to turn on.";
    const m = readMeta(), live = inGame && S && !S.over;
    show($("m-continue"), !!m && !live);
    if (m) $("m-continue-sub").textContent = `${m.sandbox ? "Sandbox" : "Campaign"} · seed ${m.seed} · ${dateOf(m.day)} · score ${money(m.score)}`;
    show($("m-resume"), !!live);
    $("m-seed").value = String(seed);
    $("mainmenu").hidden = false;
    dlog("menu", { save: !!m, live });
  }
  function hideMenu() { V.menu = false; $("mainmenu").hidden = true; $("m-howto").hidden = true; }
  function menuSeed() { const v = parseInt(($("m-seed").value || "").replace(/\D/g, ""), 10); return isFinite(v) ? v >>> 0 : Math.floor(Math.random() * 1e6); }
  $("m-campaign").addEventListener("click", () => start(menuSeed(), { sandbox: false }));
  $("m-sandbox").addEventListener("click", () => start(menuSeed(), { sandbox: true }));
  $("m-continue").addEventListener("click", continueGame);
  $("m-resume").addEventListener("click", () => { hideMenu(); renderAll(); });
  $("m-dice").addEventListener("click", () => { $("m-seed").value = String(Math.floor(Math.random() * 1e6)); });
  $("m-seed").addEventListener("input", e => { const v = e.target.value.replace(/\D/g, "").slice(0, 9); if (v !== e.target.value) e.target.value = v; });
  $("m-seed").addEventListener("keydown", e => { if (e.key === "Enter") start(menuSeed(), { sandbox: false }); });
  $("m-how").addEventListener("click", () => {
    const h = $("m-howto");
    h.hidden = !h.hidden;
    h.innerHTML = [["plus", "Drag hardware from the catalog onto racks (or tap a card, then a rack). Technicians install it."],
      ["coin", "Racks earn money by selling web, training and inference output. Power, staff and upkeep cost money every day."],
      ["flag", "Chapters unlock one mechanic at a time: power, GPUs, heat, generations, failures, networks, contracts, memory, finance, facilities, energy, environment, investors, reputation, policy, disruption."],
      ["news", "Vendors, investors and politicians are biased. Trust the news that follows up, measure with pilots, and watch time."],
      ["trend", "Score = your equity × company value after 5 years. At the end, two bots replay your seed so you can compare."],
      ["pause", "Space pauses. Keys 1-4 set 1x/2x/4x/8x. V cycles map modes. M mutes sound. F toggles fullscreen. Esc closes drawers."]]
      .map(([ic, t]) => `<div>${icon(ic)}<span>${t}</span></div>`).join("");
  });
  $("menubtn").addEventListener("click", () => showMenu(true));

  /* ================= drag and drop (pointer events: mouse, touch, pen) ================= */
  let drag = null, suppressClick = false;
  function payload(el) {
    const k = el.dataset.drag;
    if (k === "new") return { kind: "new", item: el.dataset.item };
    if (k === "dev") return { kind: "dev", from: el.dataset.rack, uid: +el.dataset.uid };
    if (k === "shelf") return { kind: "shelf", uid: +el.dataset.uid };
    if (k === "spine") return { kind: "spine" };
    if (k === "offer") return { kind: "offer", id: el.dataset.id };
    return null;
  }
  const TARGETS = "[data-drop-fail], [data-spine], [data-drop-sign], [data-drop-decline], [data-drop-shelf], [data-drop-sell], [data-drop-rack], [data-rack]:not([data-drag])";
  function findTarget(x, y) {
    const el = document.elementFromPoint(x, y);
    if (!el) return null;
    let t = el.closest(TARGETS);
    if (t && t.hasAttribute("data-drop-fail") && (!drag || drag.p.kind !== "shelf")) t = t.closest("[data-drop-rack]");
    return t;
  }
  /* map (payload, target) to a sim action, or {bad: reason} */
  function opFor(p, target) {
    if (!target) return null;
    const leasing = V.lease && on("finance");
    if (target.hasAttribute("data-drop-sign")) return p.kind === "offer" ? { type: "signContract", id: p.id } : null;
    if (target.hasAttribute("data-drop-decline")) return p.kind === "offer" ? { type: "declineContract", id: p.id } : null;
    if (p.kind === "offer") return null;
    if (target.hasAttribute("data-drop-fail")) {
      const f = findDev(+target.dataset.dropFail), sp = S.shelf.find(x => x.uid === p.uid);
      if (!f || !sp) return null;
      if (sp.type !== f.d.type) return { bad: `Needs a spare ${item(f.d.type).name}` };
      if (sp.failed) return { bad: "That spare is broken too" };
      return { type: "repair", uid: f.d.uid };
    }
    if (target.hasAttribute("data-spine")) {
      const [h, row] = target.dataset.spine.split("-").map(Number);
      return p.kind === "spine" ? { type: "spine", hall: h, row } : { bad: "Spine slot: drag the Row spine card here" };
    }
    if (target.hasAttribute("data-drop-sell")) {
      if (p.kind === "dev") { const f = findDev(p.uid); return f && f.d.leased ? { type: "returnLease", rack: p.from, uid: p.uid } : { type: "sell", rack: p.from, uid: p.uid }; }
      if (p.kind === "shelf") return { bad: "Install it in a rack to sell it" };
      return null;
    }
    if (target.hasAttribute("data-drop-shelf")) {
      if (!on("ops")) return null;
      if (p.kind === "dev") return { type: "store", rack: p.from, uid: p.uid };
      if (p.kind === "new") return on("memory") ? { type: "forward", item: p.item } : { bad: "Forward orders unlock in chapter 9" };
      return null;
    }
    const to = target.dataset.rack || target.dataset.dropRack;
    if (!to) return null;
    if (p.kind === "new") return { type: leasing && item(p.item).role === "gpu" ? "lease" : "buy", item: p.item, rack: to };
    if (p.kind === "dev") return { type: "move", rack: p.from, uid: p.uid, to };
    if (p.kind === "shelf") return { type: "unstore", rack: to, uid: p.uid };
    if (p.kind === "spine") { const r = rack(to); return r ? { type: "spine", hall: r.hall, row: r.row } : null; }
    return null;
  }
  const PROJECTABLE = new Set(["buy", "lease", "move", "sell", "store", "returnLease", "unstore", "repair", "spine"]);
  const clearMarks = () => document.querySelectorAll(".drop-ok, .drop-bad").forEach(e => e.classList.remove("drop-ok", "drop-bad"));
  function payloadInfo(p) {
    if (p.kind === "new") { const it = item(p.item); return it && { icon: it.icon, name: it.name }; }
    if (p.kind === "dev" || p.kind === "shelf") { const f = findDev(p.uid); return f && { icon: item(f.d.type).icon, name: item(f.d.type).name }; }
    if (p.kind === "spine") return { icon: "net", name: "Row spine" };
    if (p.kind === "offer") { const o = S.offers.find(x => x.id === p.id); return o && { icon: "doc", name: o.cust }; }
    return null;
  }
  function evaluate(p, target) {
    const op = opFor(p, target);
    if (!op) return { op: null };
    if (op.bad) return { op: null, res: { ok: false, msg: op.bad } };
    const res = Sim.check(S, op);
    return { op: res.ok ? op : null, res, raw: op };
  }

  document.addEventListener("pointerdown", e => {
    V.down = true;
    // pressing on a card's backdrop does nothing: say why instead of silently eating the drag
    const dlg = document.querySelector("dialog[open]");
    if (dlg && e.target === dlg) {
      if (dlg.id === "settings" || dlg.id === "keys") { dlg.close(); return; }   // light dialogs close on a backdrop click
      sr(`Close the card first (${dlg.querySelector("footer button") ? dlg.querySelector("footer button:last-child").textContent.trim() : "Got it"})`);
      SND("bonk", null, 200);
      const fb = dlg.querySelector("footer button:last-child");
      if (fb) pulse(fb, "fx-attn", 900);
      try { dlg.animate([0, -8, 7, -4, 0].map(x => ({ translate: `${x}px 0` })), { duration: 260 }); } catch (err) { /* no WAAPI */ }
      return;
    }
    hoverHide();
    const fr = e.target.closest("#floor [data-rack]");
    V.rackPress = fr && !e.target.closest("[data-drag]") && !e.shiftKey ? { x: e.clientX, y: e.clientY } : null;
    // box select: press on the empty floor (aisles, gaps), not on a rack, spine or button
    if (e.button === 0 && S && !S.over && !V.menu && e.target.closest("#floor") && !e.target.closest("[data-rack], [data-spine], button, .hall")) boxStart(e);
    const src = e.target.closest("[data-drag]");
    if (!src || e.button !== 0 || !S || S.over || V.menu) return;
    const p = payload(src); if (!p) return;
    drag = { src, x: e.clientX, y: e.clientY, started: false, p, shift: e.shiftKey };
  });
  document.addEventListener("pointermove", e => {
    if (V.box) { boxMove(e); return; }
    if (!drag && V.rackPress && Math.hypot(e.clientX - V.rackPress.x, e.clientY - V.rackPress.y) > 30) {
      V.rackPress = null;   // floor tiles are not draggable: point at the rack panel, where parts are
      toast("To move or sell hardware, drag a part from the rack panel (right) onto another rack or the bin");
      dlog("hint: floor rack drag");
    }
    if (!drag) return;
    drag.shift = e.shiftKey;
    if (!drag.started) {
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 6) return;
      const info = payloadInfo(drag.p);
      if (!info) { drag = null; return; }
      drag.started = true;
      document.body.classList.add("dragging");
      drag.ghost = document.createElement("div");
      drag.ghost.className = "ghost";
      drag.ghost.innerHTML = `<div class="gcard lift">${icon(info.icon)}${esc(info.name)}${drag.p.kind === "new" && V.lease && on("finance") && item(drag.p.item).role === "gpu" ? " (lease)" : ""}</div><div class="msg"></div>`;
      document.body.appendChild(drag.ghost);
      drag.card = drag.ghost.querySelector(".gcard");
      drag.src.classList.add("lifting");
      drag.lx = e.clientX; drag.lt = performance.now(); V.tilt = 0;
      SND("pickup");
      // an unaffordable card still lifts, but its price pulses red at once (the drop will be refused)
      if (drag.p.kind === "new" && drag.src.classList.contains("unaff")) { const pr = drag.src.querySelector(".price"); pulse(pr, "fx-pricebad", 800); pulse($("h-cashchip"), "fx-nocash", 520); }
      dlog("drag start", drag.p);
    }
    e.preventDefault();
    // tilt with pointer velocity (follow-through); settles back in fxFrame when the pointer stops
    const tNow = performance.now(), vx = (e.clientX - drag.lx) / Math.max(8, tNow - drag.lt);
    drag.lx = e.clientX; drag.lt = tNow;
    V.tilt = Math.max(-14, Math.min(14, V.tilt * 0.6 + vx * 9));
    if (!FXON() || !FX.reduced) drag.card.style.rotate = V.tilt.toFixed(2) + "deg";
    let target = findTarget(e.clientX, e.clientY), gx = e.clientX, gy = e.clientY;
    clearMarks();
    const msg = drag.ghost.querySelector(".msg");
    drag.reorder = null;
    // reorder: a part dragged within its own rack's elevation → a slot index + a drop-indicator line
    if (drag.p.kind === "dev" && target && target.matches && target.matches(`.elev[data-drop-rack="${drag.p.from}"]`)) {
      const ro = reorderAt(target, e.clientY);
      drag.ghost.style.transform = `translate(${gx.toFixed(1)}px,${gy.toFixed(1)}px) translate(-112%,-50%)`;   // beside the pointer: the line stays visible
      drag.gx = gx; drag.gy = gy; drag.snap = null; drag.bad = false;
      msg.style.display = "none";
      if (ro) { drag.op = { type: "reorder", rack: drag.p.from, uid: drag.p.uid, index: ro.index }; drag.reorder = ro; }
      else drag.op = null;
      return;
    }
    hideReorderLine();
    let ev = evaluate(drag.p, target);
    // coyote time: magnetic targets — nothing valid under the pointer, but a valid target within 40 px snaps
    drag.snap = null;
    if (!ev.res) {
      const m = magnet(e.clientX, e.clientY, target);
      if (m) { target = m.el; ev = m.ev; drag.snap = m; gx = e.clientX + (m.cx - e.clientX) * 0.35; gy = e.clientY + (m.cy - e.clientY) * 0.35; }
    }
    drag.ghost.style.transform = `translate(${gx.toFixed(1)}px,${gy.toFixed(1)}px) translate(-50%,-60%)`;
    drag.gx = gx; drag.gy = gy;
    const st = Sim.stats(S);
    drag.bad = ev.res && !ev.res.ok;
    drag.badMsg = drag.bad ? ev.res.msg : null; drag.raw = ev.raw || null;
    drag.fill = null;
    if (!ev.res) { msg.style.display = "none"; renderHUD(st); drag.op = null; return; }
    target.classList.add(ev.res.ok ? "drop-ok" : "drop-bad");
    let level = ev.res.ok ? "ok" : "bad", text = ev.res.msg, proj = null;
    if (ev.res.ok && PROJECTABLE.has(ev.op.type)) {
      const wl = wlDefault(ev.op);
      proj = Sim.stats(Sim.project(wl ? Sim.project(S, wl) : S, ev.op), { eq: true });
      const eqNow = Sim.stats(S, { eq: true }), dNet = proj.net - eqNow.net;
      text += ` · ${dNet >= 0 ? "+" : "−"}$${Math.abs(dNet).toFixed(2)}k/d`;
      if (wl) text += ` · rack → ${R[wl.workload].name}`;
      const rid = ev.op.to || ev.op.rack, pr = proj.perRack[rid], dest = rack(rid);
      const newIt = ev.op.item ? item(ev.op.item) : null;
      if (dest && newIt && newIt.role !== "net" && newIt.role !== "cool" && switchless(dest, proj.perRack[rid])) {
        level = "warn"; text += " · NO SWITCH: earns nothing until a switch is installed";
      }
      else if (pr && pr.throttle < 1) { level = "warn"; text += ` · rack throttles to ${Math.round(pr.throttle * 100)} %`; }
      else if (pr && pr.netF < 1 && pr.netNeed > 0) { level = "warn"; text += " · network short"; }
    }
    // shift held over a rack with a catalog card: fill the rack (as many as fit), count · cost · ETA on the ghost
    if (ev.res.ok && drag.shift && ev.op && (ev.op.type === "buy" || ev.op.type === "lease") && drag.p.kind === "new") {
      const fp = QOL.fillPlan(Sim, S, ev.op, 20), days = (/in (\d+) days/.exec(ev.res.msg) || [])[1] || "?";
      if (fp.n > 1) { drag.fill = fp; text = L("fb.fill", { n: fp.n, cost: fp.cost ? money(fp.cost) : "$0", days }); level = "ok"; }
    }
    msg.style.display = ""; msg.className = "msg " + level; msg.textContent = text;
    renderHUD(st, proj);
    drag.op = ev.op;
  });
  /* reorder helpers: index among the rack's other devices (top to bottom = r.devices order) and the indicator line */
  function reorderAt(elev, y) {
    const r = rack(drag.p.from); if (!r) return null;
    const devs = [...elev.querySelectorAll(".dev[data-uid]")].filter(el => +el.dataset.uid !== drag.p.uid);
    let index = 0;
    for (const el of devs) { const b = el.getBoundingClientRect(); if (y > b.top + b.height / 2) index++; }
    const cur = r.devices.findIndex(d => d.uid === drag.p.uid);
    const er = elev.getBoundingClientRect(), z = STZ();
    const edge = devs.length ? (index < devs.length ? devs[index].getBoundingClientRect().top : devs[devs.length - 1].getBoundingClientRect().bottom) : er.top + 4 * z;
    let line = drag.line;
    if (!line) { line = drag.line = document.createElement("div"); line.className = "reorder-line"; }
    if (line.parentElement !== elev) elev.appendChild(line);
    line.style.top = ((edge - er.top) / z - 1) + "px";
    line.hidden = false;
    elev.classList.add("reordering");
    return index === cur ? null : { index };
  }
  function hideReorderLine() {
    if (drag && drag.line) { drag.line.hidden = true; if (drag.line.parentElement) drag.line.parentElement.classList.remove("reordering"); }
  }
  /* nearest valid drop target within MAGNET px of the pointer (rects cached per drag: the DOM does not re-render mid-drag) */
  const MAGNET = 40;
  function magnet(x, y, under) {
    if (!drag.cands) drag.cands = [...document.querySelectorAll(TARGETS)].map(el => ({ el, r: el.getBoundingClientRect() })).filter(c => c.r.width > 0);
    let best = null;
    const rad = MAGNET * STZ();   // rects and pointer are viewport px; the radius is 40 stage px at any zoom
    for (const c of drag.cands) {
      if (c.el === under) continue;
      const dx = Math.max(c.r.left - x, 0, x - c.r.right), dy = Math.max(c.r.top - y, 0, y - c.r.bottom), d = Math.hypot(dx, dy);
      if (d > rad || (best && d >= best.d)) continue;
      const ev = evaluate(drag.p, c.el);
      if (ev.res && ev.res.ok) best = { el: c.el, ev, d, cx: (c.r.left + c.r.right) / 2, cy: (c.r.top + c.r.bottom) / 2 };
    }
    return best;
  }
  addEventListener("scroll", () => { if (drag) drag.cands = null; }, true);
  /* the ghost's exit: squash into the target (commit), shake "no" (invalid), or fly home (dropped on nothing) */
  function ghostExit(g, src, how) {
    const reduced = !FXON() || FX.reduced;
    if (reduced || !g.card || !g.ghost.animate) { g.ghost.remove(); return; }
    const base = `translate(${g.gx.toFixed(1)}px,${g.gy.toFixed(1)}px) translate(-50%,-60%)`;
    let a;
    if (how === "commit") {
      const to = g.snap ? `translate(${g.snap.cx.toFixed(1)}px,${g.snap.cy.toFixed(1)}px) translate(-50%,-60%)` : base;
      a = g.ghost.animate([{ transform: base, opacity: 1 }, { transform: to, opacity: 1, offset: 0.45 }, { transform: to, opacity: 0 }], { duration: 200, easing: "ease-in" });
      g.card.animate([{ scale: "1.08" }, { scale: "1.3 0.62", offset: 0.55 }, { scale: "0.6 0.2" }], { duration: 200, easing: "ease-in" });
    } else if (how === "bad") {
      a = g.card.animate([0, -10, 9, -7, 5, -2, 0].map(x => ({ translate: `${x}px 0` })), { duration: 320, easing: "ease-out" });
      g.ghost.animate([{ opacity: 1 }, { opacity: 1, offset: 0.7 }, { opacity: 0 }], { duration: 320 });
    } else {
      const r = src && src.isConnected ? src.getBoundingClientRect() : null;
      const to = r ? `translate(${(r.left + r.width / 2).toFixed(1)}px,${(r.top + r.height / 2).toFixed(1)}px) translate(-50%,-60%)` : base;
      a = g.ghost.animate([{ transform: base, opacity: 1 }, { transform: to, opacity: 0.2 }], { duration: 240, easing: "cubic-bezier(.2,.8,.3,1)" });
    }
    a.onfinish = () => g.ghost.remove();
    setTimeout(() => g.ghost.isConnected && g.ghost.remove(), 600);   // safety
  }
  function endDrag(commitIt) {
    V.down = false;
    if (!drag) return;
    if (drag.started) {
      const g = drag;
      document.body.classList.remove("dragging"); clearMarks();
      g.src.classList.remove("lifting");
      suppressClick = true; setTimeout(() => suppressClick = false, 0);
      const op = g.op; drag = null;
      if (g.line) g.line.remove();
      document.querySelectorAll(".elev.reordering").forEach(e => e.classList.remove("reordering"));
      dlog("drag end", op, g.snap ? "(magnet)" : "", g.fill ? `fill ×${g.fill.n}` : "");
      const ok = commitIt && op;
      ghostExit(g, g.src, ok ? "commit" : commitIt && g.bad ? "bad" : "home");
      if (!ok && commitIt && g.bad) nope(g.badMsg, g.src, g.raw);
      if (ok && g.fill && g.fill.n > 1) {         // shift+drag fill: one ordinary buy per card, each logged
        V.armed = null;
        let n = 0;
        const grp = newGroup();
        for (const a of g.fill.actions) { if (!act(a, { quiet: true, group: grp })) break; n++; }
        renderAll(); fxAct(op);
        if (FXON()) fxAtRack(op.rack, c => FX.floatText(c.x, c.top, `×${n} −${money(n * (item(op.item).price || 0))}`, "#FF8466", 16));
        TELE.event(S.day, "fill", { rack: op.rack, item: op.item, n });
      } else if (ok) { V.armed = null; act(op, { src: g.src }); } else renderAll();
      return;
    }
    drag = null;
  }
  /* a card or menu opened mid-drag: drop nothing, say so (the veteran lost two orders silently) */
  function cancelDrag(why) {
    if (!drag) return;
    const g = drag;
    drag = null; V.down = false;
    document.body.classList.remove("dragging"); clearMarks();
    if (g.src) g.src.classList.remove("lifting");
    if (g.ghost) ghostExit(g, g.src, "home");
    if (g.line) g.line.remove();
    sr(`Drag cancelled: ${why}. Nothing was ordered.`);
    SND("nope");
    dlog("drag cancelled", why, g.p);
    renderAll();
  }
  // right-click cancels a drag (the card flies home; nothing happens)
  document.addEventListener("contextmenu", e => { if (drag && drag.started) { e.preventDefault(); cancelDrag("right-click"); } });
  document.addEventListener("pointerup", e => { V.rackPress = null; if (V.box) boxEnd(); if (e.button === 2) return; endDrag(true); });
  document.addEventListener("pointercancel", () => endDrag(false));

  /* ================= v0.4 QOL: cancel, jump, multi-select, blueprints, repeat, undo ================= */
  /* ✕ on a queued job: sim cancelJob; the outcome floats from the ✕ (refund in green, "→ shelf", "→ A3", …) */
  function cancelJobAt(id, el) {
    const j = S.jobs.find(x => x.id === id), r = el.getBoundingClientRect(), cash0 = S.cash;
    const res = Sim.check(S, { type: "cancelJob", id });
    if (!act({ type: "cancelJob", id }, { src: el })) return;
    const d = S.cash - cash0;
    let txt = L("fb.cancelled"), col = "#E8ECF0";
    if (d > 0.5) { txt = `+${money(d)}`; col = "#7FE0A8"; SND("chaching", d); }
    else if (/shelf/.test(res.msg)) txt = L("fb.toShelf");
    else if (/Keep it/.test(res.msg)) txt = L("fb.kept");
    else { const m = /Back to ([A-Z]\d)/.exec(res.msg); if (m) txt = L("fb.back", { rack: m[1] }); }
    if (FXON() && r.width) FX.floatText(r.left + r.width / 2, r.top, txt, col, 15);
    dlog("[cancel]", id, j && j.kind, res.msg);
  }
  /* jump: show the hall, select the rack, bring the Rack tab forward and ping the tile */
  function jumpTo(rid, cid) {
    let r = rid && rack(rid);
    if (!r && cid) { const l = Sim.stats(S).alloc.find(x => x.id === cid); r = l && rack(l.rack); }
    if (!r) { pulse($("offerstrip"), "fx-attn", 1200); return; }
    V.hall = r.hall; V.selected = r.id; V.selDev = null;
    if (V.tab !== "rack") setTab("rack");
    renderAll();
    if (FXON()) FX.rackAnim(r.id, "fx-ping", 900);
    TELE.event(S.day, "jump", { rack: r.id });
  }
  function jumpToRacks(racks, col, src) {
    const ids = Object.keys(racks || {});
    if (!ids.length) { wobble(src); pulse($("tray"), "fx-hint", 1200); return; }
    const r = rack(ids.sort((a, b) => racks[b] - racks[a])[0]);
    if (r.hall !== V.hall) { V.hall = r.hall; }
    V.selected = r.id; V.selDev = null;
    if (V.tab !== "rack") setTab("rack");
    renderAll();
    highlightRacks(racks, col, "click");
    clearTimeout(V.hlT); V.hlT = setTimeout(() => { if (V.hl && V.hl.key === "click") highlightRacks(null); }, 1600);
  }
  /* multi-select (shift+click or a box drawn on the floor) → one bar sets mode / workload for all of them */
  function toggleMulti(id) {
    if (!V.multi.size && V.selected && V.selected !== id && rack(V.selected) && rack(V.selected).hall === V.hall) V.multi.add(V.selected);
    if (V.multi.has(id)) V.multi.delete(id); else V.multi.add(id);
    renderAll(); renderBulk();
  }
  function clearMulti() { V.multi.clear(); renderBulk(); renderAll(); }
  function renderBulk() {
    const el = $("bulkbar");
    const ids = [...V.multi].filter(id => rack(id) && rack(id).hall === V.hall);
    if (ids.length < 2) { el.hidden = true; el.innerHTML = ""; return; }
    const modes = Object.keys(Sim.MODES).filter(k => on("power") || k === "std" || k === "off");
    const b = (a, ic, lbl, title) => `<button class="btn" data-bulk='${esc(JSON.stringify(a))}' title="${esc(title || lbl)}">${icon(ic)}${esc(lbl)}</button>`;
    el.innerHTML = `<b>${esc(L("multi.count", { n: ids.length }))}</b>` + modes.map(k => b({ type: "mode", mode: k }, MODE_ICON[k], Sim.MODES[k].label)).join("") +
      (on("gpu") ? `<span class="sep"></span>` + Sim.WORKLOADS.filter(w => w !== "web").map(w => b({ type: "workload", workload: w }, R[w].icon, R[w].name)).join("") : "") +
      `<button class="iconbtn" data-bulk='{"type":"clear"}' title="${esc(L("multi.clear"))}">${icon("cross")}</button>`;
    el.hidden = false;
  }
  const newGroup = () => (V.grp = "g" + (++V.grpN || (V.grpN = 1)));
  function bulk(a, src) {
    if (a.type === "clear") { clearMulti(); return; }
    newGroup();
    let ok = 0, bad = 0;
    for (const id of V.multi) {
      const r = rack(id);
      if (!r || r.hall !== V.hall || (!r.devices.length && !r.pending.length)) continue;
      if (a.type === "workload" && !r.devices.concat(r.pending).some(d => item(d.type).role === "gpu")) continue;
      const op = Object.assign({ rack: id }, a);
      if (op.type === "mode" && r.mode === op.mode || op.type === "workload" && r.workload === op.workload) continue;
      if (act(op, { quiet: true, src, group: V.grp })) ok++; else bad++;
    }
    dlog("[bulk]", a, "ok", ok, "refused", bad);
    renderAll(); renderBulk();
    if (ok) SND("tick", 4, 40);
  }
  /* box select on empty floor */
  function boxStart(e) { V.box = { x: e.clientX, y: e.clientY, on: false }; }
  function boxMove(e) {
    const b = V.box; if (!b) return;
    if (!b.on && Math.hypot(e.clientX - b.x, e.clientY - b.y) < 8) return;
    b.on = true;
    const host = $("floor").parentElement.getBoundingClientRect(), z = STZ(), el = $("boxsel");
    const x0 = Math.min(b.x, e.clientX), y0 = Math.min(b.y, e.clientY), x1 = Math.max(b.x, e.clientX), y1 = Math.max(b.y, e.clientY);
    Object.assign(el.style, { left: (x0 - host.left) / z + "px", top: (y0 - host.top) / z + "px", width: (x1 - x0) / z + "px", height: (y1 - y0) / z + "px" });
    el.hidden = false;
    b.rect = { x0, y0, x1, y1 };
  }
  function boxEnd() {
    const b = V.box; V.box = null; $("boxsel").hidden = true;
    if (!b || !b.on || !b.rect) return false;
    const hit = [...document.querySelectorAll("#floor .rack[data-rack]")].filter(el => {
      const r = el.getBoundingClientRect();
      return r.right > b.rect.x0 && r.left < b.rect.x1 && r.bottom > b.rect.y0 && r.top < b.rect.y1;
    }).map(el => el.dataset.rack);
    V.multi = new Set(hit);
    dlog("[box] selected", hit.join(","));
    suppressClick = true; setTimeout(() => suppressClick = false, 0);
    renderAll(); renderBulk();
    return true;
  }
  /* blueprints: Ctrl/Cmd+C copies the selected rack (parts, mode, workload); Ctrl/Cmd+V orders what the target lacks */
  function copyRack() {
    const bp = V.selected && QOL.blueprint(S, V.selected);
    if (!bp) { nope("Nothing to copy", $("detail")); return; }
    V.clip = bp;
    TELE.event(S.day, "copy", { rack: bp.from, n: bp.devices.length });
    if (FXON()) FX.rackAnim(bp.from, "fx-ping", 700);
    SND("tick", 6, 40);
    sr(`Copied ${bp.from}`);
    dlog("[bp] copy", bp);
  }
  function pasteRack(targetId, src) {
    const bp = V.clip, rid = targetId || V.selected;
    if (!bp || !rid) { nope("Nothing to paste", src); return; }
    const d = QOL.blueprintDiff(S, bp, rid);
    if (d.blocked || !d.actions.length) { nope(d.blocked === "tank" ? "Tank racks only take exotic cards" : "Already the same", src, { rack: rid }); return; }
    TELE.event(S.day, "paste", { from: bp.from, to: rid, n: d.actions.length });
    let done = 0;
    const grp = newGroup();
    for (const a of d.actions) { if (!act(a, { quiet: true, src, group: grp })) break; done++; }
    dlog("[bp] paste", bp.from, "→", rid, done, "/", d.actions.length);
    V.selected = rid;
    renderAll();
    if (done) { SND("drop"); if (FXON()) { FX.rackAnim(rid, "fx-thunk", 360, 0, false, "cubic-bezier(.3,1.6,.5,1)"); fxAtRack(rid, c => FX.floatText(c.x, c.top, `×${d.actions.filter(a => a.type === "buy").length}`, "#FFD24A", 16)); } }
  }
  function duplicateRack(id, src) {
    const to = QOL.nextEmptyRack(S, id, rack(id) && rack(id).tank);
    if (!to) { nope("No empty rack", src); return; }
    V.clip = QOL.blueprint(S, id);
    pasteRack(to, src);
  }
  /* R: repeat the last order on the hovered (or selected) rack */
  function repeatOrder() {
    const rid = V.hoverRack || V.selected, o = V.lastOrder;
    if (!o || !rid) { nope("Nothing to repeat", $("tray")); return; }
    const leasing = o.type === "lease";
    act({ type: leasing ? "lease" : "buy", item: o.item, rack: rid }, { src: document.querySelector(`#floor [data-rack="${rid}"]`) });
  }
  /* Ctrl/Cmd+Z: undo the last reversible action (as a sim action through act(), so it is logged and replayable) */
  function undoLast() {
    const u = UNDO && UNDO.pop(Sim, S);
    if (!u) { nope(L("undo.none"), $("h-when")); return; }
    dlog("[undo]", u.e.kind, u.inv);
    TELE.event(S.day, "undo", { of: u.e.a.type });
    if (act(u.inv, { noUndo: true, quiet: !!u.e.group })) {
      // a batch (bulk mode, blueprint paste, shift-fill) undoes as one
      let n = 1;
      while (u.e.group) { const nx = UNDO.peek(Sim, S); if (!nx || nx.e.group !== u.e.group) break; UNDO.pop(Sim, S); if (act(nx.inv, { noUndo: true, quiet: true })) n++; }
      if (u.e.group) { renderAll(); dlog("[undo] group", u.e.group, n); }
      const rid = u.inv.rack || u.inv.to || (u.e.a && (u.e.a.rack || u.e.a.to));
      if (rid && FXON()) fxAtRack(rid, c => FX.floatText(c.x, c.top, "↶", "#FFD24A", 20));
      sr(L("undo.done"));
    }
  }

  /* clicking a news item jumps to where it matters: a rack it names, else the drawer / tab / element of its category */
  const NEWS_JUMP = { contracts: "board", market: "tab:markets", hardware: "tray", vendor: "tab:bench", memory: "tray", ops: "alerts",
    finance: "drawer:finance", investors: "drawer:finance", energy: "drawer:energy", facilities: "drawer:energy", environment: "drawer:energy",
    press: "drawer:affairs", policy: "drawer:affairs", reputation: "drawer:affairs" };
  function newsJump(el) {
    // "… failed in A3": a rack named after in/from/to (card names like "Kestrel C2" must not match)
    const txt = el.innerText + " " + (el.title || ""), m = /\b(?:in|from|to) ([A-HJ][1-6])\b/.exec(txt);
    const rid = m && rack(m[1]) ? m[1] : null;
    TELE.event(S.day, "newsJump", { cat: el.dataset.news, rack: rid });
    if (rid) { jumpTo(rid); return; }
    const to = NEWS_JUMP[el.dataset.news] || "";
    if (to === "board") pulse($("offerstrip"), "fx-attn", 1200);
    else if (to === "tray") pulse($("tray"), "fx-hint", 1200);
    else if (to === "alerts") openPop("alerts", $("alertbtn"));
    else if (to.startsWith("tab:")) setTab(to.slice(4));
    else if (to.startsWith("drawer:") && $("db-" + to.slice(7)) && !$("db-" + to.slice(7)).hidden) { if (V.drawer !== to.slice(7)) openDrawer(to.slice(7)); }
    else wobble(el);
  }

  /* ================= alerts tray (HUD bell) ================= */
  const ALERT_ICON = { nosw: "unplug", fail: "cross", hot: "flame", sla: "warn", idle: "power", runway: "coin" };
  function renderAlerts(st) {
    if (!S || !QOL) return;
    const rw = runwayDays(st);
    V.alerts = QOL.alerts(Sim, S, st, { runway: rw ? rw.days : null });
    const n = V.alerts.length, btn = $("alertbtn"), dot = btn.querySelector(".dot");
    dot.hidden = !n; dot.textContent = n > 9 ? "9+" : String(n);
    btn.classList.toggle("hot", V.alerts.some(a => a.sev >= 3));
    if (V.pop === "alerts") renderPop(st);
  }
  function alertsHTML() {
    const list = V.alerts;
    if (!list.length) return `<h3>${icon("bell")}${esc(L("alerts.title"))}</h3><div class="sub">${icon("check")} ${esc(L("alerts.none"))}</div>`;
    return `<h3>${icon("bell")}${esc(L("alerts.title"))} <small>${list.length}</small></h3><div class="alist">${list.slice(0, 12).map(a => {
      const lbl = a.kind === "runway" ? L("alert.runway", { d: a.n }) : L("alert." + a.kind) + (a.kind === "sla" ? ` · ${a.cust}` : a.kind === "hot" ? ` ${a.n} %` : a.kind === "idle" ? ` ${a.n}u` : "");
      return `<button class="arow sev${a.sev}" data-jump="${a.rack || ""}"${a.id ? ` data-contract="${a.id}"` : ""}>${icon(ALERT_ICON[a.kind] || "warn")}<span>${esc(lbl)}</span><b>${a.rack || ""}</b></button>`;
    }).join("")}</div>`;
  }

  /* ================= rich hover: rack card, catalog delta ================= */
  function hoverShow(kind, id, anchor) {
    V.hover = { kind, id, anchor, t: performance.now() };
    refreshHover();
  }
  function hoverHide() { if (!V.hover) return; V.hover = null; $("hovercard").hidden = true; }
  function refreshHover() {
    const h = V.hover, el = $("hovercard");
    if (h && !h.anchor.isConnected) h.anchor = document.querySelector(h.kind === "rack" ? `#floor [data-rack="${h.id}"]:not([data-drag])` : `#tray [data-item="${h.id}"]`) || h.anchor;   // the floor re-renders every second
    if (!h || !S || (drag && drag.started) || !h.anchor.isConnected) { hoverHide(); return; }
    h.t = performance.now();
    const html = h.kind === "rack" ? rackHoverHTML(h.id) : itemHoverHTML(h.id);
    if (!html) { el.hidden = true; return; }
    el.innerHTML = html; el.hidden = false;
    // place beside the anchor inside the stage (stage px = viewport px ÷ zoom)
    const a = h.anchor.getBoundingClientRect(), stg = $("stage").getBoundingClientRect(), z = STZ();
    const w = el.offsetWidth, hh = el.offsetHeight;
    let x = (a.right - stg.left) / z + 8, y = (a.top - stg.top) / z;
    if (h.kind === "item") { x = (a.left - stg.left) / z; y = (a.top - stg.top) / z - hh - 8; }
    if (x + w > Stage.STAGE_W - 6) x = (a.left - stg.left) / z - w - 8;
    x = Math.max(6, Math.min(Stage.STAGE_W - w - 6, x)); y = Math.max(6, Math.min(Stage.STAGE_H - hh - 6, y));
    el.style.left = x + "px"; el.style.top = y + "px";
  }
  function rackHoverHTML(id) {
    const r = rack(id); if (!r) return "";
    const st = Sim.stats(S), pr = st.perRack[id]; if (!pr) return "";
    if (!r.devices.length && !r.pending.length) return `<b>${id}</b> <small>${K.RACK_U - Sim.usedU(S, r)}U · ${K.RACK_KW} kW</small>`;
    const to = {};
    for (const x of pr.to || []) to[x.id] = (to[x.id] || 0) + x.u;
    const serves = Object.keys(to).map(cid => { const c = S.contracts.find(x => x.id === cid); return `<span class="servetag" style="--lc:${QOL.linkColor(cid)}">${esc(c ? c.cust : cid)} ${to[cid].toFixed(1)}u</span>`; }).join(" ") || `<span class="idletag">${esc(L("hover.none"))}</span>`;
    // bottleneck: what limits this rack now (switch, heat, network, roofline side, contract)
    const gpus = r.devices.filter(d => item(d.type).role === "gpu");
    let bn = "";
    if (noSwitch(r, pr)) bn = L("hover.switch");
    else if (pr.throttle < 1) bn = `${L("hover.heat")} ${Math.round(pr.throttle * 100)} %`;
    else if (pr.netF < 1 && pr.netNeed > 0) bn = L("hover.network");
    else if (gpus.length) { const it = item(gpus[0].type), I = Sim.INTENSITY[r.workload]; bn = it.B * I < it.F ? L("hover.memory") : L("hover.compute"); }
    else bn = K.RACK_U - Sim.usedU(S, r) <= 0 ? L("hover.space") : "—";
    if (!Object.keys(to).length && pr.out && pr.out.web + pr.out.train + pr.out.infer > 0.05) bn = L("hover.idle");
    let risk = "";
    if (on("ops")) { const hz = rackHazard(r, pr); risk = hz > 1e-6 ? L("hover.riskDays", { d: Math.round(1 / hz) }) : "—"; }
    const row = (k, v) => `<div class="kv"><span>${esc(k)}</span><b>${v}</b></div>`;
    return `<div class="hc-h"><b>${id}</b><small>${esc(R[rackRole(r)].name)} · ${esc(Sim.MODES[r.mode] ? Sim.MODES[r.mode].label : r.mode)}</small></div>
      ${row(L("hover.income"), perDay(pr.rev))}<div class="kv"><span>${esc(L("hover.serves"))}</span><span>${serves}</span></div>
      ${row(L("hover.inlet"), `${pr.inlet.toFixed(1)} °C`)}${row(L("hover.bottleneck"), esc(bn))}${risk ? row(L("hover.risk"), esc(risk)) : ""}`;
  }
  /* a catalog card hovered with a rack selected: what buying it there changes (output, kW, inlet °C, payback) */
  function itemHoverHTML(key) {
    const it = item(key), rid = V.selected, r = rid && rack(rid); if (!it) return "";
    const head = `<div class="hc-h"><b>${esc(it.name)}</b><small>${it.u}U · ${it.kw} kW · ${money(it.price)}</small></div>`;
    if (!r) return head;
    const op = { type: V.lease && on("finance") && it.role === "gpu" ? "lease" : "buy", item: key, rack: rid };
    const res = Sim.check(S, op);
    if (!res.ok) return `${head}<div class="kv bad"><span>${rid}</span><b>${icon(QOL.reason(res.msg) === "cash" ? "coin" : "warn")} ${esc(res.msg)}</b></div>`;
    const wl = wlDefault(op), base = Sim.stats(S, { eq: true }), p = Sim.stats(Sim.project(wl ? Sim.project(S, wl) : S, op), { eq: true });
    const b0 = base.perRack[rid], p0 = p.perRack[rid];
    const out = w => (p0.out ? p0.out[w] : 0) - (b0.out ? b0.out[w] : 0);
    const dOut = out("web") + out("train") + out("infer"), dKw = p0.kw - b0.kw, dT = p0.inlet - b0.inlet;
    const dEarn = (p.earn != null ? p.earn : p.net) - (base.earn != null ? base.earn : base.net);
    const pay = op.type === "buy" && dEarn > 0.01 ? L("delta.days", { d: Math.round(it.price / dEarn) }) : op.type === "buy" ? L("delta.never") : "—";
    const sg = v => (v >= 0 ? "+" : "−") + Math.abs(v).toFixed(1);
    return `${head}<div class="deltas"><span><small>${esc(L("delta.out"))}</small><b>${sg(dOut)}</b></span><span><small>${esc(L("delta.kw"))}</small><b>${sg(dKw)}</b></span><span><small>${esc(L("delta.temp"))}</small><b class="${dT > 0.5 ? "warmc" : ""}">${sg(dT)}</b></span><span><small>${esc(L("delta.payback"))}</small><b>${esc(pay)}</b></span></div><div class="sub">→ ${rid}</div>`;
  }

  /* ================= clicks and keys ================= */
  function setSpeed(v) { if (S && v !== V.speed) TELE.event(S.day, "speed", { v }); V.speed = v; if (v) V.lastSpeed = v; renderHUD(Sim.stats(S)); if (V.drawer) $("drawer-sub").textContent = v ? "game running" : "paused"; }
  function tapTarget(target) {   // tap-to-place: armed payload + tapped target
    const ev = evaluate(V.armed, target);
    if (!ev.res) return false;
    if (!ev.res.ok) { nope(ev.res.msg, target, ev.raw || opFor(V.armed, target)); return true; }
    if (act(ev.op, { src: target })) { V.armed = null; renderAll(); }
    return true;
  }
  document.addEventListener("click", e => {
    if (suppressClick || !S) return;
    const t = e.target;
    // popover / drawer close on outside click
    if (V.pop && !t.closest("#pop") && !t.closest("#h-techs, #h-transit, #h-power, #alertbtn")) closePop();
    const sp = t.closest("[data-speed]");
    if (sp) { if (V.skip) stopSkip("speed"); setSpeed(+sp.dataset.speed); return; }
    if (t.closest("#skipbtn")) { toggleSkip(); return; }
    if (t.closest("#alertbtn")) { openPop("alerts", $("alertbtn")); return; }
    if (t.closest("#setbtn")) { openSettings(); return; }
    const cj = t.closest("[data-canceljob]");
    if (cj) { cancelJobAt(+cj.dataset.canceljob, cj); return; }
    const jm = t.closest("[data-jump]");
    if (jm) { jumpTo(jm.dataset.jump, jm.dataset.contract); closePop(); return; }
    const bk = t.closest("[data-bulk]");
    if (bk) { bulk(JSON.parse(bk.dataset.bulk), bk); return; }
    const du = t.closest("[data-dup]");
    if (du) { duplicateRack(du.dataset.dup, du); return; }
    const ab = t.closest("[data-act]");
    if (ab) {
      const a = JSON.parse(ab.dataset.act), key = JSON.stringify(a);
      if (ab.hasAttribute("data-confirm")) {
        const res = Sim.check(S, a);
        if (!res.ok) { act(a, { src: ab }); return; }    // refused: show-not-tell feedback (and the rejection is logged)
        if (!(V.confirm === key && performance.now() - V.confirmT < CONFIRM_MS)) { V.confirm = key; V.confirmT = performance.now(); sr(`${res.msg} · tap again to confirm`); renderAll(); return; }
      }
      const ok = act(a, { src: ab });
      if (ok && ab.closest("#card")) $("card").close();
      return;
    }
    const pl = t.closest("[data-contract]");
    if (pl) { const st = Sim.stats(S), racks = {}; for (const l of st.alloc) if (l.id === pl.dataset.contract) racks[l.rack] = (racks[l.rack] || 0) + l.u; jumpToRacks(racks, QOL.linkColor(pl.dataset.contract), pl); return; }
    const oc = t.closest(".ocard[data-offer]");
    if (oc) { jumpToRacks(offerPreview(oc.dataset.offer) || {}, "#FFFFFF", oc); return; }
    if (t.closest("dialog [data-close]")) { const d = t.closest("dialog"); if (d.open) d.close(); return; }
    const dr = t.closest("[data-drawer]");
    if (dr) { if (dr.closest("#h-debt, #h-rep, #h-carbon, #h-equity, #offerstrip") || dr.classList.contains("iconbtn")) { if (!(dr.classList.contains("oshead") && V.drawer === "contracts")) openDrawer(dr.dataset.drawer); else closeDrawer(); } return; }
    if (t.closest("#drawer-close")) { closeDrawer(); return; }
    if (t.closest("#h-techs")) { if (on("ops")) openPop("techs", $("h-techs")); return; }
    if (t.closest("#h-transit")) { openPop("transit", $("h-transit")); return; }
    if (t.closest("#h-power")) { if (on("power")) openPop("grid", $("h-power")); return; }
    const hl = t.closest("[data-hall]");
    if (hl) { V.hall = +hl.dataset.hall; V.selDev = null; const hr = hallRacks(V.hall); V.selected = hr.length ? hr[0].id : null; renderAll(); return; }
    const ls = t.closest("[data-lease]");
    if (ls && ls.closest(".buylease")) { V.lease = ls.dataset.lease === "1"; renderAll(); return; }
    const wf = t.closest("[data-wf]");
    if (wf) { V.wfLast = wf.dataset.wf === "1"; renderAll(); return; }
    const pp = t.closest("[data-ppa]");
    if (pp) { V.ppaKw = Math.max(K.PPA_STEP, Math.min(K.PPA_MAX, V.ppaKw + (+pp.dataset.ppa) * K.PPA_STEP)); renderAll(); return; }
    const tb = t.closest("[data-tab]");
    if (tb) { setTab(tb.dataset.tab); return; }
    const nw = t.closest("#newsfeed [data-news]");
    if (nw) { newsJump(nw); return; }
    const nc = t.closest("[data-newscat]");
    if (nc) { V.newsCat = nc.dataset.newscat; renderNews(); return; }
    // tap-to-place targets
    if (V.armed) {
      const target = t.closest(TARGETS);
      if (target && !target.closest("[data-drag]") && tapTarget(target)) return;
      if (target && target.hasAttribute("data-drop-fail") && tapTarget(target)) return;
    }
    const src = t.closest("[data-drag]");
    if (src) {
      const p = payload(src);
      if (p.kind === "dev") { V.selDev = V.selDev === p.uid ? null : p.uid; renderAll(); return; }
      if (p.kind === "offer") return;
      if (p.kind === "shelf") {
        const d = S.shelf.find(x => x.uid === p.uid);
        if (d && d.failed) { act({ type: "repair", uid: d.uid }); return; }
      }
      const same = V.armed && JSON.stringify(V.armed) === JSON.stringify(p);
      V.armed = same ? null : p;
      renderAll();
      if (V.armed) sr(p.kind === "spine" ? "Tap a spine slot (or a rack in the row)" : p.kind === "shelf" ? "Tap a rack to install, or a failed part to swap" : `Tap a rack to ${V.lease && on("finance") && item(p.item).role === "gpu" ? "lease" : "order"} ${item(p.item).name}`);
      if (V.armed && p.kind === "new" && S.cash < item(p.item).price && !(V.lease && on("finance") && item(p.item).role === "gpu")) nope(`Needs $${item(p.item).price}k`, src);
      return;
    }
    const rk = t.closest("#floor [data-rack]");
    if (rk && e.shiftKey) { toggleMulti(rk.dataset.rack); return; }
    if (rk) { if (V.multi.size) clearMulti(); V.selected = rk.dataset.rack; V.selDev = null; if (V.tab !== "rack") setTab("rack"); renderAll(); return; }
    const pm = t.closest("[data-pmode]");
    if (pm) { act({ type: "mode", rack: V.selected, mode: pm.dataset.pmode }); return; }
    const wl = t.closest("[data-wl]");
    if (wl) { act({ type: "workload", rack: V.selected, workload: wl.dataset.wl }); return; }
    const mb = t.closest("#modes button");
    if (mb) { V.mode = mb.dataset.mode; renderAll(); }
  });
  document.addEventListener("keydown", e => {
    if (e.target.closest && e.target.closest("input, textarea, select")) return;
    // the ✕ on a job is a span (it sits inside the rack tile's button): Enter / Space activate it like a button
    const cjk = e.target.closest && e.target.closest("[data-canceljob]");
    if (cjk && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); e.stopPropagation(); if (S && !anyDialogOpen()) cancelJobAt(+cjk.dataset.canceljob, cjk); return; }
    const mod = e.metaKey || e.ctrlKey, k = e.key;
    if ((k === "f" || k === "F") && !mod && !e.altKey) { toggleFullscreen(); return; }   // also on the menu and over cards
    if (k === "?" || (k === "/" && e.shiftKey)) { e.preventDefault(); if ($("keys").open) $("keys").close(); else if (!anyDialogOpen()) openKeys(); return; }
    if (V.menu || anyDialogOpen() || !S) return;
    const SPEEDS = { "1": 1, "2": 2, "3": 4, "4": 8 };
    if (e.code === "Space") { e.preventDefault(); if (V.skip) stopSkip("key"); setSpeed(V.speed ? 0 : V.lastSpeed); }
    else if (SPEEDS[k] && !mod) { if (V.skip) stopSkip("key"); setSpeed(SPEEDS[k]); }
    else if (k === "Escape") {
      if (drag && drag.started) cancelDrag("Esc");
      else if (V.hover) hoverHide();
      else if (V.armed) { V.armed = null; renderAll(); }
      else if (V.pop) closePop();
      else if (V.multi.size) clearMulti();
      else if (V.skip) stopSkip("Esc");
      else if (V.drawer) closeDrawer();
    }
    else if (mod && (k === "z" || k === "Z") && !e.shiftKey) { e.preventDefault(); undoLast(); }
    else if (mod && (k === "c" || k === "C")) { if (window.getSelection && String(window.getSelection())) return; e.preventDefault(); copyRack(); }
    else if (mod && (k === "v" || k === "V")) { e.preventDefault(); pasteRack(V.hoverRack || V.selected, document.querySelector(`#floor [data-rack="${V.hoverRack || V.selected}"]`)); }
    else if (mod && (k === "d" || k === "D")) { e.preventDefault(); if (V.selected) duplicateRack(V.selected, $("detail")); }
    else if (mod) return;
    else if (k === "m" || k === "M") toggleMute();
    else if (k === "v" || k === "V") { const ms = MAP_MODES.filter(m => on(m.ch)); V.mode = ms[(ms.findIndex(m => m.key === V.mode) + 1) % ms.length].key; renderAll(); }
    else if (k === "r" || k === "R") repeatOrder();
    else if (k === "n" || k === "N") toggleSkip();
    else if (k === "a" || k === "A") openPop("alerts", $("alertbtn"));
    else if (k === "o" || k === "O") openSettings();
  });
  /* rich hover: racks on the floor, catalog cards (delta vs the selected rack) */
  document.addEventListener("pointerover", e => {
    if (!S || V.menu || (drag && drag.started) || V.down) return;
    const rk = e.target.closest("#floor [data-rack]");
    if (rk) { V.hoverRack = rk.dataset.rack; if (!V.hover || V.hover.id !== rk.dataset.rack) hoverShow("rack", rk.dataset.rack, rk); return; }
    const it = e.target.closest("#tray .item[data-item]");
    if (it) { if (!V.hover || V.hover.id !== it.dataset.item) hoverShow("item", it.dataset.item, it); return; }
    const oc = e.target.closest(".ocard[data-offer]");
    if (oc && (!V.hl || V.hl.key !== oc.dataset.offer)) highlightRacks(offerPreview(oc.dataset.offer), "#FFFFFF", oc.dataset.offer);
    const pl = e.target.closest("[data-contract]");
    if (pl && (!V.hl || V.hl.key !== pl.dataset.contract)) { const racks = {}; for (const l of Sim.stats(S).alloc) if (l.id === pl.dataset.contract) racks[l.rack] = (racks[l.rack] || 0) + l.u; highlightRacks(racks, QOL.linkColor(pl.dataset.contract), pl.dataset.contract); }
  });
  document.addEventListener("pointerout", e => {
    const from = e.target.closest && e.target.closest("#floor [data-rack], #tray .item[data-item], .ocard[data-offer], [data-contract]");
    if (!from || (e.relatedTarget && from.contains(e.relatedTarget))) return;
    if (from.matches("#floor [data-rack]")) V.hoverRack = null;
    // by id, not by element: the floor re-renders every second, so the hovered tile may be a newer copy of the anchor
    if (V.hover && (V.hover.anchor === from || (V.hover.kind === "rack" ? from.dataset.rack : from.dataset.item) === V.hover.id)) hoverHide();
    if (V.hl && V.hl.key !== "click" && from.matches(".ocard[data-offer], [data-contract]")) highlightRacks(null);
  });
  document.addEventListener("pointerup", () => { V.down = false; }, true);

  /* ================= feedback ================= */
  /* toasts: the player's own feedback shows at once; system messages (offers, cash events, news) queue for at least
     1.4 s each so one never wipes out the other (max 3 waiting, oldest dropped) */
  let toastT, toastQT = null, sysAt = 0;
  const toastQ = [], SYS_MIN_MS = 1200;
  function showToast(t) { const el = $("toast"); el.textContent = t; el.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove("show"), 2600); }
  function nextToast() {
    toastQT = null;
    if (!toastQ.length) return;
    // at 8x events outpace one toast per 1.4 s: show up to three waiting messages at once
    let t = toastQ.shift().t;
    while (toastQ.length && t.length + toastQ[0].t.length < 190) t += "  ·  " + toastQ.shift().t;
    sysAt = performance.now(); showToast(t);
    if (toastQ.length) toastQT = setTimeout(nextToast, SYS_MIN_MS);
  }
  /* sys: true = news (may be dropped when 3+ wait), "keep" = money or an offer (never dropped) */
  function toast(t, sys) {
    if (S) TELE.event(S.day, "toast", { t: String(t).replace(/<[^>]+>/g, "").slice(0, 200), sys: sys || undefined });
    if (!sys) { showToast(t); return; }
    const keep = sys === "keep", at = keep ? toastQ.findIndex(x => !x.keep) : -1;   // money and offers go before any news
    if (at >= 0) toastQ.splice(at, 0, { t, keep }); else toastQ.push({ t, keep });
    if (toastQ.length > 3) { const i = toastQ.findIndex(x => !x.keep); if (i >= 0) toastQ.splice(i, 1); }
    if (!toastQT) { const wait = Math.max(0, SYS_MIN_MS - (performance.now() - sysAt)); if (wait) toastQT = setTimeout(nextToast, wait); else nextToast(); }
  }
  function renderMute() {
    const b = $("mutebtn"); if (!b || !window.SFX) return;
    b.innerHTML = icon(SFX.muted ? "mute" : "sound");
    b.setAttribute("aria-pressed", String(!SFX.muted));
    b.title = SFX.muted ? "Sound off (M)" : "Sound on (M)";
  }
  function toggleMute() { if (!window.SFX) return; SFX.toggle(); renderMute(); pulse($("mutebtn"), "fx-attn", 500); sr(SFX.muted ? "Sound off" : "Sound on"); }
  if ($("mutebtn")) $("mutebtn").addEventListener("click", toggleMute);

  /* ================= stage: tabs in the right column, fullscreen ================= */
  /* right-column card: News / Markets / Benchmarks. All three panes stay rendered (cheap, once a second); only one shows. */
  const TABS = ["rack", "news", "markets", "bench"];
  function setTab(k) {
    if (!TABS.includes(k)) k = "rack";
    V.tab = k;
    for (const t of TABS) {
      const b = $("tab-" + t), pane = $("pane-" + t);
      b.setAttribute("aria-selected", String(t === k)); b.tabIndex = t === k ? 0 : -1; pane.hidden = t !== k;
    }
    try { localStorage.setItem("halcyon.tab", k); } catch (e) { /* storage blocked */ }
    if (S && k === "news") renderNews();
    dlog("tab", k);
  }
  let tab0 = "rack";
  try { tab0 = localStorage.getItem("halcyon.tab") || "rack"; } catch (e) { /* storage blocked */ }
  setTab(tab0);
  // arrow keys move between tabs (WAI-ARIA tabs pattern)
  $("infotabs").querySelector(".tabs").addEventListener("keydown", e => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const i = (TABS.indexOf(V.tab) + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length;
    setTab(TABS[i]); $("tab-" + TABS[i]).focus(); e.preventDefault();
  });
  function renderFs() {
    const b = $("fsbtn"); if (!b) return;
    const fs = Stage.isFullscreen();
    b.innerHTML = icon(fs ? "shrink" : "expand");
    b.setAttribute("aria-pressed", String(fs));
    b.title = !Stage.canFullscreen() ? "Fullscreen is not available here (use the page's own fullscreen button)" : fs ? "Exit fullscreen (F)" : "Fullscreen (F)";
    b.classList.toggle("off", !Stage.canFullscreen());
  }
  function toggleFullscreen() {
    if (!Stage.canFullscreen()) { nope("Fullscreen is not available in this frame: use the page's fullscreen button", $("fsbtn")); dlog("fullscreen unavailable"); return; }
    Stage.toggleFullscreen().then(ok => { if (!ok) nope("Fullscreen was blocked by the browser", $("fsbtn")); dlog("fullscreen", ok, Stage.isFullscreen()); renderFs(); });
  }
  if ($("fsbtn")) $("fsbtn").addEventListener("click", toggleFullscreen);
  document.addEventListener("fullscreenchange", renderFs);
  document.addEventListener("webkitfullscreenchange", renderFs);
  renderFs();
  // a new zoom moves every rect: drop the drag's cached drop-target rects and re-measure the HUD
  Stage.onChange(f => { if (drag) drag.cands = null; dlog("stage zoom", f.z); });
  renderMute();
  let cashT;
  function flashCash(d) {
    const el = $("h-cash-d");
    el.textContent = (d > 0 ? "+" : "−") + money(Math.abs(d));
    el.style.color = d > 0 ? COL.hudGood : COL.hudBad;
    clearTimeout(cashT); cashT = setTimeout(() => el.textContent = "", 1400);
  }

  /* ================= boot ================= */
  applySettings("boot");
  if (params.has("speed")) V.speed = V.lastSpeed = +params.get("speed") || 1;
  const play = params.get("play");
  if (play === "campaign" || play === "sandbox") start(seed, { sandbox: play === "sandbox" });
  else showMenu(false);
  /* console / test hook. ff(days) fast-forwards and stops at the next chapter unlock or game end. */
  window.__game = {
    get S() { return S; }, V, act, start, showMenu, openDrawer, closeDrawer, renderAll, get SET() { return SET; },
    ff(days) {
      const target = S.day + days, ch0 = S.chapter;
      while (!S.over && S.day < target - 1e-9) { Sim.advance(S, Math.min(1, target - S.day)); if (S.chapter !== ch0) break; }
      renderAll(); afterTick();
      return { day: S.day, chapter: S.chapter, over: S.over };
    },
    perf: V.perf,
  };
  /* gameplay log export (telemetry.js). In an embed where downloads are blocked, fall back to the clipboard. */
  async function exportLog() {
    if (!TELE.log) { toast("Start a game first"); return; }
    if (S) TELE.snap(S, Sim.score(S));
    const name = TELE.exportFile();
    if (name) { toast(`Log saved: ${name}`); return; }
    toast(await TELE.copyToClipboard() ? "Download blocked here: log copied to the clipboard" : "Export failed: try fullscreen or the downloaded build");
  }
  $("m-export").addEventListener("click", exportLog);
  $("o-export").addEventListener("click", exportLog);
  $("m-tele").addEventListener("click", () => { TELE.setEnabled(!TELE.enabled()); showMenu(!!S && !S.over); });

  requestAnimationFrame(frame);
})();
