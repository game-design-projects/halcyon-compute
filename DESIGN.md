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

- **Greedy** buys whatever raises income *right now* the most per dollar (≤ 200-day payback). It ignores seasons,
  launches, vendor risk and contracts, never sells, hedges or pilots. It does the obvious chores (transit for its
  traffic, auto-repair, one more technician when repairs pile up). It is the gut-feeling player.
- **Planner** plays the heuristics above across all 17 chapters with one value function: change in daily profit
  over a lookahead (150 days, or the rest of the game in the last 420), plus the final-quarter profit × 730 that the
  score counts, plus resale using the public launch calendar, minus the reputation cost of SLA misses. On top: it
  signs contracts it can serve (buying the capacity when that pays), builds grid 700 kW + Hall 2 when demand outruns
  the floor, buys UPS/solar/PPA, switches cooling for droughts, reads scare follow-ups, pilots exotic cards, reads
  the demand-disruption signal, and takes a VC round only when the board can no longer fire it. It sees only public
  state, news and its own pilots (never the seed's hidden truths).

`node bots/run.js --seeds 12 --ablate` (reports/depth.json). **n = 12 seeds (1–12) per row, one planner
implementation, score = founder equity value (SPEC §1).** The gap is a *lower bound* on depth: a better planner would
open it further, and a better greedy would close it. Weak signals, not proof.

| Variant | Greedy score (mean $k) | Planner score | Relative gap (mean / median / min) | Planner wins | Note |
|---|---|---|---|---|---|
| **Full game** | 11,609 | 120,416 | **+937 %** / +954 % / +543 % | 12/12 | net worth gap +339 % |
| No heat/seasons | 12,436 | 115,534 | +829 % | 12/12 | |
| No generations | 77,697 | 231,656 | +198 % | 12/12 | confounded: prices never fall, so greedy's never-sell strategy stops losing |
| No operations | 14,123 | 114,721 | +712 % | 12/12 | |
| No fabric (spines, frontier, transit) | 19,406 | 222,691 | +1,048 % | 12/12 | confounded: removes transit, a big late cost |
| **No contracts** | 10,109 | 56,018 | **+454 %** | 12/12 | the largest single drop |
| No memory market | 11,935 | 126,361 | +959 % | 12/12 | |
| No finance | 13,824 | 117,094 | +747 % | 12/12 | |
| No facilities | 12,708 | 103,525 | +715 % | 12/12 | |
| No energy | 12,406 | 90,060 | +626 % | 12/12 | |
| No environment | 11,110 | 111,677 | +905 % | 12/12 | |
| No investors | 11,527 | 108,504 | +841 % | 12/12 | |
| No reputation | 13,445 | 104,221 | +675 % | 12/12 | |
| No policy | 11,692 | 116,641 | +898 % | 12/12 | |
| No disruption | 13,224 | 149,795 | +1,033 % | 12/12 | |
| No network | 12,926 | 115,211 | +791 % | 12/12 | |
| No roofline (identical cards) | 1,589 | 54,634 | +3,338 % | 12/12 | confounded: both families become poor at inference; greedy bankrupt 4/12 |

Balance targets (SPEC §6) on the full game, n = 12: idle survives on every seed and ends at 0.5 % of the
planner's score; greedy is never bankrupt; the planner is never fired (0 in every row above); planner beats greedy on
12/12 seeds by at least +543 %. Every chapter changed the planner's actions in most games (games out of 12): racks,
power, GPUs, heat, generations, operations, fabric, contracts, memory, facilities, energy, reputation, disruption 12;
finance, investors, policy 11 (investors and policy still made an explicit decision, a decline or "don't lobby",
in the 12th); environment 10 (the other two seeds had no drought after chapter 13, so there was nothing to decide).
Timing: planner ≈3.5 s per game, greedy ≈0.6 s (single thread, n = 6 seeds).

What this suggests (tentatively):
- **Contracts carry the most depth**: removing them roughly halves the relative gap (+937 % → +454 %). They are the
  planner's main sink (it builds capacity for them) and its hedge before launches.
- **Energy, reputation, operations, facilities and finance each carry some** (gap falls to +626…+747 %); heat,
  investors, network, policy and environment a little (+791…+905 %). Differences of this size are within one
  standard deviation of the per-seed gap (±32M), so the ordering is a hypothesis, not a result.
- **Removing disruption, fabric or the memory market does not shrink the gap** (it grows slightly). For disruption
  and memory that means the planner's gain from them (pilots, dumping the doomed vendor, reading scares) is smaller than
  what the rest of the game offers; fabric is confounded (transit is a large late cost for both bots). **Don't cut
  any of them on this evidence**; the next test is a cleaner ablation (e.g. fabric without the transit cost) and
  playtests.
- **Generations and roofline ablations are confounded** (they change the whole economy), as before.
- **The size of the gap is itself a caveat.** Most of it comes from the endgame: the planner builds run-rate for the
  score's earnings multiple and replaces old cards, while greedy never sells and ends running loss-making old
  hardware. A human in between these two is the interesting case, which only playtests can show.
- **Not met: idle cash.** Both bots hold more than $2M for ~3.4 years (planner 1,256 days on average). The planner
  reinvests almost everything it can, but markets are demand-bound and the floor caps at two halls. No constants-only
  change we tried fixed it without bankrupting greedy (`.claude/state/diagnosis-idle-cash.md`).

The end screen of every game replays the same seed with both bots, so each playtester sees how they
compare with gut-feeling play and with thinking-ahead play.

## Playtest questions (to run with people outside the group)
1. After one game, can they state at least 3 of the heuristics above in their own words?
2. Do they pause to think? When?
3. In game 2, do they pilot before scaling exotic hardware? Did they buy the PM-900 fire sale?
4. Where do they score between the greedy and planner bots, and does game 2 score better than game 1?
5. Which chapter card was confusing, and what did they ignore entirely (candidates to cut)?
