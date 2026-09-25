"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Bots = require("../bots/bots.js");

// Depth smoke check: thinking ahead must beat myopic greed, and both must beat doing nothing.
test("planner beats greedy beats idle (2 seeds)", () => {
  for (const seed of [11, 12]) {
    // v2: compared on the game's score (founder equity value, SPEC §1), not raw net worth
    const idle = Bots.play(seed, "idle").score, greedy = Bots.play(seed, "greedy").score, planner = Bots.play(seed, "planner").score;
    assert.ok(greedy > idle * 5, `seed ${seed}: greedy ${greedy} vs idle ${idle}`);
    assert.ok(planner > greedy * 1.1, `seed ${seed}: planner ${planner} vs greedy ${greedy}`);
  }
});

test("bots are deterministic", () => {
  assert.equal(Bots.play(3, "planner").worth, Bots.play(3, "planner").worth);
});
