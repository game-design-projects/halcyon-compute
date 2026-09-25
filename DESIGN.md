# Halcyon Compute: design notes

**Brief (Lecture 3):** make a game with strategic depth ("the more you think about the game the better you
should do"), and explain which characteristics it uses and which heuristics players learn. Game feel follows
Lecture 2 (see [docs/GAME_FEEL.md](docs/GAME_FEEL.md)). The full design contract is [docs/SPEC.md](docs/SPEC.md);
version history is in [CHANGELOG.md](CHANGELOG.md).

**The game:** you run a datacenter for 5 years (1800 days, about 15 minutes at 1x, pausable, up to 8x). You drag
hardware onto racks in up to 3 halls and decide what each rack runs, how it is powered, cooled, staffed, financed
and sold. **Score = founder equity value:** your ownership % × (net worth + 2 years of current profit) × reputation
factor. Seventeen chapters unlock the systems one at a time, simplest first. A sandbox mode unlocks everything on day 0.

| Ch. | Day | System | The decision it adds |
|---|---|---|---|
| 1 | 0 | Racks, cash, switches, web market | Where to put hardware; when a market is full (oversupply sells at 25 %) |
| 2 | 45 | Power: grid cap, per-rack cap, Eco/Std/Boost, grid tiers | Output vs power |
| 3 | 100 | GPUs and the roofline (compute vs bandwidth cards; training vs inference) | Which card goes with which workload |
| 4 | 170 | Seasons and heat: thermal inertia, inlet throttling, hot neighbours, coolers | Prepare for summer ahead of time; spread heat |
| 5 | 250 | Hardware generations (launches at d390/780/1170/1560, ~60-day rumours) | When to upgrade, when to sell |
| 6 | 330 | Operations: failures (age × heat), repairs, hiring, spares shelf | Staff and spares vs downtime |
| 7 | 420 | Network fabric: row spines, frontier-training clusters (≥12 GPUs), internet transit | Cluster training in a row (network) vs spread it out (heat) |
| 8 | 490 | Contracts: fixed-price offers with SLA and penalty; build-to-suit deals | Hedge price risk vs keep flexibility; don't oversell |
| 9 | 570 | Memory market: HBM price index, shortages (some scares are false), forward orders | Buy ahead into inventory vs wait; read which scares are real |
| 10 | 660 | Finance: credit line, leasing, tax with depreciation | Leverage before a price drop vs stay safe; lease what you'll replace |
| 11 | 750 | Facilities: Hall 2/3, outages, UPS + generator, CRAC upgrades | Insurance vs growth capex |
| 12 | 840 | Energy: volatile spot power, heat-wave spikes, PPA, solar + battery | Lock in price and green power vs flexibility |
| 13 | 930 | Environment: cooling mode (evaporative vs chiller, PUE), water, droughts, carbon | Cheap power vs water risk |
| 14 | 1020 | Investors: equity rounds, board targets (miss twice = fired), buyback | Dilution vs growth speed |
| 15 | 1110 | Reputation and PR: SLA misses, outages, drought water use, press | Protect reputation; PR only when there's no scandal |
| 16 | 1200 | Policy: carbon tax, efficiency mandate, export controls; votes with hinted odds, lobbying | Prepare before a policy passes vs wait for certainty |
| 17 | 1290 | Disruption: real vs hype accelerator startups (seeded), pilots, an Optane-style vendor pitch, a demand shock that may be real or hype, incumbent price war | Read biased information; pay for information |

## Characteristics used (from the lecture's list)

- **Time granularity: pausable real time.** Time flows, but the player can pause at any moment (space), and most
  actions have lead times: 6 days shipping (18 in a memory shortage), 2 days install, technicians as a shared
  queue, 45-day forward orders, 75–120-day hall builds. Pausing makes it a game of **strategy, not dexterity**:
  a slow player who thinks loses nothing. The lead times make it a game of **anticipation**.
- **Stochasticity: low per action, meaningful per game.** Everything is seeded and deterministic, with no dice on
  individual actions. Each seed draws its hidden truths: which startup is real, whether Nanofab dies, which memory
  scares are real, how the policy votes go, whether the demand shock is real, and when failures, outages, heat waves
  and droughts happen. Memorising one playthrough doesn't solve the next one.
- **Observability: imperfect, and biased on purpose.** Vendors show only their own past benchmarks ("no roadmap").
  Spec sheets list strengths only. VC pitches understate board targets. The truth arrives in three ways:
  indirect news ("sells its only fab", "fails to replicate"), paid measurement (pilot cards), and time.
  Generation launches are the one thing announced honestly.
- **Systems** (the lecture's four kinds):
  - *Conditional*: a rack throttles above 32 °C inlet; a rack without a switch earns nothing; missing a contract's SLA costs a penalty; missing two board targets gets you fired.
  - *Combination*: card × workload (roofline), training GPUs × a row spine (frontier cluster), PM-900 × a memory-bound rack, exotic card × tank, evaporative cooling × drought.
  - *Feedback loops*: revenue → hardware → revenue is positive. The negative loops are heat → throttling and failures, oversupply → quarter price, and SLA misses → reputation → worse offers.
  - *Resources*: cash, debt, kW, U, network, transit, technician time, cooling, water, market demand, reputation, equity.
- **Length of play:** a decision takes seconds, a session is a quarter (the quarter tally), and the full game is 20 quarters (sandbox has the same length).
- **Single player, "one-and-a-half"**: the market (rivals upgrading at launches, the incumbents' price war),
  vendors, investors and politicians act on you. The same-seed bots on the pace chip and the end screen act as
  asynchronous opponents.
- **Depth vs entropy:** the aim is to sit on the deep, structured side. Randomness is limited to hidden facts that
  *signals can reveal*.

## Heuristics players learn (and why they are good ones)

The lecture's test for a good heuristic: it applies at every stage, sits between gut feeling and brute force, and
compresses the game state usefully. Heuristic 1 is the backbone; the others are tactical.

1. **"Find the binding constraint."** It moves over the game: cash → switches/space → power → heat (summers) →
   staff/spares → demand → halls/grid → reputation. Spending on anything else is waste. It works at every stage and
   compresses the HUD into one question.
2. **"Match the card to the roofline."** Compute cards go on training, bandwidth cards on inference.
3. **"Heat is a forecast, not a reflex."** Coolers, Eco mode and chillers go in before late July, and hot racks go far apart.
4. **"When a scarce input limits you, rank options by output per unit of that input."** Per kW when power limits you, per U when space does.
5. **"Sell or lease the generation you'll replace; sell before the launch."**
6. **"Don't oversupply a market; don't oversell your capacity."** This covers spot demand and contract SLAs.
7. **"Lock prices before known drops."** A contract signed before a rumoured launch is a hedge; signed just after, it's a trap.
8. **"Buy insurance where the loss is fat-tailed."** Spares before failures cluster, UPS before outage season, a PPA when spot is spiking.
9. **"Cluster where it pays, spread where it burns."** Frontier training needs 12 GPUs on one spine; heat punishes packing.
10. **"A discount near a vendor's bad news is a liquidation."** (PM-900.)
11. **"Buy information before you bet."** Pilot first, then scale.
12. **"Early data can mislead; check for replication."** This covers the hype startup's early curve and the demand-shock preprint.
13. **"Dilute only for growth you can deliver."** Board targets turn equity into a constraint.
14. **"Prepare for policy by its signals, not its passage."** Carbon, PUE and export rules reward early movers.

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

## Playtest round 1 (AI personas, n = 1 each: weak signals)

Three sonnet playtesters (novice, strategy veteran, design critic) played full campaigns through the UI only
(`tools/playtest-driver.js`), and a read-only code review ran alongside. Details: [docs/playtests/SYNTHESIS.md](docs/playtests/SYNTHESIS.md).
**None of the three beat the greedy bot.** The depth measured by the bots wasn't reachable through the UI:
contracts were hard to discover, a rack without a switch was nearly silent, and nothing told the player mid-game
that they were falling behind. v0.3 fixed these: offers now appear on the main screen, a NO SWITCH badge marks
switchless racks, the pace chip runs both bots on your seed in a Web Worker, bankruptcy and runway warnings
appear, the cluster meter shows progress, chapters are re-spaced with plain-language cards, and the first event
of each system arrives as a decision card. **Not yet re-tested:** round 2 (ideally humans) should check whether
players now land between greedy and planner.

## Playtest questions (for people outside the group)
1. After one game, can they state at least 3 of the heuristics above in their own words?
2. Do they pause to think? When?
3. Where do they score relative to the greedy and planner bots, and does game 2 beat game 1?
4. Do they sign contracts before a launch? Do they pilot before scaling? Did they take the PM-900 fire sale?
5. Which chapter was confusing, and which system did they ignore entirely (candidates to merge or cut)?
6. Is the pace chip motivating or discouraging?
