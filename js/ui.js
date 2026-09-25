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
  const SAVE_KEY = "halcyon.save.v2", META_KEY = "halcyon.meta.v2", SLOT_KEY = n => `halcyon.slot.${n}`, SET_KEY = "halcyon.settings", KF_KEY = "halcyon.kindFilter";
  /* every user-visible string goes through L(key, params) = I18N.t (js/i18n.js + js/i18n/*.js dictionaries, docs/I18N.md) */
  const I18 = window.I18N;
  const L = window.L || ((k, p) => k);
  /* sim text is language-neutral (I2): check() results, news and cash events carry a key + params; old saves fall back to English */
  const chk = res => (res && res.k && I18 && I18.has(res.k) ? L(res.k, res.p) : res ? res.msg : "");
  const newsT = n => (n.k && I18 && I18.has(n.k + ".t") ? L(n.k + ".t", n.p) : n.title);
  const newsB = n => (n.k && I18 && I18.has(n.k + ".b") ? L(n.k + ".b", n.p) : n.body || "");
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
  /* auto-pause (v0.4.2 hotfix, player: "每次出新的合同都自动暂停"): by default only cash < 0 pauses (chapter cards and the
     runway warnings are modal and stop time on their own) plus ONE teaching pause on the very first new offer ever
     (`apFirstDone`). Offer / failure / SLA pauses are opt-in in Settings. AP_V bumps migrate old saved settings once. */
  const AP_V = 2, AP_DEFAULT = { offer: false, fail: false, cash: true, sla: false };
  const SET_DEFAULT = { master: 1, sfx: 1, hum: 1, reduced: null, cb: false, scale: 1, ap: Object.assign({}, AP_DEFAULT), apTouched: false, apV: AP_V, apFirstDone: false, campaigns: 0 };
  let SET = JSON.parse(JSON.stringify(SET_DEFAULT));
  try {
    const raw = JSON.parse(localStorage.getItem(SET_KEY) || "null");
    if (raw) {
      SET = Object.assign(SET, raw, { ap: Object.assign({}, SET.ap, raw.ap || {}) });
      if (!(raw.apV >= AP_V)) {          // saved before the bump: the old "everything on" default goes, whatever it was
        SET.ap = Object.assign({}, AP_DEFAULT); SET.apTouched = false; SET.apV = AP_V;
        SET.apFirstDone = !!(raw.campaigns || raw.taught);   // a returning player has already seen offers arrive
        try { localStorage.setItem(SET_KEY, JSON.stringify(SET)); } catch (e) { /* storage blocked */ }
      }
    }
  } catch (e) { /* storage blocked */ }
  function saveSettings() { try { localStorage.setItem(SET_KEY, JSON.stringify(SET)); } catch (e) { /* storage blocked */ } }
  const PACE_ON = params.get("pace") !== "0";      // ?pace=0 turns the ghost off (A/B frame-time measurement)
  /* the pace chip compares you with the HUMAN-PACED bots (Casual = humanized greedy, Expert = humanized planner); the
     full-speed greedy/planner are measurement tools and are not shown to players (UI_BACKLOG bug 5) */
  const PACE_POLS = ["casual", "expert"];
  const BOTNAME = k => (window.I18N && I18N.has("bot." + k) ? L("bot." + k) : (window.Bots && Bots.LABELS && Bots.LABELS[k]) || k);
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
    web:   { name: L("role.web"),   color: COL.web, icon: "globe" },
    train: { name: L("role.train"), color: COL.train, icon: "brain" },
    infer: { name: L("role.infer"), color: COL.infer, icon: "bubble" },
    net:   { name: L("role.net"),   color: COL.net, icon: "switch" },
    cool:  { name: L("role.cool"),  color: COL.cool, icon: "snow" },
    tank:  { name: L("role.tank"),  color: COL.tank, icon: "drop" },
    empty: { name: L("role.empty"), color: "transparent", icon: "plus" },
  });
  let R = ROLE();
  const ITEM_COLOR = it => it.role === "cpu" ? COL.web : it.role === "net" ? COL.net : it.role === "cool" ? COL.cool
    : it.role === "mem" ? COL.mem : it.role === "exotic" ? COL.tank : it.fam === "C" ? COL.train : COL.infer;
  const MODE_ICON = { eco: "leaf", std: "gauge", boost: "rocket", off: "power" };
  const KIND = { web: ["globe", "web"], infer: ["bubble", "infer"], train: ["brain", "train"], frontier: ["star", "frontier"], bts: ["building", "contract"] };
  const kindOf = o => QOL.kindOf(o);
  const MAP_MODES = [
    { key: "role", icon: "layers", ch: "racks" }, { key: "power", icon: "bolt", ch: "power" }, { key: "heat", icon: "temp", ch: "heat" },
    { key: "gen", icon: "clock", ch: "gens" }, { key: "fail", icon: "cross", ch: "ops" }, { key: "cluster", icon: "net", ch: "fabric" },
    { key: "free", icon: "plus", ch: "racks" },
  ];
  const modeLabel = k => L("map." + k);
  const ramps = () => ({ heat: [COL.cold, COL.mid, COL.hot], power: [COL["pow-lo"], COL.pow, COL["pow-hi"]], free: [COL["free-lo"], COL.good, COL["free-hi"]],
    fail: [COL["haz-lo"], COL["haz-mid"], COL["haz-hi"]] });
  const CUST_ICON = { flask: "flask", cart: "cart", heart: "heart", play: "film", robot: "robot", globe: "globe", bank: "bank", game: "game" };
  const NEWS_CAT = {
    hardware: ["chip"], ops: ["wrench"], market: ["trend"], contracts: ["hand"], memory: ["layers"], energy: ["bolt"], facilities: ["building"],
    environment: ["drop"], investors: ["pie"], press: ["news"], policy: ["flag"], vendor: ["rocket"], general: ["globe"],
  };
  const catLabel = k => L("cat." + k);
  /* per-chapter card: 3 bullets (i18n keys ch.<key>.1..3), one icon each; ch.<key>.where = where the new UI lives (behind ⓘ) */
  const CH_META = {
    racks: { icons: ["hand", "switch", "power"], col: "web" }, power: { icons: ["bolt", "sun", "gauge"], col: "pow" },
    gpu: { icons: ["chip", "brain", "doc"], col: "train" }, heat: { icons: ["sun", "flame", "snow"], col: "hot" },
    gens: { icons: ["clock", "trend", "doc"], col: "warn" }, ops: { icons: ["cross", "person", "box"], col: "fail" },
    fabric: { icons: ["switch", "star", "globe"], col: "frontier" }, contracts: { icons: ["building", "coin", "warn"], col: "contract" },
    memory: { icons: ["layers", "news", "lock"], col: "mem" }, finance: { icons: ["bank", "tag", "coin"], col: "debt" },
    facilities: { icons: ["building", "bolt", "snow"], col: "info" }, energy: { icons: ["trend", "leaf", "sun"], col: "carbon" },
    environment: { icons: ["drop", "snow", "warn"], col: "water" }, investors: { icons: ["coin", "flag", "pie"], col: "vc" },
    reputation: { icons: ["star", "warn", "news"], col: "rep" }, policy: { icons: ["flag", "news", "bank"], col: "bad" },
    disrupt: { icons: ["rocket", "gauge", "tag"], col: "tank" },
  };
  const chTitle = c => L("ch." + c.key + ".t");
  const chBullets = c => [1, 2, 3].map(i => L(`ch.${c.key}.${i}`));
  /* hardware names: GPUs keep their product names; generic parts are translated (it.<key>); short = the last word */
  const itName = k => (I18 && I18.has("it." + k) ? L("it." + k) : (S && S.items[k] ? S.items[k].name : k));
  const itShort = k => { const n = itName(k); return /\s/.test(n) ? n.split(" ").pop() : n; };

  /* ================= helpers ================= */
  const icon = (id, style) => `<svg class="i"${style ? ` style="${style}"` : ""}><use href="#${id}"/></svg>`;
  const money = k => { const a = Math.abs(k), sg = k < 0 ? "−" : ""; return a >= 1000 ? `${sg}$${(a / 1000).toFixed(2)}M` : `${sg}$${Math.round(a)}k`; };
  const UPD = () => L("u.pd");   // "/d" · "/天"
  const perDay = k => `${k >= 0 ? "+" : "−"}$${Math.abs(k).toFixed(1)}k${UPD()}`;
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
  const dateOf = day => I18.date(day);
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
    return `<svg viewBox="0 0 100 100" role="img" aria-label="${esc(L("fin.own", { p: pct(own) }))}"><circle cx="50" cy="50" r="44" fill="${COL.vc}" opacity=".35"/>${slice}<text x="50" y="56" text-anchor="middle" class="v" style="font-size:17px;fill:var(--white)">${pct(own)}</text></svg>`;
  }

  /* ============ action buttons: every button that changes the game goes through Sim.check / act ============ */
  const CONFIRM_MS = 4000;
  function actBtn(a, label, opts) {
    opts = opts || {};
    const key = JSON.stringify(a), res = Sim.check(S, a);
    const armed = opts.confirm && V.confirm === key && performance.now() - V.confirmT < CONFIRM_MS;
    const cls = ["btn", opts.cls || "", armed ? "confirm" : "", res.ok ? "" : "dim"].join(" "), why = chk(res);
    // unaffordable / invalid = rendered disabled (dim, price red via CSS, aria-disabled, the reason as tooltip); a click still
    // reaches act(), which refuses it with show-not-tell feedback. refreshAfford() re-checks these live as cash moves.
    return `<button class="${cls}" data-act='${esc(key)}' data-afford${opts.confirm ? " data-confirm" : ""} title="${esc(why)}"${res.ok ? "" : ' aria-disabled="true"'}${!label && opts.title ? ` aria-label="${esc(opts.title)}"` : ""}>${opts.icon ? icon(opts.icon) : ""}${armed ? L("btn.again", { x: label || opts.title || "" }) : label}</button>`;
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
    if (!st) { nope(L("fb.noSave"), $("m-continue")); return; }
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
    toast(`${L("fb.welcome")} · ${dateOf(S.day)}`);
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
    if (!res.ok) { TELE.action(S.day, a, false, res.msg); nope(res, opts.src, a); dlog("rejected", a, res.msg); return false; }
    const cash0 = S.cash;
    const wl = wlDefault(a);
    if (wl) { TELE.action(S.day, wl, true); Sim.apply(S, wl); dlog("workload default", wl); }
    const pre = UNDO && !opts.noUndo ? QOL.undoPre(S, a) : null;
    TELE.action(S.day, a, true);
    Sim.apply(S, a);
    if (pre) { const e = QOL.undoEntry(pre, a, S); if (e) { if (opts.group) e.group = opts.group; UNDO.push(e); dlog("undo push", e.kind, a.type, opts.group || ""); } }
    if ((a.type === "buy" || a.type === "lease") && a.item) { V.lastOrder = { type: a.type, item: a.item }; if (!SET.taught) taught(a.type); }
    V.cashSeen = S.cashSeq || 0;      // the player's own action explains its cash change and any event it caused (its toast says so)
    V.flowPrev = { cash: S.cash, flow: S.totals.flow || 0 };
    const d = S.cash - cash0;
    if (Math.abs(d) > 0.5) flashCash(d);
    if (a.to) V.selected = a.to; else if (a.rack && !["sell", "store", "returnLease"].includes(a.type)) V.selected = a.rack;
    if (["sell", "store", "returnLease"].includes(a.type) || (a.type === "repair" && false)) V.selDev = null;
    V.confirm = null;
    dlog("action", a, res.msg);
    sr(chk(res));
    if ((a.type === "buy" || a.type === "lease") && a.item) {
      const it = item(a.item);
      if (a.type === "buy" && FXON() && !opts.quiet) fxAtRack(a.rack, c => FX.floatText(c.x, c.top, `−${money(it.price)}`, "#FF8466", 15));
    } else if (!opts.quiet && !QUIET_ACTS.has(a.type)) toast(chk(res));
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
  /* m = a Sim.check result ({msg, k, p, code}) or a plain (already translated) string */
  function nope(m, el, a) {
    const obj = m && typeof m === "object", msg = obj ? m.msg : m;
    const why = obj && m.code ? m.code : QOL ? QOL.reason(msg) : "other";
    SND("bonk", null, 110);
    sr(obj ? chk(m) : msg);
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
    $("undo-msg").textContent = `${item(j.dev.type).name} → ${j.to}`;
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
    const newOffer = S.offers.some(o => !prev.offers.has(o.id));
    if (newOffer && !ap.offer && !SET.apFirstDone && !S.sandbox) { why = "offer"; el = $("offerstrip"); SET.apFirstDone = true; saveSettings(); }   // one teaching pause, ever
    else if (ap.offer && newOffer) { why = "offer"; el = $("offerstrip"); }
    else if (ap.fail && failed > prev.failed) { why = "fail"; el = $("alertbtn"); }
    else if (ap.cash && now.neg && !prev.neg) { why = "cash"; el = $("h-cashchip"); }
    else if (ap.sla && miss && !prev.miss) { why = "sla"; el = $("offerstrip"); }
    if (!why) return;
    setSpeed(0);
    pulse(el, "fx-attn", 1400);
    pulse(document.querySelector('.speed [data-speed="0"]'), "fx-attn", 1400);
    sr(L("fb.paused", { why: L("ap." + why) }));
    TELE.event(S.day, "autopause", { why });
    dlog("[autopause]", why);
  }

  /* v0.4.2 (telemetry: customers walked with nothing obvious before it): a contract that newly drops below its SLA pulses
     its pill and the alert bell with a warning sound, once per miss streak; no pause (auto-pause SLA is opt-in) */
  function slaWatch(st) {
    if (!S || S.over || V.slaDay === S.day) return;
    V.slaDay = S.day;
    const now = new Set(Object.keys(st.cMiss || {}).filter(k => st.cMiss[k] > 1e-6)), prev = V.slaSeen;
    V.slaSeen = now;
    if (!prev) return;
    const fresh = [...now].filter(id => !prev.has(id));
    if (!fresh.length) return;
    for (const id of fresh) pulse(document.querySelector(`#offerstrip .cpill[data-contract="${id}"]`), "fx-attn", 1400);
    pulse($("alertbtn"), "fx-attn", 1400);
    SND("warn", null, 1500);
    dlog("[sla] below SLA", fresh.join(","));
  }
  /* v0.4.2 (telemetry: the player never left 1x): after 60 real seconds of running at 1x, the 2x/4x buttons pulse once and
     a key hint shows for 6 s. Once per player (SET.speedHint); using any faster speed also retires it. */
  function speedHint(dt) {
    if (!S || S.over || SET.speedHint) return;
    if (V.speed > 1) { SET.speedHint = true; saveSettings(); return; }
    if (V.speed !== 1 || !running()) return;
    V.t1x = (V.t1x || 0) + dt;
    if (V.t1x < SPEED_HINT_S) return;
    SET.speedHint = true; saveSettings();
    for (const v of ["2", "4"]) pulse(document.querySelector(`.speed [data-speed="${v}"]`), "fx-hint", 4200);
    const h = $("speedhint");
    if (h) { h.hidden = false; setTimeout(() => { h.hidden = true; }, 6000); }
    TELE.event(S.day, "speedHint", { t: Math.round(V.t1x) });
    dlog("[speed] hint shown after", Math.round(V.t1x), "s at 1x");
  }
  const SPEED_HINT_S = 60;

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
      const why = chk(res);
      if (b.hasAttribute("data-afford")) { if (b.title !== why) b.title = why; }
      else { if (b._t0 == null || b._lang !== I18.lang) { b._t0 = b.title || ""; b._lang = I18.lang; } const t = dim && !b.hasAttribute("data-keep-title") ? `${b._t0}${b._t0 ? " · " : ""}${why}` : b._t0; if (b.title !== t) b.title = t; }
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
        slaWatch(st);
        speedHint(dtSec);
        refreshAfford();
        if (now - V.alertsT > 500) { V.alertsT = now; renderAlerts(st); teachTick(); }
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
      if (hot.length) toast(newsT(hot[0]), true);
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
        if (m.width && m.bottom > 0 && m.top < innerHeight) FX.floatText(m.left + m.width / 2, m.top + m.height / 2, L("fx.gen", { g: N.gen }), "#FF8466", 18);
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
      toast(`★ ${label}`, true);
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
      toast(L("fx.finalQ")); SND("drum", 0);
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
    const tt = L("tip.cash", { floor: money(floor), peak: money(V.cashPeak) }); if (chip.title !== tt) chip.title = tt;
  }
  /* quarter tally card: revenue − costs = profit, ticking up; display only, pointer-events none */
  let qcardT;
  function quarterCard(Q) {
    const el = $("qcard"); if (!el || !Q) return;
    const rev = Q.web + Q.train + Q.infer + Q.frontier + Q.contracts;
    const cost = Q.power + Q.upkeep + Q.salaries + Q.transit + Q.interest + Q.lease + Q.water + Q.diesel + Q.carbonTax + Q.fines + Q.penalties + Q.repairs + Q.other + Q.tax;
    const profit = rev - cost, q = Q.q;
    el.innerHTML = `<div class="qh">${icon("trend")}${esc(L("q.closed", { q: q % 4 + 1, y: Math.floor(q / 4) + 1 }))}</div>
      <div class="qr"><span>${L("q.rev")}</span><b style="color:var(--hud-good)">+${money(rev)}</b></div><div class="qr"><span>${L("q.cost")}</span><b style="color:var(--hud-bad)">−${money(cost)}</b></div>
      ${Q.tax > 0.5 ? `<div class="qr"><span>${L("q.tax")}</span><b style="color:var(--hud-bad)">−${money(Q.tax)}</b></div>` : ""}<div class="qr qp"><span>${L("q.profit")}</span><b id="qcard-p">$0k</b></div>`;
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
    rate.textContent = perDay(st.net) + (proj ? `  →  ${perDay(proj.net)}` : "") + (rw && rw.days < 180 ? ` · ⚠${L("u.days", { d: Math.round(rw.days) })}` : "");
    rate.style.color = (proj || st).net >= 0 ? COL.hudGood : COL.hudBad;
    rate.title = rw ? L("tip.runway", { r: perDay(rw.net), f: money(bankruptFloor()), d: Math.round(rw.days) }) : "";
    // technicians
    const busy = Sim.busyTechs(S), waiting = S.jobs.filter(j => j.phase === "wait").length, ops = on("ops");
    const nT = ops ? S.techs : K.TECHS;
    $("h-techs").innerHTML = `${icon("wrench")}<div><div class="pips">${Array.from({ length: nT }, (_, i) => `<b class="${i >= busy ? "on" : ""}"></b>`).join("")}${ops ? S.hires.map(() => `<b class="hire"></b>`).join("") : ""}</div>${waiting ? `<small>+${waiting}</small>` : ""}</div>`;
    $("h-techs").classList.toggle("click", ops);
    $("h-techs").title = L("tip.techs") + (waiting ? " · " + L("tip.queued", { n: waiting }) : "") + (ops ? " · " + L(S.repairAuto ? "c.autoRepOn" : "c.autoRepOff") : "");
    // date
    const qi = Math.floor(S.day / 90), se = st.se;
    const sIcon = se.name === "winter" ? "snow" : "sun", sCol = se.name === "summer" ? "#FFB054" : se.name === "winter" ? "#8FC4FF" : "#C9D86A";
    const quarters = K.END_DAY / 90;
    $("h-when").innerHTML = `${icon(sIcon, `color:${sCol}`)}<div><span class="big">${dateOf(S.day)}</span>${V.speed === 0 ? `<span class="pausedtag" title="${esc(L("hud.paused"))}">${icon("pause")}</span>` : ""}<div class="timeline">${Array.from({ length: quarters }, (_, i) => `<i class="${i < qi ? "past" : i === qi ? "now" : ""}"></i>`).join("")}</div></div>`;
    $("h-when").title = L("tip.when", { s: L("season." + se.name), d: Math.floor(S.day), n: K.END_DAY });
    // power
    const pw = $("h-power");
    barChip(pw, "bolt", COL.pow, st.kw, S.gridKw, "kW", proj && proj.kw, false);
    pw.title = L("tip.power", { now: st.kw.toFixed(0), all: Sim.gridKwAll(S).toFixed(0), grid: S.gridKw });
    pw.classList.toggle("lockmask", !on("power"));
    // heat: the hottest hall
    const ht = $("h-heat");
    let hot = st.halls[0];
    for (const h of st.halls) if (h.roomT > hot.roomT) hot = h;
    const tProj = proj ? Math.max(...proj.halls.map(h => h.roomT)) : null;
    barChip(ht, "temp", COL.hudBad, hot.roomT, K.T_LIMIT, "°C", tProj, hot.roomT > K.T_LIMIT - 1.5, v => v.toFixed(1));
    ht.classList.toggle("near", on("heat") && hot.roomT > K.T_LIMIT - 3.5 && hot.roomT <= K.T_LIMIT - 1.5);   // gauge glows before the limit
    const arrow = hot.tTarget > hot.roomT + 0.1 ? "rising" : hot.tTarget < hot.roomT - 0.1 ? "falling" : "steady";
    ht.title = st.halls.map(h => L("tip.heatHall", { n: h.n, t: h.roomT.toFixed(1), to: h.tTarget.toFixed(1), kw: h.heatCap.toFixed(0) })).join("\n") + "\n" + L("tip.heat", { a: L("trend." + arrow), t: K.T_LIMIT });
    ht.classList.toggle("lockmask", !on("heat"));
    // transit
    const tr = $("h-transit");
    show(tr, on("fabric"));
    if (on("fabric")) {
      const need = transitNeed(st), cap = S.transit + K.TRANSIT_FREE;
      barChip(tr, "globe", "#8FC4FF", need, cap, "", null, need > cap + 1e-6, v => v.toFixed(v < 10 ? 1 : 0));
      tr.title = L("tip.transit", { need: need.toFixed(1), cap, free: K.TRANSIT_FREE });
    }
    // debt
    const db = $("h-debt");
    show(db, on("finance"));
    if (on("finance")) {
      const lim = Math.max(0, K.LOAN_LTV * Sim.netWorth(S));
      db.innerHTML = `${icon("bank", `color:${COL.debt}`)}<div><span class="big">${money(S.debt)}</span><div class="bar"><i style="width:${Math.min(100, S.debt / Math.max(1, lim) * 100)}%;background:${COL.debt}"></i></div></div>`;
      db.title = L("tip.debt", { x: money(S.debt), lim: money(lim), r: K.INTEREST * 100 });
    }
    // reputation
    const rp = $("h-rep");
    show(rp, on("reputation"));
    if (on("reputation")) {
      const rv = Sim.repOf(S), stars = Math.round(rv / 20);
      rp.innerHTML = `${icon("star", `color:${COL.rep}`)}<div><span class="big">${Math.round(rv)}</span><div class="gauge" style="color:${COL.rep}">${Array.from({ length: 5 }, (_, i) => `<b class="${i < stars ? "on" : ""}"></b>`).join("")}</div></div>`;
      rp.title = L("tip.rep", { x: rv.toFixed(1) });
      rp.classList.toggle("warnchip", S.day < S.scandalUntil);
    }
    // carbon
    const cb = $("h-carbon");
    show(cb, on("environment"));
    if (on("environment")) {
      cb.innerHTML = `${icon("leaf", `color:${COL.carbon}`)}<div><span class="big">${st.carbon.toFixed(1)}</span> <small>${L("u.tpd")}</small><div class="bar"><i style="width:${Math.round(st.green * 100)}%;background:${COL.carbon}"></i></div></div>`;
      cb.title = L("tip.carbon", { x: st.carbon.toFixed(2), tot: Math.round(S.env.carbon), g: pct(st.green) });
    }
    // equity
    const eq = $("h-equity");
    show(eq, on("investors"));
    if (on("investors")) {
      eq.innerHTML = `${icon("pie", `color:${COL.equity}`)}<div><span class="big">${Math.round(S.equity.own * 100)} %</span></div>`;
      eq.title = L("tip.equity", { p: (S.equity.own * 100).toFixed(1) });
    }
    // score
    const sc = Sim.score(S);
    $("h-score").innerHTML = `${icon("flag", "color:var(--sel)")}<div><span class="big">${money(sc - V.scoreOff)}</span></div>`;
    renderPace(sc);
    $("h-score").title = L(on("investors") ? "tip.scoreVc" : "tip.score") + " · " + L("tip.worth", { x: money(Sim.netWorth(S)) });
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
    /* text diet: a banner = icon + a short title + a countdown; the explanation lives in its tooltip */
    const left = x => L("u.days", { d: Math.max(0, Math.ceil(x.until - S.day)) });
    if (on("facilities") && S.outage && S.day >= S.outage.start) B.push(S.ups ? ["warn", "bolt", L("ban.ups"), L("ban.upsSub"), left(S.outage)]
      : ["bad", "bolt", L("ban.outage"), L("ban.outageSub"), left(S.outage)]);
    if (S.heatWave && S.day >= S.heatWave.start) B.push(["bad", "temp", L("ban.heat", { x: S.heatWave.mult }), L("ban.heatSub", { kw: K.HEATWAVE_COOL }) + (S.solar ? " " + L("ban.solar") : ""), left(S.heatWave)]);
    if (on("environment") && S.drought && S.day >= S.drought.start) B.push(["warn", "drop", L("ban.drought"), L("ban.droughtSub"), left(S.drought)]);
    if (on("memory") && S.hbm.shortage) B.push(["warn", "layers", L("ban.hbm"), L("ban.hbmSub", { d: K.SHORT_SHIP_DAYS }), `×${S.hbm.index.toFixed(2)}`]);
    if (S.board && S.board.misses === 1) B.push(["bad", "flag", L("ban.board"), L("ban.boardSub"), L("u.days", { d: Math.ceil(S.board.end - S.day) })]);
    if (S.policyFx.mandate && S.day < S.policyFx.mandate.deadline + 1 && st.halls.some(h => h.pue > K.MANDATE_PUE + 1e-9))
      B.push(["warn", "flag", L("ban.mandate", { x: K.MANDATE_PUE }), L("ban.mandateSub", { x: K.MANDATE_PUE }), L("u.days", { d: Math.max(0, Math.ceil(S.policyFx.mandate.deadline - S.day)) })]);
    // v0.4.5: banners are compact chips on the goal row (one line in total, never stacking; the floor keeps the height)
    $("banners").innerHTML = B.map(([cls, ic, t, sub, right]) => `<span class="banner ${cls}" title="${esc(t + " · " + sub + " · " + right)}">${icon(ic)}<span>${esc(t)}</span><span class="t">${esc(right)}</span></span>`).join("");
  }

  /* goal banner (text diet: ≤ 6 words): the current chapter + the next unlock and its milestone; details in tooltips.
     The chapter's lesson lives in its card (reopen with ?) */
  function renderGoal(st) {
    const left = K.END_DAY - Math.floor(S.day);
    const ni = Sim.nextChapter(S), nc = ni != null ? CH[ni] : null;
    const next = S.sandbox ? `<span class="nextch">${esc(L("menu.sandbox"))}</span>` : nc ? `<span class="nextch" title="${esc(L("goal.next"))}: ${esc(chTitle(nc))} · ${esc(L("ch." + nc.key + ".hint"))}${S.day < nc.day ? ` (${esc(L("goal.nextFrom", { d: nc.day }))})` : ""}">${icon("lock")}<span>${esc(L("ch." + nc.key + ".hint"))}</span></span>`
      : `<span class="nextch">${icon("check")}</span>`;
    $("goal").innerHTML = `<span class="gflag">${icon("flag", "color:var(--c-warn)")}</span><b>${esc(chTitle(CH[S.chapter]))}</b>${next}`;
    $("goal").title = L("tip.daysLeft", { d: left });
  }

  function renderHallTabs() {
    const el = $("halltabs");
    if (!on("facilities") && builtHalls().length < 2) { el.innerHTML = ""; return; }
    const hj = S.jobs.find(j => j.kind === "buildHall");
    el.innerHTML = S.halls.map(h => {
      const n = h.n, built = h.built;
      const sub = built ? `${hallRacks(n).filter(r => r.devices.length).length}/${K.HALL_RACKS}` : hj && hj.hall === n ? L("u.days", { d: Math.ceil(hj.left) }) : icon("lock");
      return `<button data-hall="${n}" aria-pressed="${V.hall === n}">${icon("building")}${esc(L("hall.n", { n }))} <small>${sub}</small></button>`;
    }).join("");
  }

  function renderModes() {
    const el = $("modes");
    const ms = MAP_MODES.filter(m => on(m.ch));
    if (!ms.some(m => m.key === V.mode)) V.mode = "role";
    el.innerHTML = ms.map(m => `<button data-mode="${m.key}" aria-pressed="${V.mode === m.key}" title="${esc(L("map.tip", { m: modeLabel(m.key) }))}" aria-label="${esc(modeLabel(m.key))}">${icon(m.icon)}<span class="mlab">${esc(modeLabel(m.key))}</span></button>`).join("");
    renderLegend();
  }
  function renderLegend() {
    const LG = $("legend"), RP = ramps();
    const keys = list => `<div class="keys">${list.map(([c, n]) => `<span><i style="background:${c}"></i>${n}</span>`).join("")}</div>`;
    if (V.mode === "role") LG.innerHTML = keys(["web", "train", "infer", "tank"].filter(k => k !== "tank" || on("disrupt")).filter(k => k === "web" || on("gpu")).map(k => [R[k].color, R[k].name]));
    else if (V.mode === "gen") LG.innerHTML = keys([[COL.good, L("leg.cur")], [COL.warn, "−1"], [COL.bad, "−2"]]);
    else if (V.mode === "cluster") LG.innerHTML = keys([0, 1, 2].map(i => [COL["row" + i], builtHalls().map(n => hallLetters(n)[i]).join("/")]).concat([[COL.none, "—"]])) + `<span title="${esc(L("leg.frontier", { n: K.FRONTIER_MIN_GPUS }))}">${icon("star", `color:${COL.frontier};width:14px;height:14px`)} ${K.FRONTIER_MIN_GPUS}+</span>`;
    else {
      const lab = { heat: ["22 °C", "36 °C"], power: ["0 kW", "30 kW"], free: ["0U", "20U"], fail: ["0", "1 %/d"] }[V.mode];
      LG.innerHTML = `<span>${lab[0]}</span><span class="ramp" style="background:linear-gradient(90deg,${RP[V.mode].join(",")})"></span><span>${lab[1]}</span>${V.mode === "fail" ? `<span title="${esc(L("leg.failed"))}">${icon("cross", `color:${COL.fail};width:14px;height:14px`)}</span>` : ""}`;
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
    if (j.phase === "ship") return [icon("truck"), `${L("u.days", { d: Math.ceil(j.left) })}`];
    if (j.phase === "parts") return [icon("box"), `${L("u.days", { d: Math.ceil(j.left) })}`];
    if (j.phase === "wait") return [icon("wrench"), "…"];
    return [icon("wrench"), `${L("u.days", { d: Math.ceil(j.left) })}`];
  }

  /* placeholder for a hall that is not built yet: cost/days from the sim, one generic build button */
  function unbuiltHallHTML(n) {
    const hj = S.jobs.find(j => j.kind === "buildHall"), hc = Sim.hallCost(n), HLs = hallLetters(n);
    const body = hj && hj.hall === n ? `<span>${icon("clock")} ${L("u.days", { d: Math.ceil(hj.left) })}</span><div class="bar"><i style="width:${Math.round((1 - jobFrac(hj)) * 100)}%"></i></div>`
      : hj ? `<span title="${esc(L("hall.oneAtATime"))}">${icon("building")} ${esc(L("hall.n", { n: hj.hall }))} · ${L("u.days", { d: Math.ceil(hj.left) })}</span>`
      : `<span>+${K.HALL_RACKS} ${icon("cpu")} · ${HLs[0]}1–${HLs[2]}${K.COLS} · ${L("u.days", { d: hc.days })}</span>${n > 1 && !S.halls[n - 2].built ? `<span class="sub">${icon("lock")} ${esc(L("hall.n", { n: n - 1 }))}</span>` : ""}${actBtn({ type: "buildHall", hall: n }, `${esc(L("hall.build", { n }))} · ${money(hc.cost)}`, { confirm: true, cls: "primary", icon: "building" })}`;
    return `<div class="hall2">${icon("building", "width:40px;height:40px")}<span class="big">${esc(L("hall.n", { n }))}</span>${body}</div>`;
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
    // text diet: aisles and room units are icons; their names live in the tooltips
    [[1, "cold"], [3, "hot"], [5, "cold"], [7, "hot"]].forEach(([row, k]) =>
      h += `<div class="aisle ${k}" style="grid-row:${row}" title="${esc(L("floor." + k))}">${icon(k === "cold" ? "snow" : "flame")}</div>`);
    const hall = S.halls[V.hall - 1];
    [2, 4, 6].forEach((row, k) => h += `<div class="crac" style="grid-row:${row}" title="${esc(L("floor.crac", { n: k + 1 }) + (hall.crac ? " +" : ""))}">${icon("snow")}${hall.crac ? "<span>+</span>" : ""}</div>`);
    // grid / hall summary column
    const hs = st.halls.find(x => x.n === V.hall);
    const g = Sim.gridNext(S), gridJob = S.jobs.find(j => j.kind === "grid");
    const gridBody = gridJob ? `<span>${icon("wrench")} ${L("u.days", { d: Math.ceil(gridJob.left) })}</span>`
      : g && on("power") ? actBtn({ type: "grid" }, `${g.kw} kW · ${money(g.cost)}`, { confirm: true, cls: "primary", icon: "bolt" }) : `<span>${S.gridTier ? icon("check") : ""}</span>`;
    h += `<div class="hall" title="${esc(L("floor.grid"))}">${icon("bolt", "width:26px;height:26px;color:var(--pow-c)")}<span>${st.kw.toFixed(0)} / ${S.gridKw} kW</span>${gridBody}
      ${hs ? `<span style="margin-top:6px">${icon("temp")} ${hs.roomT.toFixed(1)} °C</span><span title="${esc(L("cool." + hs.cooling))}">${icon(hs.cooling === "evap" ? "drop" : "snow")}${on("environment") ? ` PUE ${hs.pue}` : ""}</span>` : ""}</div>`;
    // spine slots at row ends, each with the row's frontier-cluster meter (P1: "6/12 and nothing happens" was invisible)
    for (let row = 0; row < 3; row++) {
      const key = `${V.hall}-${row}`, pos = `grid-row:${[2, 4, 6][row]}`;
      if (!on("fabric")) { h += `<div class="spine locked" style="${pos}"></div>`; continue; }
      const job = S.jobs.find(j => j.kind === "spine" && j.key === key), cl = st.cluster[key];
      const cm = clusterMeter(V.hall, row, st), meter = `<span class="cmeter${cm.n >= K.FRONTIER_MIN_GPUS ? " full" : ""}"><i style="width:${Math.round(cm.f * 100)}%"></i></span><span class="cnum">${cm.n}/${K.FRONTIER_MIN_GPUS}</span>`;
      if (S.spines[key]) h += `<div class="spine built${cl && cl.frontier ? " frontier" : ""}" style="${pos}" data-spine="${key}" title="${esc(cm.tip)}">${icon(cl && cl.frontier ? "star" : "switch", cl && cl.frontier ? `color:${COL.frontier}` : "")}${meter}${cl && cl.frontier ? `<span>×${K.FRONTIER_PRICE}</span>` : ""}</div>`;
      else if (job) h += `<div class="spine" style="${pos}" title="${esc(L("spine.building"))} ${esc(cm.tip)}">${icon("wrench")}<span>${L("u.days", { d: Math.ceil(job.left) })}</span><span class="prog"><i style="width:${Math.round((1 - jobFrac(job)) * 100)}%"></i></span>${meter}</div>`;
      else {
        const k2 = JSON.stringify({ type: "spine", hall: V.hall, row }), armed = V.confirm === k2 && performance.now() - V.confirmT < CONFIRM_MS;
        h += `<button class="spine${V.armed && V.armed.kind === "spine" ? " armed-target" : ""}" style="${pos}" data-spine="${key}" data-act='${esc(k2)}' data-confirm title="${esc(L("spine.tip", { x: money(K.SPINE_COST), d: K.SPINE_DAYS, kw: K.SPINE_KW }))} ${esc(cm.tip)}">${icon(armed ? "check" : "plus")}${armed ? `<span>${money(K.SPINE_COST)}</span>` : cm.n ? meter : ""}</button>`;
      }
    }
    for (const r of hallRacks(V.hall)) {
      const row = [2, 4, 6][r.row], col = r.col + 2;
      const role = rackRole(r), free = K.RACK_U - Sim.usedU(S, r), job = jobFor(r.id), pr = st.perRack[r.id];
      const pos = `grid-row:${row};grid-column:${col}`;
      const prog = job ? `<span class="prog" data-prog="${r.id}">${progInner(job)}</span>` : "";
      const tgt = V.armed ? " armed-target" : "", ms = V.multi.has(r.id) ? " msel" : "";
      if (role === "empty" || (r.tank && !r.devices.length && !r.pending.length)) {
        h += `<button class="rack empty${r.tank ? " tank" : ""}${tgt}${ms}" style="${pos}" data-rack="${r.id}" aria-pressed="${r.id === V.selected}" aria-label="${r.id}: ${esc(L(r.tank ? "rack.emptyTank" : "role.empty"))}, ${free}U"><span class="plus">${icon(r.tank ? "drop" : "plus")}</span>${prog}</button>`;
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
      const tip = [`${r.id}: ${R[role].name}`, perDay(pr.rev), `${pr.kw.toFixed(1)} kW`, `${pr.inlet.toFixed(1)} °C`, `${free}U`, nosw ? L("alert.nosw") : "",
        r.mode === "off" ? L("mode.off") : idle ? L("rack.idle") : "", pr.netF < 1 && !nosw ? `${L("role.net")} ${Math.round(pr.netF * 100)} %` : "",
        pr.throttle < 1 ? `${L("alert.hot")} ${Math.round(pr.throttle * 100)} %` : "", nFail ? `${L("alert.fail")} ×${nFail}` : "", nLease ? `${L("fin.leased")} ×${nLease}` : ""].filter(Boolean).join(" · ");
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
        <span class="flags">${flags.map(f => icon(f, f === "star" ? `color:${COL.frontier}` : f === "tag" ? `color:${COL.lease}` : "")).join("")}</span><span class="id">${r.id}</span>
        ${nFail ? `<span class="xmark" title="${esc(L("alert.fail"))} ×${nFail}">${icon("cross")}</span>` : ""}${nosw ? `<span class="noswitch" aria-hidden="true">${icon("unplug")}</span>` : ""}${r.mode === "off" ? `<span class="offmark" aria-hidden="true">${icon("power")}</span>` : ""}${links}${prog}</button>`;
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
    const tip = L("cl.tip", { r: RL, n, need, x: K.FRONTIER_PRICE }) + (coming ? ` (+${coming})` : "") + " · " +
      (n >= need ? L(hasSpine ? "cl.active" : "cl.needSpine") : L(hasSpine ? "cl.more" : "cl.moreSpine", { n: need - n }));
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
    return res.ok ? `<span class="jx" role="button" tabindex="0" data-canceljob="${j.id}" title="${esc(L("job.cancel"))}: ${esc(chk(res))}" aria-label="${esc(L("job.cancel"))}">${icon("cross")}</span>` : "";
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
      h += `<button class="slot card${d.failed ? " failed" : ""}" data-drag="shelf" data-uid="${d.uid}" aria-pressed="${!!armed}" style="background:${ITEM_COLOR(it)}" title="${esc(itName(d.type))}${d.failed ? " · " + esc(L("shelf.failedTip")) : ""} · ${esc(L("shelf.slotTip"))}">${icon(it.icon)}<span>${esc(itShort(d.type))}</span></button>`;
    }
    for (const j of incoming) {
      const it = item(j.dev.type);
      const what = j.kind === "forward" ? L("shelf.fwd", { it: itName(j.dev.type), d: Math.ceil(j.left) }) : j.kind === "swap" ? L("shelf.swapBack") : L("shelf.coming", { it: itName(j.dev.type) });
      h += `<div class="slot incoming" title="${esc(what)}">${icon(j.kind === "forward" || j.kind === "restock" ? "truck" : "wrench")}<span>${j.kind === "swap" ? "⇄" : esc(itShort(j.dev.type))}</span><span>${L("u.days", { d: Math.ceil(j.left) })}</span>${cancelX(j)}<span class="sp" style="width:${Math.round((1 - jobFrac(j)) * 100)}%"></span></div>`;
    }
    for (let i = S.shelf.length + incoming.length; i < K.SHELF; i++) h += `<div class="slot"></div>`;
    wrap.classList.toggle("empty", !S.shelf.length && !incoming.length);   // v0.4.5: an empty shelf is one thin drop row
    $("shelf").innerHTML = h;
    // compact header (the stage has no room for the hint line): count inline, the how-to in the tooltip
    $("shelf-n").textContent = `${Sim.shelfLoad(S)}/${K.SHELF}`;
    $("shelf-wrap").querySelector(".shelf-head").title = L("shelf.tip", { n: Sim.shelfLoad(S), max: K.SHELF }) + (on("memory") ? " " + L("shelf.tipFwd") : "");
  }

  function renderTray() {
    const shop = Sim.shopItems(S), cg = Sim.currentGen(S), leasing = V.lease && on("finance");
    // header: HBM index + buy/lease switch
    let tools = "";
    if (on("memory")) {
      const hv = S.history.slice(-60).map(x => x.hbm).filter(x => x != null);
      tools += `<span class="hbm" title="${esc(L("tray.hbmTip"))}">${icon("layers", `color:${COL.mem}`)}HBM <b>${S.hbm.index.toFixed(2)}</b>${spark(hv, 90, 24, COL.mem, { ref: 1, label: "HBM" })}${S.hbm.shortage ? `<span class="badge-short">${esc(L("tray.short"))}</span>` : ""}</span>`;
    }
    if (on("finance")) tools += `<span class="buylease" role="group" aria-label="${esc(L("tray.buyLease"))}"><button data-lease="0" aria-pressed="${!leasing}">${icon("coin")}${L("tray.buy")}</button><button data-lease="1" aria-pressed="${leasing}" title="${esc(L("tray.leaseTip", { p: (K.LEASE_RATE * 100).toFixed(2) }))}">${icon("tag")}${L("tray.lease")}</button></span>`;
    // text diet: no standing caption. The how-to is the catalog title's tooltip + the one-time ghost demo (teachDrag)
    $("tray-title").innerHTML = `<h2 title="${esc(L("tray.tip", { s: K.SHIP_DAYS, i: K.INSTALL_DAYS }))}">${icon("cart")}</h2><span class="soldbar" id="soldbar" aria-live="polite"></span><span class="tthint">${leasing ? `${icon("tag")} ${(K.LEASE_RATE * 100).toFixed(2)} %/d` : ""}</span><span class="tools">${tools}</span>`;
    let h = shop.map(k => {
      const it = item(k), color = ITEM_COLOR(it), canLease = it.role === "gpu";
      let badge = "";
      if (leasing && canLease) badge = `<span class="badge lease">$${(it.price * K.LEASE_RATE).toFixed(2)}k${UPD()}</span>`;
      else if (it.key === "pm9") badge = `<span class="badge pitch">${it.price <= Sim.BASE_ITEMS.pm9.price * 0.5 ? "−60 %" : "−30 %"}</span>`;
      else if (it.role === "exotic") badge = `<span class="badge pilot">${esc(L("badge.pilot"))}</span>`;
      else if (it.role === "gpu" && it.gen < cg) badge = `<span class="badge old">${esc(L("badge.old"))}</span>`;
      else if (it.avail > 0 && S.day - it.avail < 40) badge = `<span class="badge">${esc(L("badge.new"))}</span>`;
      const fb = (it.role === "gpu" || it.role === "exotic") ? `<span class="fb" title="${esc(L("tray.spec"))}">${icon("cpu", "width:12px;height:12px")}<i style="width:${Math.min(100, it.F * 1.6)}%;background:${COL.train}"></i>${icon("layers", "width:12px;height:12px")}<i style="width:${Math.min(100, it.B * 1.6)}%;background:${COL.infer}"></i></span>` : "";
      const extra = it.cool ? L("tray.xCool", { x: it.cool }) : it.net ? L("tray.xNet", { x: it.net }) : it.boost ? L("tray.xBoost") : it.tank ? L("tray.xTank", { w: L("role." + it.only) }) : "";
      const armed = V.armed && V.armed.kind === "new" && V.armed.item === k;
      const dim = leasing && !canLease ? ' style="opacity:.45"' : "";
      return `<button class="item" data-drag="new" data-item="${k}" data-lease="${canLease ? 1 : 0}" aria-pressed="${!!armed}"${dim} title="${esc(`${itName(k)} · ${it.u}U · ${it.kw} kW · ${money(it.price)}${it.F ? ` · ${L("tray.fb", { f: it.F, b: it.B })}` : ""}${extra ? " · " + extra : ""}`)}">${badge}
        <span class="top"><span class="av" style="background:${color}">${icon(it.icon)}</span><strong>${esc(itName(k))}</strong></span>
        <span class="ublocks">${"<b></b>".repeat(it.u)}</span>${fb}
        <span class="row"><span>${icon("bolt", "color:var(--pow-c)")}${it.kw}</span><span class="price">${money(it.price)}</span></span>
      </button>`;
    }).join("");
    if (on("fabric")) {
      const armed = V.armed && V.armed.kind === "spine";
      h += `<button class="item facility" data-drag="spine" aria-pressed="${!!armed}" title="${esc(L("spine.cardTip"))}">
        <span class="top"><span class="av" style="background:${COL.frontier}">${icon("net")}</span><strong>${esc(L("it.spine"))}</strong></span>
        <span class="sub" style="font-size:11.5px;color:var(--ink-2)">${icon("clock")} ${L("u.days", { d: K.SPINE_DAYS })}</span>
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
      return `<span class="soldchip">${icon("coin")}<span>${esc(L("sold.chip", { name: itShort(x.type) }))}</span>${actBtn({ type: "undoSell", uid: x.uid, rack: x.rack }, L("sold.undo"), { cls: "slim2", icon: "undoarrow" })}<i style="width:${(f * 100).toFixed(1)}%"></i></span>`;
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
      const vk = j.kind === "repair" ? (j.phase === "parts" ? "parts" : "repair") : ["sell", "move", "tank", "store", "unstore", "returnLease", "swap"].includes(j.kind) ? j.kind : j.phase === "ship" ? "ship" : "install";
      return `<div title="${esc(L("job." + vk))}">${ic}<span>${j.dev ? esc(itName(j.dev.type)) : esc(L("job." + vk))}</span><span style="text-align:right">${txt}</span>${cancelX(j) || "<span></span>"}<span class="t"><i style="width:${Math.round((1 - jobFrac(j)) * 100)}%"></i></span></div>`;
    }).join("");
  }

  function rooflineSVG(r, extraKey, title) {
    const keys = [...new Set(r.devices.concat(r.pending).map(d => d.type).filter(k => item(k).role === "gpu").concat(extraKey && item(extraKey) && item(extraKey).role === "gpu" ? [extraKey] : []))];
    if (!keys.length) return "";
    const W = 280, H = 118, x0 = 26, y0 = 100, xs = I => x0 + (Math.log2(I) + 2) / 5 * (W - x0 - 8), maxY = Math.max(...keys.map(k => item(k).F)) * 1.25, ys = v => y0 - v / maxY * 88;
    let h = `<line x1="${x0}" y1="${y0}" x2="${W - 6}" y2="${y0}" stroke="var(--line)"/><line x1="${x0}" y1="8" x2="${x0}" y2="${y0}" stroke="var(--line)"/>`;
    for (const w of Sim.WORKLOADS) {
      const x = xs(Sim.INTENSITY[w]), cur = r.workload === w;
      h += `<line x1="${x}" y1="10" x2="${x}" y2="${y0}" stroke="${R[w].color}" stroke-dasharray="3 3" stroke-width="${cur ? 2 : 1}" opacity="${cur ? 1 : .5}"/><text x="${x + 3}" y="18" style="fill:${R[w].color};font-weight:${cur ? 600 : 400}">${esc(R[w].name)}</text>`;
    }
    const boost = r.devices.some(d => item(d.type).role === "mem" && !Sim.isDead(S, item(d.type)) && !d.failed) ? 1.25 : 1;
    keys.forEach(k => {
      const it = item(k), pts = [];
      for (let e = -2; e <= 3.01; e += 0.25) { const I = Math.pow(2, e); pts.push(`${xs(I).toFixed(1)},${ys(Math.min(it.F, it.B * boost * I)).toFixed(1)}`); }
      const I = Sim.INTENSITY[r.workload], v = Math.min(it.F, it.B * boost * I);
      h += `<polyline points="${pts.join(" ")}" fill="none" stroke="${ITEM_COLOR(it)}" stroke-width="2.5" opacity="${k === extraKey ? .6 : 1}"/>`;
      h += `<circle cx="${xs(I)}" cy="${ys(v)}" r="4" fill="${ITEM_COLOR(it)}" stroke="var(--panel)" stroke-width="1.5"/><text x="${xs(I) + 6}" y="${ys(v) + 4}" style="fill:var(--ink);font-weight:600">${it.name.split(" ")[1]} ${v.toFixed(1)}</text>`;
    });
    h += `<text x="${x0}" y="${H - 2}">${esc(L("roof.x"))}</text><text x="2" y="12">${esc(L("roof.y"))}</text>`;
    const it0 = item(keys[0]), I0 = Sim.INTENSITY[r.workload];
    const bound = it0.B * boost * I0 < it0.F ? "memory" : "compute";
    return `<div class="roof"><div class="sub" title="${esc(L("roof.tip"))}">${title || `${icon("gauge", "width:14px;height:14px;vertical-align:-2px")} ${esc(itName(it0.key))} · <b>${esc(L("hover." + bound))}</b>`}</div><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(L("roof.aria"))}">${h}</svg></div>`;
  }

  function devInfoHTML(r, pr) {
    const d = r.devices.find(x => x.uid === V.selDev);
    if (!d) return "";
    const it = item(d.type), age = Math.floor(S.day - (d.inst != null ? d.inst : d.born));
    const haz = on("ops") ? Sim.hazard(S, d, it, pr.inlet) : 0;
    const job = hasJob(d.uid);
    const tags = [d.failed ? `<span class="tagpill fail">${esc(L("dev.failed"))}</span>` : `<span class="tagpill ok">${esc(L("dev.ok"))}</span>`, d.leased ? `<span class="tagpill lease">${icon("tag", "width:11px;height:11px")} $${d.leaseRate.toFixed(2)}k${UPD()}</span>` : ""].join("");
    const btns = [];
    if (d.failed && !job) {
      const spare = S.shelf.some(x => x.type === d.type && !x.failed);
      btns.push(actBtn({ type: "repair", uid: d.uid }, L(spare ? "dev.swap" : "dev.repair"), { icon: "wrench" }));
      if (spare) btns.push(actBtn({ type: "repair", uid: d.uid, useSpare: false }, L("dev.repair"), { icon: "box" }));
    }
    if (d.leased && !job) btns.push(actBtn({ type: "returnLease", rack: r.id, uid: d.uid }, L("dev.return"), { icon: "tag" }));
    if (!d.leased && !job && on("ops")) btns.push(actBtn({ type: "store", rack: r.id, uid: d.uid }, L("dev.store"), { icon: "box" }));
    if (!d.leased && !job) btns.push(actBtn({ type: "sell", rack: r.id, uid: d.uid }, money(Sim.resale(S, d)), { icon: "coin" }));
    return `<div class="devinfo"><div class="row"><b>${esc(itName(d.type))}</b>${tags}</div>
      <div class="kv"><span title="${esc(L("dev.age"))}">${icon("clock", "width:13px;height:13px")} ${L("u.days", { d: age })}</span>${on("ops") ? `<span title="${esc(L("dev.risk"))}">${icon("cross", "width:13px;height:13px")} ${(haz * 100).toFixed(2)} %/d</span>` : ""}${job ? `<span title="${esc(L("dev.job"))}">${icon("wrench", "width:13px;height:13px")}</span>` : ""}</div>
      ${btns.length ? `<div class="row">${btns.join("")}</div>` : ""}</div>`;
  }

  /* the contracts a rack serves, in their link colours (or "idle: no contract") */
  function serveLine(pr) {
    if (!Sim.contractsOn(S)) return "";
    const to = {};
    for (const x of pr.to || []) to[x.id] = (to[x.id] || 0) + x.u;
    const ids = Object.keys(to);
    if (!ids.length) return (pr.out && pr.out.web + pr.out.train + pr.out.infer > 0.05) ? ` · <span class="idletag">${esc(L("rack.idle"))}</span>` : "";
    return " · " + ids.map(id => { const c = S.contracts.find(x => x.id === id); return `<span class="servetag" style="--lc:${QOL.linkColor(id)}" title="${to[id].toFixed(1)}u">${esc(c ? c.cust.split(" ")[0] : id)}</span>`; }).join(" ");
  }
  function renderDetail(st) {
    const r = V.selected && rack(V.selected);
    $("tab-rack-lbl").textContent = r ? r.id : L("tab.rack");
    if (!r) { $("detail").innerHTML = `<h2>${icon("building")}${esc(L("hall.n", { n: V.hall }))}</h2><div class="sub" style="margin-top:6px">${icon("lock")}</div>`; return; }
    const role = rackRole(r), pr = st.perRack[r.id], unit = 10.2;
    let elev = "";
    r.devices.forEach(d => {
      const it = item(d.type), dead = Sim.isDead(S, it);
      const cls = ["dev", d.failed ? "failed" : "", d.leased ? "leased" : ""].join(" ");
      elev += `<button class="${cls}" data-drag="dev" data-rack="${r.id}" data-uid="${d.uid}"${d.failed ? ` data-drop-fail="${d.uid}"` : ""} aria-pressed="${V.selDev === d.uid}" style="height:${it.u * unit}px;background-color:${dead ? "#555555" : ITEM_COLOR(it)}" title="${esc([itName(d.type), `${it.u}U`, `${it.kw} kW`, dead ? L("dev.dead") : "", d.failed ? L("dev.failedTip") : "", d.leased ? L("fin.leased") : ""].filter(Boolean).join(" · ") + " · " + L(d.leased ? "dev.dragTipLease" : "dev.dragTip", { x: money(Sim.resale(S, d)) }))}">${it.u > 1 || it.role === "net" ? icon(dead ? "warn" : d.failed ? "cross" : it.icon) : ""}</button>`;
    });
    r.pending.forEach(d => { const it = item(d.type); elev += `<div class="pend" style="height:${it.u * unit}px" title="${esc(itName(d.type))} · ${esc(L("dev.onWay"))}">${it.u > 1 ? icon("truck") : ""}</div>`; });
    const free = K.RACK_U - Sim.usedU(S, r);
    if (free) elev += `<div class="e" style="height:${free * unit}px"></div>`;
    const g = (ic, col, v, label, key, tip) => `<div class="g"${key ? ` data-g="${key}"` : ""}${tip ? ` title="${esc(tip)}"` : ""}>${icon(ic, `color:${col}`)}<div class="track"><i style="width:${Math.round(clamp01(v) * 100)}%;background:${col}"></i></div><small>${label}</small></div>`;
    const hasGpu = r.devices.concat(r.pending).some(d => item(d.type).role === "gpu");
    const nFail = r.devices.filter(d => d.failed).length;
    const nosw = noSwitch(r, pr);
    // text diet: status = icon + a number or two words; the explanation is the tooltip
    const status = role === "empty" ? `<span title="${esc(L(r.tank ? "rack.emptyTankTip" : "rack.emptyTip"))}">${icon(r.tank ? "drop" : "plus")} ${esc(L(r.tank ? "rack.emptyTank" : "role.empty"))}</span>`
      : nosw ? `<span class="nosw-status" title="${esc(L("rack.noswTip"))}">${icon("unplug")} ${esc(L("alert.nosw"))} · <b>$0</b></span>`
      : nFail ? `<span title="${esc(L("rack.failTip"))}">${icon("cross", `color:${COL.fail}`)} ${esc(L("alert.fail"))} ×${nFail}</span>`
      : pr.penalty < 1 ? `<span title="${esc(L("rack.crashTip"))}">${icon("warn")} 60 %</span>`
      : pr.throttle < 1 ? `<span title="${esc(L("rack.hotTip"))}">${icon("flame")} ${esc(L("alert.hot"))} ${Math.round(pr.throttle * 100)} %</span>`
      : pr.netF < 1 && pr.netNeed > 0 ? `<span title="${esc(L("rack.netTip"))}">${icon("net")} ${pr.netProv}/${pr.netNeed}</span>`
      : r.mode === "off" ? `${icon("power")} ${esc(L("rack.off"))}`
      : `${perDay(pr.rev)}${pr.frontier && pr.trainGpus ? ` ${icon("star", `color:${COL.frontier}`)}` : ""}${serveLine(pr)}`;
    const wl = on("gpu") && hasGpu && !r.tank ? `<div class="wl" role="group" aria-label="${esc(L("rack.wl"))}">${Sim.WORKLOADS.map(w => `<button data-wl="${w}" aria-pressed="${r.workload === w}" style="${r.workload === w ? `background:${R[w].color}` : ""}">${icon(R[w].icon, "width:14px;height:14px")}${esc(R[w].name)}</button>`).join("")}</div>` : "";
    // power modes: Off (park idle hardware: 0 kW, 0 output) from chapter 1; Eco / Boost with the power chapter
    const modeKeys = Object.keys(Sim.MODES).filter(k => on("power") || k === "std" || k === "off");
    // power modes: icon buttons (text diet); name + output/power in the tooltip
    const modes = r.devices.length || r.pending.length ? `<div class="seg" role="group" aria-label="${esc(L("rack.pmode"))}">${modeKeys.map(k => { const m = Sim.MODES[k]; return `<button data-pmode="${k}" aria-pressed="${r.mode === k}" title="${esc(L("mode.tip", { m: L("mode." + k), o: Math.round(m.out * 100), p: Math.round(m.kw * 100) }))}" aria-label="${esc(L("mode." + k))}">${icon(MODE_ICON[k] || "gauge")}<span class="mlab">${esc(L("mode." + k))}</span></button>`; }).join("")}</div>` : "";
    const meas = [], seen = new Set();
    for (const d of r.devices) {
      const it = item(d.type);
      if (it.role !== "exotic" || seen.has(it.key)) continue;
      seen.add(it.key);
      if (Sim.isDead(S, it)) meas.push(`<div class="meas bad" title="${esc(L("dev.dead"))}">${icon("warn")} ${esc(itName(it.key))} †</div>`);
      else if (S.measured[it.vendor] != null) meas.push(`<div class="meas ${S.measured[it.vendor] < 0.95 ? "bad" : "good"}" title="${esc(L("meas.tip"))}">${icon("gauge")} ${esc(itName(it.key))} <b>${Math.round(S.measured[it.vendor] * 100)} %</b></div>`);
      else meas.push(`<div class="meas" title="${esc(L("meas.wait", { d: K.PILOT_DAYS }))}">${icon("clock")} ${esc(itName(it.key))} …</div>`);
    }
    const swBtn = nosw ? `<div class="addsw">${actBtn({ type: "buy", item: "sw", rack: r.id }, `+ ${esc(itName("sw"))} · ${money(item("sw").price)}`, { cls: "primary", icon: "switch" })}</div>` : "";
    const tankBtn = on("disrupt") && !r.tank && !r.devices.length && !r.pending.length && !jobFor(r.id)
      ? `<div style="margin-top:10px">${actBtn({ type: "tank", rack: r.id }, `${esc(L("role.tank"))} · ${money(K.TANK_COST)}`, { confirm: true, icon: "drop" })}</div>` : "";
    const armedItem = V.armed && V.armed.kind === "new" ? V.armed.item : null;
    let clusterLine = "";
    if (on("fabric") && !r.tank && (hasGpu || S.spines[`${r.hall}-${r.row}`])) {
      const cm = clusterMeter(r.hall, r.row, st);
      clusterLine = `<div class="clusterline" title="${esc(cm.tip)}">${icon(cm.n >= K.FRONTIER_MIN_GPUS && cm.hasSpine ? "star" : "net", `color:${COL.frontier}`)}<span>${cm.L} <b>${cm.n}/${K.FRONTIER_MIN_GPUS}</b> → ×${K.FRONTIER_PRICE}${cm.hasSpine ? "" : ` ${icon("lock", "width:12px;height:12px")}`}</span><span class="cmeter wide${cm.n >= K.FRONTIER_MIN_GPUS ? " full" : ""}"><i style="width:${Math.round(cm.f * 100)}%"></i></span></div>`;
    }
    $("detail").innerHTML = `
      <h2><span style="width:14px;height:14px;border-radius:3px;background:${role === "empty" ? "var(--line)" : R[role].color};display:inline-block"></span>${r.id}<span class="sub" style="font-family:var(--sans);font-weight:400">${on("gpu") && hasGpu && !r.tank ? "" : esc(R[role].name)}${builtHalls().length > 1 ? ` · ${esc(L("hall.n", { n: r.hall }))}` : ""}</span>${role !== "empty" ? `<span class="rtools"><button class="btn slim2" data-dup="${r.id}" title="${esc(L("rack.duplicate") + ": " + L("rack.duplicateTip"))}" aria-label="${esc(L("rack.duplicate"))}">${icon("copy")}</button></span>` : ""}</h2>
      <div class="sub" style="display:flex;align-items:center;gap:6px;margin-top:4px">${status}</div>${swBtn}
      <div class="rack-detail">
        <div class="elev" data-drop-rack="${r.id}" title="${esc(L("rack.elev"))}">${elev}</div>
        <div class="gauges">
          ${g("temp", ramp(ramps().heat, (pr.inlet - 22) / 14), (pr.inlet - 18) / 18, `${pr.inlet.toFixed(1)} °C${pr.throttle < 1 ? " " + icon("flame", "width:12px;height:12px") : ""}`, null, L("g.inlet", { t: K.T_LIMIT }))}
          ${g("bolt", "var(--pow-c)", pr.kw / K.RACK_KW, `${pr.kw.toFixed(1)} / ${K.RACK_KW} kW`, "kw", L("g.kw"))}
          ${g("net", "#8FC4FF", pr.netNeed ? Math.min(1, pr.netProv / pr.netNeed) : pr.netProv ? 1 : 0, `${pr.netProv} / ${pr.netNeed.toFixed(0)}${pr.spine ? " " + icon("star", "width:12px;height:12px") : ""}`, null, L("g.net"))}
          ${g("plus", "var(--ok-c)", free / K.RACK_U, `${free}U`, "u", L("g.u"))}
          ${wl}${modes}
        </div>
      </div>
      ${clusterLine}
      ${devInfoHTML(r, pr)}
      ${on("gpu") ? rooflineSVG(r, armedItem) : ""}
      ${meas.join("")}
      <div class="jobs" id="jobs">${jobsHTML()}</div>
      ${tankBtn}
      <div class="bin" data-drop-sell title="${esc(L(on("finance") ? "rack.binTipLease" : "rack.binTip"))}">${icon("coin")}${esc(L("rack.bin"))}</div>`;
  }

  /* ---------- charts ---------- */
  function renderMarket() {
    const H = S.history.filter(h => h.d <= S.day);
    const svg = $("market-chart");
    const showIt = on("gpu");
    $("market-legend").innerHTML = showIt ? `<span style="color:${COL.train}" title="${esc(L("mk.youTip"))}"><i style="background:currentColor"></i>${esc(R.train.name)}</span><span style="color:${COL.train}" title="${esc(L("mk.demand"))}"><i class="dash"></i></span><span style="color:${COL.infer}" title="${esc(L("mk.youTip"))}"><i style="background:currentColor"></i>${esc(R.infer.name)}</span><span style="color:${COL.infer}" title="${esc(L("mk.demand"))}"><i class="dash"></i></span>` : "";
    if (!showIt || H.length < 2) { svg.innerHTML = `<text x="160" y="75" text-anchor="middle">🔒 ${esc(L("mk.locked", { n: 3 }))}</text>`; return; }
    const W = 320, x0 = 30, y0 = 118, maxD = Math.max(20, ...H.map(h => Math.max(h.dt, h.di, h.st, h.si))) * 1.1;
    const d0 = H[0].d, span = Math.max(180, H[H.length - 1].d - d0);
    const x = d => x0 + (d - d0) / span * (W - x0 - 60), y = v => y0 - v / maxD * 104;
    const path = key => H.map((h, i) => `${i ? "L" : "M"}${x(h.d).toFixed(1)},${y(h[key]).toFixed(1)}`).join("");
    const lastH = H[H.length - 1], yearAgo = H.find(h => h.d >= lastH.d - 360) || H[0];
    const chg = (a, b) => { const p = (a / b - 1) * 100; return `${p >= 0 ? "▲" : "▼"}${Math.abs(p).toFixed(0)} %`; };
    const gens = Sim.GEN_LAUNCH.filter(g => g > d0 && g <= lastH.d && on("gens"));
    svg.innerHTML = `
      <line x1="${x0}" y1="${y0}" x2="${W - 60}" y2="${y0}" stroke="var(--line)"/>
      ${gens.map(g => `<line x1="${x(g)}" x2="${x(g)}" y1="10" y2="${y0}" stroke="var(--line)" stroke-dasharray="2 3"/><text x="${x(g) + 2}" y="14" style="font-size:9px">G${Sim.GEN_LAUNCH.indexOf(g) + 2}</text>`).join("")}
      ${[0, 0.5, 1].map(f => `<text x="${x0 - 4}" y="${y(maxD / 1.1 * f) + 4}" text-anchor="end">${Math.round(maxD / 1.1 * f)}</text>`).join("")}
      <path d="${path("dt")}" fill="none" stroke="${COL.train}" stroke-width="1.5" stroke-dasharray="4 3"/>
      <path d="${path("di")}" fill="none" stroke="${COL.infer}" stroke-width="1.5" stroke-dasharray="4 3"/>
      <path d="${path("st")}" fill="none" stroke="${COL.train}" stroke-width="2.5"/>
      <path d="${path("si")}" fill="none" stroke="${COL.infer}" stroke-width="2.5"/>
      <text x="${W - 56}" y="${y0 - 70}" style="fill:${COL.train};font-weight:600">$${(lastH.pt * 1000).toFixed(0)}${L("u.ud")}</text>
      <text x="${W - 56}" y="${y0 - 57}" style="fill:${COL.train}">${chg(lastH.pt, yearAgo.pt)} ${esc(L("mk.yr"))}</text>
      <text x="${W - 56}" y="${y0 - 30}" style="fill:${COL.infer};font-weight:600">$${(lastH.pi * 1000).toFixed(0)}${L("u.ud")}</text>
      <text x="${W - 56}" y="${y0 - 17}" style="fill:${COL.infer}">${chg(lastH.pi, yearAgo.pi)} ${esc(L("mk.yr"))}</text>
      <text x="${x0}" y="${y0 + 14}">${esc(L("mk.day", { d: d0 }))}</text><text x="${x(lastH.d)}" y="${y0 + 14}" text-anchor="end">${esc(L("mk.now"))}</text>
      <text x="${W - 56}" y="${y0 + 14}">${esc(L("mk.price"))}</text>`;
  }
  function renderBench() {
    const svg = $("bench-chart"), B = S.bench, card = $("bench-card");
    card.classList.toggle("lockmask", !B.lattice.length && !B.photon.length);
    if (!B.lattice.length && !B.photon.length) { svg.innerHTML = `<text x="150" y="70" text-anchor="middle">${esc(L("bench.none"))}</text>`; return; }
    const W = 300, x0 = 26, y0 = 112, all = B.lattice.concat(B.photon), maxV = Math.max(4, ...all.map(p => p.v)) * 1.15;
    const dMax = Math.max(...all.map(p => p.d)), dMin = Math.min(...all.map(p => p.d)), span = Math.max(120, dMax - dMin);
    const x = d => x0 + (d - dMin) / span * (W - x0 - 90), y = v => y0 - v / maxV * 100;
    let h = `<line x1="${x0}" y1="${y0}" x2="${W - 8}" y2="${y0}" stroke="var(--line)"/>
      <rect x="${x(dMax) + 6}" y="8" width="${W - x(dMax) - 14}" height="${y0 - 8}" fill="var(--tile)" opacity=".4"/>
      <text x="${x(dMax) + 30}" y="66" style="font-size:24px;font-family:var(--display)">?</text><text x="${x(dMax) + 12}" y="${y0 - 6}">${esc(L("bench.noRoad"))}</text>`;
    for (const [v, col, name] of [["lattice", COL.lattice, "Lattice"], ["photon", COL.photon, "Photon"]]) {
      const P = B[v]; if (!P.length) continue;
      h += `<path d="${P.map((p, i) => `${i ? "L" : "M"}${x(p.d).toFixed(1)},${y(p.v).toFixed(1)}`).join("")}" fill="none" stroke="${col}" stroke-width="2.5"/>`;
      const l = P[P.length - 1];
      h += `<circle cx="${x(l.d)}" cy="${y(l.v)}" r="3.5" fill="${col}"/><text x="${x(l.d) - 4}" y="${y(l.v) - 7}" text-anchor="end" style="fill:${col};font-weight:600">${name} ${l.v.toFixed(1)}${S.vendors[v].dead ? " †" : ""}</text>`;
    }
    h += `<text x="${x0}" y="${y0 + 14}">${esc(L("fmt.year", { y: Math.floor(dMin / 360) + 1 }))}</text><text x="${x(dMax)}" y="${y0 + 14}" text-anchor="end">${esc(L("mk.now"))}</text>`;
    svg.innerHTML = h;
  }
  function renderNews() {
    const TONE = { info: [COL.info, "news"], good: [COL.good, "trend"], bad: [COL.bad, "warn"], pitch: [COL.pitch, "tag"] };
    const cats = [...new Set(S.news.map(n => n.cat || "general"))].filter(c => NEWS_CAT[c]);
    if (V.newsCat !== "all" && !cats.includes(V.newsCat)) V.newsCat = "all";
    $("newsfilter").innerHTML = cats.length > 1 ? `<button data-newscat="all" aria-pressed="${V.newsCat === "all"}">${esc(L("news.all"))}</button>` +
      cats.map(c => `<button data-newscat="${c}" aria-pressed="${V.newsCat === c}" title="${esc(catLabel(c))}">${icon(NEWS_CAT[c][0])}<span class="nlab">${esc(catLabel(c))}</span></button>`).join("") : "";
    // the News tab shows a dot with the number of items that arrived while another tab was open
    const newest = S.news.length ? S.news[0].day : -1;
    if (V.newsSeenFor !== S || V.tab === "news") { V.newsSeenFor = S; V.newsSeen = newest; }
    const unseen = S.news.filter(n => n.day > V.newsSeen).length, dot = $("tab-news").querySelector(".dot");
    dot.hidden = !unseen; dot.textContent = unseen > 9 ? "9+" : String(unseen);
    const list = S.news.filter(n => V.newsCat === "all" || (n.cat || "general") === V.newsCat).slice(0, 14);
    $("newsfeed").innerHTML = list.map(n => {
      const [c, ic] = TONE[n.tone] || TONE.info;
      // text diet: a news item is its title; the body is the tooltip (progressive disclosure)
      return `<div class="ev${S.day - n.day < 20 ? " fresh" : ""}" data-news="${esc(n.cat || "general")}"${n.p && n.p.r ? ` data-rackref="${esc(n.p.r)}"` : ""} title="${esc(newsB(n))}"><span class="av" style="background:${c}">${icon(n.icon || ic)}</span><span><strong>${esc(newsT(n))}</strong><span class="when" style="display:block">${dateOf(n.day)}</span></span></div>`;
    }).join("") || `<div class="sub">—</div>`;
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
      pop.innerHTML = `<h3>${icon("wrench")}${esc(L("pop.techs"))}</h3>
        <div class="stepper"><button data-act='{"type":"fire"}' title="${esc(L("c.fire", { x: K.FIRE_PAY_DAYS * K.SALARY }))}" aria-label="${esc(L("pop.fire"))}">${icon("minus")}</button>
          <div class="val"><span class="big">${S.techs}${S.hires.length ? ` <small>+${S.hires.length}</small>` : ""}</span><small>$${(S.techs * K.SALARY).toFixed(2)}k${UPD()}</small></div>
          <button data-act='{"type":"hire"}' title="${esc(L("c.hire", { d: K.HIRE_DAYS, x: K.SALARY }))}" aria-label="${esc(L("pop.hire"))}">${icon("plus")}</button></div>
        <div class="kv"><span>${esc(L("pop.busy"))}</span><b>${busy} / ${S.techs}</b></div><div class="kv"><span>${esc(L("pop.queued"))}</span><b>${queue}</b></div><div class="kv"><span>${esc(L("job.parts"))}</span><b>${parts}</b></div>
        <button class="toggle" data-act='${JSON.stringify({ type: "repairPolicy", on: !S.repairAuto })}' data-keep-title aria-pressed="${S.repairAuto}" title="${esc(L("pop.autoRepTip"))}"><span class="sw"></span><span><b>${esc(L("pop.autoRep"))}</b></span></button>
        <button class="toggle" data-act='${esc(JSON.stringify({ type: "policy", key: "autoSwap", on: !S.policy.autoSwap }))}' data-keep-title aria-pressed="${!!S.policy.autoSwap}" title="${esc(L("pol.autoSwapTip"))}"><span class="sw"></span><span><b>${esc(L("pol.autoSwap"))}</b></span></button>
        ${keepSparesHTML()}`;
    } else if (V.pop === "alerts") {
      pop.innerHTML = alertsHTML();
    } else if (V.pop === "transit") {
      const need = transitNeed(st), cap = S.transit + K.TRANSIT_FREE, tgt = Sim.transitTarget(S);
      pop.innerHTML = `<h3 title="${esc(L("tr.tip", { per: K.TRANSIT_PER, free: K.TRANSIT_FREE, x: K.TRANSIT_COST }))}">${icon("globe")}${esc(L("tr.title"))}</h3>
        <div class="stepper"><button data-act='{"type":"transit","delta":-1}' aria-label="−1">${icon("minus")}</button>
          <div class="val"><span class="big">${tgt + K.TRANSIT_FREE}</span><small>${tgt !== S.transit ? `${cap} → ${tgt + K.TRANSIT_FREE} · ${L("u.days", { d: K.TRANSIT_DAYS })}` : `$${(S.transit * K.TRANSIT_COST).toFixed(1)}k${UPD()}`}</small></div>
          <button data-act='{"type":"transit","delta":1}' aria-label="+1">${icon("plus")}</button></div>
        <div class="meter"><i style="width:${Math.min(100, need / Math.max(1, cap) * 100)}%;background:${need > cap ? COL.bad : COL.good}"></i></div>
        <div class="kv"><span>${esc(L("tr.need"))}</span><b>${need.toFixed(1)}</b></div>
        <div class="kv"><span>${esc(L("tr.carried"))}</span><b>${pct(st.transitF)}</b></div>
        <div class="buyrow">${actBtn({ type: "transit", delta: 5 }, "+5")}${actBtn({ type: "transit", delta: Math.max(1, Math.ceil(need) - K.TRANSIT_FREE - tgt) }, L("tr.match"), { cls: "primary" })}</div>`;
    } else if (V.pop === "grid") {
      const g = Sim.gridNext(S), job = S.jobs.find(j => j.kind === "grid");
      pop.innerHTML = `<h3>${icon("bolt", "color:var(--pow-c)")}${esc(L("grid.title"))}</h3>
        <div class="kv"><span>${esc(L("grid.now"))}</span><b>${st.kw.toFixed(0)} kW</b></div><div class="kv"><span>${esc(L("grid.orders"))}</span><b>${Sim.gridKwAll(S).toFixed(0)} kW</b></div><div class="kv"><span>${esc(L("grid.limit"))}</span><b>${S.gridKw} kW</b></div>
        ${gridLadder()}
        ${job ? `<div class="sub">${icon("wrench")} ${job.kw} kW · ${L("u.days", { d: Math.ceil(job.left) })}</div>` : g ? actBtn({ type: "grid" }, `${g.kw} kW · ${money(g.cost)} · ${L("u.days", { d: g.days })}`, { confirm: true, cls: "primary", icon: "bolt" })
          : `<div class="sub">${gridNote()}</div>`}`;
    }
  }

  /* policy keepSpares: pick a part, keep N on the shelf (auto-ordered at list price) */
  function keepSparesHTML() {
    const shop = Sim.shopItems(S).filter(k => { const it = item(k); return it.role !== "exotic" && k !== "pm9"; });
    if (!V.keepItem || !shop.includes(V.keepItem)) V.keepItem = Object.keys(S.policy.keepSpares)[0] || shop.find(k => item(k).role === "gpu") || shop[0];
    const k = V.keepItem, n = S.policy.keepSpares[k] || 0;
    const act = d => JSON.stringify({ type: "policy", key: "keepSpares", item: k, n: Math.max(0, Math.min(K.SHELF, n + d)) });
    return `<div class="keep" title="${esc(L("pol.keepTip"))}"><b>${esc(L("pol.keep"))}</b><select id="keep-item" aria-label="${esc(L("pol.keep"))}">${shop.map(x => `<option value="${x}"${x === k ? " selected" : ""}>${esc(itName(x))}${S.policy.keepSpares[x] ? ` (${S.policy.keepSpares[x]})` : ""}</option>`).join("")}</select>
      <div class="stepper sm"><button data-act='${esc(act(-1))}' data-keep-title aria-label="−1">${icon("minus")}</button><div class="val"><span class="big">${n}</span></div><button data-act='${esc(act(1))}' data-keep-title aria-label="+1">${icon("plus")}</button></div></div>`;
  }
  /* the four grid tiers (250 / 400 / 700 / 1000 kW) as a ladder: owned, under way, next */
  const GRID_TIERS = () => [[K.GRID_KW, 0, 0], [K.GRID_KW_UP, K.GRID_COST, K.GRID_DAYS], [K.GRID_KW_UP2, K.GRID_COST2, K.GRID_DAYS2], [K.GRID_KW_UP3, K.GRID_COST3, K.GRID_DAYS3]];
  function gridNote() { return S.gridTier >= 3 ? `${icon("check")} ${esc(L("c.gridMax"))}` : `${icon("lock")} ${GRID_TIERS()[S.gridTier + 1][0]} kW · ${esc(L("c.locked", { n: 11 }))}`; }
  function gridLadder() {
    const job = S.jobs.find(j => j.kind === "grid");
    return `<div class="gridladder" role="list" aria-label="${esc(L("grid.tiers"))}">${GRID_TIERS().map(([kw, cost, days], i) => {
      const st = i <= S.gridTier ? "own" : job && i === S.gridTier + 1 ? "busy" : "";
      return `<span role="listitem" class="gt ${st}" title="${esc(i === 0 ? L("grid.start") : `${money(cost)} · ${L("u.days", { d: days })}${i >= 2 ? " · " + L("c.locked", { n: 11 }) : ""}`)}">${st === "own" ? icon("check") : st === "busy" ? icon("wrench") : icon("bolt")}<b>${kw}</b><small>kW</small></span>`;
    }).join("")}</div>`;
  }

  /* ================= drawers ================= */
  const DRAWERS = { contracts: "hand", finance: "trend", energy: "bolt", affairs: "flag" };
  function openDrawer(k) {
    if (S) TELE.event(S.day, "drawer", { k, open: V.drawer !== k });
    if (V.drawer === k) { closeDrawer(); return; }
    V.drawer = k; closePop();
    $("drawer").classList.add("open"); $("drawer").setAttribute("aria-hidden", "false");
    $("stage").classList.add("docked");     // v0.4.2: the drawer docks under the rack panel; both stay usable (DECISIONS D63)
    renderDrawer(Sim.stats(S)); renderDrawerBtns();
    dlog("drawer", k);
  }
  /* v0.4.5: the docked drawer can fold to its header (the rack panel above takes the height back) */
  function setDrawerMin(v) {
    V.drawerMin = !!v;
    $("drawer").classList.toggle("min", V.drawerMin);
    $("drawer-min").setAttribute("aria-expanded", String(!V.drawerMin));
    $("drawer-min").innerHTML = icon(V.drawerMin ? "plus" : "minus");
    dlog("drawer", V.drawerMin ? "folded" : "unfolded");
  }
  function closeDrawer() { V.drawer = null; const d = $("drawer"); d.classList.remove("open"); d.setAttribute("aria-hidden", "true"); $("stage").classList.remove("docked"); if (S) renderDrawerBtns(); }
  function renderDrawer(st) {
    const k = V.drawer; if (!k) return;
    $("drawer-title").innerHTML = `${icon(DRAWERS[k])} ${esc(L("dr." + k))}`;
    $("drawer-sub").innerHTML = V.speed ? icon("play1") : icon("pause");
    const body = $("drawer-body"), top = body.scrollTop;
    body.innerHTML = k === "contracts" ? contractsHTML(st) : k === "finance" ? financeHTML(st) : k === "energy" ? energyHTML(st) : affairsHTML(st);
    body.scrollTop = top;
  }
  const sect = (ic, title, sub, inner, cls) => `<section class="sect ${cls || ""}"><h3>${icon(ic)}${title}${sub ? `<span class="sub">${sub}</span>` : ""}</h3>${inner}</section>`;

  function contractsHTML(st) {
    const offers = QOL.byKind(S.offers, V.kf).slice().sort((a, b) => a.expires - b.expires).map(o => offerCard(o, st)).join("");
    const act = QOL.byKind(S.contracts, V.kf).map(c => {
      const k = kindOf(c), col = QOL.linkColor(c.id);
      const racks = [...new Set((st.alloc || []).filter(l => l.id === c.id).map(l => l.rack))];
      const head = `<div class="kv"><span><i class="swatch" style="background:${col}"></i>${icon((KIND[k] || KIND.web)[0], "width:14px;height:14px;vertical-align:-2px")} <b>${esc(c.cust)}</b> · ${esc(L("kind." + k))}${Sim.isJob(c) ? "" : ` · ${c.units}u · $${(c.price * 1000).toFixed(0)}`}</span>`;
      const served = `<div class="sub">${icon("link", "width:13px;height:13px;vertical-align:-2px")} ${esc(racks.length ? L("board.served", { racks: racks.join(", ") }) : L("board.unserved"))}</div>`;
      if (Sim.isJob(c)) {
        const f = clamp01(c.done / c.work), tf = clamp01((S.day - c.signed) / Math.max(1, c.deadline - c.signed)), late = S.day > c.deadline;
        return `<div class="contract" style="border-color:${col}">${head}<span>${late ? `<b style="color:${COL.bad}">${esc(L("ct.late", { d: Math.ceil(S.day - c.deadline) }))}</b>` : `${icon("clock", "width:13px;height:13px")} ${L("u.days", { d: Math.ceil(c.deadline - S.day) })}`}</span></div>
          <div class="meter" title="${esc(L("ct.workTip"))}"><i style="width:${f * 100}%;background:${f + 1e-6 >= tf ? COL.good : COL.warn}"></i><em style="left:${tf * 100}%"></em></div>
          <div class="kv"><span>${Math.round(c.done)} / ${Math.round(c.work)} u·d · ${money(c.pay)}</span><span>${(st.cDel[c.id] || 0).toFixed(1)} u/d</span></div>${served}</div>`;
      }
      if (S.day < c.start) {
        const lead = Math.max(1, c.start - (c.signed != null ? c.signed : c.start - (c.lead || K.BTS_LEAD))), f = clamp01(1 - (c.start - S.day) / lead);
        return `<div class="contract" style="border-color:${col}">${head}<span>${esc(L("board.starts", { d: Math.ceil(c.start - S.day) }))}</span></div>
          <div class="meter slim" title="${esc(L("ct.leadTip"))}"><i style="width:${f * 100}%;background:${COL.warn}"></i></div>${served}</div>`;
      }
      const el = Math.max(0.01, S.day - c.start), tf = clamp01(el / c.days), delF = c.delivered / (c.units * el);
      const missing = (st.cMiss[c.id] || 0) > 1e-6;
      return `<div class="contract" style="border-color:${col}">${head}<span>${icon("clock", "width:13px;height:13px")} ${L("u.days", { d: Math.ceil(c.end - S.day) })}</span></div>
        <div class="meter slim" title="${esc(L("ct.timeTip"))}"><i style="width:${tf * 100}%;background:var(--ink-2)"></i></div>
        <div class="meter" title="${esc(L("ct.slaTip"))}"><i style="width:${clamp01(delF) * 100}%;background:${delF + 1e-6 >= c.sla ? COL.good : COL.bad}"></i><em style="left:${c.sla * 100}%"></em></div>
        <div class="kv"><span>${pct(Math.min(1, delF))} / SLA ${pct(c.sla)}${missing ? ` · <b style="color:${COL.bad}">${icon("warn", "width:13px;height:13px")}</b>` : ""}</span><span title="${esc(L("ct.pen"))}">${c.penaltyPaid > 0.5 ? "−" + money(c.penaltyPaid) : "—"}</span></div>${served}</div>`;
    }).join("");
    const Lg = S.contractLog;
    const renew = `<button class="toggle" data-act='${esc(JSON.stringify({ type: "policy", key: "autoRenew", on: !S.policy.autoRenew }))}' data-keep-title aria-pressed="${!!S.policy.autoRenew}" title="${esc(L("board.autoRenewTip"))}"><span class="sw"></span><span><b>${esc(L("board.autoRenew"))}</b></span></button>`;
    return kindChips("wide") + sect("doc", L("ct.offers"), `${S.offers.length}`, `<div class="ocards">${offers || `<div class="sub">${esc(L("board.none"))}</div>`}</div>${renew}`)
      + sect("hand", L("board.active"), `${S.contracts.length}`, act || `<div class="sub">—</div>`)
      + sect("flag", L("ct.record"), "", `<div class="kv"><span>${esc(L("ct.signed"))}</span><b>${Lg.signed}</b></div><div class="kv"><span>${esc(L("ct.fulfilled"))}</span><b>${Lg.fulfilled}</b></div><div class="kv"><span>${esc(L("ct.short"))}</span><b>${Lg.failed}</b></div><div class="kv"><span>${esc(L("ct.cancelLate"))}</span><b>${Lg.cancelled || 0} / ${Lg.late || 0}</b></div>`);
  }

  function waterfallSVG(Q) {
    const rev = [["web", Q.web, COL.web], ["train", Q.train, COL.train], ["infer", Q.infer, COL.infer], ["frontier", Q.frontier, COL.frontier], ["contracts", Q.contracts, COL.contract]];
    const cost = [["power", Q.power, COL.pow], ["staff", Q.upkeep + Q.salaries, COL.net], ["transit", Q.transit, "#8FC4FF"], ["interest", Q.interest, COL.debt], ["lease", Q.lease, COL.lease],
      ["water", Q.water, COL.water], ["diesel", Q.diesel, COL.hot], ["carbonTax", Q.carbonTax, COL.carbon], ["fines", Q.fines, COL.bad], ["penalties", Q.penalties, COL.bad],
      ["repairs", Q.repairs, COL.fail], ["other", Q.other, COL.info], ["tax", Q.tax, COL.vc]];
    const items = rev.filter(x => x[1] > 0.5).concat(cost.filter(x => x[1] > 0.5).map(x => [x[0], -x[1], x[2]])).map(x => [esc(L("wf." + x[0])), x[1], x[2]]);
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
    h += `<rect x="${x}" y="${top}" width="${w}" height="${hgt}" rx="2" fill="var(--ink)"/><text class="v" x="${x + w / 2}" y="${top - 3}" text-anchor="middle" style="font-size:10px">${money(run)}</text><text x="${x + w / 2}" y="${base + 12}" text-anchor="end" transform="rotate(-35 ${x + w / 2} ${base + 12})" style="font-size:9.5px">${esc(L("wf.net"))}</text>`;
    void yOf;
    return `<svg viewBox="0 0 ${W} 215" role="img" aria-label="${esc(L("wf.aria"))}">${h}</svg>`;
  }
  function financeHTML(st) {
    const useLast = V.wfLast && S.lastQuarter;
    const Q = useLast ? S.lastQuarter : S.ledger, q = useLast ? S.lastQuarter.q : Math.floor(S.day / 90);
    let out = sect("trend", L("fmt.quarter", { q: q % 4 + 1, y: Math.floor(q / 4) + 1 }), "",
      `<div class="buylease" role="group" style="justify-self:start"><button data-wf="0" aria-pressed="${!useLast}">${esc(L("fin.thisQ"))}</button><button data-wf="1" aria-pressed="${!!useLast}"${S.lastQuarter ? "" : " disabled"}>${esc(L("fin.lastQ"))}</button></div>
       <div class="wfall"${on("finance") ? ` title="${esc(L("fin.taxTip", { p: K.TAX * 100 }))}"` : ""}>${waterfallSVG(Q)}</div>${Q.lost > 0.5 ? `<div class="sub" title="${esc(L("fin.throttleTip"))}">${icon("flame", `color:${COL.hot};width:14px;height:14px`)} −${money(Q.lost)}</div>` : ""}`);
    if (on("finance")) {
      const nw = Sim.netWorth(S), lim = Math.max(0, K.LOAN_LTV * nw);
      out += sect("bank", L("fin.credit"), `${K.INTEREST * 100} %/${L("mk.yr")}`,
        `<div class="stepper"><button data-act='{"type":"repay","amount":${K.LOAN_STEP}}' title="${esc(L("fin.repay"))} ${money(K.LOAN_STEP)}" aria-label="${esc(L("fin.repay"))}">${icon("minus")}</button>
          <div class="val"><span class="big">${money(S.debt)}</span><small title="${esc(L("fin.interest"))}">$${(S.debt * K.INTEREST / K.YEAR).toFixed(2)}k${UPD()}</small></div>
          <button data-act='{"type":"borrow","amount":${K.LOAN_STEP}}' title="${esc(L("fin.borrow"))} ${money(K.LOAN_STEP)}" aria-label="${esc(L("fin.borrow"))}">${icon("plus")}</button></div>
         <div class="meter"><i style="width:${Math.min(100, S.debt / Math.max(1, lim) * 100)}%;background:${COL.debt}"></i></div>
         <div class="kv"><span>${esc(L("fin.limit"))}</span><b>${money(lim)}</b></div>
         <div class="kv"><span>${esc(L("fin.bankrupt"))}</span><b>${money(-S.creditLimit)}</b></div>`);
      const leased = [];
      for (const r of S.racks) for (const d of r.devices.concat(r.pending)) if (d.leased) leased.push({ r, d, pending: r.pending.includes(d) });
      const tot = leased.reduce((a, x) => a + x.d.leaseRate, 0);
      out += sect("tag", L("fin.leases"), `${leased.length} · $${tot.toFixed(2)}k${UPD()}`, leased.length ? `<div class="leaselist">${leased.map(x =>
        `<div><span>${esc(itName(x.d.type))} <small class="sub">${x.r.id}</small></span><span>$${x.d.leaseRate.toFixed(2)}k${UPD()}</span>${x.pending ? `<span class="sub">${icon("truck")}</span>` : actBtn({ type: "returnLease", rack: x.r.id, uid: x.d.uid }, L("dev.return"))}</div>`).join("")}</div>`
        : `<div class="sub" title="${esc(L("fin.leaseHow"))}">—</div>`);
    }
    if (on("investors")) {
      const cv = Sim.companyValue(S), o = S.roundOffer;
      let inner = `<div class="pie">${pieSVG(S.equity.own, COL.equity)}<div style="display:grid;gap:4px;flex:1"><div class="kv"><span>${esc(L("vc.value"))}</span><b>${money(cv)}</b></div><div class="kv"><span>${esc(L("vc.score"))}</span><b>${money(Sim.score(S))}</b></div><div class="kv"><span>${esc(L("vc.raised"))}</span><b>${money(S.equity.raised)}</b></div><div class="kv"><span>${esc(L("vc.rounds"))}</span><b>${S.equity.rounds}</b></div></div></div>`;
      if (o) inner += `<div class="vc"><div class="kv"><span>${icon("person", `color:${COL.vc};width:15px;height:15px`)} <b>${esc(o.vc)}</b></span><span>${icon("clock", "width:13px;height:13px")} ${L("u.days", { d: Math.ceil(o.expires - S.day) })}</span></div>
          <div class="kv"><span><b>${money(o.amount)}</b> → <b>${pct(o.pct)}</b></span><span title="${esc(L("vc.valuation"))}">${money(o.valuation)}</span></div>
          <span class="biased">${esc(L("vc.pitchTag"))}</span><q>${esc(L("vc.pitch", { g: Math.round(K.PITCH_GROWTH * 100) }))}</q>
          <div class="acts buyrow">${actBtn({ type: "acceptRound", id: o.id }, L("vc.accept"), { cls: "good", confirm: true, icon: "check" })}${actBtn({ type: "declineRound", id: o.id }, L("board.decline"), { icon: "cross" })}</div></div>`;
      else inner += `<div class="sub" title="${esc(L("vc.none", { d: K.ROUND_EVERY }))}">—</div>`;
      if (S.board) {
        const b = S.board, tf = clamp01((S.day - b.start) / (b.end - b.start));
        inner += `<div class="kv"><span>${icon("flag", "width:14px;height:14px")} ${esc(L("vc.board"))} · ${L("u.days", { d: Math.ceil(b.end - S.day) })}</span><b>${money(b.rev)} / ${money(b.target)}</b></div>
          <div class="meter" title="${esc(L("vc.boardTip"))}"><i style="width:${clamp01(b.rev / b.target) * 100}%;background:${b.rev / b.target >= tf ? COL.good : COL.warn}"></i><em style="left:${tf * 100}%"></em></div>
          <div class="kv"><span>${esc(L("vc.history"))}</span><span class="hist">${b.history.map(x => `<b style="background:${x.hit ? COL.good : COL.bad}" title="${money(x.rev)} / ${money(x.target)}">${icon(x.hit ? "check" : "cross")}</b>`).join("") || "—"}</span></div>
          ${b.misses ? `<div class="sub" style="color:${COL.bad}">${icon("warn", "width:14px;height:14px")} ${esc(L("ban.boardSub"))}</div>` : ""}`;
      }
      if (S.equity.own < 1) inner += `<div class="buyrow">${actBtn({ type: "buyback" }, L("vc.buyback"), { icon: "pie", confirm: true })}</div>`;
      out += sect("pie", L("vc.title"), pct(S.equity.own), inner);
    }
    return out;
  }

  function facCard(ic, color, title, sub, status, btn) {
    return `<div class="fcard${status === "owned" ? " done" : ""}"><div class="top"><span class="av" style="background:${color}">${icon(ic)}</span>${title}</div><div class="sub">${sub}</div>${status === "owned" ? `<div class="sub" style="color:${COL.good}">${icon("check", "width:14px;height:14px")}</div>` : status || btn || ""}</div>`;
  }
  const buildingStatus = j => j ? `<div class="sub">${icon("wrench", "width:14px;height:14px")} ${L("u.days", { d: Math.ceil(j.left) })}</div><div class="meter slim"><i style="width:${(1 - jobFrac(j)) * 100}%;background:${COL.sel}"></i></div>` : null;
  function energyHTML(st) {
    let out = "";
    const jobOf = (kind, hall) => S.jobs.find(j => j.kind === kind && (hall == null || j.hall === hall));
    const cards = [];
    const g = Sim.gridNext(S);
    cards.push(facCard("bolt", COL.pow, `${esc(L("grid.title"))} ${S.gridKw} kW`, (g ? `→ ${g.kw} kW · ${L("u.days", { d: g.days })}` : S.gridTier >= 3 ? "4/4" : gridNote()) + gridLadder(),
      buildingStatus(jobOf("grid")) || (g || S.gridTier < 3 ? null : "owned"), g ? actBtn({ type: "grid" }, `${money(g.cost)}`, { confirm: true, cls: "primary" }) : ""));
    if (on("facilities")) {
      for (const h of S.halls.filter(x => x.n > 1)) {
        const hc = Sim.hallCost(h.n), HLs = hallLetters(h.n);
        cards.push(facCard("building", COL.info, esc(L("hall.n", { n: h.n })), `+${K.HALL_RACKS} ${icon("cpu", "width:13px;height:13px")} · ${HLs[0]}1–${HLs[2]}${K.COLS} · ${L("u.days", { d: hc.days })}${!h.built && !S.halls[h.n - 2].built ? ` · ${icon("lock", "width:13px;height:13px")} ${esc(L("hall.n", { n: h.n - 1 }))}` : ""}`,
          h.built ? "owned" : buildingStatus(jobOf("buildHall", h.n)), actBtn({ type: "buildHall", hall: h.n }, money(hc.cost), { confirm: true, cls: "primary" })));
      }
      cards.push(facCard("battery", COL.good, esc(L("fac.ups")), esc(L("fac.upsSub")), S.ups ? "owned" : buildingStatus(jobOf("ups")), actBtn({ type: "ups" }, money(K.UPS_COST), { confirm: true, cls: "primary" })));
      for (const h of S.halls.filter(x => x.built)) cards.push(facCard("snow", COL.cool, `CRAC · ${esc(L("hall.n", { n: h.n }))}`, `+${K.CRAC_KW} kW · ${L("u.days", { d: K.CRAC_DAYS })}`, h.crac ? "owned" : buildingStatus(jobOf("crac", h.n)), actBtn({ type: "crac", hall: h.n }, money(K.CRAC_COST), { confirm: true, cls: "primary" })));
    }
    if (on("energy")) cards.push(facCard("sun", COL.rep, esc(L("fac.solar")), esc(L("fac.solarSub", { kw: K.SOLAR_KW, p: K.BATTERY_SHAVE * 100 })), S.solar ? "owned" : buildingStatus(jobOf("solar")), actBtn({ type: "solar" }, money(K.SOLAR_COST), { confirm: true, cls: "primary" })));
    out += sect("building", L("fac.title"), "", `<div class="buyrow">${cards.join("")}</div>`);
    if (on("energy")) {
      const sp = S.history.slice(-72).map(h => h.sp).filter(x => x != null);
      let ppa;
      if (S.ppa && S.day < S.ppa.end) {
        const tf = clamp01((S.day - S.ppa.start) / (S.ppa.end - S.ppa.start));
        ppa = `<div class="kv"><span>${icon("leaf", `color:${COL.carbon};width:14px;height:14px`)} PPA ${S.ppa.kw} kW · $${(S.ppa.price * 1000).toFixed(1)}/kW·d</span><b>${L("u.days", { d: Math.ceil(S.ppa.end - S.day) })}</b></div>
          <div class="meter" title="${esc(L("ct.timeTip"))}"><i style="width:${tf * 100}%;background:${COL.carbon}"></i></div>
          <div class="kv"><span>${esc(L("en.draw"))}</span><b>${st.facility.toFixed(0)} kW${st.facility < S.ppa.kw ? ` <small style="color:${COL.bad}" title="${esc(L("en.unused"))}">(−${(S.ppa.kw - st.facility).toFixed(0)} kW)</small>` : ""}</b></div>`;
      } else {
        const q = Sim.ppaQuote(S);
        ppa = `<div class="stepper"><button data-ppa="-1" aria-label="−">${icon("minus")}</button><div class="val"><span class="big">${V.ppaKw} kW</span><small>${L("u.days", { d: K.PPA_DAYS })} · $${(q * 1000).toFixed(1)}/kW·d = $${(V.ppaKw * q).toFixed(1)}k${UPD()}</small></div><button data-ppa="1" aria-label="+">${icon("plus")}</button></div>
          <div class="meter" title="${esc(L("en.sizeTip"))}"><i style="width:${Math.min(100, V.ppaKw / Math.max(1, st.facility) * 100)}%;background:${V.ppaKw > st.facility ? COL.warn : COL.carbon}"></i></div>
          <div class="kv"><span>${esc(L("en.draw"))}</span><b>${st.facility.toFixed(0)} kW</b></div>
          <div class="buyrow" title="${esc(L("en.ppaTip"))}">${actBtn({ type: "ppa", kw: V.ppaKw }, `PPA ${V.ppaKw} kW`, { confirm: true, cls: "good", icon: "leaf" })}</div>`;
      }
      out += sect("trend", L("en.price"), `$${(st.spot * 1000).toFixed(1)}/kW·d`, `<div class="hbm">${spark(sp, 360, 60, COL.pow, { label: L("en.price") })}</div>
        <div class="kv"><span>${esc(L("en.green"))}</span><b>${pct(st.green)}</b></div>${st.solarKw ? `<div class="kv"><span>${esc(L("fac.solar"))}</span><b>${st.solarKw.toFixed(0)} kW</b></div>` : ""}${st.dieselKw ? `<div class="kv"><span>${esc(L("en.gen"))}</span><b>${st.dieselKw.toFixed(0)} kW</b></div>` : ""}` + ppa);
    }
    if (on("environment")) {
      const hallsHTML = S.halls.filter(h => h.built).map(h => {
        const hs = st.halls.find(x => x.n === h.n), job = jobOf("cooling", h.n);
        return `<div class="kv"><span>${icon("building", "width:14px;height:14px")} ${esc(L("hall.n", { n: h.n }))} · PUE ${hs ? hs.pue : "-"}</span>${job ? `<span class="sub">${icon("wrench", "width:13px;height:13px")} ${L("u.days", { d: Math.ceil(job.left) })}</span>` : ""}</div>
          <div class="buylease" role="group">${["evap", "chiller"].map(m => `<button data-act='${esc(JSON.stringify({ type: "cooling", hall: h.n, mode: m }))}' data-confirm aria-pressed="${h.cooling === m}" title="${esc(L("cool." + m + "Tip", { p: K.PUE[m] }) + " · " + L("c.cooling", { m: L("cool." + m), x: K.COOL_SWITCH_COST, d: K.COOL_SWITCH_DAYS }))}">${icon(m === "evap" ? "drop" : "snow")}${esc(L("cool." + m))}${V.confirm === JSON.stringify({ type: "cooling", hall: h.n, mode: m }) ? " ?" : ""}</button>`).join("")}</div>`;
      }).join("");
      const co2 = S.history.slice(-72).map(h => h.co2).filter(x => x != null);
      out += sect("drop", L("en.cooling"), S.drought ? `${icon("warn", "width:14px;height:14px")} ${esc(L("ban.drought"))}` : "", hallsHTML +
        `<div class="gpair"><div class="gaugec">${arcGauge(st.waterRate / 400, COL.water, `${Math.round(st.waterRate)}`, L("en.water"))}</div><div class="gaugec">${arcGauge(st.carbon / 3, COL.carbon, st.carbon.toFixed(1), L("en.co2"))}</div></div>
         <div class="kv"><span>${esc(L("en.totals"))}</span><b>${Math.round(S.env.water)} m³ · ${Math.round(S.env.carbon)} t CO2</b></div>
         <div class="hbm">${spark(co2, 360, 40, COL.carbon, { label: L("en.co2") })}</div>
         ${S.policyFx.carbonTax ? `<div class="kv"><span>${esc(L("pol.carbonTax.short"))}</span><b>$${Math.round(S.policyFx.carbonTax * 1000)}/t</b></div>` : ""}`);
    }
    return out;
  }

  function affairsHTML(st) {
    let out = "";
    if (on("reputation")) {
      const rv = Sim.repOf(S), hist = S.history.slice(-72).map(h => h.rep).filter(x => x != null), scandal = S.day < S.scandalUntil;
      out += sect("star", L("rep.title"), `${rv.toFixed(1)} / 100`, `<div class="gpair" title="${esc(L("rep.tip", { f: Sim.repFactor(S).toFixed(2) }))}"><div class="gaugec">${arcGauge(rv / 100, COL.rep, Math.round(rv), L("rep.title"))}</div><div class="hbm" style="align-self:center">${spark(hist, 200, 60, COL.rep, { ref: K.REP_START, label: L("rep.title") })}</div></div>
        <div class="kv"><span>${esc(L("rep.factor"))}</span><b>×${Sim.repFactor(S).toFixed(2)}</b></div>
        ${scandal ? `<div class="sub" style="color:${COL.bad}" title="${esc(L("rep.scandalTip"))}">${icon("warn", "width:14px;height:14px")} ${esc(L("rep.scandal"))} · ${L("u.days", { d: Math.ceil(S.scandalUntil - S.day) })}</div>` : ""}
        <div class="buyrow">${actBtn({ type: "pr" }, `${L("rep.pr")} · ${money(K.PR_COST)}`, { confirm: true, cls: "primary", icon: "news" })}</div>`);
    }
    if (on("policy")) {
      const ps = S.policies.filter(p => p.announced).map(p => {
        const span = p.vote - p.announceDay, tf = clamp01((S.day - p.announceDay) / span);
        const sigs = p.signals.map(x => `<b style="background:${x.up ? COL.good : COL.bad}" title="${esc(L(x.up ? "pol.sigUp" : "pol.sigDown"))} (${dateOf(x.day)})">${icon(x.up ? "trend" : "warn")}</b>`).join("") + Array.from({ length: Math.max(0, 2 - p.signals.length) }, () => `<b class="q" title="${esc(L("pol.sigWait"))}">?</b>`).join("");
        const lob = p.status === "proposed" ? (p.lobbied ? `<div class="sub">${icon("bank", "width:14px;height:14px")} ${p.lobbied > 0 ? "+" : "−"}${K.LOBBY_SHIFT * 100} %</div>`
          : `<div class="buyrow">${actBtn({ type: "lobby", policy: p.id, dir: 1 }, L("pol.for"), { confirm: true, icon: "trend" })}${actBtn({ type: "lobby", policy: p.id, dir: -1 }, L("pol.against"), { confirm: true, icon: "warn" })}</div>`) : "";
        return `<div class="policy" title="${esc(L("pol." + p.kind + ".b"))}"><div class="top">${icon("flag", `color:${COL.bad}`)}<b>${esc(L("pol." + p.kind))}</b><span class="status ${p.status}">${esc(L("pol.st." + p.status))}</span></div>
          ${p.status === "proposed" ? `<div class="kv"><span>${icon("clock", "width:13px;height:13px")} ${dateOf(p.vote)}</span><b>${L("u.days", { d: Math.ceil(p.vote - S.day) })}</b></div><div class="meter slim"><i style="width:${tf * 100}%;background:${COL.warn}"></i></div>` : ""}
          <div class="signals">${sigs}</div>${lob}</div>`;
      }).join("");
      const fx = S.policyFx, eff = [];
      if (fx.carbonTax) eff.push(`${icon("leaf", "width:14px;height:14px")} ${esc(L("pol.carbonTax.short"))} $${Math.round(fx.carbonTax * 1000)}/t ↑`);
      if (fx.mandate) eff.push(`${icon("gauge", "width:14px;height:14px")} PUE ≤ ${K.MANDATE_PUE} ${S.day < fx.mandate.deadline ? `· ${dateOf(fx.mandate.deadline)}` : "✓"}`);
      if (fx.exportCtl) eff.push(`${icon("lock", "width:14px;height:14px")} ${esc(L("pol.export.short"))} ${S.exportUsed}/${K.EXPORT_QUOTA}`);
      out += sect("flag", L("pol.title"), "", (ps || `<div class="sub">—</div>`) +
        `<div class="sub">${esc(L("pol.lobbyTip", { x: money(K.LOBBY_COST), p: K.LOBBY_SHIFT * 100, leak: K.LOBBY_LEAK * 100 }))}</div>` +
        (eff.length ? `<div style="display:grid;gap:4px">${eff.map(e => `<div class="kv"><span>${e}</span></div>`).join("")}</div>` : ""));
    }
    return out || `<div class="sub">${icon("lock")} ${esc(L("c.locked", { n: 15 }))}</div>`;
  }

  /* ================= v4 order board: THE primary element (CONTRACTS_CORE.md) =================
   * Visible from day 0. Each offer shows its kind, its terms (serving: units × days, start; jobs: work, pay, deadline),
   * its price vs the market index, whether you can deliver it (spare capacity vs need) and big Sign / Decline buttons.
   * Below the offers: every active contract as a pill in its link colour; the racks serving it carry the same colour. */
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
    const tip = `${o.cust} · ${kindName} · ${offerTerms(o).join(" · ")} · SLA ${pct(o.sla)} · ${L("board.penalty", { x: (o.penalty * 1000).toFixed(0) })}${Sim.isJob(o) ? ` · ${L("board.lateFee", { x: money(o.lateFee || 0) })}` : ""}`;
    const fresh = !V.boardSeen.has(o.id);        // only a new card slides in (the board re-renders every second)
    V.boardSeen.add(o.id);
    // v0.4.2 deliverability bar (telemetry: 36 units signed on 16 of capacity): the track is your capacity at the offer's
    // start (the tick at 2/3 of the bar = 100 %); grey = already committed over its window, colour = this offer, red =
    // past 100 % (overbooked). Signing an overbooking offer needs a second tap (the button wobbles first).
    const U = 100 / 1.5, cap = Math.max(1e-9, f.cap), a = f.cap > 0 ? Math.min(f.peak, cap) / cap : 0;
    const b = f.cap > 0 ? Math.max(0, Math.min(f.peak + f.need, cap) - f.peak) / cap : 0;
    const c = f.cap > 0 ? Math.min(0.5, Math.max(0, f.peak + f.need - cap) / cap) : 0.5;
    const bar = `<span class="bar"><i class="cm" style="width:${(a * U).toFixed(1)}%"></i><i class="nw" style="left:${(a * U).toFixed(1)}%;width:${(b * U).toFixed(1)}%"></i>${f.over ? `<i class="ov" style="left:${U.toFixed(1)}%;width:${(c * U).toFixed(1)}%"></i>` : ""}</span>`;
    const fitTip = f.over ? L("board.overTip", { n: +(f.peak + f.need - f.cap).toFixed(1) }) : L("board.freeTip");
    return `<div class="ocard k-${k}${o.stretch ? " stretch" : ""}${o.starter ? " starter" : ""}${f.over ? " over" : ""}${fresh ? " fresh" : ""}" style="--wc:${kindCol(k)}" data-offer="${o.id}" title="${esc((o.starter ? L("board.starterTip") + " · " : "") + tip)}">
      <div class="ot"><span class="av" style="background:${kindCol(k)}" title="${esc(kindName)}">${icon(ic)}</span><span class="on"><b>${esc(o.cust)}</b><small>${offerTerms(o).map(esc).join(" · ")}</small></span>
        <span class="op" title="${esc(L("board.priceTip"))}"><b>$${(o.price * 1000).toFixed(0)}</b><small class="${up ? "up" : "down"}" title="${esc(L("board.vsIndex", { sign: up ? "+" : "−", p: Math.abs(diff).toFixed(0) }))}">${up ? "▲" : "▼"}${Math.abs(diff).toFixed(0)} %</small></span></div>
      <div class="oa">${actBtn({ type: "signContract", id: o.id }, o.bts ? `${L("board.sign")} · ${money(o.fitout)}` : L("board.sign"), { cls: `good sign${f.over ? " over" : ""}`, icon: f.over ? "warn" : "hand", confirm: !!o.bts || f.over })}${actBtn({ type: "declineContract", id: o.id }, "", { cls: "decl", icon: "cross", title: L("board.decline") })}<span class="ofit ${f.level}${f.over ? " over" : ""}" title="${esc(fitTip)}">${bar}<span>${esc(L("board.free", { free: f.free < 10 ? f.free.toFixed(1).replace(/\.0$/, "") : Math.round(f.free), need: +f.need.toFixed(1) }))}</span></span><small class="expd" title="${esc(L("board.expires", { d: Math.ceil(left) }))}">${icon("clock", "width:12px;height:12px")}${L("u.days", { d: Math.ceil(left) })}</small></div>
      <span class="exp" aria-hidden="true"><i style="width:${Math.min(100, left / ttl * 100).toFixed(0)}%"></i></span></div>`;
  }
  function contractPill(c, st, ob) {
    const k = kindOf(c), [ic] = KIND[k] || KIND.web, col = QOL.linkColor(c.id), miss = (st.cMiss[c.id] || 0) > 1e-6;
    // v0.4.2: a missed customer shows how many days it will wait ("⏳ 12d"); a contract in an overbooked market is dashed red
    const walk = Sim.walkIn(S, c), o = ob && ob[c.w], short = !!(o && o.short > 0.5 && c.start <= o.at + 1e-9 && o.at < c.end);
    let f, left;
    if (Sim.isJob(c)) { f = clamp01(c.done / c.work); left = c.deadline - S.day; }
    else if (S.day < c.start) { f = 0; left = c.start - S.day; }
    else { const el = Math.max(0.01, S.day - c.start); f = clamp01(c.delivered / (c.units * el)); left = c.end - S.day; }
    const racks = [...new Set((st.alloc || []).filter(l => l.id === c.id).map(l => l.rack))];
    const tip = `${c.cust} · ${L("kind." + k)} · ${c.units}u · ${Sim.isJob(c) ? `${Math.round(c.done)}/${Math.round(c.work)} u·d · ${L("board.due", { d: Math.ceil(c.deadline - S.day) })}` : S.day < c.start ? L("board.starts", { d: Math.ceil(c.start - S.day) }) : `${pct(Math.min(1, f))} / SLA ${pct(c.sla)} · ${L("u.days", { d: Math.ceil(c.end - S.day) })}`} · ${racks.length ? L("board.served", { racks: racks.join(", ") }) : L("board.unserved")}`;
    const wt = walk != null ? L("board.leavesTip", { d: Math.ceil(walk) }) + " · " : short ? L("board.shortTip") + " · " : "";
    return `<button class="cpill${miss ? " miss" : ""}${walk != null ? " walking" : ""}${short ? " short" : ""}${S.day < c.start ? " soon" : ""}${c.anchor ? " anchor" : ""}" data-contract="${c.id}" style="--lc:${col}" title="${esc(wt + tip)}"><i class="sw"></i>${icon(ic)}<span>${esc(c.cust.split(" ")[0])}</span><span class="m"><i style="width:${(f * 100).toFixed(0)}%"></i>${Sim.isJob(c) ? "" : `<em style="left:${c.sla * 100}%"></em>`}</span>${walk != null ? `<small class="walk">⏳${esc(L("board.leaves", { d: Math.ceil(walk) }))}</small>` : ""}</button>`;
  }
  /* kind filter chips (All + each kind present, icon + count); the choice is remembered (localStorage, guarded) */
  V.kf = (() => { const v = store.get(KF_KEY); return v && (v === "all" || QOL.KINDS.includes(v)) ? v : "all"; })();
  function kindChips(cls) {
    const n = QOL.kindCounts(S.offers, S.contracts);
    const chip = (k, ic, title) => `<button class="kchip${V.kf === k ? " on" : ""}" data-kf="${k}" aria-pressed="${V.kf === k}" title="${esc(title)}">${icon(ic, "width:12px;height:12px")}<b>${n[k]}</b></button>`;
    return `<div class="kchips ${cls || ""}" role="group" aria-label="${esc(L("kf.aria"))}">${chip("all", "layers", L("kf.all"))}${QOL.KINDS.filter(k => n[k] > 0 || V.kf === k).map(k => chip(k, (KIND[k] || KIND.web)[0], L("kind." + k))).join("")}</div>`;
  }
  function setKindFilter(k) {
    V.kf = k === V.kf ? "all" : k;
    store.set(KF_KEY, V.kf);
    TELE.event(S.day, "kindFilter", { k: V.kf });
    renderAll();
    if (V.drawer === "contracts") renderDrawer(Sim.stats(S));
  }
  function webPriceChip(st) {
    const h = Sim.held(S).web, f = Sim.webPriceF(S), p = st.mk.web.price * (1 + K.CONTRACT_PREMIUM) * Sim.repFactor(S) * f;
    const hMax = Math.max(2 * K.WEB_DREF, 1.6 * h), W = 44, H = 14, X = x => (x / hMax * W).toFixed(1), Y = v => (1 + (1 - v) * (H - 2)).toFixed(1);
    const pts = Array.from({ length: 23 }, (_, i) => { const x = i / 22 * hMax; return `${X(x)},${Y(Sim.webPriceAt(x))}`; }).join(" ");
    const down = f < 0.999, cls = f <= K.WEB_FLOOR + 1e-9 ? " floor" : f < 0.6 ? " low" : down ? " warm" : "";
    return `<span class="wprice${cls}" title="${esc(L("board.webPrice", { x: (p * 1000).toFixed(0), p: Math.round(f * 100), h: Math.round(h) }))}">${icon("globe", "width:11px;height:11px")}<b>$${(p * 1000).toFixed(0)}</b>${down ? "▼" : ""}<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="1.3" opacity=".75"/><circle cx="${X(Math.min(h, hMax))}" cy="${Y(f)}" r="2.4" fill="currentColor"/></svg></span>`;
  }
  function renderOffers(st) {
    const el = $("offerstrip");
    const vis = Sim.contractsOn(S);
    show(el, vis);
    if (!vis) { el.innerHTML = ""; return; }
    const list = QOL.byKind(S.offers, V.kf).slice().sort((a, b) => a.expires - b.expires);
    const nextIn = S.nextOffer != null ? Math.max(0, Math.ceil(S.nextOffer - S.day)) : null;
    const ob = Sim.overbook(S, st), obW = ["web", "train", "infer"].filter(w => ob[w].short > 0.5);
    V.overbook = ob;
    // v0.4.2: overbooked = commitments (active + signed-future) above the capacity you will have. Web price trend (D61): the
    // price of the NEXT web contract at the volume you already hold, with the curve and your position on it (soft signal)
    const obChip = obW.length ? `<small class="obk" title="${esc(obW.map(w => L("board.overHead", { n: Math.ceil(ob[w].short), w: "@wl." + w, d: Math.max(0, Math.ceil(ob[w].at - S.day)) })).join(" · "))}">${icon("warn", "width:12px;height:12px")}−${obW.map(w => Math.ceil(ob[w].short)).join("/")}</small>` : "";
    const satChip = webPriceChip(st);
    // text diet: icon + count; "next offer" and auto-renew are an icon chip and a switch, their words in tooltips
    // v0.4.5 (layout hotfix, the floor never collapses): the head is ONE chip row (title, price, kinds, next, auto-renew, then
    // the contract pills); offers are compact cards in one row that scrolls sideways; zero offers = a slim strip, no placeholders
    const nextTxt = nextIn != null ? L("board.next", { d: nextIn }) : "";
    const nextChip = list.length ? (nextIn != null ? `<small class="bnext" title="${esc(L("board.nextTip"))}">${icon("mail", "width:12px;height:12px")}${esc(nextTxt)}</small>` : "")
      : `<small class="bnone" title="${esc(L("board.nextTip"))}">${icon("mail", "width:12px;height:12px")}${esc(L("board.none"))}${nextTxt ? " · " + esc(nextTxt) : ""}</small>`;
    const head = `<div class="oshead" data-drawer="contracts" title="${esc(L("board.headTip"))}"><span class="bt">${icon("hand")}<b>${esc(L("board.title"))}</b><span class="badge" id="board-badge">${S.offers.length}</span></span>${obChip}${satChip}${kindChips("mini")}${nextChip}<button class="toggle mini" data-act='${esc(JSON.stringify({ type: "policy", key: "autoRenew", on: !S.policy.autoRenew }))}' data-keep-title aria-pressed="${!!S.policy.autoRenew}" title="${esc(L("board.autoRenew") + ": " + L("board.autoRenewTip"))}" aria-label="${esc(L("board.autoRenew"))}"><span class="sw"></span>${icon("undoarrow", "width:12px;height:12px")}</button></div>`;
    const cards = list.map(o => offerCard(o, st)).join("");
    const pills = QOL.byKind(S.contracts, V.kf).map(c => contractPill(c, st, ob)).join("");
    if (V.boardSeen.size > 100) V.boardSeen = new Set(S.offers.map(o => o.id));   // bounded: only live offers matter
    if (previewCache.size > 30) previewCache.clear();
    const sx = el.querySelector(".bcards"), keepX = sx ? sx.scrollLeft : 0;
    el.innerHTML = `<div class="bhead">${head}<div class="cpills" role="list" aria-label="${esc(L("board.active"))}">${pills}</div></div>` + (list.length ? `<div class="bcards">${cards}</div>` : "");
    el.classList.toggle("none", !list.length);
    if (keepX && el.querySelector(".bcards")) el.querySelector(".bcards").scrollLeft = keepX;
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
    $("kt").textContent = c.title; $("ksub").innerHTML = c.sub || "";
    $("kbody").innerHTML = c.body; $("kfoot").innerHTML = c.foot || `<button class="end" data-close>${esc(L("btn.gotIt"))}</button>`;
    $("card").dataset.key = c.key;
    if (c.pause && V.speed) setSpeed(0);   // warnings only: the game stays paused after "Got it" (DECISIONS D46)
    openDialog($("card"));
    SND(c.sound || "warn");
    dlog("card", c.key);
  }
  const SCARE_TITLES = new Set(C.SCARES.map(x => x.title));
  const pausedSub = () => `${esc(dateOf(S.day))} · ${icon("pause", "width:13px;height:13px;vertical-align:-2px")}`;
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
        queueCard({ key: "scare", title: L("card.scare.t"), sub: pausedSub(),
          body: `<div class="kv big" title="${esc(newsB(n))}"><span>${icon("layers", `color:${COL.mem}`)} <b>${esc(newsT(n))}</b></span></div>
            <ul class="plain"><li>${icon("truck")}<span>${esc(L("card.scare.1", { d: K.SHORT_SHIP_DAYS, n: K.SHIP_DAYS }))}</span></li>
            <li>${icon("news")}<span>${esc(L("card.scare.2"))}</span></li>
            <li>${icon("lock")}<span>${esc(L("card.scare.3", { d: K.FORWARD_DAYS }))}</span></li></ul>`,
          foot: `${k ? actBtn({ type: "forward", item: k }, `${L("card.scare.fwd", { it: itName(k) })} · ${money(it.price)}`, { cls: "primary", icon: "truck" }) : ""}<button class="end" data-close>${esc(L("card.wait"))}</button>` });
      }
    }
    if (on("policy") && !V.firsts.policy) {
      const p = S.policies.find(x => x.announced && x.status === "proposed");
      if (p) {
        V.firsts.policy = true;
        queueCard({ key: "policy", title: L("card.pol.t", { pol: L("pol." + p.kind) }), sub: `${icon("clock", "width:13px;height:13px;vertical-align:-2px")} ${esc(dateOf(p.vote))} · ${icon("pause", "width:13px;height:13px;vertical-align:-2px")}`,
          body: `<div class="sub">${esc(L("pol." + p.kind + ".b"))}</div><ul class="plain"><li>${icon("trend")}<span>${esc(L("card.pol.1"))}</span></li>
            <li>${icon("bank")}<span>${esc(L("card.pol.2", { x: money(K.LOBBY_COST), p: K.LOBBY_SHIFT * 100, leak: K.LOBBY_LEAK * 100 }))}</span></li></ul>`,
          foot: `${actBtn({ type: "lobby", policy: p.id, dir: -1 }, L("pol.against"), { icon: "warn" })}${actBtn({ type: "lobby", policy: p.id, dir: 1 }, L("pol.for"), { icon: "trend" })}<button class="end" data-close>${esc(L("card.ignore"))}</button>` });
      }
    }
    if (on("investors") && !V.firsts.round && S.roundOffer) {
      V.firsts.round = true;
      const o = S.roundOffer;
      queueCard({ key: "round", title: `${o.vc}: ${money(o.amount)} → ${pct(o.pct)}`, sub: `${icon("clock", "width:13px;height:13px;vertical-align:-2px")} ${L("u.days", { d: Math.ceil(o.expires - S.day) })} · ${icon("pause", "width:13px;height:13px;vertical-align:-2px")}`,
        body: `<span class="biased">${esc(L("vc.pitchTag"))}</span><q>${esc(L("vc.pitch", { g: Math.round(K.PITCH_GROWTH * 100) }))}</q><ul class="plain">
          <li>${icon("pie")}<span>${esc(L("card.vc.1", { a: pct(S.equity.own), b: pct(S.equity.own * (1 - o.pct)) }))}</span></li>
          <li>${icon("flag")}<span>${esc(L("card.vc.2", { d: K.BOARD_EVERY }))}</span></li></ul>`,
        foot: `${actBtn({ type: "acceptRound", id: o.id }, L("vc.accept"), { cls: "good", icon: "check" })}${actBtn({ type: "declineRound", id: o.id }, L("board.decline"), { icon: "cross" })}<button class="end" data-close>${esc(L("card.later"))}</button>` });
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
    // text diet: cash, the line, days left, then 3 icon fixes (the 4th only with finance)
    const body = why => `<div class="kv big"><span>${icon("coin")} <b>${Math.abs(S.cash) < 1 ? "$" + S.cash.toFixed(1) + "k" : money(S.cash)}</b></span><b style="color:${COL.bad}" title="${esc(L("tip.floor"))}">${icon("warn")} ${money(floor)}</b></div>
      ${why ? `<div class="sub">${why}</div>` : ""}<ul class="plain">
      <li>${icon("coin")}<span>${esc(L("card.cash.1"))}</span></li>
      <li>${icon("power")}<span>${esc(L("card.cash.2"))}</span></li>
      ${on("finance") ? `<li>${icon("bank")}<span>${esc(L("card.cash.3"))}</span></li>` : on("ops") ? `<li>${icon("person")}<span>${esc(L("card.cash.4"))}</span></li>` : ""}</ul>`;
    if (S.cash < 0 && !V.warned.neg) {
      V.warned.neg = true;
      queueCard({ key: "neg", pause: true, sound: "alarm", title: L("card.neg.t"), sub: pausedSub(),
        body: body(R0 ? `${icon("clock", "width:14px;height:14px;vertical-align:-2px")} ${perDay(R0.net)} · <b>${L("u.days", { d: Math.round(rw) })}</b>` : "") });
    }
    if (rw != null && rw < 30 && !V.warned.rw) {
      V.warned.rw = true;
      queueCard({ key: "runway", pause: true, sound: "alarm", title: L("card.runway.t", { d: Math.max(1, Math.round(rw)) }), sub: pausedSub(),
        body: body(`${perDay(R0.net)} · ${icon("warn", "width:14px;height:14px;vertical-align:-2px")} <b>${esc(dateOf(S.day + rw))}</b>`) });
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
    if (big.length) toast(big.slice(0, 3).map(e => `${cashLabel(e)} ${e.amt >= 0 ? "+" : "−"}${money(Math.abs(e.amt))}`).join(" · "), "keep");
    if (news.length) dlog("[cash] events", news.map(e => `${e.kind} ${e.amt}`).join(", "));
    V.cashSeen = seq;
    const P = V.flowPrev;
    if (P) {   // anything left over is a jump nobody logged: say so, never stay silent (and flag it in debug)
      const gap = (S.cash - P.cash) - (flow - P.flow) - logged;
      if (Math.abs(gap) >= 10) { toast(`${L("cash.oneoff")} ${gap >= 0 ? "+" : "−"}${money(Math.abs(gap))}`, "keep"); console.warn("[ui] unexplained cash jump", gap.toFixed(1), "day", S.day); }
    }
    V.flowPrev = { cash: S.cash, flow };
  }

  /* v4 cash events as signals: money floats from where it happened, losses get a short red screen-edge vignette,
     contract outcomes fly to / flash on the order board, all with a sound; no sentences (tooltips keep the label) */
  const TOLD = new Set(["tax", "repair", "sale"]);
  /* a cash event's short label (text diet: ≤ 5 words; the number follows): "cash.<kind>" with the event's params */
  const cashLabel = e => (I18 && I18.has("cash." + e.kind) ? L("cash." + e.kind, Object.assign({ it: "", c: "" }, e.p || {})) : e.label);
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
        const cust = e.p && e.p.c ? e.p.c : (e.label || "").split(/ terminated| cancelled/)[0];
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
    const vals = [you, g ? g.score : 0, p ? p.score : 0], max = Math.max(1, ...vals.map(v => Math.abs(v)));
    const verdict = !g ? "…" : L(you >= g.score ? "pace.ahead" : "pace.behind", { a: BOTNAME(PACE_POLS[0]) });
    const col = !g ? COL.hudGood : you >= g.score ? COL.hudGood : COL.hudBad;
    const bar = (v, c, t) => `<i title="${esc(t)}" style="width:${Math.max(2, Math.abs(v) / max * 100).toFixed(1)}%;background:${c}"></i>`;
    const key = [Math.round(you), g && Math.round(g.score), g && g.day, p && Math.round(p.score), p && p.day, today].join("|");
    if (el._k === key) return;
    el._k = key;
    el.innerHTML = `${icon("trend", `color:${col}`)}<div><span class="big" style="color:${col}">${verdict}</span>
      <div class="pacebars">${bar(vals[0], COL.sel, `${L("pace.you")} ${money(you)}`)}${bar(vals[1], COL.net, `${BOTNAME(PACE_POLS[0])} ${g ? money(g.score) : "…"}`)}${bar(vals[2], COL.train, `${BOTNAME(PACE_POLS[1])} ${p ? money(p.score) : "…"}`)}</div></div>`;
    el.title = `${L("pace.vs", { a: BOTNAME(PACE_POLS[0]), b: BOTNAME(PACE_POLS[1]) })}: ${L("pace.tip", { a: BOTNAME(PACE_POLS[0]), b: BOTNAME(PACE_POLS[1]) })}\n${L("pace.you")} ${money(you)} · ${BOTNAME(PACE_POLS[0])} ${g ? money(g.score) : "…"} · ${BOTNAME(PACE_POLS[1])} ${p ? money(p.score) : "…"}`;
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
    V.chapShown = i;
    const c = CH[i], m = CH_META[c.key] || { icons: [], col: "info" };
    const col = COL[m.col] || COL.info;
    // text diet: ≤ 3 bullets, each with an icon; "where to find it" is behind an ⓘ toggle (progressive disclosure)
    $("ct").textContent = chTitle(c);
    $("csub").innerHTML = `${esc(L("ch.sub", { i: i + 1, n: CH.length }))} · ${esc(dateOf(S.day))} · ${icon("pause", "width:13px;height:13px;vertical-align:-2px")}`;
    $("cbody").innerHTML = `<ul>${chBullets(c).map((b, k) => `<li style="--i:${k}"><span class="av" style="background:${col}">${icon(m.icons[k] || "flag")}</span><span>${esc(b)}</span></li>`).join("")}</ul>
      ${c.key === "gpu" ? chapterRoofline() : ""}
      ${I18 && I18.has("ch." + c.key + ".where") ? `<details class="where"><summary title="${esc(L("ch.whereTip"))}">ⓘ</summary><span>${esc(L("ch." + c.key + ".where"))}</span></details>` : ""}`;
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
    return `<div class="chroof" title="${esc(L("ch.gpu.roofTip"))}"><div class="pair">${demo("train", `<b style="color:${R.train.color}">${esc(R.train.name)}</b>: C1 ${v("c1", "train")} · M1 ${v("m1", "train")}`)}${demo("infer", `<b style="color:${R.infer.color}">${esc(R.infer.name)}</b>: M1 ${v("m1", "infer")} · C1 ${v("c1", "infer")}`)}</div></div>`;
  }
  function showSandboxCard() {
    V.chapShown = -1;
    $("ct").textContent = L("menu.sandbox");
    $("csub").innerHTML = `${esc(L("sb.sub", { n: CH.length }))} · ${icon("pause", "width:13px;height:13px;vertical-align:-2px")}`;
    $("cbody").innerHTML = `<div class="sub">${esc(L("sb.body"))}</div>
      <div class="chaps">${CH.map((c, i) => { const m = CH_META[c.key]; return `<span><span class="av" style="background:${COL[m.col] || COL.info}">${icon(m.icons[0])}</span>${i + 1}. ${esc(chTitle(c))}</span>`; }).join("")}</div>`;
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
    const K2 = [[L("kbd.space"), "key.space"], ["1 2 3 4", "key.speed"], ["N", "key.skip"], ["V", "key.v"], ["M", "key.m"], ["F", "key.f"], ["R", "key.r"],
      ["Ctrl/⌘ C", "key.copy"], ["Ctrl/⌘ V", "key.paste"], ["Ctrl/⌘ D", "key.dup"], ["Ctrl/⌘ Z", "key.undo"], ["A", "key.alerts"], ["O", "key.settings"], ["L", "key.lang"],
      ["Esc", "key.esc"], ["?", "key.help"], ["Shift", "key.shift"], ["Shift", "key.shiftClick"], [L("kbd.rclick"), "key.right"]];
    $("ky-t").textContent = L("keys.title");
    $("ky-body").innerHTML = `<div class="keys">${K2.map(([k, t]) => `<div><kbd>${esc(k)}</kbd><span>${esc(L(t))}</span></div>`).join("")}</div>`;
    $("ky-foot").innerHTML = (S ? `<button class="btn" id="ky-chap">${icon("help")}${esc(L("keys.chapter"))}</button>` : "") + `<button class="end" data-close>${esc(L("btn.ok"))}</button>`;
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
      return `<div class="slotrow"><b>${esc(L("set.slot", { n }))}</b><small>${m ? `${esc(L(m.sandbox ? "menu.sandbox" : "menu.campaign"))} · ${esc(L("menu.seed"))} ${m.seed} · ${esc(dateOf(m.day))} · ${money(m.score)}` : esc(L("set.empty"))}</small>
        <button class="btn" data-slot-save="${n}"${S && !S.over ? "" : " disabled"}>${icon("download")}${esc(L("set.save"))}</button><button class="btn" data-slot-load="${n}"${m ? "" : " disabled"}>${icon("play1")}${esc(L("set.load"))}</button></div>`;
    }).join("");
    return `<section class="sect"><h3>${icon("sound")}${esc(L("set.sound"))}</h3>${rng("master", "set.master")}${rng("sfx", "set.sfx")}${rng("hum", "set.hum")}</section>
      <section class="sect"><h3>${icon("expand")}${esc(L("set.display"))}</h3>
        <label class="srow"><span>${esc(L("set.reduced"))}</span><select data-setsel="reduced"><option value=""${SET.reduced == null ? " selected" : ""}>${esc(L("set.system"))}</option><option value="1"${SET.reduced === true ? " selected" : ""}>${esc(L("set.on"))}</option><option value="0"${SET.reduced === false ? " selected" : ""}>${esc(L("set.off"))}</option></select></label>
        <label class="srow"><span>${esc(L("set.scale"))}</span><select data-setsel="scale">${[[1, L("set.scaleAuto")], [0.9, "90 %"], [0.8, "80 %"], [0.7, "70 %"]].map(([v, t]) => `<option value="${v}"${+SET.scale === v ? " selected" : ""}>${esc(t)}</option>`).join("")}</select></label>
        <div class="srow"><span>${esc(L("set.lang"))}</span>${langToggleHTML("st")}</div>
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
      else nope(L("set.blocked"), sv);
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
      try { await navigator.clipboard.writeText(body); toast(L("set.copied")); } catch (e2) { nope(L("set.exportFail"), $("st-export")); }
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
    if (!S.sandbox) { SET.campaigns = (SET.campaigns || 0) + 1; if (!SET.apTouched) SET.ap = Object.assign({}, AP_DEFAULT); saveSettings(); }
    const sm = Sim.summary(S), H = sm.hidden, NAME = { lattice: "Lattice", photon: "Photon" };
    $("ot").textContent = L("end." + (S.over === "bankrupt" ? "bankrupt" : S.over === "fired" ? "fired" : "done"));
    $("osub").textContent = `${L("menu.seed")} ${seed}${S.sandbox ? " · " + L("menu.sandbox") : ""}`;
    const kvs = (a, b) => `<div class="kv"><span>${a}</span><b>${b}</b></div>`;
    const breakdown = `<div class="sect"><h3>${icon("flag")}${esc(L("end.breakdown"))}</h3>
      ${kvs(esc(L("end.worth")), money(sm.netWorth))}${kvs(esc(L("end.earn")), money(sm.earnings))}
      ${kvs(esc(L("end.rep", { r: Math.round(sm.reputation) })), "×" + sm.repFactor.toFixed(2))}${kvs(esc(L("end.cv")), money(sm.companyValue))}
      ${kvs(esc(L("end.own")), pct(sm.own))}${S.over === "fired" ? kvs(esc(L("end.firedPen")), "×" + K.FIRED_SCORE) : ""}${kvs(`<b>${esc(L("end.score"))}</b>`, money(sm.score))}
      <div class="kv"><span title="${esc(L("end.contractsTip"))}">${esc(L("end.contracts"))}</span><b>${sm.contracts.signed} / ${sm.contracts.fulfilled} / ${sm.contracts.failed} / ${sm.contracts.cancelled || 0} / ${sm.contracts.late || 0}</b></div>
      <div class="kv"><span>${esc(L("end.env"))}</span><b>${Math.round(sm.carbon)} t · ${Math.round(sm.water)} m³</b></div></div>`;
    const maxLoss = Math.max(1, ...sm.losses.map(l => l.total));
    // lessons: one line each (text diet), built from the language-neutral loss keys; the worst period is the tooltip
    const lessonLine = l => L(I18 && I18.has("les." + l.key) ? "les." + l.key : "les.other", { x: money(l.total), what: L("loss." + l.key) });
    const period = p => String(p).replace(/^Y(\d+) (\w+)$/, (m, y, s) => `${L("fmt.year", { y })} ${L("season." + s)}`);   // sim periods are "Y2 summer"
    const worstTip = l => l.worst ? L("les.worst", { p: period(l.worst.period), x: money(l.worst.amount) }) : "";
    const top3 = (sm.lessonKeys || []).map(k => sm.losses.find(l => l.key === k)).filter(Boolean);
    const lessons = `<div class="sect"><h3>${icon("warn")}${esc(L("end.lessons"))}</h3>
      ${top3.map(l => `<div class="lesson" data-lesson="${esc(l.key)}" title="${esc(worstTip(l))}"><span class="av">${icon(LESSON_ICON[l.key] || "warn")}</span><span>${esc(lessonLine(l))}</span></div>`).join("") || `<div class="sub">${esc(L("end.noLoss"))}</div>`}
      ${sm.losses.slice(0, 6).map(l => `<div class="kv"><span>${esc(L("loss." + l.key))}</span><b>${money(l.total)}</b></div><div class="meter slim"><i style="width:${l.total / maxLoss * 100}%;background:${COL.bad}"></i></div>`).join("")}</div>`;
    const polKind = id => { const p = S.policies.find(x => x.id === id); return p ? p.kind : null; };
    const truths = [
      ["rocket", L("tr.exotic", { r: NAME[H.realExotic], f: NAME[H.fakeExotic] })],
      ["layers", L(H.nanofabDies ? "tr.nanoDied" : "tr.nanoOk")],
      ["brain", L(H.demandCut ? "tr.demandReal" : "tr.demandHype")],
      ["news", L("tr.scares", { list: H.scares.map(x => `${L("mk.day", { d: x.day })} ${L(x.real ? "tr.real" : "tr.false")}`).join(", ") || "—" })],
      ["flag", H.policies.map(p => `${polKind(p.id) ? L("pol." + polKind(p.id)) : p.title}: ${pct(p.p0)}${p.shift ? ` (${p.shift > 0 ? "+" : "−"}${pct(Math.abs(p.shift))})` : ""} · ${L("pol.st." + p.status)}`).join("; ") || "—"],
      ["person", L("tr.vc", { a: pct(H.vcPitchGrowth), b: pct(H.boardGrowth) })],
    ];
    const curtain = `<div class="sect"><h3>${icon("help")}${esc(L("end.curtain"))}</h3>${truths.map(([ic, t]) => `<div class="truth">${icon(ic)}<span>${esc(t)}</span></div>`).join("")}</div>`;
    const [PA, PB] = PACE_POLS;
    const rows = { you: { score: sm.score, done: true }, [PA]: { score: null, day: 0 }, [PB]: { score: null, day: 0 } };
    const drawBots = () => {
      const max = Math.max(1, ...Object.values(rows).map(r => r.score || 0));
      const bar = (k, name, col) => { const r = rows[k]; return `<div class="bar"><span>${name}</span><i style="width:${r.score == null ? 0 : Math.max(1, r.score / max * 100)}%;background:${col}"></i><b>${r.score == null ? "…" : money(r.score)}${r.est ? `<span class="est" title="${esc(L("end.est", { d: r.day }))}">~d${r.day}</span>` : ""}</b>${k !== "you" && !r.done ? `<span></span><span class="prog"><i style="display:block;width:${r.day / K.END_DAY * 100}%"></i></span>` : ""}</div>`; };
      $("bots").innerHTML = `<div class="sub" style="font-weight:600" title="${esc(L("end.botsTip", { a: BOTNAME(PA), b: BOTNAME(PB) }))}">${esc(L("pace.vs", { a: BOTNAME(PA), b: BOTNAME(PB) }))}</div>${bar("you", esc(L("pace.you")), COL.sel)}${bar(PA, esc(BOTNAME(PA)), COL.net)}${bar(PB, esc(BOTNAME(PB)), COL.train)}`;
    };
    $("obody").innerHTML = `<div class="score"><div class="tally" id="tally"></div><div class="scorelabel">${icon("flag")}${esc(L("end.score"))}</div><div class="big" id="final-score" style="font-size:38px" title="${esc(L("end.scoreTip"))}">${money(sm.score)}</div><div class="sub">${esc(S.over === "bankrupt" ? L("end.bankruptSub") : S.over === "fired" ? L("end.firedSub") : L("end.doneSub", { d: Math.floor(S.day) }))}</div><div id="bots" style="display:grid;gap:8px"></div></div>
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
    const steps = [[L("end.worth"), money(sm.netWorth), sm.netWorth], [L("end.earn"), money(sm.earnings), sm.netWorth + sm.earnings],
      [L("end.rep", { r: Math.round(sm.reputation) }), "×" + sm.repFactor.toFixed(2), sm.companyValue]];
    if (sm.own < 0.999) steps.push([L("end.own"), pct(sm.own), sm.companyValue * sm.own]);
    if (S.over === "fired") steps.push([L("end.firedPen"), "×" + K.FIRED_SCORE, sm.score]);
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
    $("m-tele-sub").textContent = L(TELE.enabled() ? "menu.teleOn" : "menu.teleOff");
    const m = readMeta(), live = inGame && S && !S.over;
    show($("m-continue"), !!m && !live);
    if (m) $("m-continue-sub").textContent = `${L(m.sandbox ? "menu.sandbox" : "menu.campaign")} · ${L("menu.seed")} ${m.seed} · ${dateOf(m.day)} · ${money(m.score)}`;
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
    // text diet: five one-line rules with icons
    h.innerHTML = [["hand", "how.1"], ["plus", "how.2"], ["flag", "how.3"], ["news", "how.4"], ["trend", "how.5"]]
      .map(([ic, k]) => `<div>${icon(ic)}<span>${esc(L(k))}</span></div>`).join("");
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
      if (sp.type !== f.d.type) return { bad: `Needs a spare ${item(f.d.type).name}`, k: "drop.spare", p: { it: itName(f.d.type) } };
      if (sp.failed) return { bad: "That spare is broken too", k: "drop.broken" };
      return { type: "repair", uid: f.d.uid };
    }
    if (target.hasAttribute("data-spine")) {
      const [h, row] = target.dataset.spine.split("-").map(Number);
      return p.kind === "spine" ? { type: "spine", hall: h, row } : { bad: "Spine slot: drag the Row spine card here", k: "drop.spine" };
    }
    if (target.hasAttribute("data-drop-sell")) {
      if (p.kind === "dev") { const f = findDev(p.uid); return f && f.d.leased ? { type: "returnLease", rack: p.from, uid: p.uid } : { type: "sell", rack: p.from, uid: p.uid }; }
      if (p.kind === "shelf") return { bad: "Install it in a rack to sell it", k: "drop.shelfSell" };
      return null;
    }
    if (target.hasAttribute("data-drop-shelf")) {
      if (!on("ops")) return null;
      if (p.kind === "dev") return { type: "store", rack: p.from, uid: p.uid };
      if (p.kind === "new") return on("memory") ? { type: "forward", item: p.item } : { bad: "Forward orders unlock in chapter 9", k: "c.locked", p: { n: 9 } };
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
    if (p.kind === "new") { const it = item(p.item); return it && { icon: it.icon, name: itName(p.item) }; }
    if (p.kind === "dev" || p.kind === "shelf") { const f = findDev(p.uid); return f && { icon: item(f.d.type).icon, name: itName(f.d.type) }; }
    if (p.kind === "spine") return { icon: "net", name: L("it.spine") };
    if (p.kind === "offer") { const o = S.offers.find(x => x.id === p.id); return o && { icon: "doc", name: o.cust }; }
    return null;
  }
  function evaluate(p, target) {
    const op = opFor(p, target);
    if (!op) return { op: null };
    if (op.bad) return { op: null, res: { ok: false, msg: op.bad, k: op.k, p: op.p, code: "other" } };
    const res = Sim.check(S, op);
    return { op: res.ok ? op : null, res, raw: op };
  }

  document.addEventListener("pointerdown", e => {
    V.down = true;
    // pressing on a card's backdrop does nothing: say why instead of silently eating the drag
    const dlg = document.querySelector("dialog[open]");
    if (dlg && e.target === dlg) {
      if (dlg.id === "settings" || dlg.id === "keys") { dlg.close(); return; }   // light dialogs close on a backdrop click
      sr(L("fb.closeFirst", { b: dlg.querySelector("footer button") ? dlg.querySelector("footer button:last-child").textContent.trim() : L("btn.gotIt") }));
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
      toast(L("hint.rackDrag"));
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
      drag.ghost.innerHTML = `<div class="gcard lift">${icon(info.icon)}${esc(info.name)}${drag.p.kind === "new" && V.lease && on("finance") && item(drag.p.item).role === "gpu" ? " " + icon("tag") : ""}</div><div class="msg"></div>`;
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
    drag.badMsg = drag.bad ? ev.res : null; drag.raw = ev.raw || null;
    drag.fill = null;
    if (!ev.res) { msg.style.display = "none"; renderHUD(st); drag.op = null; return; }
    target.classList.add(ev.res.ok ? "drop-ok" : "drop-bad");
    let level = ev.res.ok ? "ok" : "bad", text = chk(ev.res), proj = null;
    if (ev.res.ok && PROJECTABLE.has(ev.op.type)) {
      const wl = wlDefault(ev.op);
      proj = Sim.stats(Sim.project(wl ? Sim.project(S, wl) : S, ev.op), { eq: true });
      const eqNow = Sim.stats(S, { eq: true }), dNet = proj.net - eqNow.net;
      text += ` · ${dNet >= 0 ? "+" : "−"}$${Math.abs(dNet).toFixed(2)}k${UPD()}`;
      if (wl) text += ` · → ${R[wl.workload].name}`;
      const rid = ev.op.to || ev.op.rack, pr = proj.perRack[rid], dest = rack(rid);
      const newIt = ev.op.item ? item(ev.op.item) : null;
      if (dest && newIt && newIt.role !== "net" && newIt.role !== "cool" && switchless(dest, proj.perRack[rid])) {
        level = "warn"; text += " · " + L("drag.nosw");
      }
      else if (pr && pr.throttle < 1) { level = "warn"; text += ` · ${L("alert.hot")} ${Math.round(pr.throttle * 100)} %`; }
      else if (pr && pr.netF < 1 && pr.netNeed > 0) { level = "warn"; text += " · " + L("drag.net"); }
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
    sr(L("fb.dragCancel"));
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
    el.innerHTML = `<b>${esc(L("multi.count", { n: ids.length }))}</b>` + modes.map(k => b({ type: "mode", mode: k }, MODE_ICON[k], L("mode." + k))).join("") +
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
    if (!bp) { nope(L("fb.noCopy"), $("detail")); return; }
    V.clip = bp;
    TELE.event(S.day, "copy", { rack: bp.from, n: bp.devices.length });
    if (FXON()) FX.rackAnim(bp.from, "fx-ping", 700);
    SND("tick", 6, 40);
    sr(L("fb.copied", { r: bp.from }));
    dlog("[bp] copy", bp);
  }
  function pasteRack(targetId, src) {
    const bp = V.clip, rid = targetId || V.selected;
    if (!bp || !rid) { nope(L("fb.noPaste"), src); return; }
    const d = QOL.blueprintDiff(S, bp, rid);
    if (d.blocked || !d.actions.length) { nope(L(d.blocked === "tank" ? "c.tankOnly" : "fb.same"), src, { rack: rid }); return; }
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
    if (!to) { nope(L("fb.noEmpty"), src); return; }
    V.clip = QOL.blueprint(S, id);
    pasteRack(to, src);
  }
  /* R: repeat the last order on the hovered (or selected) rack */
  function repeatOrder() {
    const rid = V.hoverRack || V.selected, o = V.lastOrder;
    if (!o || !rid) { nope(L("fb.noRepeat"), $("tray")); return; }
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
    const ref = el.dataset.rackref, rid = ref && rack(ref) ? ref : m && rack(m[1]) ? m[1] : null;   // the sim's params name the rack (any language)
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
  const ALERT_ICON = { nosw: "unplug", fail: "cross", hot: "flame", sla: "warn", idle: "power", runway: "coin", idleSum: "power", overbook: "warn" };
  function renderAlerts(st) {
    if (!S || !QOL) return;
    const rw = runwayDays(st);
    V.alerts = QOL.alerts(Sim, S, st, { runway: rw ? rw.days : null, overbook: V.overbook });
    const n = V.alerts.length, btn = $("alertbtn"), dot = btn.querySelector(".dot");
    dot.hidden = !n; dot.textContent = n > 9 ? "9+" : String(n);
    btn.classList.toggle("hot", V.alerts.some(a => a.sev >= 3));
    if (V.pop === "alerts") renderPop(st);
  }
  function alertsHTML() {
    const list = V.alerts;
    if (!list.length) return `<h3>${icon("bell")}${esc(L("alerts.title"))}</h3><div class="sub">${icon("check")} ${esc(L("alerts.none"))}</div>`;
    return `<h3>${icon("bell")}${esc(L("alerts.title"))} <small>${list.length}</small></h3><div class="alist">${list.slice(0, 12).map(a => {
      const lbl = a.kind === "runway" ? L("alert.runway", { d: a.n }) : a.kind === "idleSum" ? L("alert.idleSum", { n: a.n })
        : a.kind === "overbook" ? L("alert.overbook", { n: a.n, w: "@wl." + a.w })
        : L("alert." + a.kind) + (a.kind === "sla" ? ` · ${a.cust}${a.walk != null ? ` · ⏳${L("board.leaves", { d: Math.ceil(a.walk) })}` : ""}` : a.kind === "hot" ? ` ${a.n} %` : a.kind === "idle" ? ` ${a.n}u` : "");
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
    return `<div class="hc-h"><b>${id}</b><small>${esc(R[rackRole(r)].name)} · ${esc(L("mode." + r.mode))}</small></div>
      ${row(L("hover.income"), perDay(pr.rev))}<div class="kv"><span>${esc(L("hover.serves"))}</span><span>${serves}</span></div>
      ${row(L("hover.inlet"), `${pr.inlet.toFixed(1)} °C`)}${row(L("hover.bottleneck"), esc(bn))}${risk ? row(L("hover.risk"), esc(risk)) : ""}`;
  }
  /* a catalog card hovered with a rack selected: what buying it there changes (output, kW, inlet °C, payback) */
  function itemHoverHTML(key) {
    const it = item(key), rid = V.selected, r = rid && rack(rid); if (!it) return "";
    const head = `<div class="hc-h"><b>${esc(itName(key))}</b><small>${it.u}U · ${it.kw} kW · ${money(it.price)}</small></div>`;
    if (!r) return head;
    const op = { type: V.lease && on("finance") && it.role === "gpu" ? "lease" : "buy", item: key, rack: rid };
    const res = Sim.check(S, op);
    if (!res.ok) return `${head}<div class="kv bad"><span>${rid}</span><b>${icon(res.code === "cash" ? "coin" : "warn")} ${esc(chk(res))}</b></div>`;
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
  function setSpeed(v) { if (S && v !== V.speed) TELE.event(S.day, "speed", { v }); V.speed = v; if (v) V.lastSpeed = v; renderHUD(Sim.stats(S)); if (V.drawer) $("drawer-sub").innerHTML = v ? icon("play1") : icon("pause"); }
  function tapTarget(target) {   // tap-to-place: armed payload + tapped target
    const ev = evaluate(V.armed, target);
    if (!ev.res) return false;
    if (!ev.res.ok) { nope(ev.res, target, ev.raw || opFor(V.armed, target)); return true; }
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
    const kf = t.closest("[data-kf]");
    if (kf) { setKindFilter(kf.dataset.kf); return; }
    const ab = t.closest("[data-act]");
    if (ab) {
      const a = JSON.parse(ab.dataset.act), key = JSON.stringify(a);
      if (ab.hasAttribute("data-confirm")) {
        const res = Sim.check(S, a);
        if (!res.ok) { act(a, { src: ab }); return; }    // refused: show-not-tell feedback (and the rejection is logged)
        if (!(V.confirm === key && performance.now() - V.confirmT < CONFIRM_MS)) {
          V.confirm = key; V.confirmT = performance.now();
          const over = ab.classList.contains("over");
          sr(over ? L("fb.overSign") : `${chk(res)} · ${L("fb.again")}`);
          renderAll();
          if (over) {           // v0.4.2: signing would overbook you: the button says no once, the bar flashes red
            const nb = [...document.querySelectorAll("#offerstrip [data-act]")].find(x => x.dataset.act === ab.dataset.act) || ab;
            wobble(nb); SND("bonk"); pulse(nb.closest(".ocard") && nb.closest(".ocard").querySelector(".ofit"), "fx-attn", 900);
            TELE.event(S.day, "overSign", { id: a.id });
            dlog("[board] overbooking sign needs a second tap", a.id);
          }
          return;
        }
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
    if (t.closest("#drawer-min") || (t.closest("#drawer > header") && V.drawerMin)) { setDrawerMin(!V.drawerMin); return; }
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
      if (V.armed) sr(p.kind === "spine" ? L("tap.spine") : p.kind === "shelf" ? L("tap.shelf") : L("tap.new", { it: itName(p.item) }));
      if (V.armed && p.kind === "new" && S.cash < item(p.item).price && !(V.lease && on("finance") && item(p.item).role === "gpu")) nope({ ok: false, msg: `Needs $${item(p.item).price}k`, k: "c.needs", p: { x: item(p.item).price }, code: "cash" }, src);
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
      hoverHide();                   // the hover card never eats an Esc meant for something else
      if (drag && drag.started) cancelDrag("Esc");
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
    else if (k === "l" || k === "L") { I18.toggle(); TELE.event(S.day, "lang", { l: I18.lang, via: "key" }); }
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
    b.title = L(SFX.muted ? "hud.soundOff" : "hud.soundOn") + " (M)";
  }
  function toggleMute() { if (!window.SFX) return; SFX.toggle(); renderMute(); pulse($("mutebtn"), "fx-attn", 500); sr(L(SFX.muted ? "hud.soundOff" : "hud.soundOn")); }
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
    b.title = !Stage.canFullscreen() ? L("fs.none") : L(fs ? "fs.exit" : "fs.enter") + " (F)";
    b.classList.toggle("off", !Stage.canFullscreen());
  }
  function toggleFullscreen() {
    if (!Stage.canFullscreen()) { nope(L("fs.none"), $("fsbtn")); dlog("fullscreen unavailable"); return; }
    Stage.toggleFullscreen().then(ok => { if (!ok) nope(L("fs.blocked"), $("fsbtn")); dlog("fullscreen", ok, Stage.isFullscreen()); renderFs(); });
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

  /* ================= language (docs/I18N.md I3): 中/EN toggles in the menu, the HUD and settings; L key ================= */
  function langToggleHTML(where) {
    return `<span class="langtog" role="group" aria-label="${esc(L("set.lang"))}">${I18.LANGS.map(l => `<button type="button" data-lang="${l}" data-where="${where}" aria-pressed="${I18.lang === l}" lang="${l === "zh" ? "zh-CN" : "en"}">${l === "zh" ? "中文" : "EN"}</button>`).join("")}</span>`;
  }
  function renderLangBtns() {
    const hb = $("langbtn");
    if (hb) { hb.textContent = I18.lang === "zh" ? "EN" : "中"; hb.title = L("lang.switch") + " (L)"; hb.setAttribute("aria-label", L("lang.switch")); }
    const mm = $("m-lang"); if (mm) mm.innerHTML = langToggleHTML("menu");
  }
  /* switching never restarts the game: static markup is re-labelled (data-i18n), caches of translated HTML are dropped and
     everything visible re-renders in place (menu, HUD, board, drawers, popovers, open settings / keys / chapter card) */
  I18.onChange((l, prev) => {
    dlog("[i18n] switch", prev, "->", l);
    R = ROLE();
    progCache.clear();
    for (const id of ["h-power", "h-heat", "h-transit"]) { const el = $(id); if (el) el._bc = null; }
    if ($("h-pace")) $("h-pace")._k = null;
    if ($("soldbar")) $("soldbar")._h = null;
    $("toast").classList.remove("show"); $("toast").textContent = "";
    if (!V.drawer) { $("drawer-title").textContent = ""; $("drawer-body").innerHTML = ""; }
    renderLangBtns();
    if (!$("mainmenu").hidden) showMenu(!$("m-resume").hidden);
    if (!$("m-howto").hidden) { $("m-howto").hidden = true; $("m-how").click(); }
    if (S) { renderAll(); renderFs(); renderMute(); renderAlerts(Sim.stats(S)); renderBulk(); }
    if ($("settings").open) { $("st-t").textContent = L("set.title"); $("st-body").innerHTML = settingsHTML(); }
    if ($("keys").open) openKeys();
    if ($("chapter").open && V.chapShown != null && S) { if (V.chapShown < 0) showSandboxCard(); else showChapter(V.chapShown); }
    if (S) TELE.event(S.day, "lang", { l });
  });
  document.addEventListener("click", e => {
    const b = e.target.closest && e.target.closest("[data-lang], #langbtn");
    if (!b) return;
    e.stopPropagation();
    const l = b.id === "langbtn" ? (I18.lang === "zh" ? "en" : "zh") : b.dataset.lang;
    dlog("[i18n] toggle via", b.id || b.dataset.where, l);
    I18.setLang(l);
    pulse(b, "fx-attn", 500);
  }, true);
  I18.applyDom();
  renderLangBtns();

  /* ================= teach once: a ghost card glides from the catalog onto a rack until the first order (text diet:
     this replaces the standing "Drag onto a rack…" caption). SET.taught stays true forever after. ================= */
  function teachTick() {
    const el = $("teach");
    const want = S && !S.over && !SET.taught && S.day < 90 && !V.menu && !anyDialogOpen() && !(drag && drag.started) && !V.armed;
    if (!want) { if (el && !el.hidden) { el.hidden = true; if (el._a) el._a.cancel(); el._k = null; } return; }
    const card = document.querySelector("#tray .item[data-item]:not(.unaff)");
    const tgt = [...document.querySelectorAll("#floor .rack[data-rack]")].find(x => { const r = rack(x.dataset.rack); return r && !r.tank && K.RACK_U - Sim.usedU(S, r) >= 4; });
    if (!card || !tgt || !el) return;
    const z = STZ(), sr0 = $("stage").getBoundingClientRect(), a = card.getBoundingClientRect(), b = tgt.getBoundingClientRect();
    const p = r => [((r.left + r.width / 2) - sr0.left) / z, ((r.top + r.height / 2) - sr0.top) / z];
    const [x0, y0] = p(a), [x1, y1] = p(b), key = [x0, y0, x1, y1].map(v => Math.round(v)).join(",");
    if (el._k === key && !el.hidden) return;
    el._k = key; el.hidden = false;
    el.innerHTML = card.querySelector(".av") ? card.querySelector(".av").outerHTML + icon("hand") : icon("hand");
    if (el._a) el._a.cancel();
    const reduced = FXON() && FX.reduced;
    el.style.left = "0px"; el.style.top = "0px";
    const tr = (x, y, s) => `translate(${x.toFixed(0)}px,${y.toFixed(0)}px) translate(-50%,-50%) scale(${s})`;
    el._a = el.animate(reduced ? [{ transform: tr(x1, y1, 1), opacity: 0.9 }] : [
      { transform: tr(x0, y0, 1), opacity: 0 }, { transform: tr(x0, y0, 1.1), opacity: 0.95, offset: 0.12 },
      { transform: tr(x1, y1, 1), opacity: 0.95, offset: 0.7 }, { transform: tr(x1, y1, 0.7), opacity: 0 }],
      { duration: 2200, iterations: Infinity, easing: "ease-in-out" });
    dlog("[teach] ghost", card.dataset.item, "→", tgt.dataset.rack);
  }
  function taught(why) { if (SET.taught) return; SET.taught = true; saveSettings(); teachTick(); dlog("[teach] done:", why); }

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
    if (!TELE.log) { toast(L("log.none")); return; }
    if (S) TELE.snap(S, Sim.score(S));
    const name = TELE.exportFile();
    if (name) { toast(`⤓ ${name}`); return; }
    toast(await TELE.copyToClipboard() ? L("log.copied") : L("set.exportFail"));
  }
  $("m-export").addEventListener("click", exportLog);
  $("o-export").addEventListener("click", exportLog);
  $("m-tele").addEventListener("click", () => { TELE.setEnabled(!TELE.enabled()); showMenu(!!S && !S.over); });

  requestAnimationFrame(frame);
})();
