/* Halcyon Compute — synthesized sound (game feel pass, docs/GAME_FEEL.md). WebAudio only, no files.
 * The AudioContext is created lazily on the first user gesture (autoplay policy). Default volume is low.
 * Mute is persisted in localStorage (guarded: storage may be unavailable). Exposes window.SFX.
 */
(function () {
  "use strict";
  const DEBUG = /[?&]debug\b/.test(location.search);
  const dlog = (...a) => { if (DEBUG) console.log("[sfx]", ...a); };
  const MUTE_KEY = "halcyon.mute";
  const VOL = 0.32;

  let muted = false;
  try { muted = localStorage.getItem(MUTE_KEY) === "1"; } catch (e) { /* storage blocked */ }
  let ac = null, master = null, sfxBus = null, noiseBuf = null;
  let hum = null;
  const last = {};   // per-sound rate limit timestamps
  const listeners = [];

  function init() {
    if (ac) return true;
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return false;
    try {
      ac = new Ctor();
      master = ac.createGain(); master.gain.value = muted ? 0 : VOL;
      const comp = ac.createDynamicsCompressor(); comp.threshold.value = -18; comp.ratio.value = 4;
      master.connect(comp); comp.connect(ac.destination);
      sfxBus = ac.createGain(); sfxBus.gain.value = 1; sfxBus.connect(master);
      noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      dlog("audio context", ac.sampleRate);
      return true;
    } catch (e) { dlog("audio init failed", e && e.message); ac = null; return false; }
  }
  function unlock() { if (init() && ac.state === "suspended") ac.resume().catch(() => {}); }
  addEventListener("pointerdown", unlock, true);
  addEventListener("keydown", unlock, true);
  // a hidden tab stops the render loop; stop the hum with it
  document.addEventListener("visibilitychange", () => {
    if (!ac) return;
    if (document.hidden) ac.suspend().catch(() => {}); else ac.resume().catch(() => {});
  });

  const ready = () => ac && ac.state === "running" && !muted;
  function limit(key, ms) { const n = performance.now(); if (last[key] && n - last[key] < ms) return false; last[key] = n; return true; }

  /* ---------- building blocks ---------- */
  function env(g, t, a, peak, d, sus) {   // attack / exponential decay envelope
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, sus || 0.0001), t + a + d);
  }
  function tone(type, f0, f1, t, dur, peak, a, dest) {
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    env(g, t, a || 0.004, peak, dur);
    o.connect(g); g.connect(dest || sfxBus);
    o.start(t); o.stop(t + (a || 0.004) + dur + 0.05);
  }
  function noise(t, dur, peak, type, freq, q, dest) {
    const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    s.buffer = noiseBuf; s.loop = true;
    f.type = type || "bandpass"; f.frequency.value = freq || 1000; f.Q.value = q || 1;
    env(g, t, 0.003, peak, dur);
    s.connect(f); f.connect(g); g.connect(dest || sfxBus);
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
  }

  /* ---------- the sound palette ---------- */
  const S = {
    pickup() { const t = ac.currentTime; tone("triangle", 520, 880, t, 0.07, 0.22); },
    drop() { const t = ac.currentTime; tone("sine", 150, 55, t, 0.16, 0.55); noise(t, 0.05, 0.25, "lowpass", 900, 0.7); },
    nope() { const t = ac.currentTime; tone("square", 150, 140, t, 0.07, 0.12); tone("square", 120, 110, t + 0.1, 0.09, 0.12); },
    install() { const t = ac.currentTime; tone("triangle", 660, 660, t, 0.06, 0.16); tone("triangle", 990, 990, t + 0.06, 0.1, 0.16); },
    coin(amount) {   // soft ping; pitch rises with the amount (log scale)
      const t = ac.currentTime, f = 1100 * Math.pow(2, Math.min(1.6, Math.max(0, Math.log10(Math.max(1, amount)) * 0.55)));
      tone("sine", f, f, t, 0.12, 0.07);
    },
    chaching(amount) {
      const t = ac.currentTime, k = Math.pow(2, Math.min(1, Math.max(0, Math.log10(Math.max(1, amount)) / 3)));
      tone("triangle", 1319 * k, 1319 * k, t, 0.08, 0.2); tone("triangle", 1760 * k, 1760 * k, t + 0.07, 0.25, 0.2);
      noise(t + 0.06, 0.18, 0.08, "highpass", 6000, 0.5);
    },
    fail() { const t = ac.currentTime; noise(t, 0.12, 0.35, "bandpass", 2400, 2); tone("sawtooth", 900, 90, t, 0.22, 0.13); },
    alarm() { const t = ac.currentTime; for (let i = 0; i < 3; i++) { tone("square", 880, 880, t + i * 0.34, 0.15, 0.1); tone("square", 660, 660, t + i * 0.34 + 0.17, 0.15, 0.1); } },
    warn() { const t = ac.currentTime; tone("sine", 740, 740, t, 0.1, 0.1); tone("sine", 740, 740, t + 0.16, 0.1, 0.08); },
    powerDown() { const t = ac.currentTime; tone("sawtooth", 320, 30, t, 1.3, 0.12, 0.02); tone("sine", 160, 25, t, 1.4, 0.3, 0.02); },
    powerUp() { const t = ac.currentTime; tone("sawtooth", 40, 300, t, 0.9, 0.08, 0.05); tone("sine", 50, 220, t, 0.9, 0.22, 0.05); },
    thud() { const t = ac.currentTime; tone("sine", 90, 32, t, 0.5, 0.6); noise(t, 0.25, 0.3, "lowpass", 300, 0.7); },
    launch() { const t = ac.currentTime; tone("sine", 110, 35, t, 0.7, 0.55); tone("sawtooth", 600, 120, t + 0.05, 0.6, 0.08); noise(t, 0.35, 0.2, "lowpass", 500, 0.7); },
    crunch() { const t = ac.currentTime; for (let i = 0; i < 5; i++) noise(t + i * 0.045, 0.04, 0.3, "bandpass", 800 + i * 500, 3); tone("square", 220, 60, t, 0.4, 0.08); },
    chime() { const t = ac.currentTime; [1047, 1319, 1568].forEach((f, i) => tone("sine", f, f, t + i * 0.09, 1.1, 0.14, 0.005)); },
    chord() { const t = ac.currentTime; [262, 330, 392, 494].forEach((f, i) => { tone("triangle", f, f, t + i * 0.03, 1.8, 0.07, 0.08); tone("sine", f * 2, f * 2, t + i * 0.03, 1.2, 0.025, 0.08); }); },
    fanfare() { const t = ac.currentTime; [523, 659, 784, 1047].forEach((f, i) => tone("triangle", f, f, t + i * 0.11, i === 3 ? 1.4 : 0.18, 0.14)); [262, 392].forEach(f => tone("sine", f, f, t + 0.33, 1.5, 0.08, 0.05)); },
    drum(i) { const t = ac.currentTime; noise(t, 0.06, 0.22 + 0.02 * Math.min(8, i || 0), "bandpass", 180, 1.2); tone("sine", 120, 70, t, 0.08, 0.2); },
    tick(step) { const t = ac.currentTime, f = 600 * Math.pow(2, Math.min(2, (step || 0) / 8)); tone("square", f, f, t, 0.03, 0.05); },
    stamp() { const t = ac.currentTime; tone("sine", 200, 70, t, 0.12, 0.5); noise(t, 0.04, 0.3, "lowpass", 1500, 0.7); },
  };

  /* play(name, arg, minGapMs): no-op when muted, not yet unlocked, or rate-limited */
  function play(name, arg, gap) {
    if (!ready() || !S[name]) return;
    if (gap && !limit(name, gap)) return;
    try { S[name](arg); } catch (e) { dlog("play failed", name, e && e.message); }
  }

  /* ---------- room hum: pitch and volume follow total kW (a sense of scale) ---------- */
  function ensureHum() {
    if (hum || !ac) return;
    const o1 = ac.createOscillator(), o2 = ac.createOscillator(), f = ac.createBiquadFilter(), g = ac.createGain();
    o1.type = "sawtooth"; o2.type = "sawtooth"; o1.frequency.value = 55; o2.frequency.value = 55.7;
    f.type = "lowpass"; f.frequency.value = 260; f.Q.value = 0.8;
    g.gain.value = 0;
    o1.connect(f); o2.connect(f); f.connect(g); g.connect(master);
    o1.start(); o2.start();
    hum = { o1, o2, f, g };
  }
  /* kw: current draw; cap: grid kW; running: sim running (paused = quieter); dark: outage blackout (silence) */
  let humLast = 0;
  function setHum(kw, cap, running, dark) {
    if (!ac || ac.state !== "running") return;
    const now = performance.now();
    if (now - humLast < 120) return;   // plenty for a slow drone; keeps AudioParam traffic tiny
    humLast = now;
    ensureHum();
    const load = Math.max(0, Math.min(1.5, kw / Math.max(50, cap || 250)));
    const scale = Math.min(1, Math.sqrt(kw / 600));
    const target = dark || kw < 0.5 ? 0 : (0.012 + 0.05 * scale) * (running ? 1 : 0.45);
    const t = ac.currentTime;
    hum.g.gain.setTargetAtTime(target, t, 0.25);
    const base = 42 + 34 * scale + 10 * load;
    hum.o1.frequency.setTargetAtTime(base, t, 0.4);
    hum.o2.frequency.setTargetAtTime(base * 1.0125, t, 0.4);
    hum.f.frequency.setTargetAtTime(180 + 420 * scale, t, 0.4);
  }

  function setMuted(v) {
    muted = !!v;
    try { localStorage.setItem(MUTE_KEY, muted ? "1" : "0"); } catch (e) { /* storage blocked */ }
    if (master) master.gain.setTargetAtTime(muted ? 0 : VOL, ac.currentTime, 0.03);
    dlog("muted", muted);
    listeners.forEach(fn => { try { fn(muted); } catch (e) { /* ignore */ } });
  }

  window.SFX = {
    play, setHum, setMuted,
    toggle() { setMuted(!muted); return muted; },
    onChange(fn) { listeners.push(fn); },
    get muted() { return muted; },
    get state() { return ac ? ac.state : "none"; },
  };
})();
