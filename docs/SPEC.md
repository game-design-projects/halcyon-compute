# Halcyon Compute — full game spec (v2)

Status: design contract for the full game. The Week-3 prototype (v1, chapters 1–6 of the old numbering) is the
starting point; everything in v1 stays unless this spec changes it. The 17-chapter list below was **reconstructed**
from the handoff's ordering constraints (the originally approved list was not available). If the user supplies the
original list, it wins.

## 0. Invariants (do not break)
- Plain HTML/CSS/JS. No frameworks, no build step, no Tailwind/Vue/UI libs. Classic `<script>` tags; must run from `file://`.
- Every rule lives in the sim (DOM-free, seeded, deterministic, fixed 0.25-day substep, runs in Node). UI only reads state and sends actions through `check/apply`.
- Game feel: icons, colours, charts, drag and drop. No tables, forms or dropdowns as the primary interaction.
  Numbers entered with +/− steppers, sliders or drag, never text inputs.
- Real time, pausable (space), 1x/2x/4x/8x speeds. 1 day = 0.5 s at 1x.
- Removed on purpose, never add: CXL memory pooling, ECC errors.
- Every mechanic must add a **decision**, not just a rule. If a mechanic has no decision, cut it or give it one.
- Information from vendors, investors and politicians is **biased**. Truth arrives via indirect news, measurement (pilots), or time.

## 1. Structure
- **Campaign**: 5 years (1800 days, ≈15 min at 1x). 17 chapters unlock mechanics in order; each chapter shows a
  card (icons + ≤4 bullets) and pauses the game. Mechanics are **inactive until their chapter** (no hidden drain before the player is told).
- **Sandbox**: all chapters unlocked from day 0, same 1800 days, choose seed.
- **Main menu**: Continue (autosave, localStorage, every 30 game days + on quarter close), New campaign, Sandbox, Seed field, How to play.
  Autosave must be wrapped in try/catch and optional.
- **Score**: *founder equity value* at the end = your ownership % × company value.
  Company value = net worth + max(0, trailing-90-day profit/day) × 365 × 2 (a simple earnings multiple) × reputation factor (0.8–1.2).
  Before chapter 14 ownership is 100 % and the reputation factor is 1, so the score equals the old net worth plus the earnings multiple.
- **Lose conditions**: bankrupt (cash < −credit line), or fired by the board (chapter 14+: miss 2 board targets in a row).
- **End screen**: score, breakdown, replay of the same seed by the Greedy and Planner bots, "behind the curtain" reveal of every hidden truth, and 3 personalised lessons (the largest measurable mistakes, e.g. "you lost $1.2M to throttling in Y3 summer").

## 2. Chapters (campaign day → mechanics). Each mechanic has an id M##.

### Ch1 Racks and cash (d0) — exists
M01 18-rack Hall 1 floor, 20U / 30 kW per rack. M02 switch per rack (rack-local network, 16 per switch). M03 web servers + web market (demand ≈30, flat). M04 oversupply sells at 25 %. M05 technicians install (3), 6-day shipping + 2-day install. M06 move/sell via drag.

### Ch2 Power (d30) — exists
M07 grid cap 250 kW, upgrade to 400 kW. (Later tiers: 700 kW from ch11, **M07b** 1000 kW after that — $1.8M, 90 days.) M08 seasonal power price. M09 Eco/Std/Boost per rack.

### Ch3 GPUs and the roofline (d60) — exists
M10 Kestrel C (compute) and Heron M (bandwidth) families. M11 training vs inference markets with separate demand/price. M12 roofline throughput = min(F, B × intensity). M13 per-rack workload toggle. M14 network need per workload.

### Ch4 Seasons and heat (d120) — exists
M15 seasonal cooling capacity. M16 room thermal inertia. M17 per-rack inlet + neighbour heat + throttling. M18 CRU cooler item.

### Ch5 Hardware generations (d240; launches d390, d780, d1170, d1560)
M19 generation launches cut market price and resale. M20 rumours ~60 days ahead. M21 older-gen cards on sale at a discount ("OLD GEN").
Extend to gen 4 and gen 5 (C4/M4 at d1170, C5/M5 at d1560); keep the per-gen scaling (~1.55× F and B, ~+8 % kW, ~+20 % price). **v3 balance:** all GPU list prices are 1.6× the v2 catalogue (C1 $288k … M5 $688k) so mid-game paybacks are ~200–300 days and reinvestment absorbs profit.

