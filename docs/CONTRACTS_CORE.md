# v4 core loop: all money comes from contracts (user decision, 2026-09-24)

Status (2026-09-25): **sim + bots + tests implemented** (commit "feat: v4 contracts core"); the UI pass is pending. Numbers
below are the implemented ones; DECISIONS D48–D53 record why.

**Loop:** offers arrive on an order board → you sign → you build the capacity before the start date → you deliver
(SLA) → you get paid. Hardware with no contract earns **$0** (and still draws power), so there is no anonymous spot market.

## Contract types (unlocked by chapter)
| Type | Unlocks | Shape | What limits you |
|---|---|---|---|
| Web hosting | Ch1 | N web units per day, 60–180 days, SLA 90 % | rack space, switches |
| Inference serving | Ch3 | N inference units per day, 90–360 days, SLA 95 % | bandwidth-heavy cards (roofline) |
| Training job | Ch3 | total work W (unit·days) by a deadline; paid on completion; late → a daily penalty, then cancelled | compute-heavy cards; heat and failures delay you |
| Frontier training | Ch7 | a training job that only counts output from a ≥12-GPU spine cluster | layout, spine |
| Long-term / build-to-suit | Ch8 (this chapter now teaches the long-horizon deals) | 360–540 days, fit-out capex, 3× penalty | cash, commitment risk |

## Rules
- **Order board:** an offer every ~4 days (up to 6 on the board), each expiring in 10–20 days. **Offers scale with the
  player** (designer feedback): size = 0.3–1.2× what the player can deliver (free capacity + what half the cash buys, limited
  by floor room; a quarter are 1.2–1.6× "stretch" offers; a first offer in a new market is 0.5–0.85 of one card), capped by
  the market's open demand (demand − what the player already holds: a full GPU market sends no offers). **v0.4.2: web is
  unbounded and price-elastic instead** (D61): new web offers × max(0.25, min(1, (30/H)^0.8)), H = web units held; after
  ch3 web offers arrive on their own ~8-day clock. Kinds are those the
  player has unlocked and can plausibly serve. The price = the market price index × 1.2 (contract premium) ± 15 %, which
  drops at generation launches and in the disruption price war. Reputation raises offer frequency and price.
- **Allocation is automatic:** every substep, rack output fills contracts: first every contract's SLA minimum (jobs: the rate
  that meets the deadline), most urgent first; then serving contracts up to all their units; then jobs speed up (up to 2×).
  Unallocated output is idle. A customer missed 20 days in a row walks away; one served at SLA offers a renewal 10 days
  before the end.
- **New rack mode "Off":** 0 power, 0 output, so idle hardware can be parked.
- **Start:** 2 web racks + 1 signed web contract (≈ the old starting income) + 2 offers on the board, so money flows
  from minute 1 and signing is the very first decision.
- **Remove:** spot revenue and oversupply-at-25 %. Keep the market *curves* (demand, price index) as the drivers of offers.
- **Chapter 8** changes from "Contracts" to "Long-term deals" (build-to-suit, multi-year hedges). The chapter count stays 17.
- **Chapters are player-triggered** (DECISIONS D49): each unlocks in order on a milestone (content.js `hint`), not before an
  earliest day, at most one per 30 days.

## Heuristics this creates
"Don't sign what you can't deliver" · "keep a buffer for failures and summer" · "lock long contracts before a launch" ·
"idle capacity is waste: match capacity to backlog" · "training deadlines need compute, serving needs bandwidth".

## Implementation order
1. Sim: the contract engine (types, board, allocation, payment, penalties, Off mode), remove spot revenue, and update
   `stats().revenue`/ledger/summary; tests (determinism, money conservation, every type's payment and penalty math).
2. Bots: greedy signs any offer that is profitable against its current free capacity; the planner forecasts capacity,
   deadlines, launches and failures. Re-run the balance targets and the ablation.
3. UI: the order board becomes a primary screen element, with rack↔contract links and an "Off" mode button. Game feel
   per `docs/I18N.md` "show not tell". It ships together with i18n and the text diet.

## Implemented API for the UI pass (all state is JSON; UI reads it, acts through `Sim.check/apply`)
- `S.offers[]`: `{id, kind: web|infer|train|frontier|bts, cust, icon, w, units (jobs: nominal rate), days, lead, price (per
  unit-day; jobs: pay/work), spot (index), repAdj, sla, penalty (jobs: late fee/day), expires, ttl, stretch}`; jobs add
  `{work, pay, maxRate, lateFee, lateMax, frontier}`; build-to-suit adds `{bts, fitout}`; renewals add `renewOf` (and start
  when the old contract ends: `lead`). Actions: `signContract {id}`, `declineContract {id}` (no chapter gate any more).
- `S.contracts[]`: offer fields + `{signed, start, end, delivered, missed, penaltyPaid, missDays, streak}`; jobs add `{done,
  deadline, late}`; `anchor: true` = the starting customer; `walked` when terminated.
- `Sim.stats(S)`: `alloc[] {rack, id, w, u}` (rack → contract links), `perRack[id].to[] {id, u}`, `cDel[id]`, `cMiss[id]`,
  `idle {web, train, infer}`, `owed {…}`, `accrual` (job progress $/day), `earn` (= net + accrual), `idleLoss`.
- `Sim.capacity(S, st)`, `Sim.owedNow(S)`, `Sim.held(S)`, `Sim.roomFor(S, item, w)`, `Sim.jobNeed(c, day)`, `Sim.isJob(c)`,
  `Sim.contractsOn(S)`, `Sim.nextChapter(S)`, `Sim.milestone(S, key, st, Sim.fleet(S))`, `CHAPTERS[i].hint`.
- Rack mode `off` (`mode {rack, mode:"off"}`): 0 kW, 0 output, no failures; budgeted as Standard when buying into it.
- Cash events (`S.cashEvents`, kinds): `contract` (job paid), `contractCancel` (job cancelled, amt 0), `contractLost`
  (walk-out, amt 0), `renew` (auto-renewed, amt 0), `refund`, `restock`, `unsell`, plus the v0.3 `tax`/`repair`/`sale`.
- End screen: `Sim.summary(S).lessonKeys` (e.g. `idle`, `sla`, `cancelled`, `throttle`), `contracts {signed, fulfilled,
  failed, cancelled, late, active, penalties, idle, cancelledWork}`.
- Forgiveness/automation: `reorder {rack, uid, index}`, `cancelJob {id}`, `undoSell {uid, rack?}` (alias `buyBack`;
  `S.recentlySold[] {uid, type, value, rack, day, until}`), `policy {key: autoSwap|autoRenew, on}` / `policy {key:
  "keepSpares", item, n}` (`S.policy`).
