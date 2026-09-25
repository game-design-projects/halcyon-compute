/* Halcyon Compute — visual juice layer (game feel pass, docs/GAME_FEEL.md).
 * Display only: nothing here reads or writes sim numbers. One pooled overlay canvas for particles and floating text,
 * trauma-based screen shake on `.game`, a flash overlay, eased tweens, and per-rack CSS animations that survive the
 * floor's innerHTML re-renders (re-applied with a negative animation-delay so they resume where they were).
 * Classic script, no dependencies, works from file://. Exposes window.FX.
 */
(function () {
  "use strict";
  const DEBUG = /[?&]debug\b/.test(location.search);
  const dlog = (...a) => { if (DEBUG) console.log("[fx]", ...a); };

  /* ---------- reduced motion: no shake, no particles, short tweens ---------- */
  let reduced = false;
  try {
    const mq = matchMedia("(prefers-reduced-motion: reduce)");
    reduced = mq.matches;
    mq.addEventListener("change", e => { reduced = e.matches; dlog("reduced motion", reduced); if (reduced) clearAll(); });
  } catch (e) { /* old browsers */ }

  /* ---------- easing ---------- */
  const EASE = {
    linear: t => t,
    outCubic: t => 1 - Math.pow(1 - t, 3),
    inOutCubic: t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
    outBack: t => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
    outElastic: t => t === 0 || t === 1 ? t : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (2 * Math.PI) / 3) + 1,
  };

  /* ---------- overlay canvas (created lazily, one for the whole page) ---------- */
  let cv = null, cx = null, W = 0, H = 0, DPR = 1;
  // dirty rectangle: only the area drawn last frame is cleared (a full clear of a big canvas every frame is the main cost)
  let dx0 = 0, dy0 = 0, dx1 = 0, dy1 = 0, dirty = false;
  function clearDirty() {
    if (!dirty) return;
    const x = Math.max(0, dx0), y = Math.max(0, dy0);
    cx.clearRect(x, y, Math.min(W, dx1) - x, Math.min(H, dy1) - y);
    dirty = false;
  }
  function ensureCanvas() {
    if (cv) return;
    cv = document.createElement("canvas");
    cv.id = "fx-canvas";
    cv.setAttribute("aria-hidden", "true");
    document.body.appendChild(cv);
    cx = cv.getContext("2d");
    resize();
    addEventListener("resize", resize);
  }
  function resize() {
    if (!cv) return;
    DPR = Math.min(2, window.devicePixelRatio || 1);
    W = innerWidth; H = innerHeight;
    cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
    cx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  /* A modal <dialog> sits in the browser's top layer, above any z-index. To draw confetti over a chapter card or the
   * end screen while keeping ONE canvas, the canvas becomes a manual popover shown after the dialog (so it stacks above
   * it in the top layer). Fallback without the Popover API: re-parent into the dialog. */
  const hasPopover = typeof HTMLElement !== "undefined" && "showPopover" in HTMLElement.prototype;
  function hostCanvas(dialog) {
    ensureCanvas();
    if (hasPopover) {
      if (cv.parentNode !== document.body) document.body.appendChild(cv);
      try {
        if (cv.hasAttribute("popover") && cv.matches(":popover-open")) cv.hidePopover();
        // no modal: drop the attribute, or the UA rule [popover]:not(:popover-open) { display: none } hides the canvas
        if (dialog) { cv.setAttribute("popover", "manual"); cv.showPopover(); } else cv.removeAttribute("popover");
      } catch (e) { dlog("popover failed", e && e.message); cv.removeAttribute("popover"); }
    } else {
      const p = dialog || document.body;
      if (cv.parentNode !== p) p.appendChild(cv);
    }
  }

  /* ---------- particle pool ---------- */
  const MAXP = 700, MAXT = 48;
  const P = [], T = [];
  for (let i = 0; i < MAXP; i++) P.push({ on: false, x: 0, y: 0, vx: 0, vy: 0, g: 0, drag: 0, life: 0, max: 1, size: 2, grow: 0, color: "#fff", kind: 0, rot: 0, vr: 0, a: 1 });
  for (let i = 0; i < MAXT; i++) T.push({ on: false, x: 0, y: 0, vy: 0, life: 0, max: 1, size: 12, color: "#fff", text: "", scale: 1 });
  let pHead = 0, tHead = 0, liveP = 0, liveT = 0;
  const K_SPARK = 0, K_SMOKE = 1, K_CONF = 2, K_STEAM = 3, K_DUST = 4;
  function takeP() {   // round-robin: when the pool is full the oldest slot is recycled (bounded cost)
    for (let n = 0; n < MAXP; n++) { const p = P[pHead]; pHead = (pHead + 1) % MAXP; if (!p.on) { liveP++; return p; } }
    const p = P[pHead]; pHead = (pHead + 1) % MAXP; return p;
  }
  function spawn(kind, x, y, o) {
    if (reduced) return;
    ensureCanvas();
    const p = takeP();
    p.on = true; p.kind = kind; p.x = x; p.y = y; p.vx = o.vx || 0; p.vy = o.vy || 0; p.g = o.g || 0; p.drag = o.drag || 0;
    p.life = 0; p.max = o.life || 0.8; p.size = o.size || 2; p.grow = o.grow || 0; p.color = o.color || "#fff";
    p.rot = o.rot || 0; p.vr = o.vr || 0; p.a = o.a == null ? 1 : o.a;
  }
  const rnd = (a, b) => a + Math.random() * (b - a);

  /* bursts */
  function sparks(x, y, color, n, speed) {
    n = n || 18; speed = speed || 220;
    for (let i = 0; i < n; i++) {
      const ang = rnd(0, Math.PI * 2), sp = rnd(0.35, 1) * speed;
      spawn(K_SPARK, x, y, { vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - speed * 0.25, g: 520, drag: 2.2, life: rnd(0.35, 0.7), size: rnd(1.4, 2.6), color });
    }
  }
  function smoke(x, y, n) {
    for (let i = 0; i < (n || 6); i++) spawn(K_SMOKE, x + rnd(-8, 8), y + rnd(-4, 4), { vx: rnd(-12, 12), vy: rnd(-45, -25), drag: 0.6, life: rnd(0.9, 1.5), size: rnd(5, 8), grow: 14, color: "#6b6f75", a: 0.45 });
  }
  function steam(x, y) {
    spawn(K_STEAM, x + rnd(-10, 10), y, { vx: rnd(-6, 6), vy: rnd(-38, -24), drag: 0.3, life: rnd(0.9, 1.4), size: rnd(3, 5), grow: 9, color: "#f3f5f7", a: 0.28 });
  }
  function dust(x, y, w) {
    for (let i = 0; i < 8; i++) spawn(K_DUST, x + rnd(-w / 2, w / 2), y, { vx: rnd(-60, 60), vy: rnd(-40, -10), g: 120, drag: 3, life: rnd(0.3, 0.55), size: rnd(1.5, 3), color: "#9aa4ae", a: 0.7 });
  }
  const CONF_COLORS = ["#FFD24A", "#7FE0A8", "#FF8466", "#8FC4FF", "#B25FC4", "#E8B730", "#3FA7A0"];
  function confetti(x, y, n, spread) {
    n = n || 70; spread = spread || 1;
    for (let i = 0; i < n; i++) {
      const ang = rnd(-Math.PI * 0.92, -Math.PI * 0.08), sp = rnd(220, 520) * spread;
      spawn(K_CONF, x, y, { vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, g: 420, drag: 1.6, life: rnd(1.4, 2.4), size: rnd(4, 7), color: CONF_COLORS[i % CONF_COLORS.length], rot: rnd(0, 6), vr: rnd(-12, 12) });
    }
  }

  /* floating text ("+$4.1k") */
  function floatText(x, y, text, color, size) {
    if (reduced) return;
    ensureCanvas();
    let t = null;
    for (let n = 0; n < MAXT; n++) { const c = T[tHead]; tHead = (tHead + 1) % MAXT; if (!c.on) { t = c; liveT++; break; } }
    if (!t) { t = T[tHead]; tHead = (tHead + 1) % MAXT; }
    t.on = true; t.x = x; t.y = y; t.vy = -34; t.life = 0; t.max = 1.25; t.size = size || 13; t.color = color || "#7FE0A8"; t.text = text;
  }

  /* ---------- shake (trauma model: offset ∝ trauma², decays linearly) ---------- */
  let trauma = 0, shakeEl = null, shaking = false;
  function shake(amount) {
    if (reduced) return;
    trauma = Math.min(1, trauma + amount);
    dlog("shake", amount.toFixed(2), "trauma", trauma.toFixed(2));
  }

  /* ---------- flash overlay (Web Animations on opacity: compositor only) ---------- */
  let flashEl = null;
  function flash(color, ms, alpha) {
    if (!flashEl) { flashEl = document.createElement("div"); flashEl.id = "fx-flash"; flashEl.setAttribute("aria-hidden", "true"); document.body.appendChild(flashEl); }
    flashEl.style.background = color;
    const a = reduced ? Math.min(alpha || 0.5, 0.25) : (alpha || 0.5);
    try { flashEl.animate([{ opacity: a }, { opacity: 0 }], { duration: reduced ? Math.min(ms, 250) : ms, easing: "ease-out" }); } catch (e) { /* no WAAPI */ }
  }

  /* ---------- tweens ---------- */
  const tweens = [];
  function tween(from, to, ms, ease, onUpdate, onDone) {
    const tw = { from, to, ms: reduced ? Math.min(ms, 120) : ms, t0: performance.now(), ease: EASE[ease] || EASE.outCubic, onUpdate, onDone };
    tweens.push(tw);
    onUpdate(from);
    return tw;
  }

  /* ---------- per-rack CSS animations that survive re-renders ----------
   * entry: { name, t0, dur, delay, hold } — hold = keep the end state until cleared (outage blackout). */
  const rackAnims = new Map();   // rackId -> entry
  let floorEl = null;
  function rackEl(id) { return floorEl ? floorEl.querySelector(`[data-rack="${id}"]:not([data-drag])`) : null; }
  function styleFor(e, now) {
    const el = now - e.t0 - e.delay;
    return `${e.name} ${e.dur}ms ${e.ease || "ease-out"} ${-el}ms 1 both`;
  }
  function rackAnim(id, name, dur, delay, hold, ease) {
    const e = { name, t0: performance.now(), dur: reduced ? Math.min(dur, 150) : dur, delay: reduced ? 0 : (delay || 0), hold: !!hold, ease };
    rackAnims.set(id, e);
    const el = rackEl(id);
    if (el) el.style.animation = styleFor(e, e.t0);
  }
  function clearRackAnims(pred) {
    for (const [id, e] of rackAnims) if (!pred || pred(e, id)) { rackAnims.delete(id); const el = rackEl(id); if (el) el.style.animation = ""; }
  }
  /* called by ui.js right after the floor's innerHTML is replaced */
  function afterFloor(F) {
    floorEl = F;
    rectCache.clear();
    const now = performance.now();
    for (const [id, e] of rackAnims) {
      if (!e.hold && now - e.t0 - e.delay > e.dur) { rackAnims.delete(id); continue; }
      const el = rackEl(id);
      if (el) el.style.animation = styleFor(e, now);
    }
  }
  const rectCache = new Map();   // rackId -> DOMRect, valid until the floor re-renders, the page scrolls or resizes
  addEventListener("scroll", () => rectCache.clear(), true);
  addEventListener("resize", () => rectCache.clear());
  function rackCenter(id) {
    let r = rectCache.get(id);
    if (!r) {
      const el = rackEl(id);
      if (!el) return null;
      r = el.getBoundingClientRect();
      rectCache.set(id, r);
    }
    if (r.width === 0 || r.bottom < 0 || r.top > innerHeight) return null;
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, top: r.top, bottom: r.bottom, w: r.width, h: r.height };
  }

  /* ---------- per-frame update + draw (driven by ui.js frame(), no extra rAF loop) ---------- */
  let lastT = performance.now();
  const NB = 4, BUCKETS = Array.from({ length: 2 * NB }, () => []);   // steam 0..3, smoke 4..7
  function tick(now) {
    const dt = Math.min(0.05, Math.max(0, (now - lastT) / 1000)); lastT = now;
    // tweens
    for (let i = tweens.length - 1; i >= 0; i--) {
      const tw = tweens[i], k = Math.max(0, Math.min(1, (now - tw.t0) / Math.max(1, tw.ms)));   // rAF time can precede t0
      tw.onUpdate(tw.from + (tw.to - tw.from) * tw.ease(k));
      if (k >= 1) { tweens.splice(i, 1); if (tw.onDone) tw.onDone(); }
    }
    // shake on the play area only (HUD numbers stay still and readable)
    if (!shakeEl) shakeEl = document.querySelector(".game");
    if (trauma > 0 && shakeEl) {
      trauma = Math.max(0, trauma - dt * 1.4);
      const s = trauma * trauma, t = now / 1000;
      const ox = 14 * s * Math.sin(t * 71.3 + 1.7) * Math.cos(t * 37.1), oy = 10 * s * Math.sin(t * 63.7 + 0.3) * Math.cos(t * 29.3 + 2.1), rot = 0.9 * s * Math.sin(t * 47.9);
      if (!shaking) shakeEl.style.willChange = "transform";   // own compositor layer only while shaking: no full repaints
      shakeEl.style.transform = trauma > 0 ? `translate(${ox.toFixed(2)}px,${oy.toFixed(2)}px) rotate(${rot.toFixed(3)}deg)` : "";
      shaking = true;
    } else if (shaking && shakeEl) { shakeEl.style.transform = ""; shakeEl.style.willChange = ""; shaking = false; }
    // particles + floating text
    if (!cv) return;
    clearDirty();
    if (liveP === 0 && liveT === 0) return;
    let lp = 0, lt = 0, x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    const grow = (x, y, m) => { if (x - m < x0) x0 = x - m; if (y - m < y0) y0 = y - m; if (x + m > x1) x1 = x + m; if (y + m > y1) y1 = y + m; };
    for (let i = 0; i < MAXP; i++) {
      const p = P[i]; if (!p.on) continue;
      p.life += dt;
      if (p.life >= p.max) { p.on = false; continue; }
      lp++;
      const k = p.life / p.max, dr = Math.max(0, 1 - p.drag * dt);
      p.vx *= dr; p.vy = p.vy * dr + p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt;
      grow(p.x, p.y, p.size + p.grow * p.life + Math.abs(p.vx * 0.03) + Math.abs(p.vy * 0.03) + 4);
      if (p.kind === K_CONF) {
        p.rot += p.vr * dt;
        cx.save(); cx.translate(p.x, p.y); cx.rotate(p.rot); cx.scale(1, Math.abs(Math.cos(p.rot * 1.7)) + 0.15);
        cx.globalAlpha = k > 0.75 ? (1 - k) / 0.25 : 1; cx.fillStyle = p.color; cx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2); cx.restore();
      } else if (p.kind === K_SMOKE || p.kind === K_STEAM) {   // batched below: one path per (kind, alpha bucket)
        const al = p.a * (k < 0.2 ? k / 0.2 : 1 - (k - 0.2) / 0.8), b = (p.kind === K_STEAM ? 0 : NB) + Math.min(NB - 1, Math.floor(al / p.a * NB));
        BUCKETS[b].push(p);
      } else {   // spark / dust: short streak along velocity
        cx.globalAlpha = p.a * (1 - k); cx.strokeStyle = p.color; cx.lineWidth = p.size; cx.lineCap = "round";
        cx.beginPath(); cx.moveTo(p.x, p.y); cx.lineTo(p.x - p.vx * 0.03, p.y - p.vy * 0.03); cx.stroke();
      }
    }
    for (let b = 0; b < 2 * NB; b++) {
      const L = BUCKETS[b]; if (!L.length) continue;
      const q = L[0];
      cx.globalAlpha = q.a * ((b % NB) + 0.5) / NB; cx.fillStyle = q.color;
      cx.beginPath();
      for (const p of L) { const r = p.size + p.grow * p.life; cx.moveTo(p.x + r, p.y); cx.arc(p.x, p.y, r, 0, 6.283); }
      cx.fill();
      L.length = 0;
    }
    if (liveT) {
      cx.textAlign = "center"; cx.textBaseline = "middle"; cx.lineJoin = "round";
      for (let i = 0; i < MAXT; i++) {
        const t = T[i]; if (!t.on) continue;
        t.life += dt;
        if (t.life >= t.max) { t.on = false; continue; }
        lt++;
        const k = t.life / t.max, pop = k < 0.15 ? EASE.outBack(k / 0.15) : 1;
        t.y += t.vy * dt; t.vy *= (1 - 1.2 * dt);
        grow(t.x, t.y, t.size * 4 + t.text.length * t.size * 0.35);
        cx.globalAlpha = k > 0.6 ? 1 - (k - 0.6) / 0.4 : 1;
        cx.font = `600 ${(t.size * pop).toFixed(1)}px "Barlow Condensed", "Arial Narrow", sans-serif`;
        cx.lineWidth = 3; cx.strokeStyle = "rgba(15,19,23,.75)"; cx.strokeText(t.text, t.x, t.y);
        cx.fillStyle = t.color; cx.fillText(t.text, t.x, t.y);
      }
    }
    cx.globalAlpha = 1;
    liveP = lp; liveT = lt;
    if (lp || lt) { dx0 = Math.floor(x0); dy0 = Math.floor(y0); dx1 = Math.ceil(x1); dy1 = Math.ceil(y1); dirty = true; }
  }

  function clearAll() {
    for (const p of P) p.on = false;
    for (const t of T) t.on = false;
    liveP = liveT = 0; trauma = 0;
    if (shakeEl) shakeEl.style.transform = "";
    if (cx) cx.clearRect(0, 0, W, H);
    dirty = false;
  }

  window.FX = {
    get reduced() { return reduced; }, EASE,
    sparks, smoke, steam, dust, confetti, floatText, shake, flash, tween,
    rackAnim, clearRackAnims, afterFloor, rackCenter, rackEl, hostCanvas, tick, clearAll,
    get live() { return { particles: liveP, texts: liveT, trauma, tweens: tweens.length, rackAnims: rackAnims.size }; },
  };
})();
