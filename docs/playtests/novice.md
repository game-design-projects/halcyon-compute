# Halcyon Compute — Novice Playtest (n=1, AI persona, weak signal)

Persona: casual mobile/PC gamer (Stardew, Mini Metro), never played a tycoon/management
game, no datacenter/GPU/roofline background. Played honestly from what the UI showed,
no source reading, no insider knowledge. Seed 101.

**Result: went bankrupt on Jun 15, Y5 (day ~1626 of 1800), before the campaign's
natural end.** The driver's `/shot` and `/text` calls never returned a non-empty
`errors` array during the session — no crash-level bugs found, but see "Bugs" below
for UI/interaction issues.

## 1. Session log (first person, key moments)

- **Day 0 (Jan 1, Y1).** Main menu. Picked "New campaign", seed already 101. Landed
  on Chapter 1 "Racks and cash": two racks, $400k, web demand 30/serve 16, told to
  add web servers and that "every rack needs a switch." Screenshot: `shots-novice/01_newcampaign.png`.
- **Day ~5.** Dragged a "Tern web server" card onto rack A1. It worked first try —
  got a toast "Tern web server ordered for A1, online in 8 days." Felt good, drag-and-drop
  was intuitive. `shots-novice/02_afterdrag1.png`.
- **Day ~13-29.** Filled out A1/A2 with a second server + two switches. Cash dropped
  from $400k to $337k. `shots-novice/03_afterdrags.png`.
- **Day 32 (Feb 1, Y1), Chapter 2 "Power".** Explains Eco/Standard/Boost modes and grid
  upgrade. Clear enough, dismissed. `shots-novice/04_chapter2_power.png`.
- **Day 60 (Mar 1, Y1), Chapter 3 "GPUs and the roofline".** This is where jargon hit
  hard: "Kestrel C = compute, Heron M = bandwidth", "Throughput = min(compute, bandwidth
  x intensity)". As a novice I have no idea what "roofline" or "memory-bound" mean — I
  just looked at the little chart in the rack panel and trusted it. GPU cards cost
  $288k-$320k, i.e. most of my ~$350k cash. `shots-novice/05_chapter3_gpu.png`.
- **Day ~240 (Sep 1, Y1).** Bought my first GPU rack (Kestrel C1, training) for $288k,
  dropping cash to $100k. Discovered the rack showed "Network short: 0 of 4 needed" —
  it needed a *switch* just like the web racks did, which wasn't obvious since the
  chapter card didn't repeat that rule. Had to drag a Ferro switch onto it separately;
  the fix took a couple of in-game days to "take" (technician install lag).
  `shots-novice/09_gpu_bought.png`.
- **Day ~300 (Nov 1, Y1), Chapter 6 "Operations".** Introduces hardware failures,
  repairs, spares shelf, hire/fire technicians. I never actually hired anyone or
  touched the spares shelf — the game seemed to auto-repair by default ("auto-repair"
  label in the top bar) so I assumed it was handled. This turned out to be a costly
  assumption (see Bugs/Confusions and the final score breakdown).
- **Day ~420 (Mar 1, Y2), Chapter 7 "Network fabric".** Asks for 12+ GPUs clustered
  with a row spine to sell "frontier training" at 1.6x. I had exactly 1 GPU rack. Goal
  felt wildly out of reach for where I was economically — first moment I felt behind
  rather than following the curve.
- **Day ~480 (May 1, Y2), Chapter 8 "Customers and contracts".** Opened the contracts
  drawer and found a queue of 10 unread offers going back to April. Looked at the one
  "waiting" offer: Volga Data wanted 32 training units for $192k fit-out, and my single
  rack only had "8.0 uncommitted training output" — the contract asked for 4x my
  capacity. Declined. `shots-novice/14_contracts_drawer.png`.
- **Day ~670 (Nov 1, Y2), Chapter 10 "Finance".** Debt/lease introduced. Switched
  catalog to Lease mode (no upfront cost) and leased a Heron M1 for an inference rack —
  cheap way to diversify without draining cash.
- **Day ~671.** Leased Heron M1 landed on rack A4 but the rack defaulted to
  **Training** role even though Heron M1 is the bandwidth/inference card — I had to
  manually click the "Inference" toggle in the side panel to fix it, and it needed its
  own switch too before "Network short: 0 of 4" cleared. Confusing default.
  `shots-novice/19_a4_panel.png`, `shots-novice/20_a4_inference.png`.
- **Day ~730 (May 1, Y3).** A quarterly report toast popped with confetti: "Q1 Y3
  closed: Revenue +$394k, Costs -$365k, Profit $29k." This was a genuinely nice,
  legible feel-good moment — first time the game told me plainly "you did fine this
  quarter." `shots-novice/21_a4_after_click.png`.
