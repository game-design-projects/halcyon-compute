"use strict";
/* v0.4.6 improvement round from telemetry feee0c29 (seed 45823, v0.4.4, one player; DECISIONS D70-D74):
 * 1. chapters from ch7 on unlock at least CH_GAP_LATE days apart (the player got four chapters in 90 days)
 * 2. (K.ANCHOR_STAYS, shipped off) the day-0 anchor never walks: penalties while any customer would wait, then it pays less
 * 3. (K.GPU_ELASTIC, shipped off) GPU markets are price-elastic instead of stopping offers when "full"
 * D71/D72 are held back until the reference bots are rebalanced; their rules are tested here with the flag on
 * (smart speed: test/smartspeed.test.js) */
const test = require("node:test");
const assert = require("node:assert/strict");
const Sim = require("../js/sim.js");
const K = Sim.K;

const sb = (seed = 1) => Sim.newGame(seed, { sandbox: true });
function serving(s, w, units, days, extra) {
  return Object.assign({ id: "k" + s.nextId++, kind: w, cust: "T", icon: "x", foreign: false, w, units, days, lead: 0, price: 0.2,
    sla: w === "web" ? K.SLA_WEB : K.SLA_INFER, penalty: 0.3, signed: s.day, start: s.day, end: s.day + days, delivered: 0, missed: 0,
    penaltyPaid: 0, missDays: 0, streak: 0 }, extra || {});
}

/* ---------------- 1. chapter spacing ---------------- */
test("chapter spacing: CH_GAP for ch2-6, CH_GAP_LATE from ch7 on; the goal tooltip's ready day includes it", () => {
  assert.equal(Sim.chapterGap(1), K.CH_GAP);
  assert.equal(Sim.chapterGap(K.CH_LATE_FROM - 1), K.CH_GAP);
  for (let i = K.CH_LATE_FROM; i < Sim.CHAPTERS.length; i++) assert.equal(Sim.chapterGap(i), K.CH_GAP_LATE);
  assert.ok(K.CH_GAP_LATE >= 45, "at least 45 days between late chapters");
  const s = Sim.newGame(3);
  Sim.advance(s, 1);
  assert.equal(Sim.chapterReadyDay(s), Math.max(Sim.CHAPTERS[1].day, K.CH_GAP), "next = power: earliest day vs spacing");
  s.chapter = K.CH_LATE_FROM - 1; s.prog.lastChapter = 400;       // pretend ch6 just unlocked on day 400
  assert.equal(Sim.chapterReadyDay(s), Math.max(Sim.CHAPTERS[K.CH_LATE_FROM].day, 400 + K.CH_GAP_LATE));
});

test("chapter spacing: fast players (planner) never get more than 2 late chapters in 90 days; the stall fallback is unchanged", () => {
  const Bots = require("../bots/bots.js");
  for (const seed of [3, 45823]) {
    const s = Bots.play(seed, "planner").state;
    const un = Sim.CHAPTERS.map(c => s.unlocked[c.key]);
    for (let i = K.CH_LATE_FROM; i < un.length; i++) if (un[i] != null) assert.ok(un[i] - un[i - 1] >= K.CH_GAP_LATE - 1e-9, `seed ${seed} ch${i + 1}: ${un[i] - un[i - 1]} d`);
    const late = un.slice(K.CH_LATE_FROM).filter(d => d != null);
    for (const d of late) assert.ok(late.filter(x => x >= d && x < d + 90).length <= 2, `seed ${seed}: bunching after d${d} (${late})`);
    assert.ok(un.filter(d => d != null).length >= 14, `seed ${seed}: planner still reaches ${un.filter(d => d != null).length} chapters`);
  }
  assert.equal(K.CH_STALL, 240, "a stuck active player still gets the next chapter after CH_STALL days");
});

/* ---------------- 2. the anchor customer never walks ---------------- */
test("anchor (D71): never walks; SLA penalty while a customer would wait, then it only pays for what it gets", () => {
  const K0 = K.ANCHOR_STAYS; K.ANCHOR_STAYS = 1;
  try {
  const s = sb(11);
  const anchor = s.contracts.find(c => c.anchor);
  Sim.advance(s, K.GRACE_DAYS + 5);                       // past the onboarding grace: normal patience
  const keep = s.racks.map(r => r.devices);
  for (const r of s.racks) r.devices = [];                // nothing serves the anchor
  Sim.advance(s, 1);
  assert.ok(anchor.streak >= 1 && Sim.walkIn(s, anchor) === null, "no countdown for the anchor");
  const pen0 = anchor.penaltyPaid;
  Sim.advance(s, K.SLA_WALK_DAYS - 3);
  assert.ok(anchor.penaltyPaid > pen0, "misses inside its patience cost the SLA penalty (the teaching signal)");
  Sim.advance(s, 10);
  assert.ok(anchor.streak > Sim.patience(s, anchor), `streak ${anchor.streak} past the patience`);
  assert.ok(!anchor.walked && s.contracts.includes(anchor), "still a customer (any other would have walked)");
  const pen1 = anchor.penaltyPaid;
  assert.equal(Sim.stats(s).costs.penalties, 0, "past its patience it charges no penalty (bounded exposure, no trap)");
  Sim.advance(s, 30);
  assert.ok(Math.abs(anchor.penaltyPaid - pen1) < 1e-9, "no penalty while it waits");
  s.racks.forEach((r, i) => { r.devices = keep[i]; });   // serve it again: revenue returns, the streak resets
  Sim.advance(s, 2);
  const st = Sim.stats(s);
  assert.ok(st.cDel[anchor.id] >= K.SLA_WEB * anchor.units - 1e-9, "served again");
  assert.equal(anchor.streak, 0);
  assert.ok(st.revenue.web > 0);
  } finally { K.ANCHOR_STAYS = K0; }
});

