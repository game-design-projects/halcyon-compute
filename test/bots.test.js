"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Bots = require("../bots/bots.js");

// Depth smoke check: thinking ahead must beat myopic greed, and both must beat doing nothing.
test("planner beats greedy beats idle (2 seeds)", () => {
  for (const seed of [11, 12]) {
    const idle = Bots.play(seed, "idle").worth, greedy = Bots.play(seed, "greedy").worth, planner = Bots.play(seed, "planner").worth;
    assert.ok(greedy > idle * 5, `seed ${seed}: greedy ${greedy} vs idle ${idle}`);
    assert.ok(planner > greedy * 1.1, `seed ${seed}: planner ${planner} vs greedy ${greedy}`);
  }
});

test("bots are deterministic", () => {
  assert.equal(Bots.play(3, "planner").worth, Bots.play(3, "planner").worth);
});
