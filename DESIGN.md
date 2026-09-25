# Halcyon Compute: design notes

**Brief (Lecture 3):** make a game with strategic depth ("the more you think about the game the better you
should do"), and explain which characteristics it uses and which heuristics players learn. Game feel follows
Lecture 2 (see [docs/GAME_FEEL.md](docs/GAME_FEEL.md)). The full design contract is [docs/SPEC.md](docs/SPEC.md);
version history is in [CHANGELOG.md](CHANGELOG.md).

**The game:** you run a datacenter for 5 years (1800 days, about 15 minutes at 1x, pausable, up to 8x). **All money
comes from contracts (v4):** customers post offers on an order board; you sign, build the capacity before the start date,
deliver against an SLA, and get paid. Hardware with no contract earns nothing. You drag hardware onto racks in up to 3 halls
and decide what each rack runs, how it is powered, cooled, staffed, financed and sold. **Score = founder equity value:**
your ownership % × (net worth + 2 years of current profit) × reputation factor. Seventeen chapters unlock the systems one at a
time, simplest first, **when the player reaches each chapter's milestone** (not on a calendar). A sandbox mode unlocks
everything on day 0.

| Ch. | Unlocks when (earliest day) | System | The decision it adds |
|---|---|---|---|
| 1 | start | Racks, switches, the order board: web hosting contracts, a starting customer, rack mode Off | Which offers to sign; build before the start date; park idle hardware |
| 2 | 2 offers signed, 4 racks, or >35 % of the grid (d20) | Power: grid cap, per-rack cap, Eco/Std/Boost, grid tiers | Output vs power |
| 3 | cash for a GPU + switch, or 2 contracts done (d60) | GPUs and the roofline; inference serving contracts and training jobs (deadline, paid on completion) | Which card for which contract; serving (daily pay) vs jobs (lump sum, deadline) |
| 4 | 2 GPUs and summer within 60 days (d100) | Seasons and heat: thermal inertia, inlet throttling, hot neighbours, coolers | Keep a buffer for summer; spread heat |
| 5 | 4 GPUs and a launch within 75 days (d150) | Hardware generations (launches d390/780/1170/1560, ~60-day rumours) | Lock long contracts before a launch; when to upgrade |
| 6 | 30 devices or 8 GPUs (d200) | Operations: failures (age × heat), repairs, hiring, spares shelf | Staff and spares vs missed deliveries |
| 7 | 8 training GPUs or 14 GPUs (d250) | Network fabric: row spines, frontier training jobs (≥12 GPUs on a spine, 1.6×), internet transit | Cluster training in a row (network) vs spread it out (heat) |
| 8 | 5 contracts done (d300) | **Long-term deals**: build-to-suit (fit-out capex, 45-day lead, 3× penalty) | Commit cash and capacity for years: hedge vs trap |
| 9 | 10 GPUs ordered (d350) | Memory market: HBM price index, shortages (some scares are false), forward orders | Buy ahead into inventory vs wait; read which scares are real |
| 10 | $500k revenue in 90 days, or owing capacity without cash (d400) | Finance: credit line, leasing, tax with depreciation | Leverage to deliver vs stay safe; lease what you'll replace |
| 11 | Hall 1 ≥80 % used or grid ≥85 % (d450) | Facilities: Hall 2/3, outages, UPS + generator, CRAC upgrades | Insurance vs growth capex |
| 12 | power ≥ ⅓ of costs (d500) | Energy: volatile spot power, heat-wave spikes, PPA, solar + battery | Lock in price and green power vs flexibility |
| 13 | a heat wave (d550) | Environment: cooling mode (evaporative vs chiller, PUE), water, droughts, carbon | Cheap power vs water risk |
| 14 | $2M revenue in 180 days (d600) | Investors: equity rounds, board targets (miss twice = fired), buyback | Dilution vs growth speed |
| 15 | a missed delivery streak or an outage (d650) | Reputation and PR: SLA misses, outages, drought water use, press | Protect reputation; PR only when there's no scandal |
| 16 | 2 t CO₂ a day (d700) | Policy: carbon tax, efficiency mandate, export controls; votes with hinted odds, lobbying | Prepare before a policy passes vs wait for certainty |
| 17 | knowing ch5, from d1200 | Disruption: real vs hype accelerator startups (seeded), pilots, an Optane-style vendor pitch, a demand shock that may be real or hype, incumbent price war | Read biased information; pay for information |

At most one chapter unlocks per 30 days; a player who is building (2+ GPUs) but stuck on a trigger gets the next chapter
after 240 days. An idle player stays in chapter 1 (there is nothing to teach them).

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
  - *Conditional*: a rack throttles above 32 °C inlet; a rack without a switch earns nothing; hardware with no contract earns nothing; below a contract's SLA every missing unit pays a penalty, and 20 missed days in a row lose the customer; a late training job pays a daily fee and is cancelled 20 days late; missing two board targets gets you fired.
  - *Combination*: card × workload (roofline), training GPUs × a row spine (frontier cluster), PM-900 × a memory-bound rack, exotic card × tank, evaporative cooling × drought.
  - *Feedback loops*: contracts → cash → hardware → bigger offers (they scale with what you can deliver) is positive. The negative loops are heat → throttling and failures → missed deliveries, a full market → no offers, and SLA misses → penalties, walk-outs and reputation → fewer, cheaper offers. Served customers offer renewals (a loop that rewards reliability).
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
6. **"Don't sign what you can't deliver; keep a buffer for failures and summer."** The SLA leaves 5–10 % slack; heat,
   failures and droughts eat it. The planner keeps headroom per unlocked risk.
7. **"Lock long contracts before known drops."** Signed prices never move; new offers follow the index, which falls at
   every launch. A long contract signed before a rumoured launch is a hedge; signed just after, it's a trap.
7a. **"Idle capacity is waste: match capacity to backlog."** Build what you owe (plus a buffer), park what serves nobody.
7b. **"Training deadlines need compute, serving needs bandwidth; jobs pay late."** Match the card to the contract kind and
   mind the cash flow: a training job pays only on completion.
7c. **"Keep your customers."** A customer served at SLA offers a renewal; one missed for 20 days walks away (and the
   cheapest contract is not the least valuable: the starting customer lasts the whole game).
8. **"Buy insurance where the loss is fat-tailed."** Spares before failures cluster, UPS before outage season, a PPA when spot is spiking.
9. **"Cluster where it pays, spread where it burns."** Frontier training needs 12 GPUs on one spine; heat punishes packing.
10. **"A discount near a vendor's bad news is a liquidation."** (PM-900.)
11. **"Buy information before you bet."** Pilot first, then scale.
12. **"Early data can mislead; check for replication."** This covers the hype startup's early curve and the demand-shock preprint.
13. **"Dilute only for growth you can deliver."** Board targets turn equity into a constraint.
14. **"Prepare for policy by its signals, not its passage."** Carbon, PUE and export rules reward early movers.

## Evidence of depth (bots)

Two scripted players share the simulation core (`bots/bots.js`), so we can measure how much thinking pays:

- **Greedy** signs any offer that pays for the cards it needs beyond today's free capacity within 300 days (judging each
  offer against the same free capacity, so a batch can overcommit), if the cards fit and it keeps 15 days of bills in the
  bank; it buys whatever raises income *right now* per dollar, parks racks that serve nobody, and sells a part that loses
  money *today*. It ignores seasons, launches, failures, vendor risk and cash flow, and never hedges or pilots.
