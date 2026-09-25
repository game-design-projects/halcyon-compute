# Changelog

All notable changes to Halcyon Compute. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions are milestones of the week-3 project; there are no tagged releases.

## [Unreleased]

### Changed
- **Auto-pause is quiet by default** (player telemetry: ~20 pauses in 6 minutes, 19 of them on new offers; "每次出新的合同都自动
  暂停"). New offers, failures and SLA misses no longer pause unless you turn them on in Settings; only cash below 0 pauses
  (chapter cards and the runway warnings still stop time), plus one teaching pause on the very first new offer ever.
  Saved settings from v0.4.1 and earlier are migrated to the new default once (settings version 2); toggles you change
  afterwards stick.

## [0.4.1] - 2026-09-25

### Added
- Remote telemetry is live: a Cloudflare Worker + D1 sink (`telemetry-worker/`, deployed), with tagged builds reporting
  anonymous, replayable gameplay logs there (players can opt out in the main menu). `tools/telemetry.sh list|get|replay`
  reads sessions back and replays them through the deterministic sim.

## [0.4.0] - 2026-09-25

### Added (UI pass B: English + 简体中文, and a text diet)
- **简体中文** alongside English, for everything on screen: HUD, menus, how-to, chapter cards, the order board,
  drawers, catalog, rack panel, alerts, tooltips and aria-labels, news, customers' offers, VC / policy / press texts,
  toasts and floating labels, settings, the keyboard overlay, confirm states and the end screen (lessons, behind the
  curtain). Switch any time with the **中 / EN** HUD button, the main-menu toggle, Settings → Language or the **L** key:
  the game re-renders in place and never restarts. First visit: `?lang=` > saved choice > browser language. `<html lang>`
  follows; every font stack falls back to system CJK fonts (PingFang SC / Hiragino / Noto Sans SC / YaHei); zh dates read
  `第3年 10月11日`. A missing key falls back to English and logs `[i18n] missing zh: …` under `?debug=1`.
- The sim stays language-neutral: `Sim.check()` results now carry `k` (key), `p` (params) and `code` (the rejection class
  used by the "no" feedback) next to the unchanged English `msg`; news items carry `k`/`p`; cash events carry `p`. Old
  saves without keys show their English text.
- **Teach once:** until your first order, a ghost card glides from the catalog onto a rack (replaces the standing
  "Drag onto a rack…" caption; never shown again).

### Changed (text diet: "太多的文字我已经看麻了")
- Visible words on the main screen mid-game cut from **291 to 141 (−52 %)** in English (words with letters 254 → 111,
  −56 %); Chinese shows 80 characters + names and numbers in the same state (docs/I18N.md "Measurement").
- Chapter cards: 3 bullets with an icon each (≤ 8 words / ≤ 12 characters); "where to find it" moved behind an ⓘ toggle.
  The goal bar shows the chapter and the next milestone only (≤ 6 words); the long tips are gone.
- News: title only, the body is the tooltip. Toasts: ≤ 5 words + a number (cash events read "Tax −$40k").
- Icons instead of words: power-mode buttons, map modes, inactive info tabs, aisles, room units, the grid column, the
  cooling mode, spine slots, rack status lines, drawer "paused" state; units and explanations moved to tooltips. Contract
  pills show the customer only (days and units in the tooltip); empty racks drop their id and free-U labels.
- One-time cards (memory scare, proposed law, VC round, cash warnings) are 2–3 icon bullets.
- The end screen keeps its lessons, one line each, built from the loss keys (the worst period is the tooltip).
- `js/strings.js` is replaced by `js/i18n.js` + `js/i18n/ui.js` + `js/i18n/content.js`.

### Added (UI pass A: the v4 contracts core on screen, forgiveness, QOL, "show, don't tell")
- **Order board** above the floor from day 0 (was hidden until chapter 8): each offer shows its kind (web, inference,
  training job, frontier job, build-to-suit), terms (units × days and start; jobs: work, pay, deadline; fit-out),
  price vs the market index, a **deliverability bar** (your spare capacity, including hardware on its way, vs what the
  offer needs) and big **Sign** / ✕ buttons. Hovering an offer lights up the racks that would serve it; signing flies a
  link to each of them. Every active contract is a pill in its own link colour (delivery vs SLA, days left); racks carry
  a strip of those colours (width = units served) and idle output shows as hatched "z z" racks. Board header = count,
  next offer ETA, Auto-renew toggle, click for the Contracts drawer.
- **Off** rack mode (power icon) from chapter 1; parked racks go dark. The goal bar shows the **next chapter unlock**
  and its milestone (chapters are player-triggered).
- **Show, don't tell** (docs/I18N.md feel table): no cash → the cash chip shakes and flashes red, the price pulses, a
  low bonk; rack full / over kW → the rack wobbles and the missing gauge pulses; over grid → the power chip flashes;
  no switch → the rack goes dark with an unplugged icon, and a power-up light sweep when a switch goes in; throttling →
  a red heat glow; failure → a blinking red LED; a big loss → a red screen-edge vignette; bankruptcy danger → a vignette
  that deepens with the runway and a heartbeat under 30 days; new offers and chapter unlocks fly an icon into the board
  badge / goal flag. Rejections no longer toast (reason in the tooltip and an aria-live region).
- **Unaffordable = disabled everywhere** (catalog cards, drawer and card buttons, steppers, spine/grid/hall buttons,
  fit-out offers), re-checked live as cash moves; a click still gives the feedback above and never acts. The memory-scare
  card offers the cheapest GPU you can afford, or only "Wait and see".
- Forgiveness: **drag to reorder** parts inside a rack (drop-indicator line); **✕ cancels** any queued job (floor chip,
  rack panel, shelf) with the outcome floating from the ✕; **Sold · Undo** chips with a 10-day countdown next to the
  catalog; **Ctrl/⌘+Z multi-step undo** (mode, workload, reorder, policies, transit, buys while shipping, sells, moves,
  store/unstore; batches undo as one).
- QOL: **Shift+drag fill** (as many as fit; count · cost · ETA on the ghost), **rack blueprints** (Ctrl/⌘+C / V,
  Duplicate button, Ctrl/⌘+D), **multi-select** (Shift+click or a box on the floor) with a bulk mode/workload bar,
  **R** repeats the last order on the hovered rack, an **alerts tray** (bell, A: no switch, failed part, throttling,
  SLA at risk, idle capacity, runway) that jumps to the rack, clicking a news item or an offer jumps to the rack/drawer,
  a **rich rack hover** (income, contracts served, inlet, bottleneck, days to the next failure), a **catalog delta
  hover** (output, kW, °C, payback on the selected rack), **auto-pause** options (new offer, failure, cash < 0, SLA at
  risk; on for the first campaign), **skip to the next event** (N), a **settings** panel (O: master/effects/hum volume,
  reduced motion, colour-blind palette, UI scale, auto-pause, language placeholder), **3 save slots + export/import save
  JSON**, a **keyboard overlay** (?), Esc closes/cancels, right-click cancels a drag, policy toggles (Auto-swap and
  Keep-spares in the technicians popover, Auto-renew on the board and in the Contracts drawer).
- `js/qol.js` (pure, tested: rejection reasons, deliverability, serve preview, blueprint diff, fill plan, undo stack,
  alerts, link colours) and `js/strings.js` (`L(key, params)`, English today; pass B plugs i18n into it).
  `test/qol.test.js`: 11 tests (138 total).
- Playtest driver: `mods` (Shift) on click/drag, right-click, `POST /upload`, `GET /downloads`.

### Changed (UI pass A)
- v4 saves (and v2/v3 saves, migrated by the sim) resume from Continue, a slot or an imported file.
- The pace chip and end screen compare you with the **human-paced Casual and Expert** bots (labels from `Bots.LABELS`);
  the full-speed greedy/planner are no longer shown to players.
- End screen: lesson icons by loss key (idle, cancelled, SLA, …); contracts row adds cancelled / late.
- The HUD export button moved into Settings (still in the main menu and on the end screen); the HUD Contracts button is
  replaced by the board header. Lease is a tag flag on the rack tile.
- Perf: the HUD height is tracked with a ResizeObserver instead of a forced layout in every render; floating text is
  pre-rendered into cached OffscreenCanvas sprites (setting `ctx.font` after a DOM rewrite forced a document style
  recalc in the slowest 5 % of frames); fly/cash-signal rect reads wait for the next frame; job chips are cached. At 8x,
  36 racks, 1920×1080 (n=2 runs × 2 windows): frame() JS p95 3.1–3.3 ms, median 0.8 ms, vs the pre-pass build on the same
  machine and harness 7.5–8.1 ms p95 (interleaved, n=3).
- Esc clears a tapped card before anything else (it used to hide the hover card first, and the next rack click then
  tried to place the card). `tools/replay.js` orders same-day actions and snapshots by recorded real time (an export
  snapshot taken while paused no longer reads as a divergence).

### Added
- **Fixed game screen that fits any window.** The UI is one 1920×1080 screen (authored at 1440×810, zoom 4/3) scaled
  uniformly to the window with letterbox bars. It fits an itch.io embed of any size (960×540 up), a fullscreen monitor
  or an odd window with no page scrolling, and rescales on resize and fullscreen change (`js/stage.js`).
- **Fullscreen button** in the HUD and the **F** key (Fullscreen API). When the page cannot go fullscreen (an embed
  without permission) the button is dimmed and a toast points to the page's own fullscreen button.
- Right-column **tabs: Rack / News / Markets / Benchmarks**. The News tab shows a count of items that arrived while
  another tab was open. Clicking a rack brings the Rack tab forward. The chosen tab is remembered.
- Playtest driver: optional viewport (`node tools/playtest-driver.js <port> <seed> <outDir> 1280x720` or `VIEWPORT=`).
- `test/stage.test.js`: fit math (no overflow at any size, centred letterbox, 16:9 has no bars). 103 tests.

### Changed
- 16:9 layout. The HUD is one row. Debt, reputation, carbon and equity moved from the HUD into a company strip above
  the right column. The Contracts button is icon-only; its count badge, its pulse and the offer strip show waiting
  offers. The floor fills the height left after the other rows, so racks are larger than before
  (≈119 px tall on a 1080p screen, were 78). Map modes show the label of the active mode only (the rest have
  tooltips). The legend sits on the same row. The spares shelf header moved to the left of the slots; its
  instructions are in its tooltip. The Markets / Benchmarks / News bottom strip moved into the right-column tabs.
- Text sizes: nothing under 12 px of regular text in the stylesheet (bold badges 11 px); on a 1080p screen the body
  text renders at 18.7 px.
- Banners (outage, heat wave, shortage, …) sit side by side; the floor gives up the height they need.
- `DESIGN.md` rewritten for the full game: the 17-chapter table, characteristics and 14 heuristics, the playtest
  round 1 summary and new playtest questions. The v3 depth-evidence section is kept.
- README screenshot retaken for the 1920×1080 game screen.

### Removed
- The phone/narrow-window layouts (media queries at 980/700/560 px): the stage scales instead. Desktop only.

### Fixed
- On the itch.io embed the game rendered as a long web page: the bottom strip was cut off and the iframe could not be
  scrolled. Everything is reachable in the frame now.

## [0.3.0] - 2026-09-24
Post-playtest fix round (playtest round 1: three AI personas and a code review; see `docs/playtests/SYNTHESIS.md`).

### Added
- **Pace ghost**: the Greedy and Planner bots replay your seed (same sandbox/campaign setting) in a Web Worker, one
  day at a time up to your current day and never beyond it. A HUD chip shows "ahead of / behind Greedy" with all
  three scores. The end screen reuses it, so the bot comparison is ready about 40 ms after the dialog opens at day 1800
  (it used to replay both bots on the main thread for up to 8 s). `js/pace.js`; `?pace=0` turns it off.
- **Offers on the main screen**: pending contract offers appear above the floor with units, days, price vs spot,
  SLA, penalty, your spare capacity and big Sign / Decline buttons. The Contracts button is labelled, pulses and
  shows a count. Every new offer raises a toast. The first offer pauses the game with a short explainer
  ("a contract locks your price: a hedge before launches").
- **NO SWITCH badge**: a rack with hardware but no switch shows a red "NO SWITCH $0" badge in every map mode.
  The drag ghost warns when you drop a non-switch into a switchless rack, and the rack panel offers a one-click
  "Add switch" purchase.
- **Bankruptcy warnings**: the cash chip shows the days left until bankruptcy at the current net rate. The game
  pauses with a warning card the first time cash goes below zero, and whenever the runway drops under 30 days.
- **Frontier cluster meter**: every spine slot and the rack panel show "N/12 training GPUs → frontier ×1.6"
  with a progress bar.
- **Decision cards** for the first event of a system: first memory scare (forward-order now or wait), first
  policy proposal (lobby for / against / ignore), first VC round (accept / decline / later).
- Chapter 3 card shows the roofline chart for one card of each family, with a plain-language caption.
- Every chapter card ends with "Where to find it".
- Cash-event log in the sim (`s.cashEvents`, `s.cashSeq`, `s.totals.flow`): tax, automatic repairs and completed
  sales are logged with a label, and the UI toasts every discrete cash change of $10k or more with its cause.
  Anything unlogged still gets a "one-off" toast (and a console warning), never silence.
- Quarter tally card shows the tax line.
- `Sim.naturalWorkload`: the first GPU placed in a GPU-less rack sets the workload it earns more on at today's
  prices (Kestrel C → training, Heron M → inference).
- Playtest driver: `POST /pointer` for low-level pointer steps (mid-drag screenshots).
- Tests: `test/fixround.test.js` (10 tests: pacing, item availability, workload default, lease billing, grid tier 4,
  cash events, 1800-day cash accounting, pace runner).

### Changed
- Chapter pacing: chapters now unlock on days 0, 45, 100, 170, 250, 330, 420, 490, 570, 660, 750, 840, 930, 1020,
  1110, 1200, 1290 (was 0, 30, 60, 120, 240, 300, 420, 480, …). The first four systems no longer arrive inside
  120 days. Chapter 17 stays at day 1290 so its seeded story still finishes before day 1800.
- GPUs (Kestrel C1, Heron M1) go on sale with chapter 3 and CRU coolers with chapter 4.
- All 17 chapter cards rewritten in plain language: jargon (HBM, PPA, PUE, CRAC, UPS, SLA, VC) is named once with
  its meaning.
- Purchase toasts name the card and the rack ("Heron M1 ordered for B1 …") and a floating "−$Xk" rises from the rack.
- System toasts queue: money and offer messages go before news and are never dropped, and at 8x several waiting
  messages merge into one toast.
- The random-driver determinism test uses seed 21, because the new timeline changes which seeds reach day 1800.

### Fixed
- Leases are billed until the return job completes (they used to stop at the return click: one free day).
- Grid tier 4 (1000 kW) can only be ordered once Hall 3 is built or under construction.
- A drag no longer fails silently when a card opens mid-drag: it is cancelled with a toast and nothing is ordered.
  Pressing on a dialog backdrop says to close the card first.
- Dragging a rack tile on the floor now explains that parts are moved or sold from the rack panel (the sell-by-drag
  "failure" in playtests; dragging from the rack elevation to the bin was verified to work).

## [0.2.0] - 2026-09-24
The full game: 17 chapters over a 1800-day campaign.

### Added
- Sim v2 (`js/sim.js`, `js/content.js`): 17 chapters and mechanics M19–M66. Operations (failures, repairs,
  technicians, spares), network fabric (row spines, frontier market, internet transit), contracts, the HBM memory
  market with forward orders, finance (credit line, leases, tax), facilities (Hall 2, outages, UPS, CRAC), energy
  (spot power, PPA, solar), environment (PUE, water, droughts, carbon), investors and a board, reputation and press,
  policy and lobbying, and the disruption chapter moved to day 1290 with a demand shock and an incumbent price cut.
  Sandbox mode, score = founder equity value, end-screen summary. State is JSON-safe.
- v3 cash sinks: Hall 3 ($2.4M, 120 days), a fourth grid tier (1000 kW), build-to-suit contract offers.
- Full UI: main menu with autosave and continue, seeds, chapter cards, HUD chips and popovers per mechanic, hall
  tabs, spine slots, spares shelf, Failures and Cluster map modes, contracts / finance / energy / policy drawers,
  news filters, end screen with score breakdown, lessons, hidden truths and a greedy/planner replay.
- Bots: the planner plays all 17 chapters on public information only; a fair greedy; `bots/run.js` depth report on
  worker threads with 16 ablation groups and a `--patch` option for balance sweeps.
- Game feel: pooled particles, screen shake, flashes, tweens, synthesized sound, quarter tally card, score
  milestones, final-quarter countdown, racks powering down on a loss, drag lift / tilt / squash / magnetic targets,
  reduced-motion support.
- Coyote-time undo: a 2-second Undo toast refunds a purchase that is still shipping (`cancelOrder`).
- Playtest round 1 docs and the HTTP playtest driver (`tools/playtest-driver.js`).

### Changed
- Campaign length 1080 → 1800 days. GPU list prices ×1.6 and greedy retuned so mid-game cash has somewhere to go.
- Map-mode cycling moved from M to V (M mutes sound).

## [0.1.0] - 2026-09-24
The week-3 prototype.

### Added
- Real-time, pausable datacenter tycoon on one 18-rack hall over 1080 days, in six chapters: racks and cash, power,
  GPUs and the roofline, summer heat, hardware generations, and "something new" (a real vs a hyped accelerator
  startup, a vendor-pitched memory module).
- Deterministic seeded simulation that runs in the browser and in Node; drag-and-drop UI; greedy and planner bots
  with an ablation depth report; design write-up (`DESIGN.md`) and the full-game spec (`docs/SPEC.md`).