### Ch6 Operations (d300)
M22 **Hardware failures**: each device has a daily failure hazard = base(role) × age factor (bathtub: higher first 20 days and after 500 days) × heat factor (×2 per 5 °C above 30 °C inlet). Seeded. A failed device produces nothing and shows a red cross.
M23 **Repair**: a technician job (1 day, 8 % of list price). The player sets a rack-agnostic **repair policy**: auto-repair on/off (on = queue repair jobs automatically).
M24 **Hire/fire technicians** (1–10). Salary 0.35 k/day each. Hiring takes 7 days. Firing is instant but costs 10 days' salary.
M25 **Spares shelf**: a storage area (UI: shelf next to the floor, 12 slots). Stored cards cost nothing to run and can be dropped into racks instantly (install still needs a technician, but no shipping). Swapping a spare for a failed card = 1-day job.
Decision: staff and spares vs downtime; running hot costs failures, not just throttling.

### Ch7 Network fabric (d420)
M26 **Row spine**: each floor row can get a spine switch (facility purchase, $160k, 20 days, 3 kW). Training racks in a row with a spine pool their GPUs into one cluster.
M27 **Frontier training market**: a third market that pays 1.6× the training price, but only counts output from clusters with ≥12 training GPUs on one spine. Separate demand (starts 30 units, grows 1.5×/yr).
M28 **Internet transit**: web + inference output needs transit capacity (1 transit unit per 10 output units). Transit is bought in steps with a stepper (0.4 k/day per unit, changes take effect after 5 days). Short transit caps web + inference output proportionally.
Decision: cluster training racks in a row (network wins) vs spread them out (heat wins).

### Ch8 Customers and contracts (d480)
M29 **Contract offers** arrive every ~25 days (seeded) as cards: customer (icon + name), workload, units, days, price/unit·day, SLA (min delivered fraction), penalty per missed unit·day, expiry (15 days).
**M29b Build-to-suit** (v3): about every 60 days (±15, first 30 days after ch8) a big customer asks for dedicated capacity: units 40–80 % of today's output on that workload (≥20), 360–540 days, price = spot × (1.0–1.2) × reputation adjustment, SLA 95 %, penalty 3× the price, an up-front **fit-out** of $6k per unit (capex, paid at signing), and delivery starting **45 days** after signing (time to buy the hardware). Signing commits cash and capacity: a hedge before launches, a trap before a real demand shock (see M65).
M30 Accepted contracts are served first from your supply at their fixed price; the rest goes to spot. A shortfall below the SLA costs the penalty and −reputation (from ch15).
M31 Contract prices are quoted against **today's** spot price (±15 %), so locking in before a known generation launch is a hedge, and signing just after one is a trap.
Decision: hedge price risk vs keep flexibility; don't oversell capacity.

### Ch9 Memory market (d570)
M32 **HBM price index** (starts 1.0): a mean-reverting walk plus scheduled shocks (seeded). GPU list prices = base × (0.55 + 0.45 × index). Resale also follows it.
M33 **Shortages**: during a shock, shipping for GPUs goes from 6 days to 18 days and prices spike. Leading signals appear in news 20–40 days before (e.g. "Fab fire at Hynix-like supplier", "Hyperscaler HBM mega-order"), but ~1/3 of scare stories are false alarms.
M34 **Forward orders**: order at today's price with delivery in 45 days (no shortage delay). Delivered cards go to the spares shelf.
Decision: buy ahead into inventory vs wait; read which scares are real.

### Ch10 Finance (d660)
M35 **Credit line**: borrow in $100k steps up to 40 % of net worth. Interest 9 %/yr, accrued daily. Repay any time. Bankrupt at cash < −(credit line limit).
M36 **Leasing**: any GPU in the catalog can be leased instead of bought: no upfront cost, pays 0.45 % of list price per day, return any time (1-day technician job). Leased cards don't count toward net worth.
M37 **Tax**: 21 % of positive quarterly profit, where profit = revenue − opex − depreciation (capex straight-line over 3 years). Shown in the quarter waterfall.
Decision: leverage to grow before a price drop vs stay safe; lease the gen you will replace soon.

