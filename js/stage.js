/* Halcyon Compute — fixed-resolution game screen (see CLAUDE.md "Stage").
 * The whole UI lives in #stage, a box of STAGE_W x STAGE_H CSS px (the stylesheet's units) that is uniformly scaled with
 * CSS `zoom` to fit the window, centred, with letterbox bars. The design target is 1920x1080: the stylesheet is authored
 * at 1440x810, so a 1080p screen shows it at zoom 4/3 (14 px body text renders at 18.7 px) and a 960x540 embed at 2/3.
 * Why `zoom` and not `transform: scale`: under zoom, getBoundingClientRect / clientX / elementFromPoint all stay in
 * viewport pixels (hit tests just work), text is laid out at its real size (crisp), and modal <dialog>s in the top layer
 * inherit the zoom from #stage. A transform would leave top-layer dialogs unscaled and turn #stage into the containing
 * block of every fixed element in an unscaled coordinate system.
 * Things that must stay in viewport pixels live OUTSIDE #stage: the fx canvas (FX divides its inputs by Stage.z) and
 * the drag ghost (its children get `zoom: var(--z)`).
 * UMD: window.Stage in the browser, require() in Node (fit() is pure and tested in test/stage.test.js).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Stage = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const STAGE_W = 1440, STAGE_H = 810;   // CSS px of the stylesheet; x 4/3 = the 1920x1080 design target
  const DESIGN_W = 1920, DESIGN_H = 1080;

  /* uniform scale that fits a W x H stage into a vw x vh window, plus the letterbox offsets (window px).
     The zoom is floored to 1/10000 so the scaled stage never exceeds the window by a rounding hair (no scrollbars). */
  function fit(vw, vh, W, H) {
    W = W || STAGE_W; H = H || STAGE_H;
    if (!(vw > 0) || !(vh > 0)) return { z: 1, w: W, h: H, x: 0, y: 0 };
    const z = Math.floor(Math.min(vw / W, vh / H) * 10000) / 10000;
    const w = W * z, h = H * z;
    return { z, w, h, x: (vw - w) / 2, y: (vh - h) / 2 };
  }

  const api = { STAGE_W, STAGE_H, DESIGN_W, DESIGN_H, fit, z: 1 };
  if (typeof document === "undefined") return api;

  /* ---------- browser glue ---------- */
  const DEBUG = /[?&]debug\b/.test(location.search);
  const listeners = [];
  let last = null;
  function apply() {
    const f = fit(innerWidth, innerHeight);
    api.z = f.z; api.rect = f;
    const r = document.documentElement.style;
    r.setProperty("--z", String(f.z));
    r.setProperty("--stage-w", STAGE_W + "px");
    r.setProperty("--stage-h", STAGE_H + "px");
    if (!last || last.z !== f.z) {
      if (DEBUG) console.log("[stage] fit", innerWidth + "x" + innerHeight, "zoom", f.z, "design px =", (f.z * STAGE_W / DESIGN_W).toFixed(3), "x window");
      for (const cb of listeners) { try { cb(f); } catch (e) { console.error(e); } }
    }
    last = f;
    return f;
  }
  api.apply = apply;
  api.onChange = cb => { listeners.push(cb); };
  /* viewport px -> stage CSS px, relative to the stage's top-left corner (for positioning things inside #stage) */
  api.toStage = (x, y) => { const s = document.getElementById("stage"), r = s ? s.getBoundingClientRect() : { left: 0, top: 0 }; return { x: (x - r.left) / api.z, y: (y - r.top) / api.z }; };

  /* ---------- fullscreen (itch embeds are small); every call is guarded, the game works without it ---------- */
  const de = document.documentElement;
  const fsEl = () => document.fullscreenElement || document.webkitFullscreenElement || null;
  api.canFullscreen = () => !!(document.fullscreenEnabled || document.webkitFullscreenEnabled) && !!(de.requestFullscreen || de.webkitRequestFullscreen);
  api.isFullscreen = () => !!fsEl();
  api.toggleFullscreen = () => {
    if (!api.canFullscreen()) return Promise.resolve(false);
    try {
      if (fsEl()) { const p = document.exitFullscreen ? document.exitFullscreen() : document.webkitExitFullscreen(); return Promise.resolve(p).then(() => true, () => false); }
      const p = de.requestFullscreen ? de.requestFullscreen({ navigationUI: "hide" }) : de.webkitRequestFullscreen();
      return Promise.resolve(p).then(() => true, e => { if (DEBUG) console.log("[stage] fullscreen refused", e && e.message); return false; });
    } catch (e) { if (DEBUG) console.log("[stage] fullscreen error", e && e.message); return Promise.resolve(false); }
  };

  addEventListener("resize", apply);
  document.addEventListener("fullscreenchange", apply);
  document.addEventListener("webkitfullscreenchange", apply);
  apply();
  return api;
});
