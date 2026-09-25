# Halcyon Compute: design notes (Game Design, Week 3)

**Brief (Lecture 3):** make a prototype with strategic depth ("the more you think about the game the better
you should do"), explain which characteristics it uses and which heuristics players learn, and keep the scope small.

**The game:** you run a datacenter floor for 3 years (1080 days, about 9 minutes at 1x). You drag hardware onto
18 racks and decide what each rack runs. Your score is net worth: cash plus the resale value of your hardware.
Mechanics arrive in 6 short chapters, simplest first:

| Ch. | Day | New mechanic | The decision it adds |
|---|---|---|---|
| 1 | 0 | Racks, cash, switches, web market (demand ≈ 30) | Where to put hardware, and when the market is full |
| 2 | 30 | 250 kW grid, 30 kW per rack, seasonal power price, Eco/Std/Boost, grid upgrade | Trading output against power |
| 3 | 60 | Two GPU families + two markets (roofline: throughput = min(compute, bandwidth × intensity)), rack-local network | Which card goes with which workload |
| 4 | 120 | Seasonal cooling, room thermal inertia (τ≈5 days), rack inlet throttling above 32 °C, hot neighbours, coolers | Preparing for summer ahead of time, spreading heat |
| 5 | 330 | Generations every ~year, announced by rumour ~60 days ahead; launches cut prices and resale | When to upgrade, and when to sell |
| 6 | 450 | Disruption: 2 startups (one real, one hype; **the seed decides which**), immersion tanks, pilots, an Optane-style vendor pitch (PM-900) whose vendor may die | Reading biased information; paying for information |

## Characteristics used (from the lecture's list)

- **Time granularity: pausable real time.** Time runs continuously but can be paused (space bar) at any
  moment, and every action has a lead time (6 days shipping, 2 days install, 3 technicians). Pausing
  keeps it a game of **strategy, not dexterity**: a slow player who thinks loses nothing. The lead
  times make it a game of *anticipation*: heat has to be solved before summer, and cards sold before a launch.
- **Stochasticity: low, at the level of whole games.** Within a game almost everything follows known
  rules. Two hidden coin flips per seed decide which exotic accelerator is real and whether Nanofab dies,
  and demand wobbles a little. Memorising one playthrough doesn't solve the next one.
- **Observability: imperfect, and biased.** Vendor charts show only the vendors' own past numbers
  ("no roadmap"). Spec sheets list strengths only. The truth comes through indirect news ("sells its only
  fab", "lead architect departs") and through **paid information**: a pilot card shows its real field
  performance after 10 days. Generation launches are the one thing announced honestly, with a warning.
- **Systems** (the lecture's four kinds):
  - *Conditional*: a rack throttles if its inlet is above 32 °C, earns nothing without a switch, and runs at 60 % if it holds a bricked PM-900.
  - *Combination*: card × workload (the roofline); PM-900 × a memory-bound rack; exotic card × tank.
  - *Feedback loops*: revenue → hardware → more revenue (positive). Heat → throttling → less output,
    and oversupply → quarter price (negative loops that cap growth).
  - *Resources*: cash, kW, U of space, network, technician time, cooling capacity, market demand.
- **Length of play:** the unit of decision is a few seconds of real time, a session is one quarter
  (the ledger/waterfall), and the full game is 12 quarters.
- **Single player, but "one-and-a-half"** in spirit: the market (rivals upgrading at launches) and the
  vendors act on you.
- **Depth vs entropy:** the aim is to sit on the deep, structured side. The randomness is limited to
  hidden facts that *can be discovered*. There are no dice on individual actions.

## Heuristics players learn (and why they are good ones)

The lecture's test for a good heuristic: it applies at every stage, sits between gut feeling and brute
force, and compresses the game state usefully.

1. **"Find the binding constraint."** The thing that limits you moves over the game: cash (early) →
   space and network → power → heat (summers) → market demand (late). Spending on anything else is waste.
   It applies at every stage, and it compresses the whole HUD into one question.
2. **"Match the card to the roofline."** Compute-heavy cards go on training, bandwidth-heavy cards on
   inference. This is a real systems idea taught through play: the rack panel's roofline chart shows
   which one limits you.
3. **"Heat is a forecast, not a reflex."** The room reacts slowly and hardware takes 8 days to arrive,
   so cooling (or Eco mode) has to go in before late July. Spread hot racks instead of packing a row.
4. **"When a scarce input limits you, rank by output per unit of that input."** Compare by output
   per kW when power limits you and per U when space does, not per dollar. This drives upgrade decisions
   after each launch.
5. **"Sell before the launch, not after."** Launches cut resale by about 40 %, and rumours give warning.
6. **"Don't oversupply a market."** Output beyond demand sells at a quarter price. Inference demand
   grows about 2.2× a year and training about 1.25×, so the balance between them has to shift over the game.
7. **"A discount near a vendor's bad news is a liquidation."** The PM-900 is actually good, but the
   60 %-off fire sale arrives right before the vendor exits and the part bricks.
8. **"Buy information before you bet."** One pilot card per startup costs little; scaling up before
   measuring can mean buying hardware that delivers 60 % of spec and then dies.
9. **"Early data can mislead."** The hype vendor's benchmark curve looks *better* at first and then
   flattens, while the real one compounds. This is the Nokia/touchscreen problem at small scale.

## Evidence of depth (bots)

Two scripted players share the simulation core (`bots/bots.js`), so we can measure how much thinking pays:

- **Greedy** buys whatever raises income *right now* the most per dollar (payback ≤ 300 days). It ignores seasons,
  launches, vendor risk and contracts, and never hedges or pilots. Like a gut player, it sells a part that loses
  money *today* and lets an idle technician go. It also does the obvious chores (transit for its traffic,
  auto-repair, one more technician when repairs pile up).
- **Planner** plays the heuristics above across all 17 chapters with one value function: change in daily profit
  over a lookahead (150 days, or the rest of the game in the last 420), plus the final-quarter profit × 730 that the
  score counts, plus resale using the public launch calendar, minus the reputation cost of SLA misses. On top: it
  signs contracts and build-to-suit deals it can serve with ≥10–15 % headroom (buying the capacity when that pays and
  is affordable before delivery starts), builds grid tiers and Hall 2 when demand outruns the floor, buys UPS/solar/PPA,
  switches each hall's cooling for droughts, reads scare follow-ups, pilots exotic cards, reads the demand-disruption
  signal (inference build-to-suit customers walk away if it is real), and takes a VC round only when the board can
  no longer fire it. It sees only public state, news and its own pilots (never the seed's hidden truths).

`node bots/run.js --seeds 12 --ablate` (reports/depth.json, v3 balance: GPU prices ×1.6, build-to-suit every ~60
days). **n = 12 seeds (1–12) per row, one planner implementation, score = founder equity value (SPEC §1).** The gap
is a *lower bound* on depth: a better planner would open it further, and a better greedy would close it. Weak
signals, not proof.

| Variant | Greedy score (mean $k) | Planner score | Relative gap (mean / median / min) | Planner wins | Note |
|---|---|---|---|---|---|
| **Full game** | 7,719 | 61,829 | **+701 % / +666 % / +290 %** | 12/12 | net worth gap +662 % |
| No heat/seasons | 14,315 | 70,517 | +393 % / +331 % / +134 % | 12/12 |  |
| No generations | 58,334 | 171,066 | +193 % / +181 % / +90 % | 12/12 | confounded: prices never fall, so the never-sell greedy stops losing |
| No operations | 16,188 | 71,295 | +340 % / +399 % / +94 % | 12/12 |  |
| No fabric | 41,564 | 211,483 | +409 % / +408 % / +208 % | 12/12 | confounded: also removes transit, a large late cost for both bots |
| **No contracts** | 7,705 | 37,527 | **+387 % / +471 % / +152 %** | 12/12 | also removes build-to-suit, the planner's main sink |
| No memory market | 9,197 | 72,390 | +687 % / +688 % / +325 % | 12/12 |  |
| No finance | 12,641 | 76,913 | +508 % / +481 % / +268 % | 12/12 | greedy bankrupt 1/12 (no credit line: floor −$150k) |
| No facilities | 10,013 | 62,918 | +528 % / +522 % / +193 % | 12/12 |  |
| **No energy** | 12,060 | 51,635 | **+328 % / +441 % / +143 %** | 12/12 |  |
| No environment | 8,420 | 61,958 | +636 % / +678 % / +299 % | 12/12 |  |
| No investors | 7,956 | 49,175 | +518 % / +552 % / +219 % | 12/12 |  |
| No reputation | 8,592 | 58,881 | +585 % / +572 % / +259 % | 12/12 |  |
| No policy | 8,169 | 74,430 | +811 % / +822 % / +388 % | 12/12 |  |
| No disruption | 7,706 | 94,174 | +1,122 % / +1,189 % / +438 % | 12/12 |  |
| No network | 10,815 | 74,805 | +592 % / +600 % / +192 % | 12/12 |  |
| No roofline | 1,904 | 42,327 | +2,123 % / +3,082 % / +426 % | 12/12 | confounded: both families become poor at inference |

Balance targets (SPEC §6) on the full game, n = 12:
- **Idle** survives on every seed and ends at 1.0 % of the planner's score.
- **Greedy** is never bankrupt (3.8–24× idle).
- **The planner** is never fired (0 in every row) and beats greedy on 12/12 seeds by at least +290 %.
- **Idle cash** (the planner's longest stretch with more than $2M in the bank, mean over seeds) is **311 days**
  (it was 1,256 before v3), but 4/12 seeds still exceed a year (385–645 days).
- **Chapter coverage** (games out of 12 where the chapter changed the planner's actions): 15 chapters in 12/12.
  Environment 10/12: seeds 6 and 10 have no drought after chapter 13. Policy 10/12 (12/12 counting explicit
  "don't lobby" decisions).
- **Timing:** planner ≈1.9 s per game, greedy ≈0.6 s (single thread, n = 12).

What this suggests (tentatively):
- **Contracts (with build-to-suit) carry the most depth**: removing them roughly halves the planner's score
  and the gap falls to +387 %. They are the planner's main cash sink and its hedge before launches.
- **Energy, operations, heat and fabric carry a lot too** (gap +328…+409 % without them). Finance, facilities,
  investors and reputation carry some (+508…+585 %). Environment, network, memory and policy carry little or
  nothing (+592…+811 %). The per-seed spread of the gap is large (±$16–64M), so this ordering is a hypothesis,
  not a result.
- **Removing disruption *widens* the gap** (+1,122 %). The planner does better without the late shocks, and greedy
  isn't hurt by them because it ignores exotic tech. That is not evidence that disruption adds depth. **Don't cut or
  keep any mechanic on this evidence**; the next tests are cleaner ablations (fabric without the transit cost) and
  playtests.
- **Generations, fabric and roofline ablations are confounded** (they change the whole economy).
- **Hall 3 and the 1000 kW grid tier were never built by the planner (0/12).** At v3 margins it rarely fills two
  halls, so they are a bet it declines. They exist as a choice, but this data doesn't show them working as a sink.
- **The gap is still large (≈7×).** Most of it comes from contracts/build-to-suit and the endgame run-rate that the
  score's earnings multiple rewards. A human will sit somewhere between the two bots, which only playtests can show.

The end screen of every game replays the same seed with both bots, so each playtester sees how they
compare with gut-feeling play and with thinking-ahead play.

## Playtest questions (to run with people outside the group)
1. After one game, can they state at least 3 of the heuristics above in their own words?
2. Do they pause to think? When?
3. In game 2, do they pilot before scaling exotic hardware? Did they buy the PM-900 fire sale?
4. Where do they score between the greedy and planner bots, and does game 2 score better than game 1?
5. Which chapter card was confusing, and what did they ignore entirely (candidates to cut)?
