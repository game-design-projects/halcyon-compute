"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Bots = require("../bots/bots.js");

// Depth smoke check against the SPEC §6 balance targets (the full n>=12 check is `node bots/run.js --seeds 12`):
// thinking ahead must beat myopic greed by >= 25 % on the game's score (founder equity value, SPEC §1), idle ends far
// below the planner, greedy never goes bankrupt and the planner is never fired.
// v4 (contracts core): greedy > idle is no longer asserted per seed: at v4 margins a myopic player can end at or just
// below idle on a bad seed (n=12: 11/12 above idle, seed 11 ~0.85x; DECISIONS D48). The human-paced reference bots
// (Casual, Expert: what the pace chip shows) must beat idle and never go bankrupt.
const games = {};
for (const seed of [11, 12]) for (const p of ["idle", "greedy", "planner", "casual", "expert"]) games[`${seed}${p}`] = Bots.play(seed, p);

test("planner beats greedy by >= 25 % and idle ends below 5 % of the planner (score, 2 seeds)", () => {
  for (const seed of [11, 12]) {
    const idle = games[`${seed}idle`], greedy = games[`${seed}greedy`], planner = games[`${seed}planner`];
    assert.ok(idle.score < planner.score * 0.05, `seed ${seed}: idle ${idle.score} should be < 5 % of planner ${planner.score}`);
    assert.ok(planner.score > greedy.score * 1.25, `seed ${seed}: planner ${planner.score} vs greedy ${greedy.score}`);
  }
});

test("greedy is never bankrupt, the planner is never fired, idle survives; the human-paced bots finish too", () => {
  for (const seed of [11, 12]) for (const p of ["greedy", "planner", "idle", "casual", "expert"])
    assert.equal(games[`${seed}${p}`].over, "end", `seed ${seed} ${p}`);
});

test("the planner's actions are changed by most chapters' mechanics (SPEC §6, logged per game)", () => {
  for (const seed of [11, 12]) {
    const used = games[`${seed}planner`].used;
    const n = Object.keys(used).filter(k => used[k] > 0).length;
    assert.ok(n >= 14, `seed ${seed}: only ${n} chapters changed the planner's actions: ${JSON.stringify(used)}`);
    for (const k of ["ops", "fabric", "contracts", "facilities", "energy", "disrupt"]) assert.ok(used[k] > 0, `seed ${seed}: ${k} unused`);
  }
});

test("human-paced reference bots: Casual and Expert beat idle, Expert beats Casual on average, both act far less", () => {
  let c = 0, e = 0;
  for (const seed of [11, 12]) {
    const idle = games[`${seed}idle`], casual = games[`${seed}casual`], expert = games[`${seed}expert`], planner = games[`${seed}planner`];
    assert.ok(casual.score > idle.score && expert.score > idle.score, `seed ${seed}: casual ${casual.score}, expert ${expert.score}, idle ${idle.score}`);
    assert.ok(expert.score < planner.score, "a human-paced expert stays below the full-speed planner");
    assert.ok(casual.human && expert.human && casual.sessions > 50 && casual.sessions < 1800 / 6, `seed ${seed}: ${casual.sessions} sessions`);
    c += casual.score; e += expert.score;
  }
  assert.ok(e > c, `Expert ${e} vs Casual ${c}`);
});

test("bots are deterministic; greedy/planner with {human:true} are Casual/Expert", () => {
  assert.equal(Bots.play(11, "planner").worth, games["11planner"].worth);
  assert.equal(Bots.play(11, "greedy").worth, games["11greedy"].worth);
  assert.equal(Bots.play(12, "casual").score, games["12casual"].score);
  assert.equal(Bots.play(12, "greedy", { human: true }).score, games["12casual"].score);
  assert.equal(Bots.play(11, "planner", { human: true }).score, games["11expert"].score);
  assert.deepEqual(Object.keys(Bots.LABELS).sort(), ["casual", "expert", "greedy", "idle", "planner"]);
});
