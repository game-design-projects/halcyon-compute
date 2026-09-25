# Playtest synthesis, round 1 (2026-09-24)

Sources: 3 AI persona playtests (sonnet; n=1 each, seeds 101/202/303, played only through the UI via
`tools/playtest-driver.js`) + 1 read-only code review. **These are weak signals**: AI players are not humans. A finding
counts as stronger only when ≥2 independent testers hit it, or when I reproduced it myself.

| Tester | Result | Score | Greedy | Planner |
|---|---|---|---|---|
| Novice (`novice.md`) | bankrupt d1626 | −$70k | $4.93M | $114.36M |
| Veteran (`veteran.md`) | finished | $3.19M | $4.11M | $38.33M |
| Design critic (`designer.md`, grade B) | run 1 bankrupt d460; run 2 finished | $257k | $15.61M | $142.28M |

**The main result:** none of the 3 testers beat the greedy bot. The planner is 10–500× ahead. Depth exists (the bots prove
it) but humans cannot reach it through the current UI: the decision-heavy systems are hard to discover, and nothing tells
the player mid-game that they are falling behind.

## Findings (priority, evidence strength)

P0. **Contracts are hard to discover.** The veteran signed 0 contracts in 5 years ("no discoverable accept/decline UI"); the
critic signed 0. Contracts carry the most measured depth (ablation). *2 testers.*
P0. **A rack with no switch is nearly silent.** The novice asked why GPU racks needed a switch; the critic's racks sat at
"Network short 0/0.5" for months and they misattributed it to transit. I verified from the critic's screenshot
(`shots-designer/24_a3panel.png`, rack A5 = 1 server, no switch). The rules are correct; the feedback is too weak. The
critic's "transit is a hidden drain before ch7" claim did **not** reproduce: I checked rule-level before ch7 and
transitF = 1. *2 testers + verified.*
P0. **No mid-game pace signal.** Testers only learned at the end screen that they were 100× behind. Suggestion: ghost bots
running on the same seed alongside the player, shown as a HUD pace chip. *Critic, supported by all 3 outcomes.*
P1. **No warning before bankruptcy.** It arrived during fast-forward with no warning. *Novice + critic run 1.*
P1. **The frontier cluster has no progress meter.** The veteran built 6/12 GPUs and got nothing, with no feedback. *Veteran.*
P1. **Chapter pacing is front-loaded.** 4 systems in the first 120 days; nothing new in the last 490 days. *Critic; the novice was
overwhelmed by ch3 jargon.*
P1. **Chapter 3 jargon** (roofline) needs plain language plus a picture. *Novice.*
P1. **Workload default:** a GPU placed in an empty rack keeps the rack's workload (train) even when it is an inference card.
*Novice.*
P2. **Drag lost when a chapter dialog opens mid-drag** (no feedback). *Veteran, unverified.*
P2. **Sell-by-drag failed 3×.** *Critic, unverified; may be driver coordinates.*
P2. **Unexplained −$167k while paused after clicking a legend chip.** *Veteran, unverified. Likely a scheduled charge (tax at
quarter close, a contract penalty, a hire) shown without a toast. The toast/ledger should explain every discrete cash jump.*
P2. **Skippable chapters:** a passive 6-rack build compounds fine; ops/policy/pilots/memory market can be ignored. *Veteran +
critic.* Design response: make each chapter's first event a decision the player must answer (accept/decline card),
not just a modal.
P2. **DESIGN.md is stale** (still describes the v1 6-chapter/3-year game). *Critic.*
P3. **Code review (low severity):** lease billing stops at the return action instead of at job completion (1 free day);
grid tier 4 is purchasable without Hall 3.

## What worked (keep)
The roofline visualisation; the end-screen bot comparison + lessons + "behind the curtain" ("the single best anti-slop
decision"); juice that carries information (floating money, undo toast, cash gauge pulse, quarter toast); seed-consistent
narrative payoffs; the network-fabric cluster decision ("best decision in the game", veteran).