### Ch11 Facilities and resilience (d750)
M38 **Hall 2**: build a second 18-rack hall ($1.4M, 75 days). Shares the grid. UI: floor tabs "Hall 1 / Hall 2".
**M38b Hall 3** (v3): after Hall 2 stands, a third 18-rack hall (racks G1..J6) for $2.4M and 120 days, on the same grid (needs the 1000 kW tier to fill). Halls are generic (`s.halls[n-1]`, `buildHall` with an optional `hall`, default = next unbuilt). A long, early commitment: demand may not follow, and ch17 may strand it.
M39 **Grid outages**: seeded random outages (1–3 days, ~2 per year, more in summer heat waves). Without backup, all output stops and SLAs miss.
M40 **UPS + generator**: facility purchase ($380k). Covers outages but the generator burns diesel (cost and carbon per outage day).
M41 **CRAC upgrade**: +45 kW cooling per hall ($260k, 30 days).
Decision: insurance vs growth capex.

### Ch12 Energy sourcing (d840)
M42 **Spot power**: price becomes volatile (daily noise ±15 %, heat-wave spikes ×2–3 lasting 5–10 days, seeded, flagged by weather news 5 days ahead).
M43 **PPA**: sign a fixed-price, renewable power contract for X kW (stepper, 25 kW steps) for 540 days at a quoted price (quote moves with the spot average). Unused PPA power is still paid for.
M44 **On-site solar + battery** (facility, $600k): produces 0–60 kW by season (peaks in summer), and the battery shaves spot spikes (−40 % of the spike premium).
Decision: lock in price and green power vs flexibility; size the PPA correctly.

### Ch13 Environment (d930)
M45 **Cooling mode** per hall: *Evaporative* (PUE 1.15, uses water) or *Chiller* (PUE 1.45, no water). Facility power = IT × PUE and is billed. (Before ch13 PUE is a fixed 1.3 baked into the power price, so nothing jumps.)
M46 **Water**: evaporative cooling uses water scaling with IT load × summer factor. **Droughts** (seeded, news warning) cap water use: evaporative halls then lose 40 % cooling capacity.
M47 **Carbon**: tonnes = grid kWh × grid intensity (falls slowly over time) + generator use − PPA/solar. Shown as a gauge; matters for ch15 and ch16.
Decision: cheap power vs water risk; green sourcing pays later.

### Ch14 Investors (d1020)
M48 **Equity round offers**: a VC offers $X for Y % at a valuation = f(revenue growth, reputation). Offers come every ~120 days; accept or decline.
M49 **Board targets**: after the first accepted round, the board sets a revenue target each 180 days. A miss → warning; two misses in a row → you are fired (game over, score counts your equity at that moment × 0.5).
M50 **Buyback**: at any time, buy back 1 % of equity at the current valuation.
M51 Score switches to founder equity value (see §1). A VC pitch overstates how "easy" targets are (biased source).
Decision: dilution vs growth speed; targets constrain risky bets.

### Ch15 Reputation and PR (d1110)
M52 **Reputation 0–100** (starts 60). Moves with: SLA misses (−), outages without backup (−), carbon intensity vs peers (±), water use during droughts (−), fulfilled contracts (+), green PPA/solar (+), press events.
M53 Effects: contract offer frequency and price (±20 %), inference/web demand share (±10 %), investor valuation (±20 %), score factor.
M54 **PR campaign** action ($120k): +8 reputation that decays over 90 days. If a scandal is live, PR backfires (−5) with 50 % chance.
M55 **Press events**: journalists write stories triggered by state (e.g. water use in a drought, an outage) — news with a reputation hit.

### Ch16 Policy (d1200)
M56 **Proposed policies** appear in news with a vote date (60–120 days later); each has a pass probability hinted by indirect signals (e.g. "Senate committee adds amendments" = lower). Seeded outcome.
M57 **Carbon tax** (if passed): $ per tonne, ramping up quarterly.
M58 **Efficiency mandate** (if passed): hall PUE must be ≤1.3 by a deadline or fines per day.
M59 **Export controls** (if passed): the newest generation is quota-limited to N cards per quarter, and some contract customers are barred (their contracts end without penalty to them, but you lose the revenue).
M60 **Comment period**: pay for lobbying ($200k) to shift the pass probability by ±15 % (you choose the direction). A reputation cost if a press event reveals it (30 %).
Decision: prepare for policy before it passes vs wait for certainty.

