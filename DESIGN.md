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

- **Greedy** buys whatever raises income *right now* the most per dollar. It ignores seasons, launches
  and vendor risk, never sells, and never pilots. It is the gut-feeling player.
- **Planner** plays heuristics 1–9 above: it looks 8–150 days ahead with its current beliefs.

`node bots/run.js --seeds 12 --ablate`. **n = 12 seeds per row, one planner implementation.** The gap
is only a *lower bound* on depth, since a better planner would open it further. These are weak signals, not proof.

| Variant | Greedy (mean $k) | Planner (mean $k) | Gap (planner − greedy) | Planner wins |
|---|---|---|---|---|
| Full game | 16,083 | 21,912 | +5,829 ± 1,389 (**+36 %**) | 12/12 |
| No heat / seasons | 16,852 | 21,812 | +29 % | 12/12 |
| No generations | 28,332 | 38,834 | +37 % | 12/12 |
| No disruption | 19,936 | 23,798 | **+19 %** | 12/12 |
| No network | 15,661 | 21,925 | +40 % | 12/12 |
| No roofline (both cards made identical) | 9,547 | 17,525 | +84 % | 12/12 |

What this suggests (tentatively):
- **Disruption carries the most depth** here: removing it roughly halves the relative gap (36 % → 19 %).
- **Heat adds some** depth (36 % → 29 %).
- **Network adds none.** It is a rule both bots follow, not a decision, so it is a cut candidate if the
  scope needs trimming.
- **The generations and roofline ablations are confounded.** "No generations" removes the price drops, so
  everyone gets richer. The "identical cards" ablation changed the economy too: both cards became poor at
  inference. These rows need cleaner ablations before we conclude anything. **Don't cut either mechanic on
  the strength of these numbers.**
- Idle play (never touching anything) ends at about $0.6M, so the actions matter a lot.

The end screen of every game replays the same seed with both bots, so each playtester sees how they
compare with gut-feeling play and with thinking-ahead play.

## Playtest questions (to run with people outside the group)
1. After one game, can they state at least 3 of the heuristics above in their own words?
2. Do they pause to think? When?
3. In game 2, do they pilot before scaling exotic hardware? Did they buy the PM-900 fire sale?
4. Where do they score between the greedy and planner bots, and does game 2 score better than game 1?
5. Which chapter card was confusing, and what did they ignore entirely (candidates to cut)?
