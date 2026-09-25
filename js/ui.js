/* Halcyon Compute — DOM layer. All game rules live in sim.js; this file only draws and forwards input.
 * URL params: ?seed=123  ?debug=1 (console logging)  ?speed=4
 */
(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  const K = Sim.K;
  const params = new URLSearchParams(location.search);
  const DEBUG = params.has("debug");
  Sim.setDebug(DEBUG);
  const dlog = (...a) => { if (DEBUG) console.log("[ui]", ...a); };
  const DAYS_PER_SEC = 2;

  let S = null;
  const V = { speed: 1, lastSpeed: 1, mode: "role", selected: "A1", armed: null, seenChapter: -1, seenNews: 0, acc: 0, overShown: false, sig: "" };

  /* ================= look-up tables ================= */
  const ROLE = {
    web:   { name: "Web",        color: "#3F8F76", icon: "globe" },
    train: { name: "Training",   color: "#4A6FB8", icon: "brain" },
    infer: { name: "Inference",  color: "#7B61C9", icon: "bubble" },
    net:   { name: "Network",    color: "#6D7784", icon: "switch" },
    cool:  { name: "Cooling",    color: "#4F9BB8", icon: "snow" },
    tank:  { name: "Immersion tank", color: "#B0548C", icon: "drop" },
    empty: { name: "Empty rack", color: "transparent", icon: "plus" },
  };
  const ITEM_COLOR = it => it.role === "cpu" ? ROLE.web.color : it.role === "net" ? ROLE.net.color : it.role === "cool" ? ROLE.cool.color
    : it.role === "mem" ? "#9A7BD6" : it.role === "exotic" ? "#B0548C" : it.fam === "C" ? ROLE.train.color : ROLE.infer.color;
  const MODE_ICON = { eco: "leaf", std: "gauge", boost: "rocket" };
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const MAP_MODES = [
    { key: "role", label: "Role", icon: "layers", ch: 0 },
    { key: "power", label: "Power", icon: "bolt", ch: 1 },
    { key: "heat", label: "Heat", icon: "temp", ch: 3 },
    { key: "gen", label: "Generation", icon: "clock", ch: 4 },
    { key: "free", label: "Free space", icon: "plus", ch: 0 },
  ];
  const RAMPS = { heat: ["#3C7DD9", "#B9C4CF", "#E0532F"], power: ["#8C8F7A", "#E2A91C", "#FFE08A"], free: ["#5E6770", "#36A267", "#7FE0A8"] };

  const CHAPTER_TEXT = {
    racks: { sub: "Chapter 1", items: [
      ["plus", "#36A267", "<b>Drag</b> hardware from the catalog onto a rack. It ships in 6 days, then one of your 3 technicians installs it."],
      ["switch", ROLE.net.color, "Every rack needs a <b>switch</b>. No switch, no traffic, no money."],
      ["globe", ROLE.web.color, "Web servers earn a little, steadily. The web market only wants about <b>30 servers</b>; beyond that you sell at a quarter price."],
      ["coin", "#E2A91C", "Your score is <b>net worth</b> after 3 years: cash plus resale value. Space pauses, 1/2/3 set speed."],
    ] },
    power: { sub: "Chapter 2", items: [
      ["bolt", "#E2A91C", "The grid feeds <b>250 kW</b>. Each rack takes at most 30 kW. Click the grid panel to buy an upgrade to 400 kW."],
      ["coin", "#E2A91C", "Electricity costs money, about 20 % more in summer."],
      ["gauge", "#6D7784", "Each rack runs in <b>Eco</b> (65 % power, 80 % output), <b>Standard</b>, or <b>Boost</b> (135 % power, 112 % output)."],
    ] },
    gpu: { sub: "Chapter 3", items: [
      ["chip", ROLE.train.color, "<b>Kestrel C</b> cards have lots of compute. <b>Heron M</b> cards have lots of memory bandwidth."],
      ["brain", ROLE.train.color, "<b>Training</b> does a lot of math per byte, so it needs compute. <b>Inference</b> does little math per byte, so memory bandwidth limits it. Throughput = min(compute, bandwidth x intensity): the roofline chart in the rack panel shows which one limits you."],
      ["bubble", ROLE.infer.color, "Set each rack's <b>workload</b>. The two markets have separate prices and separate demand. Inference demand grows much faster."],
      ["net", ROLE.net.color, "A switch carries 16. Each GPU needs 4 for training, 2 for inference."],
    ] },
    heat: { sub: "Chapter 4", items: [
      ["sun", "#FFB054", "Summer peaks in <b>late July</b>. The room's cooling can remove less heat when it's hot outside."],
      ["temp", "#E0532F", "The room warms and cools <b>slowly</b> (about 5 days to react). A rack throttles when its inlet goes above <b>32 °C</b>."],
      ["flame", "#E0532F", "Busy neighbours heat each other. Spreading load across the row runs cooler than packing it."],
      ["snow", ROLE.cool.color, "<b>CRU coolers</b> (2U) add cooling capacity. Eco mode also cuts heat."],
    ] },
    gens: { sub: "Chapter 5", items: [
      ["clock", "#E0A43A", "New cards ship roughly <b>once a year</b>. Rumors give about 60 days of warning."],
      ["trend", "#E0532F", "When a generation ships, rivals upgrade and <b>compute prices drop</b>. Your older cards resell for much less."],
      ["bolt", "#E2A91C", "When power or space is what limits you, compare cards by output <b>per kW</b> and <b>per U</b>, not per dollar."],
    ] },
    disrupt: { sub: "Chapter 6", items: [
      ["rocket", "#B0548C", "Two startups sell new accelerators: <b>Lattice</b> (inference) and <b>Photon</b> (training). Both only run in an <b>immersion tank</b> rack ($90k, empty rack, 8 days)."],
      ["chip", "#56616E", "Their charts are the vendors' own numbers. <b>No roadmap</b>, and spec sheets only list strengths."],
      ["drop", "#B0548C", "A <b>pilot</b> card shows what the hardware really does after about 10 days in a rack."],
      ["news", "#56616E", "Watch the news. Not every new thing is the future, and not every discount is a gift."],
    ] },
  };

  /* ================= helpers ================= */
  const icon = (id, style) => `<svg class="i"${style ? ` style="${style}"` : ""}><use href="#${id}"/></svg>`;
  const money = k => { const a = Math.abs(k), sg = k < 0 ? "−" : ""; return a >= 1000 ? `${sg}$${(a / 1000).toFixed(2)}M` : `${sg}$${Math.round(a)}k`; };
  const perDay = k => `${k >= 0 ? "+" : "−"}$${Math.abs(k).toFixed(1)}k/d`;
  function lerp(a, b, t) {
    const pa = a.match(/\w\w/g).map(h => parseInt(h, 16)), pb = b.match(/\w\w/g).map(h => parseInt(h, 16));
    return "#" + pa.map((v, i) => Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, "0")).join("");
  }
  function ramp(stops, t) {
    t = Math.max(0, Math.min(1, t));
    const seg = (stops.length - 1) * t, i = Math.min(Math.floor(seg), stops.length - 2);
    return lerp(stops[i], stops[i + 1], seg - i);
  }
  const rack = id => Sim.rackById(S, id);
  const item = k => S.items[k];
  function rackRole(r) {
    const all = r.devices.concat(r.pending).map(d => item(d.type));
    if (r.tank) return "tank";
    if (!all.length) return "empty";
    if (all.some(i => i.role === "gpu")) return r.workload;
    if (all.some(i => i.role === "cpu")) return "web";
    if (all.some(i => i.role === "cool")) return "cool";
    return "net";
  }
  const genBehind = r => {
    const g = r.devices.map(d => item(d.type)).filter(i => i.role === "gpu").map(i => i.gen);
    return g.length ? Sim.currentGen(S) - Math.min(...g) : null;
  };
  const measuredDev = d => d.inst != null && S.day - d.inst >= 10;

  /* ================= game lifecycle ================= */
  function start(newSeed) {
    seed = newSeed >>> 0;
    S = Sim.newGame(seed);
    Object.assign(V, { selected: "A1", armed: null, seenChapter: -1, seenNews: S.news.length, overShown: false, acc: 0 });
    const url = new URL(location.href); url.searchParams.set("seed", seed); history.replaceState(null, "", url);
    dlog("start seed", seed);
    renderAll();
    maybeChapter();
  }
  let seed = params.has("seed") ? +params.get("seed") : Math.floor(Math.random() * 1e6);

  function act(a) {
    const res = Sim.check(S, a);
    if (!res.ok) { toast(res.msg); dlog("rejected", a, res.msg); return false; }
    Sim.apply(S, a);
    if (a.type === "buy") flashCash(-item(a.item).price);
    if (a.type === "tank") flashCash(-K.TANK_COST);
    if (a.type === "grid") flashCash(-K.GRID_COST);
    if (a.to) V.selected = a.to; else if (a.rack && a.type !== "sell") V.selected = a.rack;
    dlog("action", a);
    renderAll();
    return true;
  }

  /* ================= loop ================= */
  let last = performance.now(), lastFull = 0;
  function frame(now) {
    const dtSec = Math.min(0.25, (now - last) / 1000); last = now;
    if (V.speed > 0 && !S.over && !anyDialogOpen()) {
      V.acc += dtSec * DAYS_PER_SEC * V.speed;
      const steps = Math.floor(V.acc / K.DT);
      if (steps > 0) { V.acc -= steps * K.DT; Sim.advance(S, steps * K.DT); }
    }
    const dragging = drag && drag.started;
    if (!dragging) {
      const sig = signature();
      if (sig !== V.sig || now - lastFull > 1000) { renderAll(); lastFull = now; }
      else { renderHUD(Sim.stats(S)); renderProgress(); }
      afterTick();
    }
    requestAnimationFrame(frame);
  }
  function signature() {
    return [S.jobs.length, S.news.length, S.chapter, S.racks.reduce((a, r) => a + r.devices.length * 7 + r.pending.length, 0), S.gridKw, S.over].join("|");
  }
  function afterTick() {
    if (S.news.length > V.seenNews) {
      const fresh = S.news.slice(0, S.news.length - V.seenNews);
      V.seenNews = S.news.length;
      for (const n of fresh.reverse()) if (n.tone === "bad" || n.tone === "pitch" || n.tone === "good") toast(n.title);
    }
    maybeChapter();
    if (S.over && !V.overShown) { V.overShown = true; showOver(); }
  }
  const anyDialogOpen = () => document.querySelector("dialog[open]") != null;

  /* ================= rendering ================= */
  function renderAll() {
    const st = Sim.stats(S);
    V.sig = signature();
    renderHUD(st); renderGoal(st); renderModes(); renderFloor(st); renderDetail(st); renderTray();
    renderMarket(); renderBench(); renderNews();
    document.body.classList.toggle("armed", !!V.armed);
  }

  function chip(el, ic, color, val, cap, unitTxt, projVal, over, fmt) {
    fmt = fmt || (v => Math.round(v));
    const pct = v => Math.max(0, Math.min(100, v / cap * 100));
    const d = projVal != null ? projVal - val : 0;
    el.classList.toggle("over", !!over);
    el.innerHTML = `${icon(ic, `color:${color}`)}<div><span class="big">${fmt(val)}</span> <small>/ ${fmt(cap)} ${unitTxt}</small>${Math.abs(d) >= .05 ? `<span class="delta" style="color:${d > 0 ? "#FF8466" : "#7FE0A8"}">${d > 0 ? "+" : "−"}${Math.abs(d).toFixed(1)}</span>` : ""}
      <div class="bar">${projVal != null ? `<i class="proj" style="width:${pct(projVal)}%;background:${color}"></i>` : ""}<i style="width:${pct(val)}%;background:${color}"></i></div></div>`;
  }
  function renderHUD(st, proj) {
    $("h-cash").textContent = money(S.cash);
    const rate = $("h-rate");
    rate.textContent = perDay(st.net) + (proj ? `  →  ${perDay(proj.net)}` : "");
    rate.style.color = (proj || st).net >= 0 ? "#7FE0A8" : "#FF8466";
    const busy = Sim.busyTechs(S), waiting = S.jobs.filter(j => j.phase === "wait").length;
    $("h-techs").innerHTML = `${icon("wrench")}<div class="pips">${Array.from({ length: K.TECHS }, (_, i) => `<b class="${i >= busy ? "on" : ""}"></b>`).join("")}</div>${waiting ? `<small>+${waiting} queued</small>` : ""}`;
    const doy = Math.floor(S.day) % 360, y = Math.floor(S.day / 360) + 1, m = Math.floor(doy / 30), dm = doy % 30 + 1;
    const qi = Math.floor(S.day / 90), se = st.se;
    const sIcon = se.name === "winter" ? "snow" : "sun", sCol = se.name === "summer" ? "#FFB054" : se.name === "winter" ? "#8FC4FF" : "#C9D86A";
    $("h-when").innerHTML = `${icon(sIcon, `color:${sCol}`)}<div><span class="big">${MONTHS[m]} ${dm}, Y${y}</span>${V.speed === 0 ? `<span class="pausedtag">PAUSED</span>` : ""}<div class="timeline">${Array.from({ length: 12 }, (_, i) => `<i class="${i < qi ? "past" : i === qi ? "now" : ""}"></i>`).join("")}</div></div>`;
    $("h-when").title = `${se.name}. Day ${Math.floor(S.day)} of ${K.END_DAY}.`;
    const pw = $("h-power");
    chip(pw, "bolt", "var(--pow-c)", st.kw, S.gridKw, "kW", proj && proj.kw, false);
    pw.title = `Drawing ${st.kw.toFixed(0)} kW now, ${Sim.gridKwAll(S).toFixed(0)} kW with orders. Grid ${S.gridKw} kW. Power costs ${(st.se.powerPrice * 1000).toFixed(0)} $/kW per day.`;
    pw.classList.toggle("lockmask", S.chapter < 1);
    const ht = $("h-heat"), tProj = proj ? proj.roomT : null;
    chip(ht, "temp", "#FF8466", S.roomT, K.T_LIMIT, "°C", tProj, S.roomT > K.T_LIMIT - 1.5, v => v.toFixed(1));
    const arrow = st.tTarget > S.roomT + 0.1 ? "rising" : st.tTarget < S.roomT - 0.1 ? "falling" : "steady";
    ht.title = `Room ${S.roomT.toFixed(1)} °C, ${arrow} toward ${st.tTarget.toFixed(1)} °C. Cooling capacity ${st.heatCap.toFixed(0)} kW (${se.name}). Racks throttle above ${K.T_LIMIT} °C inlet.`;
    ht.classList.toggle("lockmask", S.chapter < 3);
    $("h-worth").innerHTML = `${icon("flag", "color:var(--sel)")}<div><span class="big">${money(Sim.netWorth(S))}</span><small>net worth</small></div>`;
    document.querySelectorAll(".speed button").forEach(b => b.setAttribute("aria-pressed", +b.dataset.speed === V.speed));
    document.body.classList.toggle("paused", V.speed === 0);
  }

  function renderGoal(st) {
    const ch = Sim.CHAPTERS[S.chapter].key, left = K.END_DAY - Math.floor(S.day);
    let tip;
    if (ch === "racks") tip = st.supply.web < st.mk.web.demand - 1 ? `Web demand ${st.mk.web.demand.toFixed(0)}, you serve ${st.supply.web.toFixed(0)}. Add web servers (each rack needs a switch).` : "Web market is full. Save cash: bigger things are coming.";
    else if (ch === "power") tip = "Power is money. Idle racks cost nothing; eco mode trades output for power.";
    else if (ch === "gpu") tip = "Match cards to work: compute cards to training, bandwidth cards to inference. Check the roofline in the rack panel.";
    else if (ch === "heat") tip = S.day % 360 < 210 ? `Summer peaks around day ${360 * Math.floor(S.day / 360) + 200}. Heat builds slowly: prepare before it arrives.` : "Heat is easing. Watch your inlet temperatures next summer.";
    else if (ch === "gens") tip = "New generations cut prices. Sell old cards before launches if you plan to replace them.";
    else tip = "Read the benchmarks and the news before you bet. A pilot card costs little and tells the truth.";
    $("goal").innerHTML = `${icon("flag", "color:#B5762A")}<b>${Sim.CHAPTERS[S.chapter].title}</b><span>${tip}</span><span style="margin-left:auto;color:var(--ink-2);white-space:nowrap">${left} days left</span>`;
  }

  function renderModes() {
    const el = $("modes");
    el.innerHTML = MAP_MODES.filter(m => S.chapter >= m.ch).map(m => `<button data-mode="${m.key}" aria-pressed="${V.mode === m.key}">${icon(m.icon)}${m.label}</button>`).join("") + `<div class="legend" id="legend"></div>`;
    renderLegend();
  }
  function renderLegend() {
    const L = $("legend");
    if (V.mode === "role") L.innerHTML = `<div class="keys">${["web", "train", "infer", "tank"].filter(k => k !== "tank" || S.chapter >= 5).filter(k => k === "web" || S.chapter >= 2).map(k => `<span><i style="background:${ROLE[k].color}"></i>${ROLE[k].name}</span>`).join("")}</div>`;
    else if (V.mode === "gen") L.innerHTML = `<div class="keys">${[["#36A267", "Current"], ["#E0A43A", "One behind"], ["#C2452D", "Two behind"]].map(([c, n]) => `<span><i style="background:${c}"></i>${n}</span>`).join("")}</div>`;
    else {
      const lab = { heat: ["22 °C", "36 °C"], power: ["0 kW", "30 kW"], free: ["Full", "20U free"] }[V.mode];
      L.innerHTML = `<span>${lab[0]}</span><span class="ramp" style="background:linear-gradient(90deg,${RAMPS[V.mode].join(",")})"></span><span>${lab[1]}</span>`;
    }
  }

  function rackColor(r, st) {
    const role = rackRole(r), pr = st.perRack[r.id];
    if (V.mode === "role") return r.devices.length ? ROLE[role].color : ROLE[role].color + "55";
    if (V.mode === "heat") return ramp(RAMPS.heat, (pr.inlet - 22) / 14);
    if (V.mode === "power") return ramp(RAMPS.power, pr.kw / K.RACK_KW);
    if (V.mode === "gen") { const g = genBehind(r); return g == null ? "#5E6770" : ["#36A267", "#E0A43A", "#C2452D"][Math.min(2, g)]; }
    return ramp(RAMPS.free, (K.RACK_U - Sim.usedU(S, r)) / K.RACK_U);
  }
  const jobFor = id => S.jobs.find(j => j.to === id || (j.kind === "tank" && j.rack === id));
  const jobFrac = j => Math.max(0, j.left / j.total);
  function jobLabel(j) {
    if (j.phase === "ship") return [icon("truck"), `${Math.ceil(j.left)}d`];
    if (j.phase === "wait") return [icon("wrench"), "queued"];
    return [icon("wrench"), `${Math.ceil(j.left)}d`];
  }

  function renderFloor(st) {
    let h = "";
    [[1, "cold", "Cold aisle"], [3, "hot", "Hot aisle"], [5, "cold", "Cold aisle"], [7, "hot", "Hot aisle"]].forEach(([row, k, l]) =>
      h += `<div class="aisle ${k}" style="grid-row:${row}">${icon(k === "cold" ? "snow" : "flame")}${l}</div>`);
    [2, 4, 6].forEach((row, k) => h += `<div class="crac" style="grid-row:${row}" title="Room cooling unit ${k + 1}">${icon("snow")}<span>CRAC ${k + 1}</span></div>`);
    const gridJob = S.jobs.find(j => j.kind === "grid");
    const gridBody = S.gridUp ? `<span>Upgraded</span>` : gridJob ? `<span>${icon("wrench")} ${Math.ceil(gridJob.left)} days</span>`
      : S.chapter >= 1 ? `<button class="btn primary" data-grid title="Raise the grid to ${K.GRID_KW_UP} kW. Takes ${K.GRID_DAYS} days.">${icon("bolt")}${K.GRID_KW_UP} kW · ${money(K.GRID_COST)}</button>` : `<span>—</span>`;
    h += `<div class="hall" title="Utility feed">${icon("bolt", "width:26px;height:26px;color:var(--pow-c)")}<span class="big">Grid</span><span>${st.kw.toFixed(0)} / ${S.gridKw} kW</span>${gridBody}</div>`;
    S.racks.forEach((r, n) => {
      const row = [2, 4, 6][Math.floor(n / 6)], col = (n % 6) + 2;
      const role = rackRole(r), free = K.RACK_U - Sim.usedU(S, r), job = jobFor(r.id), pr = st.perRack[r.id];
      const pos = `grid-row:${row};grid-column:${col}`;
      const prog = job ? `<span class="prog" data-prog="${r.id}">${jobLabel(job).join("")}<i style="width:${Math.round((1 - jobFrac(job)) * 100)}%"></i></span>` : "";
      if (role === "empty" || (role === "tank" && !r.devices.length && !r.pending.length)) {
        h += `<button class="rack empty${r.tank ? " tank" : ""}" style="${pos}" data-rack="${r.id}" aria-pressed="${r.id === V.selected}" title="${r.id}: ${r.tank ? "empty immersion tank" : "empty rack"}, ${free}U free"><span class="plus">${icon(r.tank ? "drop" : "plus")}</span><span class="id">${r.id}</span>${prog}</button>`;
        return;
      }
      const flags = [];
      if (pr.throttle < 1) flags.push("flame");
      if (pr.penalty < 1 || r.devices.some(d => Sim.isDead(S, item(d.type)))) flags.push("warn");
      else if (pr.netF < 1) flags.push("net");
      const gb = genBehind(r); if (gb != null && gb >= 2) flags.push("clock");
      const tip = `${r.id}: ${ROLE[role].name}. ${perDay(pr.rev)}, ${pr.kw.toFixed(1)} kW, inlet ${pr.inlet.toFixed(1)} °C, ${free}U free${pr.netF < 1 ? `, network short (${Math.round(pr.netF * 100)} %)` : ""}${pr.throttle < 1 ? `, throttled to ${Math.round(pr.throttle * 100)} %` : ""}`;
      h += `<button class="rack ${row === 4 ? "front-bottom" : "front-top"}${r.tank ? " tank" : ""}" style="${pos}" data-rack="${r.id}" aria-pressed="${r.id === V.selected}" title="${tip}">
        <span class="fill" style="background:${rackColor(r, st)}"></span><span class="front"></span>
        ${pr.rev > 0.05 ? `<span class="earn">$${pr.rev.toFixed(1)}k</span>` : ""}
        <span class="flags">${flags.map(f => icon(f)).join("")}</span><span class="id">${r.id}</span>${free ? `<span class="free">${free}U</span>` : ""}${prog}</button>`;
    });
    $("floor").innerHTML = h;
  }

  function renderProgress() {
    document.querySelectorAll("[data-prog]").forEach(el => {
      const j = jobFor(el.dataset.prog); if (!j) return;
      const [ic, txt] = jobLabel(j);
      el.innerHTML = `${ic}${txt}<i style="width:${Math.round((1 - jobFrac(j)) * 100)}%"></i>`;
    });
    const jl = $("jobs"); if (jl) jl.innerHTML = jobsHTML();
  }

  function renderTray() {
    const shop = Sim.shopItems(S), cg = Sim.currentGen(S);
    $("tray").innerHTML = shop.map(k => {
      const it = item(k), color = ITEM_COLOR(it);
      let badge = "";
      if (it.key === "pm9") badge = `<span class="badge pitch">${it.price <= Sim.BASE_ITEMS.pm9.price * 0.5 ? "60 % OFF" : "30 % OFF"}</span>`;
      else if (it.role === "exotic") badge = `<span class="badge pilot">NEW TECH</span>`;
      else if (it.role === "gpu" && it.gen < cg) badge = `<span class="badge old">OLD GEN</span>`;
      else if (it.avail > 0 && S.day - it.avail < 40) badge = `<span class="badge">NEW</span>`;
      const fb = (it.role === "gpu" || it.role === "exotic") ? `<span class="fb" title="Spec sheet: compute and memory bandwidth">${icon("cpu", "width:12px;height:12px")}<i style="width:${Math.min(100, it.F * 4)}%;background:${ROLE.train.color}"></i>${icon("layers", "width:12px;height:12px")}<i style="width:${Math.min(100, it.B * 4)}%;background:${ROLE.infer.color}"></i></span>` : "";
      const extra = it.cool ? `, +${it.cool} kW cooling` : it.net ? `, carries ${it.net} network` : it.boost ? ", +25 % GPU bandwidth in its rack (vendor claim)" : it.tank ? `, runs ${it.only === "train" ? "training" : "inference"} only, immersion tank rack only` : "";
      return `<button class="item" data-drag="new" data-item="${k}" aria-pressed="${V.armed === k}" title="${it.name}: ${it.u}U, ${it.kw} kW, ${money(it.price)}${it.F ? `, compute ${it.F}, bandwidth ${it.B}` : ""}${extra}">${badge}
        <span class="top"><span class="av" style="background:${color}">${icon(it.icon)}</span><strong>${it.name}</strong></span>
        <span class="ublocks">${"<b></b>".repeat(it.u)}</span>${fb}
        <span class="row"><span>${icon("bolt", "color:var(--pow-c)")}${it.kw}</span><span class="price">${money(it.price)}</span></span>
      </button>`;
    }).join("");
  }

  function jobsHTML() {
    const mine = S.jobs.filter(j => j.to === V.selected || j.rack === V.selected);
    return mine.map(j => {
      const [ic, txt] = jobLabel(j);
      const verb = j.kind === "sell" ? "Selling" : j.kind === "move" ? "Moving in" : j.kind === "tank" ? "Building tank" : j.kind === "grid" ? "Grid work" : j.phase === "ship" ? "Shipping" : "Installing";
      return `<div>${ic}<span>${verb}${j.dev ? " " + item(j.dev.type).name : ""}</span><span style="text-align:right">${txt}</span><span class="t"><i style="width:${Math.round((1 - jobFrac(j)) * 100)}%"></i></span></div>`;
    }).join("");
  }

  function rooflineSVG(r, extraKey) {
    const keys = [...new Set(r.devices.concat(r.pending).map(d => d.type).filter(k => item(k).role === "gpu").concat(extraKey && item(extraKey).role === "gpu" ? [extraKey] : []))];
    if (!keys.length) return "";
    const W = 280, H = 118, x0 = 26, y0 = 100, xs = I => x0 + (Math.log2(I) + 2) / 5 * (W - x0 - 8), maxY = Math.max(...keys.map(k => item(k).F)) * 1.25, ys = v => y0 - v / maxY * 88;
    let h = `<line x1="${x0}" y1="${y0}" x2="${W - 6}" y2="${y0}" stroke="var(--line)"/><line x1="${x0}" y1="8" x2="${x0}" y2="${y0}" stroke="var(--line)"/>`;
    for (const w of Sim.WORKLOADS) {
      const x = xs(Sim.INTENSITY[w]), on = r.workload === w;
      h += `<line x1="${x}" y1="10" x2="${x}" y2="${y0}" stroke="${ROLE[w].color}" stroke-dasharray="3 3" stroke-width="${on ? 2 : 1}" opacity="${on ? 1 : .5}"/><text x="${x + 3}" y="18" style="fill:${ROLE[w].color};font-weight:${on ? 600 : 400}">${ROLE[w].name}</text>`;
    }
    const boost = r.devices.some(d => item(d.type).role === "mem" && !Sim.isDead(S, item(d.type))) ? 1.25 : 1;
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
    return `<div class="roof"><div class="sub">${icon("gauge", "width:14px;height:14px;vertical-align:-2px")} Roofline: ${it0.name} is <b>${bound}</b> on ${ROLE[r.workload].name.toLowerCase()}</div><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Roofline chart">${h}</svg></div>`;
  }

  function renderDetail(st) {
    const r = rack(V.selected), role = rackRole(r), pr = st.perRack[r.id], unit = 10.2;
    let elev = "";
    r.devices.forEach(d => {
      const it = item(d.type), dead = Sim.isDead(S, it);
      elev += `<button class="dev" data-drag="dev" data-rack="${r.id}" data-uid="${d.uid}" style="height:${it.u * unit}px;background:${dead ? "#555" : ITEM_COLOR(it)}" title="${it.name}, ${it.u}U, ${it.kw} kW${dead ? ", DEAD (vendor gone)" : ""}. Drag to another rack to move, or to the bin to sell for ${money(Sim.resale(S, d))}">${it.u > 1 || it.role === "net" ? icon(dead ? "warn" : it.icon) : ""}</button>`;
    });
    r.pending.forEach(d => { const it = item(d.type); elev += `<div class="pend" style="height:${it.u * unit}px" title="${it.name}, on its way">${it.u > 1 ? icon("truck") : ""}</div>`; });
    const free = K.RACK_U - Sim.usedU(S, r);
    if (free) elev += `<div class="e" style="height:${free * unit}px"></div>`;
    const g = (ic, col, v, label) => `<div class="g">${icon(ic, `color:${col}`)}<div class="track"><i style="width:${Math.round(Math.max(0, Math.min(1, v)) * 100)}%;background:${col}"></i></div><small>${label}</small></div>`;
    const hasGpu = r.devices.concat(r.pending).some(d => item(d.type).role === "gpu");
    const status = role === "empty" ? (r.tank ? "Empty tank. Takes Lattice/Photon cards and a switch." : "Drag hardware here to start using this rack")
      : pr.penalty < 1 ? `${icon("warn")} Unsupported part is crashing this rack (60 %)`
      : pr.throttle < 1 ? `${icon("flame")} Too hot: running at ${Math.round(pr.throttle * 100)} %`
      : pr.netF < 1 && pr.netNeed > 0 ? `${icon("net")} Network short: ${pr.netProv} of ${pr.netNeed} needed`
      : `${perDay(pr.rev)} revenue`;
    const wl = S.chapter >= 2 && hasGpu && !r.tank ? `<div class="wl" role="group" aria-label="Workload">${Sim.WORKLOADS.map(w => `<button data-wl="${w}" aria-pressed="${r.workload === w}" style="${r.workload === w ? `background:${ROLE[w].color}` : ""}">${icon(ROLE[w].icon, "width:14px;height:14px")}${ROLE[w].name}</button>`).join("")}</div>` : "";
    const modes = S.chapter >= 1 && r.devices.length ? `<div class="seg" role="group" aria-label="Power mode">${Object.entries(Sim.MODES).map(([k, m]) => `<button data-pmode="${k}" aria-pressed="${r.mode === k}" title="${m.label}: ${Math.round(m.out * 100)} % output, ${Math.round(m.kw * 100)} % power">${icon(MODE_ICON[k])}${m.label}</button>`).join("")}</div>` : "";
    const meas = [];
    const seen = new Set();
    for (const d of r.devices) {
      const it = item(d.type);
      if (it.role !== "exotic" || seen.has(it.key)) continue;
      seen.add(it.key);
      if (Sim.isDead(S, it)) meas.push(`<div class="meas bad">${icon("warn")} ${it.name}: vendor gone, card is dead weight</div>`);
      else if (measuredDev(d)) meas.push(`<div class="meas ${it.field < 0.95 ? "bad" : "good"}">${icon("gauge")} ${it.name} measured: <b>${Math.round(it.field * 100)} %</b> of its spec sheet</div>`);
      else meas.push(`<div class="meas">${icon("clock")} ${it.name}: measuring field performance…</div>`);
    }
    const tankBtn = S.chapter >= 5 && !r.tank && !r.devices.length && !r.pending.length && !jobFor(r.id)
      ? `<button class="btn" data-tank style="margin-top:10px">${icon("drop")}Convert to immersion tank · ${money(K.TANK_COST)}</button>` : "";
    $("detail").innerHTML = `
      <h2><span style="width:14px;height:14px;border-radius:3px;background:${role === "empty" ? "var(--line)" : ROLE[role].color};display:inline-block"></span>${r.id}<span class="sub" style="font-family:var(--sans);font-weight:400">${ROLE[role].name}</span></h2>
      <div class="sub" style="display:flex;align-items:center;gap:6px;margin-top:4px">${status}</div>
      <div class="rack-detail">
        <div class="elev" data-drop-rack="${r.id}" title="Front view, 20U">${elev}</div>
        <div class="gauges">
          ${g("temp", ramp(RAMPS.heat, (pr.inlet - 22) / 14), (pr.inlet - 18) / 18, `Inlet ${pr.inlet.toFixed(1)} °C${pr.throttle < 1 ? " · throttling" : ""}`)}
          ${g("bolt", "var(--pow-c)", pr.kw / K.RACK_KW, `${pr.kw.toFixed(1)} of ${K.RACK_KW} kW`)}
          ${g("net", "#8FC4FF", pr.netNeed ? Math.min(1, pr.netProv / pr.netNeed) : pr.netProv ? 1 : 0, `Network ${pr.netProv} / ${pr.netNeed.toFixed(0)}`)}
          ${g("plus", "var(--ok-c)", free / K.RACK_U, `${free}U free`)}
          ${wl}${modes}
        </div>
      </div>
      ${S.chapter >= 2 ? rooflineSVG(r, V.armed) : ""}
      ${meas.join("")}
      <div class="jobs" id="jobs">${jobsHTML()}</div>
      ${tankBtn}
      <div class="bin" data-drop-sell>${icon("coin")}Drop hardware here to sell it</div>`;
  }

  /* ---------- charts ---------- */
  function renderMarket() {
    const H = S.history.filter(h => h.d <= S.day);
    const svg = $("market-chart");
    const show = S.chapter >= 2;
    $("market-legend").innerHTML = show ? `<span style="color:${ROLE.train.color}"><i style="background:currentColor"></i>You · training</span><span style="color:${ROLE.train.color}"><i class="dash"></i>demand</span><span style="color:${ROLE.infer.color}"><i style="background:currentColor"></i>You · inference</span><span style="color:${ROLE.infer.color}"><i class="dash"></i>demand</span>` : "";
    if (!show || H.length < 2) { svg.innerHTML = `<text x="160" y="75" text-anchor="middle">Opens with chapter 3</text>`; return; }
    const W = 320, x0 = 30, y0 = 118, maxD = Math.max(20, ...H.map(h => Math.max(h.dt, h.di, h.st, h.si))) * 1.1;
    const span = Math.max(180, H[H.length - 1].d);
    const x = d => x0 + d / span * (W - x0 - 60), y = v => y0 - v / maxD * 104;
    const path = key => H.map((h, i) => `${i ? "L" : "M"}${x(h.d).toFixed(1)},${y(h[key]).toFixed(1)}`).join("");
    const last = H[H.length - 1], yearAgo = H.find(h => h.d >= last.d - 360) || H[0];
    const pct = (a, b) => { const p = (a / b - 1) * 100; return `${p >= 0 ? "▲" : "▼"}${Math.abs(p).toFixed(0)} %`; };
    svg.innerHTML = `
      <line x1="${x0}" y1="${y0}" x2="${W - 60}" y2="${y0}" stroke="var(--line)"/>
      ${[0, 0.5, 1].map(f => `<text x="${x0 - 4}" y="${y(maxD / 1.1 * f) + 4}" text-anchor="end">${Math.round(maxD / 1.1 * f)}</text>`).join("")}
      <path d="${path("dt")}" fill="none" stroke="${ROLE.train.color}" stroke-width="1.5" stroke-dasharray="4 3"/>
      <path d="${path("di")}" fill="none" stroke="${ROLE.infer.color}" stroke-width="1.5" stroke-dasharray="4 3"/>
      <path d="${path("st")}" fill="none" stroke="${ROLE.train.color}" stroke-width="2.5"/>
      <path d="${path("si")}" fill="none" stroke="${ROLE.infer.color}" stroke-width="2.5"/>
      <text x="${W - 56}" y="${y0 - 70}" style="fill:${ROLE.train.color};font-weight:600">$${(last.pt * 1000).toFixed(0)}/u·d</text>
      <text x="${W - 56}" y="${y0 - 57}" style="fill:${ROLE.train.color}">${pct(last.pt, yearAgo.pt)} yr</text>
      <text x="${W - 56}" y="${y0 - 30}" style="fill:${ROLE.infer.color};font-weight:600">$${(last.pi * 1000).toFixed(0)}/u·d</text>
      <text x="${W - 56}" y="${y0 - 17}" style="fill:${ROLE.infer.color}">${pct(last.pi, yearAgo.pi)} yr</text>
      <text x="${x0}" y="${y0 + 14}">day 0</text><text x="${x(last.d)}" y="${y0 + 14}" text-anchor="end">now</text>
      <text x="${W - 56}" y="${y0 + 14}">price</text>`;
  }
  function renderBench() {
    const svg = $("bench-chart"), B = S.bench, card = $("bench-card");
    card.classList.toggle("lockmask", !S.bench.lattice.length);
    if (!B.lattice.length && !B.photon.length) { svg.innerHTML = `<text x="150" y="70" text-anchor="middle">No emerging hardware yet</text>`; return; }
    const W = 300, x0 = 26, y0 = 112, all = B.lattice.concat(B.photon), maxV = Math.max(4, ...all.map(p => p.v)) * 1.15;
    const dMax = Math.max(...all.map(p => p.d)), dMin = 360, span = Math.max(120, dMax - dMin);
    const x = d => x0 + (d - dMin) / span * (W - x0 - 90), y = v => y0 - v / maxV * 100;
    let h = `<line x1="${x0}" y1="${y0}" x2="${W - 8}" y2="${y0}" stroke="var(--line)"/>
      <rect x="${x(dMax) + 6}" y="8" width="${W - x(dMax) - 14}" height="${y0 - 8}" fill="var(--tile)" opacity=".4"/>
      <text x="${x(dMax) + 30}" y="66" style="font-size:24px;font-family:var(--display)">?</text><text x="${x(dMax) + 12}" y="${y0 - 6}">no roadmap</text>`;
    for (const [v, col, name] of [["lattice", "#B0548C", "Lattice"], ["photon", "#56616E", "Photon"]]) {
      const P = B[v]; if (!P.length) continue;
      h += `<path d="${P.map((p, i) => `${i ? "L" : "M"}${x(p.d).toFixed(1)},${y(p.v).toFixed(1)}`).join("")}" fill="none" stroke="${col}" stroke-width="2.5"/>`;
      const l = P[P.length - 1];
      h += `<circle cx="${x(l.d)}" cy="${y(l.v)}" r="3.5" fill="${col}"/><text x="${x(l.d) - 4}" y="${y(l.v) - 7}" text-anchor="end" style="fill:${col};font-weight:600">${name} ${l.v.toFixed(1)}${S.vendors[v].dead ? " (dead)" : ""}</text>`;
    }
    h += `<text x="${x0}" y="${y0 + 14}">Y2</text><text x="${x(dMax)}" y="${y0 + 14}" text-anchor="end">now</text>`;
    svg.innerHTML = h;
  }
  function renderNews() {
    const TONE = { info: ["#56616E", "news"], good: ["#36A267", "trend"], bad: ["#C2452D", "warn"], pitch: ["#7B61C9", "tag"] };
    $("newsfeed").innerHTML = S.news.slice(0, 10).map(n => {
      const [c, ic] = TONE[n.tone] || TONE.info;
      const doy = n.day % 360;
      return `<div class="ev${S.day - n.day < 20 ? " fresh" : ""}" title="${n.body || ""}"><span class="av" style="background:${c}">${icon(n.icon || ic)}</span><span><strong>${n.title}</strong><span>${n.body || ""}</span><span class="when" style="display:block">${MONTHS[Math.floor(doy / 30)]} ${doy % 30 + 1}, Y${Math.floor(n.day / 360) + 1}</span></span></div>`;
    }).join("");
  }

  /* ================= dialogs ================= */
  function maybeChapter() {
    if (S.chapter > V.seenChapter) { V.seenChapter = S.chapter; showChapter(S.chapter); }
  }
  function showChapter(i) {
    const c = Sim.CHAPTERS[i], t = CHAPTER_TEXT[c.key];
    $("ct").textContent = c.title; $("csub").textContent = t.sub + " · game paused";
    $("cbody").innerHTML = `<ul>${t.items.map(([ic, col, txt]) => `<li><span class="av" style="background:${col}">${icon(ic)}</span><span>${txt}</span></li>`).join("")}</ul>`;
    openDialog($("chapter"));
    renderAll();
  }
  function openDialog(d) { if (!d.open) d.showModal(); }
  document.querySelectorAll("dialog [data-close]").forEach(b => b.addEventListener("click", () => b.closest("dialog").close()));

  function waterfall(L) {
    const items = [["Web", L.web, ROLE.web.color], ["Training", L.train, ROLE.train.color], ["Inference", L.infer, ROLE.infer.color],
      ["Power", -L.power, "#E2A91C"], ["Upkeep", -L.upkeep, "#6D7784"]];
    const gross = Math.max(1, L.web + L.train + L.infer);
    const scale = v => v * 170 / gross, base = 200, w = 62, gap = 20;
    let run = 0, x = 20, h = `<line x1="10" y1="${base}" x2="610" y2="${base}" stroke="var(--line)"/>`;
    for (const [name, v, c] of items) {
      const top = v >= 0 ? run + v : run, yy = base - scale(top);
      h += `<rect x="${x}" y="${yy}" width="${w}" height="${Math.max(1, scale(Math.abs(v)))}" rx="2" fill="${c}"/>
        <text class="v" x="${x + w / 2}" y="${yy - 5}" text-anchor="middle">${v >= 0 ? "+" : "−"}${money(Math.abs(v))}</text>
        <text x="${x + w / 2}" y="${base + 16}" text-anchor="middle">${name}</text>`;
      run += v; x += w + gap;
    }
    const yy = base - scale(Math.max(0, run));
    h += `<rect x="${x}" y="${yy}" width="${w}" height="${Math.max(1, scale(Math.abs(run)))}" rx="2" fill="var(--ink)"/>
      <text class="v" x="${x + w / 2}" y="${yy - 5}" text-anchor="middle">${money(run)}</text><text x="${x + w / 2}" y="${base + 16}" text-anchor="middle">Net</text>`;
    if (L.lost > 0.5) h += `<text x="${x + w + 14}" y="${base - 40}" style="fill:#E0532F">Heat cost</text><text class="v" x="${x + w + 14}" y="${base - 24}" style="fill:#E0532F">−${money(L.lost)}</text>`;
    $("waterfall").innerHTML = h;
  }
  $("ledger").addEventListener("click", () => {
    const useLast = S.lastQuarter && (S.day % 90) < 15;
    const L = useLast ? S.lastQuarter : S.ledger, q = useLast ? S.lastQuarter.q : Math.floor(S.day / 90);
    $("rt").textContent = `Y${Math.floor(q / 4) + 1} Q${q % 4 + 1} ${useLast ? "results" : "so far"}`;
    $("rsub").textContent = "Game paused while open";
    waterfall(L);
    openDialog($("report"));
  });
  $("helpbtn").addEventListener("click", () => showChapter(S.chapter));

  /* end screen: replay the same seed with the reference bots, in slices so the page stays responsive */
  function showOver() {
    const worth = Sim.netWorth(S);
    $("ot").textContent = S.over === "bankrupt" ? "Bankrupt" : "Three years are up";
    $("osub").textContent = `seed ${seed}`;
    const H = S.hidden, NAME = { lattice: "Lattice", photon: "Photon" };
    const truths = `<div class="sub" style="margin-top:12px">Behind the curtain this game: <b>${NAME[H.realExotic]}</b> was the real thing, <b>${NAME[H.fakeExotic]}</b> was hype (60 % of spec, then shut down). Nanofab ${H.nanofabDies ? "<b>died</b> and bricked every PM-900" : "survived"}.</div>`;
    const rows = { you: worth, greedy: null, planner: null };
    const draw = () => {
      const max = Math.max(1, ...Object.values(rows).filter(v => v != null));
      const bar = (k, name, col) => `<div class="bar"><span>${name}</span><i style="width:${rows[k] == null ? 0 : Math.max(1, rows[k] / max * 100)}%;background:${col}"></i><b>${rows[k] == null ? "…" : money(rows[k])}</b></div>`;
      $("obody").innerHTML = `<div class="score">
        <div class="big" style="font-size:34px">${money(worth)}</div><div class="sub">Net worth after ${Math.floor(S.day)} days (cash ${money(S.cash)} + hardware resale)</div>
        ${bar("you", "You", "var(--sel)")}${bar("greedy", "Greedy bot", "#6D7784")}${bar("planner", "Planner bot", "#4A6FB8")}
        <div class="sub">Greedy bot buys whatever pays best today. Planner bot looks ahead: seasons, launches, vendor news, pilots, per-kW upgrades. Same seed, same events.</div>
        ${truths}</div>`;
    };
    draw();
    openDialog($("over"));
    for (const pol of ["greedy", "planner"]) {
      const s = Sim.newGame(seed), mem = {};
      const slice = () => {
        const until = s.day + 60;
        while (!s.over && s.day < until) { Bots.POLICIES[pol](s, mem); Sim.advance(s, 1); }
        if (s.over) { rows[pol] = Sim.netWorth(s); dlog("bot", pol, rows[pol]); draw(); } else setTimeout(slice, 0);
      };
      setTimeout(slice, 30);
    }
  }
  $("new-game").addEventListener("click", () => { $("over").close(); start(Math.floor(Math.random() * 1e6)); });
  $("same-seed").addEventListener("click", () => { $("over").close(); start(seed); });

  /* ================= drag and drop (pointer events: works with touch) ================= */
  let drag = null, suppressClick = false;
  function payload(el) {
    return el.dataset.drag === "new" ? { kind: "new", item: el.dataset.item }
      : { kind: "dev", from: el.dataset.rack, uid: +el.dataset.uid };
  }
  function opFor(p, target) {
    if (!target) return null;
    if (target.hasAttribute("data-drop-sell")) return p.kind === "dev" ? { type: "sell", rack: p.from, uid: p.uid } : null;
    const to = target.dataset.rack || target.dataset.dropRack;
    if (!to) return null;
    return p.kind === "new" ? { type: "buy", item: p.item, rack: to } : { type: "move", rack: p.from, uid: p.uid, to };
  }
  function findTarget(x, y) {
    const el = document.elementFromPoint(x, y);
    return el && el.closest("[data-rack]:not([data-drag]), [data-drop-rack], [data-drop-sell]");
  }
  const clearMarks = () => document.querySelectorAll(".drop-ok, .drop-bad").forEach(e => e.classList.remove("drop-ok", "drop-bad"));
  const payloadItem = p => p.kind === "new" ? item(p.item) : (() => { const d = rack(p.from).devices.find(x => x.uid === p.uid); return d && item(d.type); })();

  document.addEventListener("pointerdown", e => {
    const src = e.target.closest("[data-drag]");
    if (!src || e.button !== 0 || S.over) return;
    drag = { src, x: e.clientX, y: e.clientY, started: false, p: payload(src) };
  });
  document.addEventListener("pointermove", e => {
    if (!drag) return;
    if (!drag.started) {
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 6) return;
      const it = payloadItem(drag.p);
      if (!it) { drag = null; return; }
      drag.started = true;
      document.body.classList.add("dragging");
      drag.ghost = document.createElement("div");
      drag.ghost.className = "ghost";
      drag.ghost.innerHTML = `<div class="gcard">${icon(it.icon)}${it.name}</div><div class="msg"></div>`;
      document.body.appendChild(drag.ghost);
    }
    e.preventDefault();
    drag.ghost.style.left = e.clientX + "px"; drag.ghost.style.top = e.clientY + "px";
    const target = findTarget(e.clientX, e.clientY);
    clearMarks();
    const msg = drag.ghost.querySelector(".msg");
    const op = opFor(drag.p, target);
    const st = Sim.stats(S);
    if (!op) { msg.style.display = "none"; renderHUD(st); drag.op = null; return; }
    const res = Sim.check(S, op);
    target.classList.add(res.ok ? "drop-ok" : "drop-bad");
    let level = res.ok ? "ok" : "bad", text = res.msg;
    let proj = null;
    if (res.ok) {
      proj = Sim.stats(Sim.project(S, op), { eq: true });
      const eqNow = Sim.stats(S, { eq: true });
      const dNet = proj.net - eqNow.net;
      text += ` · ${dNet >= 0 ? "+" : "−"}$${Math.abs(dNet).toFixed(2)}k/d`;
      const pr = proj.perRack[op.to || op.rack];
      if (pr && pr.throttle < 1) { level = "warn"; text += ` · rack throttles to ${Math.round(pr.throttle * 100)} %`; }
      else if (pr && pr.netF < 1 && pr.netNeed > 0) { level = "warn"; text += " · network short"; }
    }
    msg.style.display = ""; msg.className = "msg " + level; msg.textContent = text;
    renderHUD(st, proj);
    drag.op = res.ok ? op : null;
  });
  function endDrag(commitIt) {
    if (!drag) return;
    if (drag.started) {
      drag.ghost.remove(); document.body.classList.remove("dragging"); clearMarks();
      suppressClick = true; setTimeout(() => suppressClick = false, 0);
      const op = drag.op; drag = null;
      if (commitIt && op) { V.armed = null; act(op); } else renderAll();
      return;
    }
    drag = null;
  }
  document.addEventListener("pointerup", () => endDrag(true));
  document.addEventListener("pointercancel", () => endDrag(false));

  /* ================= clicks and keys ================= */
  function setSpeed(v) { V.speed = v; if (v) V.lastSpeed = v; renderHUD(Sim.stats(S)); }
  document.addEventListener("click", e => {
    if (suppressClick) return;
    const sp = e.target.closest("[data-speed]");
    if (sp) { setSpeed(+sp.dataset.speed); return; }
    const it = e.target.closest("[data-item]");
    if (it) { V.armed = V.armed === it.dataset.item ? null : it.dataset.item; renderAll(); if (V.armed) toast(`Tap a rack to order ${item(V.armed).name}`); return; }
    const rk = e.target.closest("#floor [data-rack]");
    if (rk) {
      if (V.armed) { if (act({ type: "buy", item: V.armed, rack: rk.dataset.rack })) V.armed = null; renderAll(); return; }
      V.selected = rk.dataset.rack; renderAll(); return;
    }
    const pm = e.target.closest("[data-pmode]");
    if (pm) { act({ type: "mode", rack: V.selected, mode: pm.dataset.pmode }); return; }
    const wl = e.target.closest("[data-wl]");
    if (wl) { act({ type: "workload", rack: V.selected, workload: wl.dataset.wl }); return; }
    if (e.target.closest("[data-tank]")) { act({ type: "tank", rack: V.selected }); return; }
    if (e.target.closest("[data-grid]") || e.target.closest("#h-power")) {
      if (S.chapter < 1 || S.gridUp || S.jobs.some(j => j.kind === "grid")) return;
      if (confirm(`Upgrade the grid to ${K.GRID_KW_UP} kW for ${money(K.GRID_COST)}? Takes ${K.GRID_DAYS} days.`)) act({ type: "grid" });
      return;
    }
    const mb = e.target.closest("#modes button");
    if (mb) { V.mode = mb.dataset.mode; renderAll(); }
  });
  document.addEventListener("keydown", e => {
    if (e.target.closest("input, textarea") || anyDialogOpen()) return;
    if (e.code === "Space") { e.preventDefault(); setSpeed(V.speed ? 0 : V.lastSpeed); }
    else if (e.key === "1") setSpeed(1);
    else if (e.key === "2") setSpeed(2);
    else if (e.key === "3") setSpeed(4);
    else if (e.key === "Escape" && V.armed) { V.armed = null; renderAll(); }
    else if (e.key === "m") { const ms = MAP_MODES.filter(m => S.chapter >= m.ch); V.mode = ms[(ms.findIndex(m => m.key === V.mode) + 1) % ms.length].key; renderAll(); }
  });

  /* ================= feedback ================= */
  let toastT;
  function toast(t) { const el = $("toast"); el.textContent = t; el.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove("show"), 2400); }
  let cashT;
  function flashCash(d) {
    const el = $("h-cash-d");
    el.textContent = (d > 0 ? "+" : "−") + money(Math.abs(d));
    el.style.color = d > 0 ? "#7FE0A8" : "#FF8466";
    clearTimeout(cashT); cashT = setTimeout(() => el.textContent = "", 1400);
  }

  if (params.has("speed")) V.speed = V.lastSpeed = +params.get("speed");
  start(seed);
  window.__game = { get S() { return S; }, V, act, start };   // console / test hook
  requestAnimationFrame(frame);
})();
