"use strict";
/* Late-collapse round (DECISIONS D75-D81, .claude/state/diagnosis-late-collapse.md):
 * D75 the score's earnings term = 730 x mean daily profit over the trailing K.EARN_WINDOW (365) days
 * D76 the planner's expansion reservation (mem.committed) is released after CFG.COMMIT_DAYS
 * D78 greedy/Casual keep GREEDY_BURN_DAYS of cash burn in reserve
 * D80/D81 GPU_ELASTIC and ANCHOR_STAYS are on by default
 * (D77 pilot tank on a full floor and D79 Expert idle cash are covered by test/bots.test.js: ch17 used on seeds 11/12,
 * Expert > Casual, nobody bankrupt) */
const test = require("node:test");
const assert = require("node:assert/strict");
const Sim = require("../js/sim.js");
const Bots = require("../bots/bots.js");
const K = Sim.K;

test("D75: the profit window is a trailing year and the score's earnings term averages it", () => {
  assert.equal(K.EARN_WINDOW, 365);
  const s = Sim.newGame(3, { sandbox: true });
  Sim.advance(s, 420);
  assert.equal(s.profitDays.length, 365, "one entry per day, trailing 365");
  const p = s.profitDays.reduce((a, x) => a + x, 0) / s.profitDays.length;
  const cv = (Sim.netWorth(s) + Math.max(0, p) * K.EARN_DAYS * K.EARN_MULT) * Sim.summary(s).repFactor;
  assert.ok(Math.abs(Sim.companyValue(s) - cv) < 1e-6 * Math.max(1, cv), `${Sim.companyValue(s)} vs ${cv}`);
  // the window follows K.EARN_WINDOW (90 = the v0.4.7 rule)
  const K0 = K.EARN_WINDOW; K.EARN_WINDOW = 90;
  try { Sim.advance(s, 1); assert.equal(s.profitDays.length, 90); } finally { K.EARN_WINDOW = K0; }
});

test("D78: the greedy/Casual reserve adds GREEDY_BURN_DAYS of today's cash burn", () => {
  const s = Sim.newGame(5, { sandbox: true });
  Sim.advance(s, 5);
  const st = Sim.stats(s), base = 40 + Math.max(0, s.debt) + Bots.CFG.GREEDY_RUNWAY * Math.max(0, st.opex);
  assert.equal(Bots._internal.greedyReserve(s), base + Bots.CFG.GREEDY_BURN_DAYS * Math.max(0, -st.net));
  for (const r of s.racks) r.devices = [];                // nothing earns: the whole bill is burn
  const st2 = Sim.stats(s);
  assert.ok(st2.net < 0);
  assert.ok(Bots._internal.greedyReserve(s) >= 40 + Bots.CFG.GREEDY_BURN_DAYS * -st2.net, "burning cash raises the reserve");
});

test("D76: a stale expansion reservation is released after COMMIT_DAYS", () => {
  const s = Sim.newGame(7, { sandbox: true });
  Sim.advance(s, 200);
  const mem = { offerSeen: new Set(s.offers.map(o => o.id)), used: {}, noted: {}, committed: 900, expandFor: s.day - Bots.CFG.COMMIT_DAYS - 1 };
  const B = Bots._internal.belief(s, Object.assign(mem, { risky: new Set(), newsSeen: new Set() }));
  Bots._internal.contractsModule(s, mem, B, { mid: 0 });
  assert.equal(mem.committed, 0);
  const m2 = Object.assign({}, mem, { offerSeen: new Set(s.offers.map(o => o.id)), committed: 900, expandFor: s.day - 10 });
  Bots._internal.contractsModule(s, m2, B, { mid: 0 });
  assert.equal(m2.committed, 900, "a fresh reservation stays");
});

test("D80/D81: price-elastic GPU markets and the anchor that stays are on by default", () => {
  assert.equal(K.GPU_ELASTIC, 1);
  assert.equal(K.ANCHOR_STAYS, 1);
  const s = Sim.newGame(1, {});
  const anchor = s.contracts.find(c => c.anchor);
  assert.ok(anchor, "campaign starts with the anchor");
  assert.equal(Sim.walkIn(s, Object.assign({}, anchor, { streak: 50 })), null, "no walk-away countdown for the anchor");
});
