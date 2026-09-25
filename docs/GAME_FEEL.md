# Game feel pass: Lecture 2 ("Game Feel and Maximalism") applied to Halcyon Compute

Lecture ingredients: **Input → Response → Context → Metaphor → Rules**. "Make moving / interacting / losing fun."
Tools covered: screen shake, tweening and easing, Disney animation principles, coyote time, health bar warping,
rubberbanding, last bullet, sound, screen flash plus sound, particles. Examples: Balatro, Cannabalt, Candy Crush vs 2048.

The rule for this game: **juice must carry information, never hide it.** It is a strategy game, so every effect
should make state *more* legible: where money comes from, where heat is, what just broke. Anything that changes
the numbers (for example rubberbanding) is off-limits, because it would erase depth.

| Lecture tool | In Halcyon | Carries this information |
|---|---|---|
| Tweening / easing | Cash and score counters roll up and down (Balatro-style ticking, eased); gauge bars ease; rack colours cross-fade | Size and direction of change |
| Squash and stretch, anticipation, follow-through | A dragged card lifts (scale 1.08, shadow) and tilts with pointer velocity; on drop it squashes into the rack, and the rack does a short "thunk" bounce | "You did something physical" |
| Screen shake (small, rare) | Grid outage (strong), a generation launch price crash (medium), a vendor death bricking your parts (medium), an invalid drop (the card shakes "no" instead of the screen) | Big events, felt in proportion to their size |
| Screen flash + sound | Outage: lights dim to dark with a red flash, racks go black one by one, then relight in a wave when power returns. Quarter close: a white flash + chime | Unmissable, rare events |
| Particles | Install complete: green spark burst + LEDs blink on. Money: "+$4.1k" floats up from earning racks every few days, sized by amount. Failure: red sparks + smoke. Heat: shimmer/steam over racks above 30 °C inlet. Confetti at milestones ($1M, $10M, $100M score) and on a chapter card | Where money and trouble come from, spatially |
| Idle animation / context | Fans spin at a speed ∝ rack load; LEDs blink at a rate ∝ utilisation; cold-aisle dots drift; the night/day tint follows the calendar | The floor looks alive and reads at a glance |
| Health bar warping | The heat and cash gauges pulse and glow as they approach limits (32 °C, bankruptcy); a damage-ghost bar (the old value fades out behind the new one) on cash drops | Danger reads early (display only, the numbers stay exact) |
| Coyote time (forgiveness) | Magnetic drop targets: a released card snaps to the nearest valid rack within ~40 px; a toast with an "undo" option for a purchase for 2 real seconds (only while it is still shipping, full refund; `cancelOrder`) | Input feels generous without changing strategy |
| Last bullet | The final quarter gets a countdown drum-roll and a gold "final quarter" frame; on the last day the total score tallies up like Balatro's chip × mult | The ending feels like a climax |
| Sound (WebAudio, synthesised, no assets) | Pick-up blip, drop thunk, cha-ching (pitch rises with amount), alarm for outage/throttle, a room hum whose pitch/volume follows total kW, a soft chord on a chapter card; mute toggle (M key + HUD icon), default volume low | A second channel for state; the hum gives a sense of scale |
| Make losing fun | Bankrupt/fired: racks power down one by one with a descending tone, then the lessons screen ("here is what sank you") | A loss teaches instead of punishing |

Non-goals / guard-rails
- No rubberbanding or hidden catch-up: it would flatten the greedy-vs-planner gap (depth).
- Respect `prefers-reduced-motion` (no shake/particles, keep the tweens short) and give a mute toggle.
- Effects must not re-render the DOM during a drag and must stay smooth at 8x speed with 36 racks (pool particles, CSS transforms only, one overlay canvas for particles).
- Lecture warning ("slopping it up"): the design decisions stay human. Play the game yourself; bots and AI playtests are a supplement, not a substitute.

## Implementation notes (game-feel pass, 2026-09-24)

Files: `js/fx.js` (window.FX: one pooled overlay canvas, floating text, trauma shake, flash, tweens, per-rack CSS
animations), `js/audio.js` (window.SFX: WebAudio synthesis, hum, mute), both loaded after `bots/bots.js` and before
`js/ui.js`. `ui.js` owns the event layer: `fxFrame()` runs every frame, `fxSnap()`/`fxEvents()` diff the previous vs
current state once per sim day (installs, failures, sale completions, throttling, outage start/end, generation launch,
vendor death, quarter close, score milestones), `fxAct()` gives feedback for player actions. Nothing in the fx layer
writes sim state; every number shown settles to the exact sim value.

Decisions (and rejected alternatives):
- **Counters roll only discrete jumps.** An eased follower on cash lags continuous 8x income by ~$100k, so the HUD would
  disagree with `Sim.check` ("Needs $X"). Jumps larger than 3x the expected per-day flow (purchases, sales, tax, ff) roll
  with a display offset; continuous income is shown exactly. Rejected: exponential follow on the raw value.
- **Cash gauge = runway above the bankruptcy line relative to your peak cash**, with a damage ghost that holds 450 ms and
  then drains. There was no cash bar to warp; this one carries "how close to going bust". Pulses red below 15 %.
- **Calendar tint is seasonal, not day/night.** At 8x a day lasts 62 ms, so a day/night cycle would strobe. The floor gets
  a faint warm tint in summer and a cool one in winter (peak around day 200, the same as the goal hint).
