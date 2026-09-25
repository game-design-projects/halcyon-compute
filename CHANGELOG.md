# Changelog

All notable changes to Halcyon Compute. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions are milestones of the week-3 project; there are no tagged releases.

## [Unreleased]

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
