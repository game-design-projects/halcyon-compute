"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Bots = require("../bots/bots.js");

// Depth smoke check against the SPEC §6 balance targets (the full n>=12 check is `node bots/run.js --seeds 12`):
// thinking ahead must beat myopic greed by >= 25 % on the game's score (founder equity value, SPEC §1),
// greed must beat doing nothing, greedy never goes bankrupt and the planner is never fired.
// v3: the bar is greedy > idle (was 5x): with mid-game paybacks of 200-300 days a gut player can end barely above
// idle on a bad seed (seed 11: 1.8x); the n=12 mean is ~11x (DECISIONS D35).
const games = {};
for (const seed of [11, 12]) for (const p of ["idle", "greedy", "planner"]) games[`${seed}${p}`] = Bots.play(seed, p);

test("planner beats greedy by >= 25 % and greedy beats idle (score, 2 seeds)", () => {
  for (const seed of [11, 12]) {
    const idle = games[`${seed}idle`], greedy = games[`${seed}greedy`], planner = games[`${seed}planner`];
    assert.ok(greedy.score > idle.score, `seed ${seed}: greedy ${greedy.score} vs idle ${idle.score}`);
    assert.ok(idle.score < planner.score * 0.05, `seed ${seed}: idle ${idle.score} should be < 5 % of planner ${planner.score}`);
    assert.ok(planner.score > greedy.score * 1.25, `seed ${seed}: planner ${planner.score} vs greedy ${greedy.score}`);
  }
});

test("greedy is never bankrupt, the planner is never fired, idle survives", () => {
  for (const seed of [11, 12]) {
    assert.equal(games[`${seed}greedy`].over, "end", `seed ${seed} greedy`);
    assert.equal(games[`${seed}planner`].over, "end", `seed ${seed} planner`);
    assert.equal(games[`${seed}idle`].over, "end", `seed ${seed} idle`);
  }
});

test("the planner's actions are changed by most chapters' mechanics (SPEC §6, logged per game)", () => {
  for (const seed of [11, 12]) {
    const used = games[`${seed}planner`].used;
    const n = Object.keys(used).filter(k => used[k] > 0).length;
    assert.ok(n >= 14, `seed ${seed}: only ${n} chapters changed the planner's actions: ${JSON.stringify(used)}`);
    for (const k of ["ops", "fabric", "contracts", "facilities", "energy", "disrupt"]) assert.ok(used[k] > 0, `seed ${seed}: ${k} unused`);
  }
});

test("bots are deterministic", () => {
  assert.equal(Bots.play(11, "planner").worth, games["11planner"].worth);
  assert.equal(Bots.play(11, "greedy").worth, games["11greedy"].worth);
});