- **Planner** plays the heuristics above across all 17 chapters with one value function: change in economic profit (cash
  profit + training-job progress) over a lookahead (150 days, or the rest of the game in the last 420), plus the
  final-quarter profit × 730 that the score counts, plus resale using the public launch calendar, minus the reputation cost of
  SLA misses and the revenue lost when a customer walks. It values offers against a *pipeline belief* (idle capacity would
  find contracts at 85 % of the index, up to open demand, after the launch calendar), keeps headroom over SLA-required units
  per unlocked risk, may buy up to 10 cards (30 for build-to-suit) to take an offer, and reads signals as before. It sees only
  public state, news and its own pilots.
- **Human-paced Casual and Expert** (v4, what the pace chip and end screen show): greedy and planner under a person's
  attention budget — a decision session every 12–18 days (Expert 8–12) plus one 3–7 days after a new offer, failure or
  chapter card; 1–2 decisions per session (Expert 2–3); new mechanics used 20–40 days after their card; Casual misjudges values
  by ±15 % and looks at 3 racks at a time.

`node bots/run.js --seeds 12 --ablate` (reports/depth.json, v4 balance: contract premium 1.2× the index, build-to-suit every
~40 days). **n = 12 seeds (1–12) per row, one implementation of each bot, score = founder equity value (SPEC §1).** The gap is
a *lower bound* on depth. Weak signals, not proof.