### Ch17 Disruption (d1290) — exists as v1 ch6, re-timed
M61 Two exotic accelerator startups (Lattice inference ASIC, Photon optical training). The seed decides which is real. Vendor-reported benchmark chart (past only, no roadmap). Models at d1290, d1440, d1590. The fake vendor dies at d1500.
M62 **Immersion tanks** (rack conversion; tank heat mostly bypasses the room).
M63 **Pilots**: measured field performance revealed after 10 days in a rack.
M64 **Vendor pitch** (Optane-style PM-900 memory tier, d1330): real benefit, vendor may exit (75 %) at d1560, fire sale at d1500, bricks the part and cripples the rack until it is pulled.
M65 **Demand disruption** (seeded, 50 %): an "algorithmic efficiency breakthrough" at ~d1400 cuts inference compute demand by 35 % overnight (real), OR a hyped paper that changes nothing (false). Signals: preprint news 30 days before; real = "reproduced by independent labs", false = "results fail to replicate". If it is real, inference build-to-suit customers cancel (no penalty; the fit-out is sunk).
M66 **Incumbent response**: after the real exotic's 2nd model, Kestrel/Heron cut prices by 25 % (the incumbents' counter-move, i.e. the Nokia problem seen from the other side).

## 3. UI surfaces (game-like, no forms)
- **HUD** (exists) + new chips as chapters unlock: technicians (hire/fire steppers in a popover), debt, reputation (star gauge), carbon (leaf gauge), equity %.
- **Floor**: hall tabs (Hall 1/2), row spine slots at the row ends (drag the spine item there), the spares shelf strip below the floor (drag cards to/from it), and failed devices with a red cross.
- **Map modes** (exist) + Failures (hazard heat map) + Cluster (spine membership).
- **Drawer panels** (slide over the right side, opened by HUD icons; the game keeps running unless paused):
  - Contracts: offer cards, drag to "Sign" or "Decline"; active contracts shown as progress bars with the SLA line.
  - Finance: debt stepper, lease list, the quarter waterfall with tax, equity pie, VC offer cards, board target progress.
  - Energy & environment: PPA stepper + term bar, solar/UPS/CRAC purchase cards, a cooling-mode toggle per hall, water/carbon gauges, spot price sparkline.
  - Policy: proposal cards with a vote countdown, pass-likelihood signals (icons), lobby buttons.
- **Charts** (exist) + HBM index sparkline in the catalog header + a reputation sparkline.
- **News** (exists): gets filters by category icon.
- All new numbers entered by steppers or drag. No `<select>`, no `<input type=text>` except the seed field in the menu.

## 4. Bots
- v3: the greedy baseline may sell any part that loses money *today* (a gut player pulls a rack in the red) and lets an idle technician go; otherwise it stays myopic (payback ≤ 300 days, never hedges or pilots).
- Greedy and planner must handle all new actions sensibly: planner uses contracts as hedges before rumoured launches, hires technicians when repair queues grow, keeps 2 spares, reads memory-scare signals, uses debt when ROI > interest, declines dilution unless growth ROI is high, buys backup before summer from ch11, signs PPA when spot is volatile, prepares for policies whose signals point to passing.
- Depth report extended with ablations per chapter group. Target: planner > greedy on ≥90 % of seeds; relative gap ≥25 %.

## 5. Tests
- Keep all v1 tests green (update numbers where the spec changes them).
- ≥1 test per mechanic M22–M66 (rule-level), plus determinism across a full 1800-day campaign with random actions,
  save/load round-trip (JSON) equality, and sandbox unlocks everything at d0.

## 6. Balance targets (check with bots, n ≥ 12 seeds)
- Idle player survives but ends < 5 % of the planner score.
- Greedy is never bankrupt; the planner is never fired.
- Each chapter's mechanic changes the planner's actions at least once per game (log it).
- Mid-game cash should not pile up idle for more than ~1 year: Hall 2, contracts, investors and policy must create sinks and choices. Measured (v3) as the planner's longest stretch with more than $2M in the bank, mean over seeds < ~365 days.
