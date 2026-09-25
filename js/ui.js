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
  const SAVE_KEY = "halcyon.save.v2", META_KEY = "halcyon.meta.v2";

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
  };
  const PACE_ON = params.get("pace") !== "0";      // ?pace=0 turns the ghost off (A/B frame-time measurement)
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
  const MODE_ICON = { eco: "leaf", std: "gauge", boost: "rocket" };
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
    return `<button class="${cls}" data-act='${esc(key)}'${opts.confirm ? " data-confirm" : ""} title="${esc(res.msg)}"${res.ok ? "" : ' aria-disabled="true"'}>${opts.icon ? icon(opts.icon) : ""}${armed ? `Tap again: ${label}` : label}</button>`;
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
  function readMeta() { try { const m = JSON.parse(store.get(META_KEY) || "null"); return m && store.get(SAVE_KEY) ? m : null; } catch (e) { return null; } }
  function loadGame() {
    try {
      const st = JSON.parse(store.get(SAVE_KEY) || "null");
      if (!st || st.v !== 2 || st.over) return null;
      return st;
    } catch (e) { dlog("load failed", e && e.message); return null; }
  }

  /* ================= game lifecycle ================= */
  function resetView() {
    Object.assign(V, { hall: 1, selected: "A1", selDev: null, armed: null, lease: false, chapQueue: [], overShown: false, acc: 0,
      drawer: null, pop: null, newsCat: "all", confirm: null, wfLast: false,
      fxPrev: null, cashOff: 0, scoreOff: 0, cashT: null, scoreT: null, cashPeak: S.cash, ghostFrac: 1, ghostHold: 0,
      fillPrev: {}, earnAcc: {}, earnLast: {}, finalQ: false, lastCount: -1 });
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
    V.ghost = Pace.start({ seed: S.seed, sandbox: !!S.sandbox, day: S.day,
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
    if (!st) { toast("No saved game"); return; }
    S = st; seed = S.seed; V.sandbox = !!S.sandbox;
    resetView();
    V.seenChapter = S.chapter;
    setUrl();
    dlog("continue day", S.day);
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
  function act(a) {
    const res = Sim.check(S, a);
    if (!res.ok) { toast(res.msg); dlog("rejected", a, res.msg); SND("nope", null, 150); return false; }
    const cash0 = S.cash;
    const wl = wlDefault(a);
    if (wl) { Sim.apply(S, wl); dlog("workload default", wl); }
    Sim.apply(S, a);
    V.cashSeen = S.cashSeq || 0;      // the player's own action explains its cash change and any event it caused (its toast says so)
    V.flowPrev = { cash: S.cash, flow: S.totals.flow || 0 };
    const d = S.cash - cash0;
    if (Math.abs(d) > 0.5) flashCash(d);
    if (a.to) V.selected = a.to; else if (a.rack && !["sell", "store", "returnLease"].includes(a.type)) V.selected = a.rack;
    if (["sell", "store", "returnLease"].includes(a.type) || (a.type === "repair" && false)) V.selDev = null;
    V.confirm = null;
    dlog("action", a, res.msg);
    if ((a.type === "buy" || a.type === "lease") && a.item) {
      const it = item(a.item);
      toast(`${it.name} ${a.type === "lease" ? "leased" : "ordered"} for ${a.rack}: ${res.msg}${wl ? ` · rack set to ${R[wl.workload].name} (suits this card)` : ""}`);
      if (a.type === "buy" && FXON()) fxAtRack(a.rack, c => FX.floatText(c.x, c.top, `−${money(it.price)}`, "#FF8466", 15));
    } else if (!["transit", "hire", "fire", "borrow", "repay", "repairPolicy", "mode", "workload"].includes(a.type)) toast(res.msg + (wl ? ` · ${a.to || a.rack} set to ${R[wl.workload].name}` : ""));
    renderAll();
    fxAct(a);
    return true;
  }
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
  function fxAct(a) {
    if (a.type === "cancelOrder") { hideUndo("used"); SND("pickup"); return; }
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

  /* ================= loop ================= */
  let last = performance.now();
  function running() { return S && V.speed > 0 && !S.over && !anyModal(); }
  function frame(now) {
    const t0 = performance.now();
    const dtSec = Math.min(0.25, (now - last) / 1000); last = now;
    if (running()) {
      V.acc += dtSec * DAYS_PER_SEC * V.speed;
      const steps = Math.floor(V.acc / K.DT);
      if (steps > 0) { V.acc -= steps * K.DT; Sim.advance(S, steps * K.DT); }
    }
    if (S) {
      const dragging = drag && drag.started;
      let st = null;
      if (!dragging && !V.down) {
        const sig = signature();
        if ((sig !== V.sig && now - V.lastFull > 200) || now - V.lastFull > 1000) st = renderAll();
        else { st = Sim.stats(S); renderHUD(st); renderProgress(); }
        afterTick();
      }
      fxFrame(st || Sim.stats(S), dtSec, now);
      undoTick(now);
      if (V.ghost && !S.over) V.ghost.to(S.day);          // posts to the worker only when the day changes
      if (dragging && anyModal()) cancelDrag("a card opened");
      autosave();
    }
    if (FXON()) FX.tick(now);
    const ft = performance.now() - t0;
    V.perf.frames++; if (ft > V.perf.worst) V.perf.worst = ft;
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
    const inst = new Map(), pend = new Set(), failed = new Set(), thr = new Set();
    for (const r of S.racks) {
      for (const d of r.devices) { inst.set(d.uid, r.id); if (d.failed) failed.add(d.uid); }
      for (const d of r.pending) pend.add(d.uid);
      const pr = st.perRack[r.id];
      if (pr && pr.throttle < 1) thr.add(r.id);
    }
    const sells = new Map();
    for (const j of S.jobs) if (j.kind === "sell") sells.set(j.id, j);
    const dead = Object.keys(S.vendors).filter(v => S.vendors[v].dead);
    return { day: S.day, inst, pend, failed, thr, sells, dead, gen: Sim.currentGen(S), q: S.lastQuarter ? S.lastQuarter.q : null,
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
  function quarterCard(L) {
    const el = $("qcard"); if (!el || !L) return;
    const rev = L.web + L.train + L.infer + L.frontier + L.contracts;
    const cost = L.power + L.upkeep + L.salaries + L.transit + L.interest + L.lease + L.water + L.diesel + L.carbonTax + L.fines + L.penalties + L.repairs + L.other + L.tax;
    const profit = rev - cost, q = L.q;
    el.innerHTML = `<div class="qh">${icon("trend")}Q${q % 4 + 1} Y${Math.floor(q / 4) + 1} closed</div>
      <div class="qr"><span>Revenue</span><b style="color:var(--hud-good)">+${money(rev)}</b></div><div class="qr"><span>Costs</span><b style="color:var(--hud-bad)">−${money(cost)}</b></div>
      ${L.tax > 0.5 ? `<div class="qr"><span>incl. tax</span><b style="color:var(--hud-bad)">−${money(L.tax)}</b></div>` : ""}<div class="qr qp"><span>Profit</span><b id="qcard-p">$0k</b></div>`;
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
    renderHUD(st); renderDrawerBtns(); renderBanners(st); renderGoal(st); renderOffers(st); renderHallTabs(); renderModes(); renderFloor(st); renderShelf();
    renderDetail(st); renderTray(); renderMarket(); renderBench(); renderNews();
    if (V.drawer) renderDrawer(st);
    if (V.pop) renderPop(st);
    const hh = $("hud").offsetHeight;
    if (hh !== V.hudH) { V.hudH = hh; document.documentElement.style.setProperty("--hud-h", hh + "px"); }
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
    const vis = { contracts: on("contracts"), finance: true, energy: on("facilities") || on("energy") || on("environment"), affairs: on("reputation") || on("policy") };
    const dots = {
      contracts: S.offers.length, finance: S.roundOffer ? 1 : 0, energy: (S.outage ? 1 : 0) + (S.heatWave ? 1 : 0) + (S.drought ? 1 : 0),
      affairs: S.policies.filter(p => p.announced && p.status === "proposed").length,
    };
    for (const k of Object.keys(vis)) {
      const b = $("db-" + k); show(b, vis[k]);
      b.setAttribute("aria-pressed", V.drawer === k);
      const dot = b.querySelector(".dot");
      if (dots[k]) { dot.hidden = false; dot.textContent = dots[k]; } else dot.hidden = true;
      b.classList.toggle("hot", k === "contracts" && dots[k] > 0);
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
      case "racks": tip = st.supply.web < st.mk.web.demand - 1 ? `Web demand ${st.mk.web.demand.toFixed(0)}, you serve ${st.supply.web.toFixed(0)}. Add web servers (each rack needs a switch).` : "Web market is full. Save cash: bigger things are coming."; break;
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
    $("goal").innerHTML = `${icon("flag", "color:var(--c-warn)")}<b>${CH[S.chapter].title}</b><span>${tip}</span><span style="margin-left:auto;color:var(--ink-2);white-space:nowrap">${S.sandbox ? "Sandbox · " : ""}${left} days left</span>`;
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
    const L = $("legend"), RP = ramps();
    const keys = list => `<div class="keys">${list.map(([c, n]) => `<span><i style="background:${c}"></i>${n}</span>`).join("")}</div>`;
    if (V.mode === "role") L.innerHTML = keys(["web", "train", "infer", "tank"].filter(k => k !== "tank" || on("disrupt")).filter(k => k === "web" || on("gpu")).map(k => [R[k].color, R[k].name]));
    else if (V.mode === "gen") L.innerHTML = keys([[COL.good, "Current"], [COL.warn, "One behind"], [COL.bad, "Two behind"]]);
    else if (V.mode === "cluster") L.innerHTML = keys([0, 1, 2].map(i => [COL["row" + i], `Row ${builtHalls().map(n => hallLetters(n)[i]).join("/")} spine`]).concat([[COL.none, "No spine"]])) + `<span>${icon("star", `color:${COL.frontier};width:14px;height:14px`)} = frontier cluster (${K.FRONTIER_MIN_GPUS}+ training GPUs)</span>`;
    else {
      const lab = { heat: ["22 °C", "36 °C"], power: ["0 kW", "30 kW"], free: ["Full", "20U free"], fail: ["Safe", "1 %/day"] }[V.mode];
      L.innerHTML = `<span>${lab[0]}</span><span class="ramp" style="background:linear-gradient(90deg,${RP[V.mode].join(",")})"></span><span>${lab[1]}</span>${V.mode === "fail" ? `<span>${icon("cross", `color:${COL.fail};width:14px;height:14px`)} failed part</span>` : ""}`;
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
    const hj = S.jobs.find(j => j.kind === "buildHall"), hc = Sim.hallCost(n), L = hallLetters(n);
    const body = hj && hj.hall === n ? `<span>Under construction: ${Math.ceil(hj.left)} days left</span><div class="bar"><i style="width:${Math.round((1 - jobFrac(hj)) * 100)}%"></i></div>`
      : hj ? `<span>Hall ${hj.hall} is under construction: ${Math.ceil(hj.left)} days left. One hall at a time.</span>`
      : `<span>${K.HALL_RACKS} more racks (${L[0]}1–${L[2]}${K.COLS}) on the same grid. ${money(hc.cost)}, ${hc.days} days to build.</span>${n > 1 && !S.halls[n - 2].built ? `<span class="sub">Build Hall ${n - 1} first.</span>` : ""}${actBtn({ type: "buildHall", hall: n }, `Build Hall ${n} · ${money(hc.cost)}`, { confirm: true, cls: "primary", icon: "building" })}`;
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
    const L = hallLetters(V.hall);
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
      const prog = job ? `<span class="prog" data-prog="${r.id}">${jobLabel(job).join("")}<i style="width:${Math.round((1 - jobFrac(job)) * 100)}%"></i></span>` : "";
      const tgt = V.armed ? " armed-target" : "";
      if (role === "empty" || (r.tank && !r.devices.length && !r.pending.length)) {
        h += `<button class="rack empty${r.tank ? " tank" : ""}${tgt}" style="${pos}" data-rack="${r.id}" aria-pressed="${r.id === V.selected}" title="${r.id}: ${r.tank ? "empty immersion tank" : "empty rack"}, ${free}U free"><span class="plus">${icon(r.tank ? "drop" : "plus")}</span><span class="id">${r.id}</span>${prog}</button>`;
        continue;
      }
      const flags = [];
      if (pr.throttle < 1) flags.push("flame");
      if (pr.penalty < 1 || r.devices.some(d => Sim.isDead(S, item(d.type)))) flags.push("warn");
      else if (pr.netF < 1) flags.push("net");
      const gb = genBehind(r); if (gb != null && gb >= 2) flags.push("clock");
      if (pr.frontier && pr.trainGpus) flags.push("star");
      const nFail = r.devices.filter(d => d.failed).length, nLease = r.devices.concat(r.pending).filter(d => d.leased).length;
      const nosw = noSwitch(r, pr);
      const tip = `${nosw ? "NO SWITCH: this rack earns nothing until a switch is installed. " : ""}${r.id}: ${R[role].name}. ${perDay(pr.rev)}, ${pr.kw.toFixed(1)} kW, inlet ${pr.inlet.toFixed(1)} °C, ${free}U free${pr.netF < 1 ? `, network short (${Math.round(pr.netF * 100)} %)` : ""}${pr.throttle < 1 ? `, throttled to ${Math.round(pr.throttle * 100)} %` : ""}${nFail ? `, ${nFail} failed` : ""}${nLease ? `, ${nLease} leased` : ""}`;
      // idle life (display only): fan speed follows the rack's kW, LED blink rate follows how much of it is delivered.
      // Negative animation-delay keeps the phase continuous across the floor's re-renders.
      const load = clamp01(pr.kw / K.RACK_KW), util = pr.rev > 0.01 ? clamp01(pr.throttle * Math.min(1, pr.netF == null ? 1 : pr.netF)) : 0;
      const fanDur = 1.7 - 1.35 * load, ledDur = 0.3 + 1.5 * (1 - util), tS = nowMs / 1000;
      const fan = pr.kw > 0.05 ? `<span class="fan" style="animation-duration:${fanDur.toFixed(2)}s;animation-delay:${(-(tS % fanDur)).toFixed(2)}s"></span>` : "";
      const led = util > 0 ? ` style="animation-duration:${ledDur.toFixed(2)}s;animation-delay:${(-(tS % ledDur)).toFixed(2)}s"` : "";
      const fillCol = rackColor(r, st), prevCol = V.fillPrev[r.id];
      V.fillPrev[r.id] = fillCol;
      const fillStyle = prevCol && prevCol !== fillCol ? `background:${prevCol}" data-fill="${fillCol}` : `background:${fillCol}`;   // cross-fade: start at the old colour
      h += `<button class="rack ${r.row === 1 ? "front-bottom" : "front-top"}${r.tank ? " tank" : ""}${tgt}" style="${pos}" data-rack="${r.id}" aria-pressed="${r.id === V.selected}" title="${esc(tip)}">
        <span class="fill" style="${fillStyle}"></span>${fan}<span class="front${util > 0 ? " blink" : ""}${nFail ? " bad" : ""}"${led}></span>
        ${pr.rev > 0.05 ? `<span class="earn">$${pr.rev.toFixed(1)}k</span>` : ""}${nLease ? `<span class="leasetag">LEASE</span>` : ""}
        <span class="flags">${flags.map(f => icon(f, f === "star" ? `color:${COL.frontier}` : "")).join("")}</span><span class="id">${r.id}</span>${free ? `<span class="free">${free}U</span>` : ""}
        ${nFail ? `<span class="xmark" title="${nFail} failed">${icon("cross")}</span>` : ""}${nosw ? `<span class="noswitch">${icon("switch")}NO SWITCH<b>$0</b></span>` : ""}${prog}</button>`;
    }
    F.innerHTML = h;
    floorLife(F, nowMs);
  }
  /* frontier cluster progress for one row: installed training GPUs (non-tank racks), toward FRONTIER_MIN_GPUS */
  function clusterMeter(hall, row, st) {
    const rs = S.racks.filter(r => r.hall === hall && r.row === row && !r.tank);
    const n = rs.reduce((a, r) => a + ((st.perRack[r.id] || {}).trainGpus || 0), 0);
    const coming = rs.reduce((a, r) => a + (r.workload === "train" ? r.pending.filter(d => item(d.type).role === "gpu").length : 0), 0);
    const hasSpine = !!S.spines[`${hall}-${row}`], L = hallLetters(hall)[row], need = K.FRONTIER_MIN_GPUS;
    const tip = `Row ${L} cluster: ${n}/${need} training GPUs${coming ? ` (+${coming} on the way)` : ""} → frontier training ×${K.FRONTIER_PRICE} at ${need}` +
      (n >= need ? (hasSpine ? ". Frontier price active." : ". Build the row spine to unlock it.") : `. ${need - n} more${hasSpine ? "" : ", plus a row spine"}. Partial clusters earn the normal training price.`);
    return { n, coming, f: Math.min(1, n / need), tip, hasSpine, L };
  }
  /* post-render juice for the floor: colour cross-fades, cold-air drift phase, calendar tint, rack animations */
  function floorLife(F, nowMs) {
    F.style.setProperty("--drift-delay", (-((nowMs / 1000) % 1.6)).toFixed(2) + "s");
    const doy = S.day % 360, warm = Math.cos(2 * Math.PI * (doy - 200) / 360);   // summer peaks ~day 200 (same as the goal hint)
    F.style.setProperty("--season", warm > 0 ? `rgba(255,140,40,${(0.07 * warm).toFixed(3)})` : `rgba(70,140,255,${(0.07 * -warm).toFixed(3)})`);
    const fades = F.querySelectorAll("[data-fill]");
    if (fades.length) requestAnimationFrame(() => fades.forEach(el => { el.style.background = el.dataset.fill; el.removeAttribute("data-fill"); }));
    if (FXON()) FX.afterFloor(F);
  }

  function renderProgress() {
    document.querySelectorAll("[data-prog]").forEach(el => {
      const j = jobFor(el.dataset.prog); if (!j) return;
      const [ic, txt] = jobLabel(j);
      el.innerHTML = `${ic}${txt}<i style="width:${Math.round((1 - jobFrac(j)) * 100)}%"></i>`;
    });
    const jl = $("jobs"); if (jl) jl.innerHTML = jobsHTML();
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
      h += `<div class="slot incoming" title="${esc(what)}">${icon(j.kind === "forward" ? "truck" : "wrench")}<span>${j.kind === "swap" ? "swap" : esc(it.name.split(" ").pop())}</span><span>${Math.ceil(j.left)}d</span><span class="sp" style="width:${Math.round((1 - jobFrac(j)) * 100)}%"></span></div>`;
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
    $("tray-title").innerHTML = `<h2>Catalog</h2><span>${leasing ? `Leasing: no upfront cost, ${(K.LEASE_RATE * 100).toFixed(2)} % of list price per day. GPUs only.` : `Drag onto a rack (or tap a card, then a rack). Ships in ${K.SHIP_DAYS} days, then a technician installs it in ${K.INSTALL_DAYS}.`}</span><span class="tools">${tools}</span>`;
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
  }

  function jobsHTML() {
    if (!V.selected) return "";
    const mine = S.jobs.filter(j => j.to === V.selected || j.rack === V.selected);
    return mine.map(j => {
      const [ic, txt] = jobLabel(j);
      const verb = { sell: "Selling", move: "Moving in", tank: "Building tank", store: "To the shelf", unstore: "From the shelf", returnLease: "Returning lease",
        repair: j.phase === "parts" ? "Waiting for parts" : "Repairing", swap: "Swapping in a spare" }[j.kind] || (j.phase === "ship" ? "Shipping" : "Installing");
      return `<div>${ic}<span>${verb}${j.dev ? " " + esc(item(j.dev.type).name) : ""}</span><span style="text-align:right">${txt}</span><span class="t"><i style="width:${Math.round((1 - jobFrac(j)) * 100)}%"></i></span></div>`;
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
    const g = (ic, col, v, label) => `<div class="g">${icon(ic, `color:${col}`)}<div class="track"><i style="width:${Math.round(clamp01(v) * 100)}%;background:${col}"></i></div><small>${label}</small></div>`;
    const hasGpu = r.devices.concat(r.pending).some(d => item(d.type).role === "gpu");
    const nFail = r.devices.filter(d => d.failed).length;
    const nosw = noSwitch(r, pr);
    const status = role === "empty" ? (r.tank ? "Empty tank. Takes Lattice/Photon cards and a switch." : "Drag hardware here to start using this rack")
      : nosw ? `<span class="nosw-status">${icon("switch")} No switch: this rack earns <b>$0</b> until one is installed</span>`
      : nFail ? `${icon("cross", `color:${COL.fail}`)} ${nFail} failed part${nFail > 1 ? "s" : ""}: click it to repair, or drop a spare on it`
      : pr.penalty < 1 ? `${icon("warn")} Unsupported part is crashing this rack (60 %)`
      : pr.throttle < 1 ? `${icon("flame")} Too hot: running at ${Math.round(pr.throttle * 100)} %`
      : pr.netF < 1 && pr.netNeed > 0 ? `${icon("net")} Network short: ${pr.netProv} of ${pr.netNeed} needed`
      : `${perDay(pr.rev)} revenue${pr.frontier && pr.trainGpus ? " · frontier cluster" : ""}`;
    const wl = on("gpu") && hasGpu && !r.tank ? `<div class="wl" role="group" aria-label="Workload">${Sim.WORKLOADS.map(w => `<button data-wl="${w}" aria-pressed="${r.workload === w}" style="${r.workload === w ? `background:${R[w].color}` : ""}">${icon(R[w].icon, "width:14px;height:14px")}${R[w].name}</button>`).join("")}</div>` : "";
    const modes = on("power") && r.devices.length ? `<div class="seg" role="group" aria-label="Power mode">${Object.entries(Sim.MODES).map(([k, m]) => `<button data-pmode="${k}" aria-pressed="${r.mode === k}" title="${m.label}: ${Math.round(m.out * 100)} % output, ${Math.round(m.kw * 100)} % power">${icon(MODE_ICON[k])}${m.label}</button>`).join("")}</div>` : "";
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
      <h2><span style="width:14px;height:14px;border-radius:3px;background:${role === "empty" ? "var(--line)" : R[role].color};display:inline-block"></span>${r.id}<span class="sub" style="font-family:var(--sans);font-weight:400">${R[role].name}${builtHalls().length > 1 ? ` · Hall ${r.hall}` : ""}</span></h2>
      <div class="sub" style="display:flex;align-items:center;gap:6px;margin-top:4px">${status}</div>${swBtn}
      <div class="rack-detail">
        <div class="elev" data-drop-rack="${r.id}" title="Front view, 20U">${elev}</div>
        <div class="gauges">
          ${g("temp", ramp(ramps().heat, (pr.inlet - 22) / 14), (pr.inlet - 18) / 18, `Inlet ${pr.inlet.toFixed(1)} °C${pr.throttle < 1 ? " · throttling" : ""}`)}
          ${g("bolt", "var(--pow-c)", pr.kw / K.RACK_KW, `${pr.kw.toFixed(1)} of ${K.RACK_KW} kW`)}
          ${g("net", "#8FC4FF", pr.netNeed ? Math.min(1, pr.netProv / pr.netNeed) : pr.netProv ? 1 : 0, `Network ${pr.netProv} / ${pr.netNeed.toFixed(0)}${pr.spine ? " (row spine)" : ""}`)}
          ${g("plus", "var(--ok-c)", free / K.RACK_U, `${free}U free`)}
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
      return `<div class="ev${S.day - n.day < 20 ? " fresh" : ""}" title="${esc(n.body || "")}"><span class="av" style="background:${c}">${icon(n.icon || ic)}</span><span><strong>${esc(n.title)}</strong><span>${esc(n.body || "")}</span><span class="when" style="display:block">${dateOf(n.day)}${n.cat && NEWS_CAT[n.cat] ? ` · ${NEWS_CAT[n.cat][1]}` : ""}</span></span></div>`;
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
  function renderPop(st) {
    const pop = $("pop");
    if (V.pop === "techs") {
      const busy = Sim.busyTechs(S), queue = S.jobs.filter(j => j.phase === "wait").length, parts = S.jobs.filter(j => j.phase === "parts").length;
      pop.innerHTML = `<h3>${icon("wrench")}Technicians</h3>
        <div class="stepper"><button data-act='{"type":"fire"}' title="Fire one: severance ${money(K.FIRE_PAY_DAYS * K.SALARY)}" aria-label="Fire a technician">${icon("minus")}</button>
          <div class="val"><span class="big">${S.techs}${S.hires.length ? ` <small>+${S.hires.length} hiring</small>` : ""}</span><small>$${(S.techs * K.SALARY).toFixed(2)}k/day in salaries</small></div>
          <button data-act='{"type":"hire"}' title="Hire one: arrives in ${K.HIRE_DAYS} days" aria-label="Hire a technician">${icon("plus")}</button></div>
        <div class="kv"><span>Busy</span><b>${busy} / ${S.techs}</b></div><div class="kv"><span>Jobs queued</span><b>${queue}</b></div><div class="kv"><span>Waiting for parts</span><b>${parts}</b></div>
        <button class="toggle" data-act='${JSON.stringify({ type: "repairPolicy", on: !S.repairAuto })}' aria-pressed="${S.repairAuto}"><span class="sw"></span><span><b>Auto-repair</b><br><small>${S.repairAuto ? "Failed parts are swapped (spare) or repaired automatically" : "You decide what to repair"}</small></span></button>`;
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
    const committed = { web: 0, train: 0, infer: 0 };
    for (const c of S.contracts) committed[c.w] += c.units;
    const offers = S.offers.map(o => {
      const up = o.price >= o.spot, diff = (o.price / o.spot - 1) * 100, spare = st.supply[o.w] - committed[o.w];
      const daysLeft = Math.max(0, o.expires - S.day);
      const bts = o.bts ? `<div class="btsrow"><span class="bts-badge">${icon("building")}BUILD-TO-SUIT</span><span class="sub">dedicated capacity, long term</span></div>
        <div class="facts bts"><span>${icon("coin")}Fit-out <b>${money(o.fitout)}</b> now</span><span>${icon("truck")}Delivery from <b>day ${Math.round(S.day + o.lead)}</b> (in ${Math.round(o.lead)} d)</span><span>${icon("doc")}Term <b>${o.days} d</b></span><span>${icon("warn")}Penalty <b>3×</b> price</span></div>` : "";
      return `<div class="offer dragsrc${o.bts ? " bts" : ""}" data-drag="offer" data-id="${o.id}" title="Drag onto Sign or Decline">${bts}
        <div class="top"><span class="av" style="background:${R[o.w].color}">${icon(CUST_ICON[o.icon] || "globe")}</span><span><b>${esc(o.cust)}</b>${o.foreign ? ` ${icon("globe", "width:13px;height:13px;vertical-align:-2px")}<small class="sub"> foreign</small>` : ""}<br><small class="sub">${R[o.w].name} · ${o.units} units × ${o.days} days</small></span>
          <span style="margin-left:auto;text-align:right"><b>$${(o.price * 1000).toFixed(0)}</b><small class="sub">/u·d</small><br><small class="${up ? "up" : "down"}">${up ? "▲" : "▼"}${Math.abs(diff).toFixed(0)} % vs spot</small></span></div>
        <div class="facts"><span>${icon("check")}SLA <b>${pct(o.sla)}</b></span><span>${icon("warn")}Penalty <b>$${(o.penalty * 1000).toFixed(0)}</b>/missed u·d</span><span>${icon("coin")}Worth <b>${money(o.units * o.days * o.price)}</b></span></div>
        <div class="kv"><span>${spare >= o.units ? icon("check", `color:${COL.good};width:14px;height:14px`) : icon("warn", `color:${COL.bad};width:14px;height:14px`)} Your uncommitted ${R[o.w].name.toLowerCase()} output: ${Math.max(0, spare).toFixed(1)}</span><span>expires ${Math.ceil(daysLeft)} d</span></div>
        <div class="meter slim"><i style="width:${Math.min(100, daysLeft / (o.bts ? K.BTS_EXPIRY : K.OFFER_EXPIRY) * 100)}%;background:${COL.warn}"></i></div>
        <div class="acts">${actBtn({ type: "signContract", id: o.id }, o.bts ? `Sign · ${money(o.fitout)}` : "Sign", { cls: "good", icon: "hand", confirm: !!o.bts })}${actBtn({ type: "declineContract", id: o.id }, "Decline", { icon: "cross" })}</div></div>`;
    }).join("");
    const act = S.contracts.map(c => {
      const head = `<div class="kv"><span>${c.bts ? `<span class="bts-badge sm" title="Build-to-suit">BTS</span> ` : ""}<b>${esc(c.cust)}</b> · ${c.units} ${R[c.w].name.toLowerCase()} u at $${(c.price * 1000).toFixed(0)}</span>`;
      if (S.day < c.start) {   // build-to-suit before delivery starts: time to buy the hardware
        const lead = Math.max(1, c.start - (c.signed != null ? c.signed : c.start - (c.lead || K.BTS_LEAD))), f = clamp01(1 - (c.start - S.day) / lead);
        return `<div class="contract" style="border-color:${R[c.w].color}">${head}<span>starts in ${Math.ceil(c.start - S.day)} days</span></div>
          <div class="meter slim" title="Lead time until delivery starts"><i style="width:${f * 100}%;background:${COL.warn}"></i></div>
          <div class="kv"><span>Deliver ${c.units} ${R[c.w].name.toLowerCase()} units from day ${Math.round(c.start)} for ${c.days} d · SLA ${pct(c.sla)}</span><span>ready now ${Math.max(0, Math.min(c.units, st.supply[c.w] - committed[c.w] + c.units)).toFixed(1)} / ${c.units}</span></div></div>`;
      }
      const el = Math.max(0.01, S.day - c.start), tf = clamp01(el / c.days), delF = c.delivered / (c.units * el);
      const missing = (st.cMiss[c.id] || 0) > 1e-6;
      return `<div class="contract" style="border-color:${R[c.w].color}">${head}<span>${Math.ceil(c.end - S.day)} d left</span></div>
        <div class="meter slim" title="Time elapsed"><i style="width:${tf * 100}%;background:var(--ink-2)"></i></div>
        <div class="meter" title="Delivered vs promised; the line is the SLA"><i style="width:${clamp01(delF) * 100}%;background:${delF + 1e-6 >= c.sla ? COL.good : COL.bad}"></i><em style="left:${c.sla * 100}%"></em></div>
        <div class="kv"><span>Delivered ${pct(Math.min(1, delF))} (SLA ${pct(c.sla)})${missing ? ` · <b style="color:${COL.bad}">missing now</b>` : ""}</span><span>penalties ${money(c.penaltyPaid)}</span></div></div>`;
    }).join("");
    const L = S.contractLog;
    return sect("doc", "Offers", `${S.offers.length} waiting`, `<div class="dropzones"><div class="dz sign" data-drop-sign>${icon("hand")}Sign</div><div class="dz decline" data-drop-decline>${icon("cross")}Decline</div></div>
        <div class="sub">Quotes track today's spot price. Signing just before a generation launch is a hedge; signing just after one is a trap.</div>${offers || `<div class="sub">No offers right now. New ones arrive every ~${K.OFFER_EVERY} days.</div>`}`)
      + sect("hand", "Active contracts", `${S.contracts.length}`, act || `<div class="sub">None. Contracts are served first, before spot.</div>`)
      + sect("flag", "Track record", "", `<div class="kv"><span>Signed</span><b>${L.signed}</b></div><div class="kv"><span>Fulfilled</span><b>${L.fulfilled}</b></div><div class="kv"><span>Ended short</span><b>${L.failed}</b></div>`);
  }

  function waterfallSVG(L) {
    const rev = [["Web", L.web, COL.web], ["Train", L.train, COL.train], ["Infer", L.infer, COL.infer], ["Frontier", L.frontier, COL.frontier], ["Contracts", L.contracts, COL.contract]];
    const cost = [["Power", L.power, COL.pow], ["Staff", L.upkeep + L.salaries, COL.net], ["Transit", L.transit, "#8FC4FF"], ["Interest", L.interest, COL.debt], ["Leases", L.lease, COL.lease],
      ["Water", L.water, COL.water], ["Diesel", L.diesel, COL.hot], ["Carbon tax", L.carbonTax, COL.carbon], ["Fines", L.fines, COL.bad], ["Penalties", L.penalties, COL.bad],
      ["Repairs", L.repairs, COL.fail], ["Other", L.other, COL.info], ["Tax", L.tax, COL.vc]];
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
    const L = useLast ? S.lastQuarter : S.ledger, q = useLast ? S.lastQuarter.q : Math.floor(S.day / 90);
    let out = sect("trend", `Y${Math.floor(q / 4) + 1} Q${q % 4 + 1} ${useLast ? "results" : "so far"}`, "",
      `<div class="buylease" role="group" style="justify-self:start"><button data-wf="0" aria-pressed="${!useLast}">This quarter</button><button data-wf="1" aria-pressed="${!!useLast}"${S.lastQuarter ? "" : " disabled"}>Last quarter</button></div>
       <div class="wfall">${waterfallSVG(L)}</div>${L.lost > 0.5 ? `<div class="sub">${icon("flame", `color:${COL.hot};width:14px;height:14px`)} Throttling cost ${money(L.lost)} of revenue this quarter.</div>` : ""}
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
        const hc = Sim.hallCost(h.n), L = hallLetters(h.n);
        cards.push(facCard("building", COL.info, `Hall ${h.n}`, `${K.HALL_RACKS} racks (${L[0]}1–${L[2]}${K.COLS}), same grid. ${hc.days} days.${!h.built && !S.halls[h.n - 2].built ? ` Needs Hall ${h.n - 1}.` : ""}`,
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

  /* ================= v0.3: offers on the main screen (P0-1) ================= */
  const OFFER_STRIP_MAX = 3;
  function offerFacts(o, st) {
    const spot = st.mk[o.w].price, diff = (o.price / spot - 1) * 100, committed = S.contracts.filter(c => c.w === o.w).reduce((a, c) => a + c.units, 0);
    const spare = st.supply[o.w] - committed;
    return { diff, spare, fits: spare >= o.units, left: Math.max(0, o.expires - S.day) };
  }
  function renderOffers(st) {
    const el = $("offerstrip");
    const vis = on("contracts") && S.offers.length > 0;
    show(el, vis);
    if (!vis) { el.innerHTML = ""; return; }
    const list = S.offers.slice().sort((a, b) => a.expires - b.expires).slice(0, OFFER_STRIP_MAX);
    el.innerHTML = `<div class="oshead">${icon("hand")}<b>${S.offers.length} offer${S.offers.length > 1 ? "s" : ""}</b><small>Contracts lock your price for their term.</small>${S.offers.length > OFFER_STRIP_MAX ? `<button class="btn slim" data-drawer="contracts">+${S.offers.length - OFFER_STRIP_MAX} more</button>` : `<button class="btn slim" data-drawer="contracts">Details</button>`}</div>` +
      list.map(o => {
        const f = offerFacts(o, st), up = f.diff >= 0;
        return `<div class="ocard${o.bts ? " bts" : ""}" style="--wc:${R[o.w].color}" data-offer="${o.id}">
          <div class="ot"><span class="av" style="background:${R[o.w].color}">${icon(CUST_ICON[o.icon] || "globe")}</span><span class="on"><b>${esc(o.cust)}</b>${o.bts ? `<span class="bts-badge sm">BUILD-TO-SUIT</span>` : ""}<small>${o.units} ${R[o.w].name.toLowerCase()} units × ${o.days} days${o.bts ? ` · from day ${Math.round(S.day + o.lead)}` : ""}</small></span>
            <span class="op"><b>$${(o.price * 1000).toFixed(0)}</b><small>/u·d</small><small class="${up ? "up" : "down"}">${up ? "▲" : "▼"}${Math.abs(f.diff).toFixed(0)} % vs spot</small></span></div>
          <div class="of"><span title="Delivery promise: share of the units you must deliver every day">${icon("check")}SLA ${pct(o.sla)}</span><span title="Paid per missed unit-day">${icon("warn")}penalty $${(o.penalty * 1000).toFixed(0)}</span>${o.bts ? `<span>${icon("coin")}fit-out ${money(o.fitout)}</span>` : `<span>${icon("coin")}${money(o.units * o.days * o.price)}</span>`}
            <span class="${f.fits ? "okc" : "badc"}" title="Your ${R[o.w].name.toLowerCase()} output not yet promised to other contracts">${icon(f.fits ? "check" : "warn")}spare ${Math.max(0, f.spare).toFixed(0)}/${o.units}</span></div>
          <div class="oa">${actBtn({ type: "signContract", id: o.id }, o.bts ? `Sign · ${money(o.fitout)}` : "Sign", { cls: "good", icon: "hand", confirm: !!o.bts })}${actBtn({ type: "declineContract", id: o.id }, "Decline", { icon: "cross" })}<span class="exp" title="Expires in ${Math.ceil(f.left)} days"><i style="width:${Math.min(100, f.left / (o.bts ? K.BTS_EXPIRY : K.OFFER_EXPIRY) * 100)}%"></i></span><small>${Math.ceil(f.left)} d</small></div></div>`;
      }).join("");
  }
  /* new offers: a toast (+ sound) every time, and the very first one pauses the game with a short explainer */
  function checkOffers() {
    if (!on("contracts")) return;
    const st = Sim.stats(S);
    for (const o of S.offers) {
      if (V.offersSeen.has(o.id)) continue;
      V.offersSeen.add(o.id);
      const f = offerFacts(o, st);
      toast(`New ${o.bts ? "build-to-suit request" : "contract offer"}: ${o.cust}, ${o.units} ${R[o.w].name.toLowerCase()} units × ${o.days} d, ${f.diff >= 0 ? "+" : "−"}${Math.abs(f.diff).toFixed(0)} % vs spot`, "keep");
      SND("chime", null, 400);
      if (FXON()) { const b = $("db-contracts").getBoundingClientRect(); if (b.width) FX.sparks(b.left + b.width / 2, b.top + b.height / 2, COL.contract, 14, 160); }
      dlog("[offer] new", o.id, o.cust, o.w, o.units, o.days, o.price, o.bts ? "bts" : "");
      if (!V.firsts.offer) { V.firsts.offer = true; queueCard(firstOfferCard(o, f)); }
    }
  }
  function firstOfferCard(o, f) {
    const launches = Sim.GEN_LAUNCH.filter(d => d > S.day);
    return { key: "offer", sound: "chime", title: "Your first contract offer", sub: `${dateOf(S.day)} · game paused`,
      body: `<div class="kv big"><span>${icon(CUST_ICON[o.icon] || "globe")} <b>${esc(o.cust)}</b> wants ${o.units} ${R[o.w].name.toLowerCase()} units × ${o.days} days</span><b>$${(o.price * 1000).toFixed(0)}/u·d (${f.diff >= 0 ? "+" : "−"}${Math.abs(f.diff).toFixed(0)} % vs spot)</b></div>
        <ul class="plain"><li>${icon("lock")}<span><b>A contract locks your price</b> for its whole term. The market price falls at every generation launch${launches.length ? ` (next: day ${launches[0]})` : ""}, so signing before one is a hedge.</span></li>
        <li>${icon("check")}<span>Contracts are served first. Deliver at least <b>${pct(o.sla)}</b> of the units every day, or pay <b>$${(o.penalty * 1000).toFixed(0)}</b> per missed unit-day.</span></li>
        <li>${icon(f.fits ? "check" : "warn", `color:${f.fits ? COL.good : COL.bad}`)}<span>You have <b>${Math.max(0, f.spare).toFixed(0)}</b> spare ${R[o.w].name.toLowerCase()} units right now: ${f.fits ? "enough" : "not enough yet; build capacity first or decline"}.</span></li>
        <li>${icon("help")}<span>New offers appear above the floor with <b>Sign</b> / <b>Decline</b>. The <b>Contracts</b> button (top right) has details.</span></li></ul>`,
      foot: `${actBtn({ type: "signContract", id: o.id }, "Sign", { cls: "good", icon: "hand" })}${actBtn({ type: "declineContract", id: o.id }, "Decline", { icon: "cross" })}<button class="end" data-close>Decide later</button>` };
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
  function bestForwardCard() {   // the current-generation card of the family the player runs most (C by default)
    const cg = Sim.currentGen(S);
    let c = 0, m = 0;
    for (const r of S.racks) for (const d of r.devices) { const it = item(d.type); if (it.role === "gpu") it.fam === "C" ? c++ : m++; }
    const fam = m > c ? "m" : "c";
    return S.items[fam + cg] && Sim.shopItems(S).includes(fam + cg) ? fam + cg : Sim.shopItems(S).find(k => item(k).role === "gpu" && item(k).fam === fam.toUpperCase()) || null;
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
    const big = news.filter(e => Math.abs(e.amt) >= 10);
    if (big.length) {
      toast(big.slice(0, 3).map(e => `${e.amt >= 0 ? "+" : "−"}${money(Math.abs(e.amt))}: ${e.label}`).join(" · "), "keep");
      if (FXON()) { const r = $("h-cashchip").getBoundingClientRect(); const tot = big.reduce((a, e) => a + e.amt, 0); if (r.width) FX.floatText(r.left + r.width / 2, r.bottom + 6, `${tot >= 0 ? "+" : "−"}${money(Math.abs(tot))}`, tot >= 0 ? "#7FE0A8" : "#FF8466", 15); }
      dlog("[cash] events", big.map(e => `${e.kind} ${e.amt}`).join(", "));
    }
    V.cashSeen = seq;
    const P = V.flowPrev;
    if (P) {   // anything left over is a jump nobody logged: say so, never stay silent (and flag it in debug)
      const gap = (S.cash - P.cash) - (flow - P.flow) - logged;
      if (Math.abs(gap) >= 10) { toast(`Cash ${gap >= 0 ? "+" : "−"}${money(Math.abs(gap))}: one-off (see the Finance drawer)`, "keep"); console.warn("[ui] unexplained cash jump", gap.toFixed(1), "day", S.day); }
    }
    V.flowPrev = { cash: S.cash, flow };
  }

  /* ================= v0.3: pace chip (P0-3) ================= */
  function renderPace(sc) {
    const el = $("h-pace"); if (!el) return;
    const vis = !!S && PACE_ON && !!window.Pace;
    show(el, vis);
    if (!vis) return;
    const you = sc != null ? sc : Sim.score(S), P = (V.pace && V.pace.rows) || {}, g = P.greedy, p = P.planner, today = Math.floor(S.day);
    const lag = x => x && !x.over && x.day < today - 2;
    const vals = [you, g ? g.score : 0, p ? p.score : 0], max = Math.max(1, ...vals.map(v => Math.abs(v)));
    const verdict = !g ? "…" : you >= g.score ? "ahead of Greedy" : "behind Greedy";
    const col = !g ? COL.hudGood : you >= g.score ? COL.hudGood : COL.hudBad;
    const bar = (v, c, t) => `<i title="${esc(t)}" style="width:${Math.max(2, Math.abs(v) / max * 100).toFixed(1)}%;background:${c}"></i>`;
    const key = [Math.round(you), g && Math.round(g.score), g && g.day, p && Math.round(p.score), p && p.day, today].join("|");
    if (el._k === key) return;
    el._k = key;
    const fmt = x => x ? money(x.score) + (lag(x) ? `<span class="lag"> d${x.day}</span>` : "") : "…";
    el.innerHTML = `${icon("trend", `color:${col}`)}<div><span class="big" style="color:${col}">${verdict}</span>
      <small class="pr">G ${fmt(g)} · P ${p ? fmt(p) : V.ghost && V.ghost.mode === "main" ? "n/a" : "…"}</small>
      <div class="pacebars">${bar(vals[0], COL.sel, `You ${money(you)}`)}${bar(vals[1], COL.net, `Greedy ${g ? money(g.score) : "…"}`)}${bar(vals[2], COL.train, `Planner ${p ? money(p.score) : "…"}`)}</div></div>`;
    el.title = `Pace: two bots play your seed (${S.sandbox ? "sandbox" : "campaign"}) alongside you, up to today and never ahead.\nYou ${money(you)} · Greedy ${g ? money(g.score) + ` (day ${g.day})` : "…"} · Planner ${p ? money(p.score) + ` (day ${p.day})` : "…"}\nGreedy buys whatever pays best today. Planner looks ahead: seasons, launches, contracts, vendor news.`;
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
  $("helpbtn").addEventListener("click", () => showChapter(S.chapter));

  /* ================= end screen ================= */
  function showOver() {
    const sm = Sim.summary(S), H = sm.hidden, NAME = { lattice: "Lattice", photon: "Photon" };
    $("ot").textContent = S.over === "bankrupt" ? "Bankrupt" : S.over === "fired" ? "The board fired you" : "Five years are up";
    $("osub").textContent = `seed ${seed}${S.sandbox ? " · sandbox" : ""}`;
    const kvs = (a, b) => `<div class="kv"><span>${a}</span><b>${b}</b></div>`;
    const breakdown = `<div class="sect"><h3>${icon("flag")}Score breakdown</h3>
      ${kvs("Net worth (cash + resale − debt)", money(sm.netWorth))}${kvs("+ Earnings multiple (2 years of profit)", money(sm.earnings))}
      ${kvs(`× Reputation factor (${Math.round(sm.reputation)} rep)`, "×" + sm.repFactor.toFixed(2))}${kvs("= Company value", money(sm.companyValue))}
      ${kvs("× Your ownership", pct(sm.own))}${S.over === "fired" ? kvs("× Fired penalty", "×" + K.FIRED_SCORE) : ""}${kvs("<b>Score</b>", money(sm.score))}
      <div class="kv"><span>Contracts signed / fulfilled / short</span><b>${sm.contracts.signed} / ${sm.contracts.fulfilled} / ${sm.contracts.failed}</b></div>
      <div class="kv"><span>Carbon · water</span><b>${Math.round(sm.carbon)} t · ${Math.round(sm.water)} m³</b></div></div>`;
    const maxLoss = Math.max(1, ...sm.losses.map(l => l.total));
    const lessons = `<div class="sect"><h3>${icon("warn")}Your three biggest lessons</h3>
      ${sm.lessons.map((t, i) => `<div class="lesson"><span class="av">${icon(["flame", "cross", "coin"][i] || "warn")}</span><span>${esc(t)}</span></div>`).join("") || `<div class="sub">No measurable losses. Impressive.</div>`}
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
    const rows = { you: { score: sm.score, done: true }, greedy: { score: null, day: 0 }, planner: { score: null, day: 0 } };
    const drawBots = () => {
      const max = Math.max(1, ...Object.values(rows).map(r => r.score || 0));
      const bar = (k, name, col) => { const r = rows[k]; return `<div class="bar"><span>${name}</span><i style="width:${r.score == null ? 0 : Math.max(1, r.score / max * 100)}%;background:${col}"></i><b>${r.score == null ? "…" : money(r.score)}${r.est ? `<span class="est" title="Stopped at day ${r.day} to keep the page responsive">EST d${r.day}</span>` : ""}</b>${k !== "you" && !r.done ? `<span></span><span class="prog"><i style="display:block;width:${r.day / K.END_DAY * 100}%"></i></span>` : ""}</div>`; };
      $("bots").innerHTML = `<div class="sub" style="font-weight:600">Score vs the bots (founder equity, same seed)</div>${bar("you", "You", COL.sel)}${bar("greedy", "Greedy bot", COL.net)}${bar("planner", "Planner bot", COL.train)}
        <div class="sub">Same seed, same events. Greedy buys whatever pays best today. Planner looks ahead: seasons, launches, vendor news, pilots, per-kW upgrades.</div>`;
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
        for (const p of ["greedy", "planner"]) { const x = m.rows[p]; if (x) rows[p] = x.over ? { score: x.score, day: x.day, done: true } : { score: null, day: x.day }; }
        drawBots();
        if (rows.greedy.done && rows.planner.done) { dlog("[pace] end screen bots done in", (performance.now() - t0).toFixed(0) + "ms"); V.overRows = null; }
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
    const queue = ["greedy", "planner"];
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
      toast(`Close the card first (${dlg.querySelector("footer button") ? dlg.querySelector("footer button:last-child").textContent.trim() : "Got it"})`);
      try { dlg.animate([0, -8, 7, -4, 0].map(x => ({ translate: `${x}px 0` })), { duration: 260 }); } catch (err) { /* no WAAPI */ }
      return;
    }
    const fr = e.target.closest("#floor [data-rack]");
    V.rackPress = fr && !e.target.closest("[data-drag]") ? { x: e.clientX, y: e.clientY } : null;
    const src = e.target.closest("[data-drag]");
    if (!src || e.button !== 0 || !S || S.over || V.menu) return;
    const p = payload(src); if (!p) return;
    drag = { src, x: e.clientX, y: e.clientY, started: false, p };
  });
  document.addEventListener("pointermove", e => {
    if (!drag && V.rackPress && Math.hypot(e.clientX - V.rackPress.x, e.clientY - V.rackPress.y) > 30) {
      V.rackPress = null;   // floor tiles are not draggable: point at the rack panel, where parts are
      toast("To move or sell hardware, drag a part from the rack panel (right) onto another rack or the bin");
      dlog("hint: floor rack drag");
    }
    if (!drag) return;
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
    msg.style.display = ""; msg.className = "msg " + level; msg.textContent = text;
    renderHUD(st, proj);
    drag.op = ev.op;
  });
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
      dlog("drag end", op, g.snap ? "(magnet)" : "");
      const ok = commitIt && op;
      ghostExit(g, g.src, ok ? "commit" : commitIt && g.bad ? "bad" : "home");
      if (!ok && commitIt && g.bad) SND("nope");
      if (ok) { V.armed = null; act(op); } else renderAll();
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
    toast(`Drag cancelled: ${why}. Nothing was ordered.`);
    SND("nope");
    dlog("drag cancelled", why, g.p);
  }
  document.addEventListener("pointerup", () => { V.rackPress = null; endDrag(true); });
  document.addEventListener("pointercancel", () => endDrag(false));

  /* ================= clicks and keys ================= */
  function setSpeed(v) { V.speed = v; if (v) V.lastSpeed = v; renderHUD(Sim.stats(S)); if (V.drawer) $("drawer-sub").textContent = v ? "game running" : "paused"; }
  function tapTarget(target) {   // tap-to-place: armed payload + tapped target
    const ev = evaluate(V.armed, target);
    if (!ev.res) return false;
    if (!ev.res.ok) { toast(ev.res.msg); SND("nope"); try { target.animate([0, -6, 5, -3, 0].map(x => ({ translate: `${x}px 0` })), { duration: 260 }); } catch (e) { /* no WAAPI */ } return true; }
    if (act(ev.op)) { V.armed = null; renderAll(); }
    return true;
  }
  document.addEventListener("click", e => {
    if (suppressClick || !S) return;
    const t = e.target;
    // popover / drawer close on outside click
    if (V.pop && !t.closest("#pop") && !t.closest("#h-techs, #h-transit, #h-power")) closePop();
    const sp = t.closest("[data-speed]");
    if (sp) { setSpeed(+sp.dataset.speed); return; }
    const ab = t.closest("[data-act]");
    if (ab) {
      const a = JSON.parse(ab.dataset.act), key = JSON.stringify(a);
      if (ab.hasAttribute("data-confirm")) {
        const res = Sim.check(S, a);
        if (!res.ok) { toast(res.msg); return; }
        if (!(V.confirm === key && performance.now() - V.confirmT < CONFIRM_MS)) { V.confirm = key; V.confirmT = performance.now(); toast(`${res.msg} · tap again to confirm`); renderAll(); return; }
      }
      const ok = act(a);
      if (ok && ab.closest("#card")) $("card").close();
      return;
    }
    if (t.closest("dialog [data-close]")) { const d = t.closest("dialog"); if (d.open) d.close(); return; }
    const dr = t.closest("[data-drawer]");
    if (dr) { if (dr.closest("#h-debt, #h-rep, #h-carbon, #h-equity, #offerstrip") || dr.classList.contains("iconbtn")) openDrawer(dr.dataset.drawer); return; }
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
      if (V.armed) toast(p.kind === "spine" ? "Tap a spine slot (or a rack in the row)" : p.kind === "shelf" ? "Tap a rack to install, or a failed part to swap" : `Tap a rack to ${V.lease && on("finance") && item(p.item).role === "gpu" ? "lease" : "order"} ${item(p.item).name}`);
      return;
    }
    const rk = t.closest("#floor [data-rack]");
    if (rk) { V.selected = rk.dataset.rack; V.selDev = null; if (V.tab !== "rack") setTab("rack"); renderAll(); return; }
    const pm = t.closest("[data-pmode]");
    if (pm) { act({ type: "mode", rack: V.selected, mode: pm.dataset.pmode }); return; }
    const wl = t.closest("[data-wl]");
    if (wl) { act({ type: "workload", rack: V.selected, workload: wl.dataset.wl }); return; }
    const mb = t.closest("#modes button");
    if (mb) { V.mode = mb.dataset.mode; renderAll(); }
  });
  document.addEventListener("keydown", e => {
    if (e.target.closest && e.target.closest("input, textarea")) return;
    if ((e.key === "f" || e.key === "F") && !e.metaKey && !e.ctrlKey && !e.altKey) { toggleFullscreen(); return; }   // also on the menu and over cards
    if (V.menu || anyDialogOpen() || !S) return;
    const SPEEDS = { "1": 1, "2": 2, "3": 4, "4": 8 };
    if (e.code === "Space") { e.preventDefault(); setSpeed(V.speed ? 0 : V.lastSpeed); }
    else if (SPEEDS[e.key]) setSpeed(SPEEDS[e.key]);
    else if (e.key === "Escape") { if (V.armed) { V.armed = null; renderAll(); } else if (V.pop) closePop(); else if (V.drawer) closeDrawer(); }
    else if (e.key === "m" || e.key === "M") toggleMute();
    else if (e.key === "v" || e.key === "V") { const ms = MAP_MODES.filter(m => on(m.ch)); V.mode = ms[(ms.findIndex(m => m.key === V.mode) + 1) % ms.length].key; renderAll(); }
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
  function toggleMute() { if (!window.SFX) return; SFX.toggle(); renderMute(); toast(SFX.muted ? "Sound off" : "Sound on"); }
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
    if (!Stage.canFullscreen()) { toast("Fullscreen is not available in this frame: use the page's fullscreen button"); dlog("fullscreen unavailable"); return; }
    Stage.toggleFullscreen().then(ok => { if (!ok) toast("Fullscreen was blocked by the browser"); dlog("fullscreen", ok, Stage.isFullscreen()); renderFs(); });
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
  if (params.has("speed")) V.speed = V.lastSpeed = +params.get("speed") || 1;
  const play = params.get("play");
  if (play === "campaign" || play === "sandbox") start(seed, { sandbox: play === "sandbox" });
  else showMenu(false);
  /* console / test hook. ff(days) fast-forwards and stops at the next chapter unlock or game end. */
  window.__game = {
    get S() { return S; }, V, act, start, showMenu, openDrawer, closeDrawer, renderAll,
    ff(days) {
      const target = S.day + days, ch0 = S.chapter;
      while (!S.over && S.day < target - 1e-9) { Sim.advance(S, Math.min(1, target - S.day)); if (S.chapter !== ch0) break; }
      renderAll(); afterTick();
      return { day: S.day, chapter: S.chapter, over: S.over };
    },
    perf: V.perf,
  };
  requestAnimationFrame(frame);
})();
