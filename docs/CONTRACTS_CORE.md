# v4 core loop: all money comes from contracts (user decision, 2026-09-24)

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
- **Order board:** 3–6 offers visible, each expiring in 10–20 days. Arrival rate and size follow market demand
  (the old demand curves: inference grows fastest). The price follows the market price index, which drops at
  generation launches and in the disruption price war. Reputation raises offer frequency and price.
- **Allocation is automatic:** each day, rack output fills contracts by priority (the most urgent SLA/deadline
  first); the UI shows which rack serves which contract (colour links). Unallocated output is idle.
- **New rack mode "Off":** 0 power, 0 output, so idle hardware can be parked.
- **Start:** 2 web racks + 1 signed web contract (≈ the old starting income) + 2 offers on the board, so money flows
  from minute 1 and signing is the very first decision.
- **Remove:** spot revenue and oversupply-at-25 %. Keep the market *curves* (demand, price index) as the drivers of offers.
- **Chapter 8** changes from "Contracts" to "Long-term deals" (build-to-suit, multi-year hedges). The chapter count stays 17.

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