- **Day ~945 (Aug 1, Y3), Chapter 13 "Environment".** Landed mid-heatwave: a red
  banner "Heat wave: spot power x2.39, Cooling -15kW per hall, 3d left" was already
  live, cash burn hit -$3.4k/day, score cratered from $1.42M to $233k in one fast-
  forward jump. Felt punishing and out of my control — I hadn't built any weather
  mitigation yet because I didn't know it existed until this chapter card told me.
  `shots-novice/22_chapter13_environment.png`.
- **Day ~1035 (Nov 1, Y3), Chapter 14 "Investors".** First time the game explicitly
  said "Score = your equity value" — this cleared up a running confusion about the two
  dollar numbers in the top bar (see Confusions). Declined VC offers throughout to keep
  100% ownership. `shots-novice/23_chapter14_investors.png`.
- **Day ~1145 (Feb 1, Y4), Chapter 15 "Reputation and PR".** Noticed reputation had
  quietly slid from 60 to 58 without me doing anything I was aware of. News mentioned
  recurring "Ferro 48P switch failed in A1" events (Apr, Sep, Dec of Y3) — the same
  part kept failing repeatedly and I never intervened.
- **Day ~1310 (Aug 1, Y4), Chapter 17/17 "Something new".** Final chapter: immersion
  tanks, pilot hardware, "two startups, one is real." By now reputation was 41 (down
  from 60), cash $105k and falling. Bought one more web rack (B1) to try to shore up
  income — this instead helped trigger the death spiral (see below).
  `shots-novice/27_added_b1.png`.
- **Day ~1626 (Jun 15, Y5) — GAME OVER.** Fast-forwarding through what I expected to
  be quiet time, the game suddenly ended with a **"Bankrupt"** screen: net worth -$76k,
  score (founder equity) **-$70k**. This was well before day 1800 — the campaign ended
  itself early because "cash fell below your credit line." I did not choose to end the
  game. `shots-novice/28_bankrupt_end.png`.

## 2. Final score

**Bankrupt ending, day ~1626/1800 (Jun 15, Y5). n=1 run, one seed, one strategy — not
representative of the game's balance in general.**

| | Founder equity (score) |
|---|---|
| **You (novice)** | **-$70k** |
| Greedy bot | $4.93M |
| Planner bot | $114.36M |

Score breakdown shown on screen: Net worth -$76k, + Earnings multiple $0k, x Reputation
factor 0.92 (44 rep), x Ownership 100% = -$70k. Contracts signed/fulfilled/short: 0/0/0
(I never signed a single contract the whole game). Carbon 467t, water 20,273 m³.

The end screen's own "three biggest lessons" (its diagnosis, not mine):
1. Lost $260k to **failed hardware downtime**, worst in Y5 spring ($137k).
2. Lost $23k to **grid outages**, worst in Y4 autumn ($15k).
3. Lost $11k to **shortage delays**, worst in Y3 winter ($11k).

Screenshot: `docs/playtests/shots-novice/28_bankrupt_end.png`.

## 3. Confusions (every time I didn't understand what to do or why)

- **Day 60, Chapter 3.** "Throughput = min(compute, bandwidth x intensity)" and
  "memory-bound / compute-bound" roofline language — zero context for what these mean
  or why I should care, as someone who's never heard "roofline" before. I just trusted
  the little chart without understanding it. `shots-novice/05_chapter3_gpu.png`.
- **Day ~240.** New GPU rack silently required a switch just like web racks did, but
  the game didn't remind me — I only noticed because the side panel said "Network
  short: 0 of 4 needed" in red-ish text. Easy to miss if you don't check every rack's
  side panel after every purchase.
- **Day ~671.** Leased inference card (Heron M1) landed on a rack that **defaulted to
  Training role**, silently mismatched to the card type. Had to notice and manually
  flip a toggle. As a novice I would not have known to check this.
