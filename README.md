# Halcyon Compute

![Halcyon Compute mid-game at 1920×1080](./screenshot.png)

A real-time (pausable) datacenter tycoon prototype for Game Design Week 3: *strategic depth*.
Drag GPUs onto racks, match cards to workloads, survive summer, time your upgrades, and work out
which "disruptive" startup is real before you bet on it.

**Design write-up (characteristics, heuristics, depth evidence): [DESIGN.md](./DESIGN.md)**

## Play
Open `index.html` in a browser. **English and 简体中文**: switch any time with the **中 / EN** button in the top bar,
the toggle on the main menu or in Settings, or the **L** key; the game keeps running and nothing restarts. The first
visit follows your browser language; `?lang=zh` or `?lang=en` forces one. It is plain HTML/CSS/JS and also works from `file://`. Or serve it:
```bash
python3 -m http.server 8765   # then http://localhost:8765/
```
- **Controls** (press **?** in game for the list): Space pauses; 1-4 set 1x/2x/4x/8x; **N** skips to the next event;
  V cycles map modes; **L** switches 中文 / English; M mutes; F toggles fullscreen; **A** opens the alerts tray; **O** opens settings and saves;
  **R** repeats your last order on the hovered rack; **Ctrl/⌘+C / V / D** copy, paste and duplicate a rack blueprint;
  **Ctrl/⌘+Z** undoes; Esc closes or cancels; right-click cancels a drag.
- Mouse: drag a catalog card onto a rack to buy it (**Shift+drag** fills the rack); drag a part inside the rack panel's
  elevation to reorder it; **Shift+click** racks (or drag a box on the floor) to select several and set their mode at
  once; ✕ on any job cancels it; "Sold · Undo" buys a sale back within 10 days. The order board above the floor is
  where all money comes from: sign what you can deliver (the bar shows your spare capacity vs the offer).
- The game is one 1920×1080 screen that scales to fit the window (letterboxed, no scrolling), so any window size works.
- **itch.io embed:** upload a zip with `index.html` at its root, set the embed size to 1280×720 (or 1920×1080), tick
  "Fullscreen button" and leave "Enable scrollbars" off. The in-game fullscreen button (F) works when the embed allows it;
  otherwise use itch's own fullscreen button. The smallest size that stays readable is 960×540.
- Drag a catalog card onto a rack to buy it. Drag hardware in the rack panel to another rack to move
  it, or onto the bin to sell it. On touch screens, tap a card and then a rack.
- `?seed=123` replays a specific game; `?debug=1` logs sim and UI events to the console; `?pace=0` turns off the
  pace ghost (two bots replaying your seed in a Web Worker).
- Changes by version: [CHANGELOG.md](./CHANGELOG.md).

## Develop
```bash
node --test test/*.test.js           # 149 tests: sim rules, determinism, bots, pace ghost, stage fit, UI logic, i18n
node bots/run.js --seeds 12 --ablate # depth report -> reports/depth.json
```

| File | Role |
|---|---|
| `js/sim.js` | Deterministic simulation core (seeded, 0.25-day substeps, no DOM). Loads in the browser and in Node |
| `js/ui.js` | Rendering, drag and drop, dialogs. Contains no game rules |
| `js/qol.js` | Pure UI logic (deliverability, blueprints, fill, undo, alerts); tested in Node |
| `js/i18n.js` + `js/i18n/*.js` | `L(key, params)` = `I18N.t`: English + 简体中文 dictionaries (`{ key: [en, zh] }`), language choice, dates. The sim emits language-neutral keys; the UI translates them ([docs/I18N.md](./docs/I18N.md)) |
| `js/stage.js` | Fixed 1920×1080 game screen: scale-to-fit with CSS `zoom`, letterbox, fullscreen |
| `bots/bots.js` | Greedy and planner reference players, used for depth measurement and the end-screen comparison |
| `bots/run.js` | Ablation runner |
| `css/style.css` | Visual style, adapted from the reference artifact |