| Variant | Greedy score (mean $k) | Planner score | Relative gap (mean / median / min) | Planner wins | Note |
|---|---|---|---|---|---|
| **Full game** | 6,213 | 59,281 | **+854 % / +1,082 % / +186 %** | 12/12 | net worth gap +718 % |
| No heat/seasons | 10,095 | 72,376 | +617 % / +664 % / +110 % | 12/12 |  |
| No generations | 29,273 | 170,253 | +482 % / +526 % / +261 % | 12/12 | confounded: prices never fall |
| No operations | 13,504 | 82,579 | +512 % / +404 % / +144 % | 12/12 |  |
| No fabric | 25,039 | 118,440 | +373 % / +375 % / +106 % | 12/12 | confounded: also removes transit |
| **No contracts** | 34,771 | 69,456 | **+100 % / +89 % / +31 %** | 12/12 | a flat-rate buyer at index × 1.2 up to demand; no board |
| No memory market | 7,702 | 78,199 | +915 % / +893 % / +390 % | 12/12 |  |
| No finance | 9,477 | 49,586 | +423 % / +550 % / +18 % | 12/12 | greedy bankrupt 3/12 |
| No facilities | 4,864 | 55,125 | +1,033 % / +1,866 % / +212 % | 12/12 | greedy bankrupt 1/12 |
| No energy | 8,107 | 46,077 | +468 % / +601 % / +146 % | 12/12 |  |
| No environment | 5,467 | 50,805 | +829 % / +1,011 % / +278 % | 12/12 | greedy bankrupt 1/12 |
| No investors | 7,249 | 54,212 | +648 % / +687 % / +160 % | 12/12 |  |
| No reputation | 12,235 | 66,637 | +445 % / +519 % / +178 % | 12/12 |  |
| No policy | 7,474 | 59,927 | +702 % / +607 % / +273 % | 12/12 |  |
| No disruption | 8,793 | 74,603 | +748 % / +1,145 % / +228 % | 12/12 |  |
| No network | 11,989 | 65,263 | +444 % / +412 % / +216 % | 12/12 |  |
| No roofline | 2,987 | 20,085 | +572 % / +785 % / +134 % | 12/12 | confounded: both families poor at inference |

Human-paced, full game, n = 12: **Casual 5,205** (877–11,397), **Expert 17,013** (4,900–35,593); Expert beats Casual on 10/12,
Casual beats idle on 12/12, none bankrupt or fired.

Balance targets (SPEC §6) on the full game, n = 12:
- **Idle** (only the starting customer) survives on every seed and ends at 1.3 % of the planner's score.
- **Greedy** is never bankrupt; it ends below idle on 1/12 seeds (seed 11), which SPEC §6 allows (DECISIONS D52).
- **The planner** is never fired and beats greedy on 12/12 seeds by at least +332 %.
- **Idle cash** (the planner's longest stretch above $2M, mean over seeds) is **493 days: not met** (target < ~365). It is
  offer-flow-bound late in the game; see DECISIONS "v4 contracts core" (Open).
- **Chapter coverage** (games out of 12 where the chapter changed the planner's actions): 15 chapters 12/12; environment 7/12
  (drought-dependent); investors 8/12 (12/12 counting explicit declines).
- **Timing:** planner ≈4.4 s per game, greedy ≈1.5 s (inside 8 parallel workers).

What this suggests (tentatively):
- **Contracts carry most of the depth now**: without them (a flat-rate buyer at the same average price) the relative gap
  falls from +1,051 % to +100 %, mostly because greedy does 7× better. Matching capacity to promises is where myopia is
  punished (overcommitting, late jobs, idle hardware between contracts, walk-outs). The planner does about as well either way.
- Heat, operations, fabric and reputation carry depth too (gap +459…+644 % without them); memory, policy and investors
  carry little (+756…+986 %). The per-seed spread is large (± $11–40M): the ordering is a hypothesis.
- **Greedy is weaker than in v3** (5.0M vs 7.7M) while the planner is similar (57.7M vs 61.8M): the contract loop widens the
  gap. A human is compared with Casual/Expert, not with the full bots.
- Generations, fabric and roofline ablations stay confounded (they change the economy).

The end screen of every game replays the same seed with Casual and Expert, so each playtester sees how they compare with a
casual and an expert *human-paced* player.

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