- **Throughout, score vs. worth.** The top bar shows two dollar figures side by side
  ("$X score · worth $Y") that frequently disagree and sometimes swap which is bigger
  (score > worth early on, worth > score later, e.g. day ~1310: "$164k score · worth
  $181k"). Not explained until Chapter 14 (day ~1035) said "Score = your equity
  value" — for the first ~1000 days I had no idea what these two numbers meant or why
  they diverged.
- **Day ~945, heatwave.** A -$3.4k/day cash-burn spike from a weather event that I had
  no prior warning of and no built mitigation for, because the "Environment" chapter
  that explains cooling/heatwaves is Chapter 13 — it only unlocked *at* the same moment
  the heatwave was already 3 days from ending. Felt like the game taught the lesson
  after the exam.
- **Reputation drift.** Reputation fell from 60 to 41 over ~Y3-Y4 and I never got a
  clear single moment telling me why (no "-2 rep: SLA miss" style toast that I noticed
  — it seemed to erode quietly in the background from outages/failures).
- **The ending itself.** The game just stopped with a "Bankrupt" modal mid
  fast-forward. I had no warning banner, no "you are close to bankruptcy" alert before
  it happened — I was actively trying to shore up income by buying a new web rack
  (`27_added_b1.png`) in the same fast-forward stretch that ended the game.

## 4. Bugs

- No JSON `errors` array from the driver was ever non-empty across ~30 shot/click/drag
  calls — no hard crashes encountered.
- One driver-side annoyance (not a game bug): `POST /click` with `{"selector":"text=Inference"}`
  failed with `"not visible: text=Inference"` because the legend label "Inference" and
  the toggle button "Inference" both match `text=`, and had to fall back to raw x/y
  coordinates. Similarly `[aria-label=Close]` CSS selector syntax errored and had to be
  replaced with coordinate clicks. This is a test-harness selector-uniqueness issue,
  not something the player would hit, but worth flagging for anyone scripting against
  this UI.
- **Possible design bug / harsh cliff, not a technical bug:** the transition from a
  seemingly playable state (day ~1310, cash $105k, 44 rep, actively buying racks) to
  outright bankruptcy by day ~1626 happened inside a single unattended fast-forward
  window with no intermediate warning screen. Whether this is "working as intended"
  (tycoon games can and should let you go bust) or a missing warning affordance is a
  design judgment call, not something I can verify from the outside — flagging as a
  weak signal (n=1) for the design team to check against their intended difficulty
  curve.

## 5. Fun / not fun

**Felt good:**
- The very first drag-and-drop (card onto rack) worked immediately and gave clear
  toast feedback ("ordered for A1, online in 8 days") — great onboarding moment.
- The Q1 Y3 quarterly report toast with confetti and a clean Revenue/Costs/Profit
  breakdown was the single most legible "how am I doing" moment in the whole game.
- Leasing vs buying felt like a real, understandable lever once introduced (no upfront
  cost, pay per day) — good the game surfaced this before big GPU purchases got scary.

**Not fun / overwhelming:**
- Chapter 3's GPU/roofline jargon dump, with zero ramp-up, right when I only had two
  green web racks running. Compute/bandwidth/intensity/throughput all landed in one
  card.
- The contracts drawer piling up ~10 unread offers by the time I first opened it
  (Chapter 8) was overwhelming — I couldn't evaluate most of them because I didn't
  understand the "uncommitted output" units well enough to know if I could fulfill
  them, so I declined everything I saw and never signed a single contract all game.
- The heatwave/HBM-shortage/policy news items scroll by constantly in a long feed and
  it's hard to tell which ones need action versus which are just flavor text — by
  the end the news feed was 20+ items long and I was skimming, not reading.
- Losing across a fast-forward stretch with no chance to react felt bad, not
  challenging-in-a-good-way — by the time I saw the "Bankrupt" screen there was
  nothing left to try.

## 6. Strategies/heuristics I think I learned (in my own words)

- Every rack needs a switch, whether it's web, training, or inference — don't forget
  this on new rack types just because you remembered it for the first ones.
- Check the rack's role toggle (Training/Inference) after adding a card — it doesn't
  auto-match the card's actual specialty.
- Leasing is a safer way to try new hardware than buying outright when cash is tight,
  since it avoids draining your buffer in one shot.
- Big contracts/build-to-suit deals scale to capacity far beyond a beginner's setup
  (e.g. 32-77 units when I had single-digit capacity) — they seem aimed at a much
  later, larger base than where I was.
- Don't ignore "Operations"/repairs — I assumed "auto-repair" meant I was covered, and
  it apparently was not enough; failed hardware downtime was my single largest loss
  ($260k) and I never once visited the spares shelf or hired a technician.
- Watch cash burn rate (the small $/day number next to your cash total), not just the
  headline cash figure — mine went from "seems fine" to bankrupt in what felt like one
  unattended stretch, and the burn-rate number was the earlier warning sign I ignored.

## 7. Top 5 recommendations, ranked

1. **Add an explicit bankruptcy warning before the cliff.** A persistent low-cash /
   negative-runway banner (e.g. "12 days of cash left at current burn") well before
   the game-over screen, so a losing run can be noticed and corrected instead of
   discovered only at the "Bankrupt" modal.
2. **Introduce "Operations"/repairs and spares-shelf mechanics earlier or more
   forcefully**, since failed-hardware downtime was the #1 cause of loss ($260k) in
   this run and the chapter that explains it (6 of 17) came and went without any
   nudge to actually use the spares shelf or hire technicians — "auto-repair" reads as
   "you're covered" when apparently it isn't fully.
3. **Clarify score vs. worth from turn one**, not at Chapter 14. Two dollar figures
   that disagree and sometimes invert which is larger, unexplained for the first
   ~1000 in-game days, was a standing point of confusion the whole early-to-mid game.
4. **Reorder or foreshadow the Environment/heatwave chapter** so mitigation knowledge
   (chillers, PPAs, solar) arrives before the first heatwave event rather than
   simultaneously with it — Chapter 13 unlocked with only 3 days left on an
   already-active heatwave banner.
5. **Default new hardware to the matching workload role** (an inference card landing
   on a rack pre-set to Training) and **surface a contextual reminder about switches**
   when a rack shows "Network short" right after a purchase, instead of relying on the
   player to notice the side panel on their own.
