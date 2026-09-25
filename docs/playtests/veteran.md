# Halcyon Compute — Veteran Playtest

**Persona:** strategy-game veteran (Factorio / Paradox / Offworld Trading Company). Played honestly via the driver — no source reading, no `__game.S` peeking, learned only from the UI.
**Label: n=1 AI persona playtest — weak signal.** One run, one seed (202), one playstyle. Treat every claim below as a hypothesis worth re-testing, not a verdict.

## 0. Final score

| | Founder equity |
|---|---|
| **You (this run)** | **$3.19M** |
| Greedy bot | $4.11M |
| Planner bot | $38.33M |

You lost to Greedy by ~1.3x and to Planner by ~12x. End-screen screenshot: `docs/playtests/shots-veteran/44_endscreen.png`.

Score formula shown at game end: `(Net worth $1.42M + Earnings multiple $1.99M) × Reputation factor ×0.94 × Ownership 100% = $3.19M`. Contracts signed/fulfilled/short: **0/0/0**. Carbon 740t, water 44,702 m³.

---

## 1. Session log (key moments)

- **Day 1 (Jan 1, Y1).** New campaign, seed 202. Start: $400k, 2 web racks (A1/A2), chapter 1 "Racks and cash" (demand 30, serving 16). Decision: order a switch + 3 more web servers into A3. Outcome: chapter auto-advanced almost immediately after just *ordering* (not delivering) hardware — goals seem to gate on commitment, not completion.
- **Mar 1, Y1.** Chapter 3 "GPUs and the roofline": `throughput = min(compute, bandwidth × intensity)`. Bought a Kestrel C1 (compute) into A5 and a Heron M1 (bandwidth) into A6, both on credit against my $400k seed.
- **Apr–May, Y1.** Cash cratered to **$16k–48k** after two ~$300k GPU buys before either was earning (switches not yet installed → $0 revenue while shipping). This was the closest the run came to a bankruptcy spiral; recovered only because the original web racks kept producing. **Lesson: chapter-1 hardware is cheap, chapter-3 hardware is not — the game doesn't warn you the moment you cross from "affordable" to "two paychecks from empty."**
- **Mar, Y2.** Chapter 7 "Network fabric": put 12+ training GPUs in one row + a row spine to sell at **1.6× "frontier training"** price. This is the single most interesting spatial-economic decision in the game — cluster GPUs physically in one row, buy a spine, cross a hard threshold, get a permanent price multiplier. Real depth here (see §3).
- **May 22, Y2.** Bug: clicked the "Inference" text in the top-left role-legend row (not the rack panel's role toggle) while paused; cash dropped from $229k → $62k with no toast, no dialog, no visible transaction. See §6.
- **May–Aug, Y2.** Chapter 8 "Customers and contracts": dozens of "Contract offer" / "Build-to-suit request" cards began appearing in the News feed. I tried clicking them, scrolling them into view, and inspecting the DOM for buttons — found only inert `<div class="ev">` nodes, no click handler, no sign/decline affordance. **I never managed to sign a single contract in the entire 1800-day run.** Confirmed at game end: 0/0/0 contracts.
- **Aug, Y2.** Chapter 9 "Memory market": HBM index badge (shortage → 3x GPU shipping time, higher prices); forward orders via the spares shelf lock today's price. Used this correctly — deferred bulk GPU buying while the shortage tag was red.
- **Nov, Y2.** Chapter 10 "Finance": borrow up to 40% of net worth at 9%, lease cards with no upfront cost, 21% tax on quarterly profit. Never touched debt or leasing — organic cash flow was healthy enough not to need it. Untested lever; flagged as an open question, not a conclusion.
- **Feb, Y3.** Chapter 11 "Facilities and resilience": Hall 2/3 expansion, **UPS + generator cover outages**. I read the goal, dismissed it, and moved on without building any backup power — a real mistake, see next entry.
- **Aug, Y3.** Direct consequence: "Grid outage: everything is down. No backup power. Contracts miss their SLA." 3 days, -$2k/d, racks dark. This is a *legible* punishment for skipping ch.11 — good design, clear cause→effect. End screen tallies $82k lost to grid outages across the run, worst hit in Y3 summer ($30k) — exactly this event.
- **Nov, Y3.** Chapter 14 "Investors": VCs offer cash for equity; board sets revenue targets; miss two in a row = fired; score = equity value. Decision: **stayed 100% owner**, bootstrapped instead. Confirmed correct in hindsight — the end screen's "Behind the curtain" reveals the VC pitch promised +5%/half-year board targets while the board would actually have demanded +15%, i.e. the VC offer as presented was a bait-and-switch I dodged by never engaging.
- **Feb, Y4.** Chapter 15 "Reputation and PR": reputation (was 60, ended 47) multiplies final score (×0.94 in my case) and is hurt by SLA misses/outages, helped by PR and green power. My reputation *fell* over the run — a direct cost of the ch.11 negligence and ch.8 contract-blindness (missed SLAs I never even signed up for still seem to have dinged something, or it's decay from the outage alone).
- **May, Y4.** Chapter 16 "Policy": proposals with vote dates, lobbying shifts odds. Never lobbied. Of three proposals, Export Controls (true odds 58%) passed; the other two (Carbon Pricing 71% odds, Efficiency Mandate 51% odds) failed. I had zero agency over any of these outcomes because I never opened the "Public drawer."
- **Aug, Y4.** Chapter 17/17 "Something new": two rival vendors, one real, one hype; pilot cards de-risk the bet cheaply. I never ran a pilot and stuck to the incumbent Kestrel/Heron line. End screen reveals I got lucky by inaction: "Lattice was the real thing; Photon was hype (60% of spec in the field, shut down day 1500)" and "Nanofab PM-900: vendor died day 1560 and bricked every PM-900." Avoided both traps purely by not engaging the new mechanic at all.
- **Oct Y4 – Dec Y5.** Built a training cluster in row B: one Kestrel GPU per rack across B1→B6 (6 GPUs total), funded entirely from organic profit, no debt. **Never reached the 12-GPU frontier-cluster threshold** before day 1800 — ran out of runway. Screenshots: `38_b_switches.png` → `43_b5b6.png`.
- **Jan 1, Y6 (day 1800).** End screen. Final score $3.19M vs Greedy $4.11M vs Planner $38.33M.

---

## 2. Strategic depth assessment (by chapter/mechanic)

| Chapter/mechanic | Real decision? | Verdict |
|---|---|---|
| 1 Racks & cash | Marginal | Trivial — drag switch+server until demand met. No interesting tradeoff yet. |
| 2 Power (Eco/Standard/Boost) | Yes, shallow | Never had to touch it once beyond default; grid cap (250→400kW) never bound in 6-rack play. Feels like it matters more at higher density than I ever reached. |
| 3 GPUs & roofline | **Yes, real** | `min(compute, bandwidth×intensity)` is a genuine engineering tradeoff (compute-bound vs memory-bound), visualized well via the roofline chart. Best micro-mechanic in the game. |
| 4 Summer/heat | Weak | Warned well ahead, cooling degraded gracefully, never actually threatened a rack in my run. Possibly more binding at higher rack density/Hall 2+. |
| 5 Hardware generations | Yes, but shallow | "Buy old-gen, it's cheaper" is a dominant strategy I never had reason to break — newest gen was never *necessary* to meet demand. Resale-before-launch timing never mattered because I never sold anything. |
| 6 Operations (failures/spares) | Weak, backgrounded | Auto-repair handled everything invisibly; I never manually stocked the spares shelf and suffered only $39k in downtime over 1800 days. Feels optional. |
| 7 Network fabric (cluster bonus) | **Yes, the best decision in the game** | Physical-layout + capital-commitment tradeoff: cluster 12+ training GPUs in a row + buy a spine → permanent 1.6× price. Real spatial puzzle, real capital gate, genuinely interesting — and I couldn't afford to finish it. This is where skill should separate players from bots. |
| 8 Customers & contracts | **Could not find the interaction** | See §5/§6. If Planner's 12x score lead comes substantially from contracts (plausible — SLA-backed guaranteed revenue vs spot-market volatility), this chapter's UI failure is the single biggest reason I lost. |
| 9 Memory market (HBM shortage) | Yes, real | Clear signal (index badge, red "SHORTAGE" tag), clear response (wait, or forward-order). Good depth, appropriately legible. |
| 10 Finance (debt/leasing/tax) | Untested | Never needed debt. Can't judge depth — flag as unexplored, not solved. |
| 11 Facilities & resilience | **Yes, and I paid for skipping it** | UPS/generator is straightforward insurance math (small % of net worth vs catastrophic outage cost) that I never ran. Good design: consequence was legible and directly traceable in the end-screen "lessons" panel. |
| 12 Energy sourcing (PPA/solar) | Not engaged | Dismissed the tutorial, never opened the energy drawer again. Possibly rewarding but zero pressure to touch it at my scale. |
| 13 Environment (PUE/carbon/water) | Weak | Tracked (740t carbon, 44,702m³ water) but never gated a decision — no cost or score term I could see tied to it directly, felt like a scoreboard stat rather than a lever. |
| 14 Investors | Yes, real, and legible in hindsight | 100%-ownership vs VC dilution is a clean tradeoff; end screen retroactively confirmed my "don't take VC" instinct was right for this seed's board terms. |
| 15 Reputation & PR | Present but invisible during play | Multiplies final score meaningfully (×0.94 here) but I never saw a "reputation" number tied to a specific action until it was too late to correct — pure end-of-run surprise. |
| 16 Policy | **Not a decision — a coin flip I never touched** | No lobbying attempted; outcomes just happened. Could be deep (signals + lobbying) but I never found a reason during play to open it, and nothing punished ignoring it directly. |
| 17 "Something new" (pilot vendors) | **Yes, but skippable-and-still-win** | Pilot-card de-risking is a good idea; I avoided its downside entirely by just not adopting new vendors, which suggests the mechanic doesn't force engagement — a risk-averse player can ignore it for free. |

**Most solved/noise mechanics:** 5 (old-gen is dominant), 6 (auto-repair trivializes it), 13 (tracked but inert).
**Best mechanics:** 3 (roofline), 7 (cluster threshold), 9 (shortage timing), 11 (resilience — because the punishment was clear).

---

## 3. Exploits / degenerate strategies

1. **Idle compounding works and is never punished.** From ~day 200 to day 1500 I mostly fast-forwarded through 6 racks (A1–A6) doing almost nothing, and cash/score compounded smoothly the whole time (e.g. $16k → $1M+ cash with only sporadic check-ins). There's no decay, spoilage, or rising cost curve that punishes an idle "set it and forget it" datacenter. A more optimal version of this run would probably just buy 6–10 racks once in year 1 and then fast-forward to day 1800 doing nothing else, which likely beats what I actually did.
2. **Never touching contracts, policy lobbying, or the pilot mechanic cost nothing structurally** — no penalty screen, no "missed opportunity" flag, no reputation hit tied specifically to declined offers (only SLA *misses on signed contracts* would hurt, and I signed none). If Planner's 12x lead comes from those systems, the game currently lets a player finish a full 1800-day campaign, reach the credits, and *never discover* the mechanics that separate a 3M score from a 38M one. That's an exploit in the sense that "ignore three of seventeen chapters' mechanics entirely" is a viable, undetected strategy, but it's really an information-gap bug (see §5) more than a deliberate exploit.
3. **Old-gen hardware is a dominant buy** with no real drawback found (same roofline capability curve, ~30–40% cheaper, no observed reliability penalty tied to generation age specifically). I never had a reason to buy current-gen.

---

## 4. Bugs

1. **Unexplained $167k cash loss from a legend-chip click (medium-confidence, n=1, unconfirmed repro).** Chapter 8, May 22 Y2, game paused. Clicked the "Inference" text in the top-left role/legend filter row (screen coords ≈162,178 — NOT the rack-panel's Training/Inference toggle, which lives at ≈1245–1330,350). Cash went from $229k → $62k between screenshots `docs/playtests/shots-veteran/21_heron_placed.png` and `docs/playtests/shots-veteran/22_a6_inference.png` with no toast, no dialog, no new hardware appearing anywhere on the 18-rack floor (checked via DOM read of every rack). No driver `errors` were reported. I could not identify the cause and did not retry the exact repro — flagging as a real possibility, not a confirmed defect.
2. **Silent drag-and-drop order failures during chapter-dialog transitions.** Twice (screenshots `07_gpu_added.png`→`12_a6.png` timeframe), a hardware drag-drop onto a rack produced no toast, no cash change, and no shipping indicator, apparently because a new chapter dialog opened over the drop target mid-action. The player gets zero feedback that the order didn't go through; I only noticed because I later inspected the rack panel and found it still empty. Low severity but a real footgun, easy repro: drag hardware right as a new chapter is about to trigger.
3. **Contracts/offers have no discoverable UI to accept or decline them** (see §5) — filed here too since it may be a genuine defect rather than deliberate design (an entire scoring category, "contracts signed/fulfilled/short," ends every single run at 0/0/0 for a player who never finds the hidden affordance, which seems unlikely to be intended).

---

## 5. Information & feedback

- **Good:** chapter dialogs are excellent — concise, mechanically precise (e.g. literally printing `throughput = min(compute, bandwidth × intensity)`), and the roofline chart, HBM index badge, and cluster row overlay (`Cluster` tab, star icon for "12+ training GPUs") are all legible, well-designed micro-widgets that tell you exactly what to do.
- **Missing/buried:** the single biggest information gap is contracts. Offers pile up in the News feed indistinguishable from pure announcements (generation launches, rumors) with identical inert-looking cards. I inspected the DOM directly and found no button, no `onclick`, nothing actionable on a "Contract offer" list item. If there is a transient popup/toast that appears only briefly when an offer first arrives (and is lost forever once it scrolls into the log), that's a severe legibility problem for a game that runs at up to 8x speed in the background — a player who blinks (or, like me, is doing something else in the same tick) permanently loses the chance to act on it, with no way to know that happened until the credits say "0/0/0."
- **Missing:** no running comparison to the Planner/Greedy bots during play. The entire premise of the game ("beat the Planner bot") is completely invisible for 1800 days and only resolved at the very end, by which point course-correction is impossible. Even an approximate, hidden-details relative-score ticker would let a player realize by day 300 that they're on a $3M trajectory instead of a $38M one and go investigate why.
- **Missing:** reputation is tracked and multiplies the final score, but nothing during play tells you "you just lost 3 reputation because of that outage" at the moment it happens — it's a silent number you only reconcile against in the post-game breakdown.
- **Misleading via omission:** the finance chapter mentions "VCs offer cash for equity... the board sets revenue targets," but the actual board-target-vs-VC-pitch mismatch (+15% demanded vs +5% promised) is only revealed in "Behind the curtain" after the game is already over — a player who *did* take VC funding would have no way to know mid-game that the terms were a trap until they'd already missed two targets and been fired.

---

## 6. Heuristics formed

1. **"OLD GEN badge → always buy it unless capacity-constrained."** Applies at every hardware purchase throughout the run; compresses the generation-pricing curve into one visual check. Good heuristic — cheap to apply, rarely wrong in this run. Untested: whether it ever *is* wrong (e.g., does new-gen unlock higher roofline ceilings needed for larger contracts I never signed?).
2. **"Red HBM-shortage tag → defer bulk GPU buys."** Applies whenever considering compute purchases; turns a volatile price index into a binary go/no-go. Sits well between gut feel and full price-curve math.
3. **"If a chapter's tutorial mentions insurance/backup/resilience, budget for it within a year even if cash is tight now."** I *formed* this heuristic only retroactively, from the end-screen lesson about the Y3 outage — it did not fire in time to prevent the $82k loss, meaning in practice I was applying "skip anything that doesn't obviously pay for itself today," which is the wrong default once net worth clears ~$500k. Flagging as a heuristic I *should* have had, not one I successfully used.
4. **"Don't half-commit to the 12-GPU cluster threshold."** Formed post-hoc: 6 of 12 GPUs earns the same 1x rate as 1 of 12 — there's no partial credit — so partial investment is pure sunk cost until you cross the line. The game gives no in-UI progress readout like "6/12 toward frontier cluster, keep going" versus "at your current cash-flow you won't reach 12 before the campaign ends," so this heuristic is currently unusable *during* a run; it only becomes available in hindsight, which is a design gap, not a player skill issue.

None of these four reach the bar of "applies at every stage, sits between gut and brute-force, compresses state well" for the *whole* game — #1 and #2 come closest. #3 and #4 are heuristics the game's feedback loop currently prevents a player from forming in time to use them.

---

## 7. Top 5 recommendations (ranked)

1. **Fix or surface the contracts interaction.** This is the highest-leverage single change: either add a visible, always-available "Offers" inbox with explicit Sign/Decline buttons (not a scrolling log), or fix whatever transient popup I never caught. Given the end screen explicitly scores "contracts signed/fulfilled/short," a mechanic that a competent, attentive player can fully miss for 1800 days and finish at 0/0/0 is very likely the largest single contributor to the 12x gap versus Planner.
2. **Add a relative-progress indicator against the bots during play** (even coarse — "trending toward $X-$Y range" or a lagged/approximate comparison), so the stated goal of the game ("beat the Planner bot") is legible before day 1800 instead of only at the credits.
3. **Give the frontier-cluster (ch.7) a visible progress readout** ("6/12 training GPUs in Row B — need 6 more to unlock 1.6x") instead of only a binary star icon that appears at completion. This is the best mechanic in the game and currently gives zero mid-build feedback on whether the investment is on track.
4. **Make resilience (ch.11) consequences preview-able**, e.g. an estimated "expected annual outage cost without UPS: ~$Xk" number next to the UPS purchase button, so the insurance math is legible in the moment instead of only in the post-mortem "lessons" panel.
5. **Add a light penalty or at least a persistent nudge for zero-engagement chapters** (policy lobbying, pilot cards, contracts) so a fully passive player discovers mid-run — not only at the credits — that ignoring these systems is leaving score on the table. Right now the game can be "completed" while skipping roughly a third of its own chapters with no in-run signal that anything was missed.

---

*Screenshots referenced throughout are under `docs/playtests/shots-veteran/` (00_start.png → 44_endscreen.png), all relative to the project root `/Users/lishuyu/Codes/gamedesign/week3/datacenter`.*