test("anchor (D71): a normal customer still walks after its patience", () => {
  const K0 = K.ANCHOR_STAYS; K.ANCHOR_STAYS = 1;
  try {
  const s = sb(12);
  Sim.advance(s, K.GRACE_DAYS + 5);                       // a streak that begins after the grace: normal patience
  s.cash = 1e5;                                          // the penalties must not bankrupt the test company
  const c = serving(s, "web", 200, 400);                 // far more than the floor can serve: misses every day
  s.contracts.push(c);
  Sim.advance(s, K.SLA_WALK_DAYS + 2);
  assert.ok(c.walked, "walks");
  assert.ok(!s.contracts.find(x => x.anchor).walked, "the anchor stays");
  } finally { K.ANCHOR_STAYS = K0; }
});

/* ---------------- 3. price-elastic GPU markets ---------------- */
test("GPU price factor (D72): flat up to the market's demand, then monotonically cheaper, never below GPU_FLOOR", () => {
  let prev = 2;
  for (let h = 0; h <= 2000; h += 10) {
    const f = Sim.gpuPriceAt(h, 200);
    assert.ok(f <= prev + 1e-12 && f >= K.GPU_FLOOR - 1e-12 && f <= 1, `h ${h}: ${f}`);
    if (h <= 200) assert.equal(f, 1);
    prev = f;
  }
  assert.equal(Sim.gpuPriceAt(1e6, 200), K.GPU_FLOOR);
  assert.ok(Sim.gpuPriceAt(400, 400) === 1 && Sim.gpuPriceAt(400, 200) < 1, "a growing market absorbs the same holding at full price");
});

function gpuOffersPast(s, w, days) {
  const old = new Set(s.offers.map(o => o.id)), seen = [];
  for (let i = 0; i < days; i++) { Sim.advance(s, 1); for (const o of s.offers) if (o.w === w && !o.bts && !old.has(o.id) && !o.renewOf && !seen.includes(o)) seen.push(o); }
  return seen;
}
test("GPU markets (D72): holding more than the demand still brings offers, priced down; GPU_ELASTIC 0 = the old wall", () => {
  const K0 = K.GPU_ELASTIC; K.GPU_ELASTIC = 1;
  try {
  const setup = () => {
    const s = sb(14);
    s.cash = 5000;
    const r = Sim.rackById(s, "B1");
    r.workload = "infer";
    r.devices = [{ uid: s.nextId++, type: "sw", born: 0, inst: 0 }, { uid: s.nextId++, type: "m1", born: 0, inst: 0 }];
    Sim.advance(s, 1);
    const dem = Sim.stats(s).mk.infer.demand;
    s.contracts.push(serving(s, "infer", Math.ceil(dem * 1.5), 1000, { sla: 0 }));   // hold 1.5x the demand (sla 0: never walks)
    return { s, dem };
  };
  const { s, dem } = setup();
  const seen = gpuOffersPast(s, "infer", 120);
  assert.ok(seen.length >= 2, `${seen.length} inference offers while holding 1.5x the demand (${dem.toFixed(0)})`);
  for (const o of seen) {
    const f = Sim.gpuPriceAt(Sim.held(s).infer, dem);
    assert.ok(o.pf < 1 && o.pf >= K.GPU_FLOOR - 1e-9, `discounted: pf ${o.pf}`);
    assert.ok(Math.abs(o.price / o.repAdj / o.pf / o.spot - 1) <= K.CONTRACT_PREMIUM + K.QUOTE_SPREAD * 1.2 + 0.05, `priced from the index x pf (${o.price} ${o.spot} ${o.pf}, f now ${f})`);
  }
  const old = K.GPU_ELASTIC;
  try {
    K.GPU_ELASTIC = 0;
    const w = setup();
    assert.equal(gpuOffersPast(w.s, "infer", 120).length, 0, "the old wall: a full market sends no offers");
  } finally { K.GPU_ELASTIC = old; }
  } finally { K.GPU_ELASTIC = K0; }
});

test("GPU markets (D72): renewals keep the discount they were signed at; determinism holds", () => {
  const K0 = K.GPU_ELASTIC; K.GPU_ELASTIC = 1;
  try {
  const s = sb(15);
  s.cash = 3000;
  Sim.advance(s, 1);
  const c = serving(s, "infer", 4, 60, { pf: 0.7, sla: 0 });
  c.end = s.day + 5;
  s.contracts.push(c);
  Sim.advance(s, 1);
  const r = s.offers.find(o => o.renewOf === c.id);
  assert.ok(r, "renewal offered");
  assert.equal(r.pf, 0.7);
  const t = JSON.parse(JSON.stringify(s));
  Sim.advance(s, 60); Sim.advance(t, 60);
  assert.equal(JSON.stringify(s), JSON.stringify(t));
  } finally { K.GPU_ELASTIC = K0; }
});
