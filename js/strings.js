/* Halcyon Compute — UI strings (v0.4 pass A). Every NEW user-visible string goes through L(key, params).
 * Today L() returns English from the table below; pass B replaces this file with the real i18n layer (docs/I18N.md, I1):
 * same keys, `{name}` placeholders, English fallback. Missing keys return the key itself (and log under ?debug=1).
 * Classic script (window.L) + CommonJS (tests).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else { root.L = api.L; root.STRINGS = api; }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const EN = {
    // order board
    "board.title": "Orders", "board.sign": "Sign", "board.decline": "Decline", "board.more": "+{n}",
    "board.none": "No offers yet", "board.next": "next ~{d}d", "board.free": "{free} / {need} free",
    "board.freeTip": "Your spare capacity (installed + on its way, minus what you already owe) vs what this offer needs",
    "board.vsIndex": "{sign}{p} % vs index", "board.expires": "{d}d", "board.starts": "starts {d}d",
    "board.work": "{w} u·d", "board.pay": "{pay}", "board.due": "due {d}d", "board.term": "{u} × {d}d", "board.fitout": "fit-out {x}",
    "board.active": "Active", "board.autoRenew": "Auto-renew", "board.autoRenewTip": "Sign renewals on the same terms automatically",
    "board.served": "Served by {racks}", "board.unserved": "No rack serves it yet",
    "kind.web": "Web", "kind.infer": "Inference", "kind.train": "Training job", "kind.frontier": "Frontier job", "kind.bts": "Build-to-suit",
    // goal / chapters
    "goal.next": "Next unlock", "goal.nextFrom": "from day {d}", "goal.last": "All chapters unlocked",
    // rack
    "rack.off": "Off", "rack.idle": "Idle: no contract", "rack.linked": "Serves {n}", "rack.duplicate": "Duplicate",
    "rack.duplicateTip": "Copy this rack's layout, mode and workload to the next empty rack (Ctrl+D)",
    "rack.copyTip": "Blueprint: Ctrl+C copy, Ctrl+V paste onto a rack",
    "hover.income": "Income", "hover.serves": "Serves", "hover.inlet": "Inlet", "hover.bottleneck": "Bottleneck",
    "hover.risk": "Next failure", "hover.riskDays": "~{d}d", "hover.none": "none", "hover.compute": "compute-bound",
    "hover.memory": "memory-bound", "hover.network": "network", "hover.switch": "no switch", "hover.heat": "heat",
    "hover.space": "room (U)", "hover.idle": "no contract",
    "delta.out": "output", "delta.kw": "kW", "delta.temp": "°C", "delta.payback": "payback", "delta.never": "never", "delta.days": "{d}d",
    // jobs, undo, sold
    "job.cancel": "Cancel", "sold.chip": "Sold {name}", "sold.undo": "Undo", "sold.tip": "Buy it back for {x} (within 10 days)",
    "undo.done": "Undone", "undo.none": "Nothing to undo",
    // multi-select
    "multi.count": "{n} racks", "multi.clear": "Clear selection (Esc)",
    // alerts
    "alerts.title": "Alerts", "alerts.none": "All clear", "alert.nosw": "No switch", "alert.fail": "Failed part", "alert.hot": "Throttling",
    "alert.sla": "SLA at risk", "alert.idle": "Idle capacity", "alert.runway": "~{d}d of cash",
    // skip
    "skip.tip": "Skip to the next event (N)", "skip.on": "Skipping…",
    // settings
    "set.title": "Settings", "set.sound": "Sound", "set.master": "Master", "set.sfx": "Effects", "set.hum": "Room hum",
    "set.display": "Display", "set.reduced": "Reduced motion", "set.cb": "Colour-blind palette", "set.scale": "UI scale", "set.scaleAuto": "Fit",
    "set.lang": "Language", "set.langSoon": "English (中文 coming)", "set.autopause": "Auto-pause on", "set.ap.offer": "New offer",
    "set.ap.fail": "Failure", "set.ap.cash": "Cash below 0", "set.ap.sla": "SLA at risk", "set.saves": "Saves", "set.slot": "Slot {n}",
    "set.empty": "empty", "set.save": "Save", "set.load": "Load", "set.export": "Export save", "set.import": "Import save",
    "set.log": "Export gameplay log", "set.saved": "Saved", "set.loaded": "Loaded", "set.bad": "Not a Halcyon save",
    // keys overlay
    "keys.title": "Keyboard", "keys.chapter": "Chapter card",
    "key.space": "Pause / play", "key.speed": "Speed 1x / 2x / 4x / 8x", "key.skip": "Skip to next event", "key.v": "Map mode",
    "key.m": "Mute", "key.f": "Fullscreen", "key.r": "Repeat last order on the hovered rack", "key.copy": "Copy rack blueprint",
    "key.paste": "Paste blueprint", "key.dup": "Duplicate rack", "key.undo": "Undo", "key.esc": "Close / cancel",
    "key.shift": "Shift+drag a card: fill the rack", "key.shiftClick": "Shift+click racks / drag on the floor: multi-select",
    "key.right": "Right-click: cancel a drag", "key.help": "This list", "key.alerts": "Alerts", "key.settings": "Settings",
    // policies (Operations)
    "pol.autoSwap": "Auto-swap spares", "pol.autoSwapTip": "Swap a failed part with a matching spare from the shelf",
    "pol.keep": "Keep spares", "pol.keepTip": "Auto-order spares at list price to keep this many on the shelf",
    // misc feedback (aria-live / tooltips only)
    "fb.cash": "Not enough cash", "fb.space": "No room in this rack", "fb.kw": "Rack power limit", "fb.grid": "Grid limit", "fb.shelf": "Shelf full",
    "fb.fill": "×{n} · {cost} · {days}d", "fb.paused": "Auto-paused: {why}", "fb.renewed": "Renewed", "fb.lost": "Lost {cust}",
    "fb.cancelled": "Cancelled", "fb.toShelf": "→ shelf", "fb.back": "→ {rack}", "fb.kept": "Kept",
    "end.contracts": "Contracts signed / fulfilled / short / cancelled / late",
    "pace.vs": "you vs {a} vs {b}", "pace.ahead": "ahead of {a}", "pace.behind": "behind {a}",
    "menu.load": "Load / import a save",
  };
  const DEBUG = typeof location !== "undefined" && /[?&]debug\b/.test(location.search);
  const missing = new Set();
  function L(key, params) {
    let t = EN[key];
    if (t == null) { if (DEBUG && !missing.has(key)) { missing.add(key); console.log("[i18n] missing en:", key); } t = key; }
    if (params) t = t.replace(/\{(\w+)\}/g, (m, k) => (params[k] != null ? String(params[k]) : m));
    return t;
  }
  return { L, EN };
});
