# UI pass backlog (v0.4): collected user feedback, done in ONE pass after the v4 sim/bots land

**Status (2026-09-25, UI pass A):** bugs 1–5, "From the specs" (except i18n + text diet = pass B), every P0 QOL item and
the automation-policy toggles are implemented (CHANGELOG [Unreleased], CLAUDE.md "UI pass A"). P1 items (upgrade rack,
sell all old-gen, stats screen) are not done. **Pass B (done, 2026-09-25):** English + 简体中文 through `js/i18n.js`, and the text diet (main-screen words −52 %); see docs/I18N.md "Implementation".

Specs: `docs/CONTRACTS_CORE.md`, `docs/I18N.md` (i18n + text diet + show-not-tell), `docs/GAME_FEEL.md`.

## Bugs / UX reported by the user (2026-09-25)
1. **An unaffordable action still looks clickable.** Example: the memory-scare card offered "Forward-order Kestrel C2 · $368k" as a
   bright primary button with $257k cash. Rule for EVERY cost-bearing control (decision-card buttons, catalog cards, drawer
   purchase cards, steppers, grid/hall/spine buttons, offers with a fit-out): when it's unaffordable or invalid, render it
   disabled (desaturated, price in red, `aria-disabled`, tooltip with the reason). A click or drag on it still gives
   show-not-tell feedback (the cash chip shakes and flashes red, the element wobbles, a "bonk" sound) and never performs
   the action. Decision cards must offer a sensible affordable alternative (e.g. forward-order the cheapest card you
   can afford, or only "Wait and see"). Re-evaluate affordability live while cash changes (the HUD tick), not only on full render.
2. **The U order inside a rack can't be changed.** Drag a device up/down within the same rack elevation → sim `reorder`
   (index from the drop position; a drop indicator line between slots).
3. **Queued jobs can't be cancelled.** Add a ✕ on each job row / rack progress chip → sim `cancelJob` (show the refund or
   outcome as floating text).
4. **Selling the wrong item.** A "Sold · Undo" chip with a countdown (10 game days) next to the bin/shelf → sim `buyBack`.
5. **Pace chip wording:** the human-paced bots are "Casual" and "Expert" (you vs Casual vs Expert); the full-speed bots
   are not shown to players.

## From the specs
- Order board as a primary screen element (CONTRACTS_CORE), rack↔contract allocation links, an "Off" rack mode.
- Player-triggered chapters: the chapter card appears when its trigger fires (the sim decides; the UI just shows it).
- i18n zh/en + text diet (≥50 % fewer visible words) + show-not-tell feedback table (I18N.md).

## QOL features (user: "还缺一大堆 QOL feature")
Principles: fewer repetitive clicks · less to remember · no fear of mistakes. P0 = ships in v0.4.

**Fewer clicks**
- P0 Shift+drag a card onto a rack = fill the rack with as many as fit (one action each; cost and ETA shown on the ghost).
- P0 Rack blueprints: copy a rack's layout + mode + workload (Ctrl/Cmd+C on the selected rack), paste onto an empty rack
  (Ctrl/Cmd+V) = orders the missing parts. Also "Duplicate rack" in the rack panel.
- P0 Multi-select racks (shift-click or box-drag on empty floor) → set mode/workload/Off for all at once.
- P0 Repeat last order: key R on a hovered rack.
- P1 "Upgrade rack" one-click: sell the old-gen cards in a rack and order the current-gen equivalents (preview the net cost).
- P1 "Sell all dead/old-gen", with a preview.

**Less to remember**
- P0 Alerts tray: a list of live problems (no switch, failed part, throttling, SLA at risk, idle capacity, runway low); clicking one
  jumps to and selects the rack. A count badge sits on the HUD.
- P0 Clicking a news item or offer jumps to the related rack/drawer.
- P0 Rich hover on a rack: income/day, which contract(s) it serves, inlet temperature, bottleneck (roofline side), and time to the next failure risk.
- P0 A catalog card hovered over a selected rack shows the delta (+output, +kW, +°C, payback days).
- P1 A stats screen: income by contract type, capacity vs backlog over time, losses by cause.

**No fear of mistakes**
- P0 Undo for the last N actions where it's reversible (mode/workload/reorder instantly; buys via cancelJob; sells via buyBack).
- P0 Auto-pause options (settings): on a new offer, a failure, a chapter, cash < 0, SLA at risk; on by default for the first campaign.
- P0 "Skip to next event" button (fast-forward until something needs you).

**Automation policies** (sim-level, so bots and determinism agree): auto-swap a failed part with a matching spare;
keep N spares of the most common card (auto-reorder); auto-renew contracts on the same terms when offered.

**Settings & saves**
- P0 Settings panel: master/SFX/hum volume, reduced motion, colour-blind palette, language, auto-pause toggles, UI scale override.
- P0 Manual save slots (3) + export/import save as a JSON file (download/upload), plus autosave.
- P0 A keyboard shortcut overlay on `?`; every button tooltip shows its key; Esc closes drawers/popovers; right-click cancels a drag.