- **M = mute (spec), map-mode cycling moved from M to V.** The how-to text says so.
- **Coyote-time undo (implemented v3, 2026-09-25).** Sim action `{type:"cancelOrder", uid}` (uid of the ordered device,
  same key as `sell`/`store`) cancels a `buy` or `lease` job while `phase === "ship"`: exact refund of the price paid
  (stored on the job as `paid`), the pending card leaves the rack, its depreciation entry and this quarter's accrued
  depreciation, the export-quota slot and any recorded shortage loss are reversed, and a `cancel order` log line is written.
  After shipping ends it is rejected ("Already shipped: sell it instead"); forward orders (`phase "contract"`) are not
  covered. In the UI, `fxAct` shows an `#undo` toast with an Undo button for 2 real seconds after a buy/lease (countdown
  bar); `undoTick()` in `frame()` also hides it as soon as `check` fails, which matters at 8x (6 shipping days pass in
  under 0.4 s). Rejected: undo by job id (the UI and other device actions key on uid); undoing any action generically
  (most actions have no clean inverse and it would invite save-scumming). Tests: `test/sim2.test.js` "cancelOrder: ...".
  Magnetic drop targets: when nothing valid
  is under the pointer, the nearest valid target within 40 px lights up, the ghost is pulled 35 % toward it, and a
  release commits there. The magnet is deliberately off when the pointer is over an *invalid* target, because showing why
  it is invalid is more useful than silently retargeting to a neighbour.
- **The confetti canvas above modals** is the same canvas shown as a `popover="manual"` after `showModal()`, so it stacks
  above the dialog in the top layer. Rejected: re-parenting the canvas into the dialog (the dialog's pop-in transform
  becomes the containing block and offsets the particles). Re-parenting stays only as a fallback without the Popover API.
- **Rack animations survive the 1 s floor re-render** by re-applying `animation` with a negative delay in
  `FX.afterFloor()`. Fans and LEDs use the same trick via inline `animation-delay`. The outage blackout uses `hold`
  entries that last until power returns.
- **End-screen tally (v3):** the big number, labelled SCORE (founder equity value), rolls from 0 straight to the final
  score while the breakdown rows land. Rejected: rolling through each intermediate subtotal, because the first stop
  (net worth) read as the result. Bot bars compare `Sim.score` to `Sim.score`.
- Juice never changes the numbers: no rubberbanding and no catch-up, and the tally shows the exact `Sim.summary` values.
- **Fixed-resolution stage (v0.4).** The UI is one 1440×810 stage (1920×1080 design at zoom 4/3) scaled to fit the
  window with CSS `zoom` (`js/stage.js`). The juice layer stays correct because everything it measures is viewport px
  under `zoom`: the fx canvas lives outside the stage, covers the window, takes viewport px from
  `getBoundingClientRect` and divides by `Stage.z` internally (context scaled by DPR×z), so particles and "+$4.1k" land
  on the racks and scale with the UI at any window size. The drag ghost also stays outside the stage (its transform
  follows `clientX/Y`; its children get `zoom: var(--z)`); the magnet radius is 40 stage px (`40 × z` viewport px).
  Screen shake still transforms `.game` inside the stage (translate px are stage px, so the shake scales too).
  Rejected: `transform: scale()` on the stage. It keeps rects in viewport px too, but modal dialogs (chapter cards,
  decision cards, end screen) render in the top layer outside the transform and would stay unscaled, and the confetti
  popover trick would need a second coordinate system. Also rejected: re-authoring every px value for 1920 (hundreds of
  sizes, inline SVG and JS-built markup) instead of one zoom factor. Verified 2026-09-25 with the playtest driver at
  1920×1080, 1600×900, 1366×768, 1280×720, 1152×648, 960×540: no page scroll, ghost anchor exactly at the pointer,
  magnet drop onto the intended rack, fx canvas ink at the rack centre (659 px) vs 0 px 200 px away.

Perf (headless Chrome, 1400×950, sandbox seed 7, 36 populated racks, 8x, 8 s windows, n = 1 run per row, noisy):
| | rAF interval med / p95 / max (ms) | frame() JS cost med / p95 / max (ms) |
|---|---|---|
| before, no CPU throttle (days 140–268) | 16.7 / 17.5 / 17.7 | 0.4 / 3.7 / 10.8 |
| after, no CPU throttle | 16.7 / 16.8 / 18.5 | 1.0 / 5.1 / 5.9 |
| before, 4x CPU throttle (days 268–396) | 16.7 / 17.6 / 17.7 | 0.8 / 12.1 / 16.1 |
| after, 4x CPU throttle (two windows; the first includes the d274 outage + d390 launch) | 16.7 / 18.6 / 35.4 | 3.2–3.3 / 17–18 / 24–27 |
With no CPU throttle, no frames are dropped. Under 4x throttle, one or two frames per 8 s drop, during the outage/launch effects.
Stage change (v0.4), headless Chrome 1920×1080, same setup (sandbox seed 7, 36 racks, 8x), 3 × 8 s windows per row,
before n = 1 run, after n = 3 runs: before rAF 16.7 / 16.7 / 16.8, frame() 0.5 / 1.2 / 11.9 ms; after rAF
16.7 / 16.7 / 16.8 in two runs (one run had a single 83 ms rAF gap with frame() max 9.6 ms, so not game code; it did not
recur), frame() 0.4 / 1.2 / 8.6–9.8 ms (med / p95 / max). No measurable difference.
Measures taken: dirty-rect canvas clears, rack rects cached per floor render, steam/smoke batched into 8 alpha-bucket
paths, `.game` promoted to a layer only while shaking. Harness: `.playwright-mcp/perf.js`; verification run: `.playwright-mcp/juice.js`.
