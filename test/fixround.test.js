"use strict";
/* v0.3 post-playtest fix round: rule-level tests for every sim change (docs/playtests/SYNTHESIS.md). */
const test = require("node:test");
const assert = require("node:assert/strict");
const Sim = require("../js/sim.js");
const K = Sim.K;

const camp = (seed = 1, opts) => Sim.newGame(seed, opts);
const sb = (seed = 1, opts) => Sim.newGame(seed, Object.assign({ sandbox: true }, opts || {}));
const rack = (s, id) => Sim.rackById(s, id);
const mk = (s, type, extra) => Object.assign({ uid: s.nextId++, type, born: s.day - 100, inst: s.day - 100 }, extra || {});
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(b));

/* ============ P1 chapter pacing (v4: player-triggered, DECISIONS D41) ============ */
test("chapter pacing: ordered earliest days, at most one chapter per CH_GAP days, ch17 early enough for its arc", () => {
  const days = Sim.CHAPTERS.map(c => c.day);
  assert.equal(days[0], 0);
  for (let i = 1; i < days.length; i++) assert.ok(days[i] > days[i - 1], "earliest days in order");
  for (const c of Sim.CHAPTERS.slice(1)) assert.ok(c.hint && c.hint.length > 5, `${c.key} has a trigger hint for the UI`);
  const byKey = k => Sim.CHAPTERS.find(c => c.key === k).day;
  assert.ok(byKey("disrupt") <= 1290, "ch17 arc (launches 1290/1440/1590, vendor death 1500) can still play out");
  // a planner game: unlocks are spaced by at least CH_GAP days and follow the chapter order
  const Bots = require("../bots/bots.js");
  const s = Bots.play(3, "planner").state;
  const un = Sim.CHAPTERS.map(c => s.unlocked[c.key]).filter(d => d != null);
  assert.ok(un.length >= 14, `planner reached ${un.length} chapters`);
  for (let i = 1; i < un.length; i++) assert.ok(un[i] - un[i - 1] >= K.CH_GAP - 1e-9, `gap before chapter ${i + 1}: ${un[i] - un[i - 1]}`);
});

test("hardware goes on sale with its chapter (GPUs with ch3, CRU coolers with ch4), never by the calendar", () => {
  assert.equal(Sim.BASE_ITEMS.c1.ch, "gpu");
  assert.equal(Sim.BASE_ITEMS.m1.ch, "gpu");
  assert.equal(Sim.BASE_ITEMS.cru.ch, "heat");
  const s = camp(5);
  Sim.advance(s, 300);
  assert.ok(!Sim.on(s, "gpu") && !Sim.shopItems(s).includes("c1"), "an idle player never sees GPUs");
  const t = sb(5);
  assert.ok(Sim.shopItems(t).includes("c1") && Sim.shopItems(t).includes("m1") && Sim.shopItems(t).includes("cru"), "sandbox: all on sale at d0");
});

/* ============ P1 workload default ============ */
test("naturalWorkload: the first GPU into a GPU-less rack picks the workload it earns more on", () => {
  const s = sb(2);
  rack(s, "B1").devices = [mk(s, "sw")];
  assert.equal(Sim.naturalWorkload(s, "B1", "c1"), "train", "compute card -> training");
  assert.equal(Sim.naturalWorkload(s, "B1", "m1"), "infer", "bandwidth card -> inference");
  assert.equal(Sim.naturalWorkload(s, "B1", "c2"), "train");
  assert.equal(Sim.naturalWorkload(s, "B1", "m2"), "infer");
  assert.equal(Sim.naturalWorkload(s, "B1", "sw"), null, "not a GPU");
  assert.equal(Sim.naturalWorkload(s, "B1", "lat1"), null, "exotic cards have a fixed workload");
  rack(s, "B1").devices.push(mk(s, "c1"));
  assert.equal(Sim.naturalWorkload(s, "B1", "m1"), null, "rack already has a GPU: its workload stays the player's choice");
  rack(s, "B2").pending.push(mk(s, "m1"));
  assert.equal(Sim.naturalWorkload(s, "B2", "c1"), null, "a GPU on its way counts too");
  assert.equal(Sim.naturalWorkload(s, "Z9", "c1"), null, "unknown rack");
});

/* ============ P3 lease billing ============ */
test("returnLease: the lease is billed until the return job completes", () => {
  const s = sb(1);
  const r = rack(s, "B1");
  r.devices = [mk(s, "sw"), mk(s, "c1", { leased: true, leaseRate: 1.2 })];
  const d = r.devices[1];
  assert.ok(near(Sim.stats(s).costs.lease, 1.2));
  assert.ok(Sim.apply(s, { type: "returnLease", rack: "B1", uid: d.uid }).ok);
  assert.ok(!r.devices.includes(d), "the card leaves the rack (it stops earning)");
  assert.ok(near(Sim.stats(s).costs.lease, 1.2), "still billed while the technician returns it");
  const L0 = s.ledger.lease;
  Sim.advance(s, 3);
  assert.ok(!s.jobs.some(j => j.kind === "returnLease"), "returned");
  assert.equal(Sim.stats(s).costs.lease, 0, "billing stops once it is gone");
  const billed = s.ledger.lease - L0;
  assert.ok(billed >= 1.2 * K.SELL_DAYS - 1e-9 && billed <= 1.2 * 3 + 1e-9, `billed ${billed}`);
});

/* ============ P3 grid tier 4 ============ */
test("grid tier 4 (1000 kW) needs Hall 3 built or under construction", () => {
  const s = sb(1);
  s.cash = 1e5;
  for (const kw of [K.GRID_KW_UP, K.GRID_KW_UP2]) { assert.ok(Sim.apply(s, { type: "grid" }).ok); Sim.advance(s, 50); assert.equal(s.gridKw, kw); }
  s.halls[1].built = true;             // Hall 2 stands, Hall 3 does not
  const res = Sim.check(s, { type: "grid" });
  assert.equal(res.ok, false);
  assert.match(res.msg, /Hall 3/);
  assert.ok(Sim.gridNext(s), "the tier is still listed (so the UI can show why it is locked)");
  assert.ok(Sim.apply(s, { type: "buildHall", hall: 3 }).ok, "start Hall 3");
  assert.ok(Sim.check(s, { type: "grid" }).ok, "under construction is enough: power and building can overlap");
  assert.ok(Sim.apply(s, { type: "grid" }).ok);
});

/* ============ P2 every discrete cash jump is explained ============ */
test("cash events: tax, auto-repairs and completed sales are logged with a label", () => {
  const s = sb(1);
  // quarter tax
  Sim.advance(s, 89.75 - s.day);
  s.fin = { rev: 1000, opex: 400, dep: 100 };
  const n0 = s.cashSeq;
  Sim.advance(s, 0.25);
  const tax = s.cashEvents.find(e => e.kind === "tax");
  assert.ok(tax && tax.n > n0, "tax logged");
  assert.ok(near(tax.amt, -0.21 * 500, 1e-3), `tax ${tax.amt}`);
  assert.match(tax.label, /tax/i);
  // a completed sale
  const r = rack(s, "B1");
  r.devices = [mk(s, "sw"), mk(s, "c1")];
  assert.ok(Sim.apply(s, { type: "sell", rack: "B1", uid: r.devices[1].uid }).ok);
  Sim.advance(s, 3);
  const sale = s.cashEvents.find(e => e.kind === "sale");
  assert.ok(sale && sale.amt > 0);
  assert.match(sale.label, /Kestrel C1/);
  // an automatic repair
  const r2 = rack(s, "B2");
  r2.devices = [mk(s, "sw"), mk(s, "c1", { failed: true })];
  s.shelf = [];
  Sim.advance(s, 1);
  const rep = s.cashEvents.find(e => e.kind === "repair");
  assert.ok(rep && rep.amt < 0, "auto-repair logged");
  assert.ok(JSON.parse(JSON.stringify(s)).cashEvents.length === s.cashEvents.length, "JSON-safe");
});

test("cash accounting: every change is continuous flow, a logged cash event, or the player's own action (1800 days)", () => {
  const s = sb(9), R = (() => { let x = 7; return () => (x = (x * 16807) % 2147483647) / 2147483647; })();
  const pick = a => a[Math.floor(R() * a.length)];
  s.cash = 1e5;                         // rich enough to play all 1800 days (taxes, repairs and sales all happen)
  let worst = 0;
  while (!s.over) {
    // random actions (the player's own: explained by their toast)
    let acted = 0;
    for (let i = 0; i < 3; i++) {
      const r = pick(s.racks), shop = Sim.shopItems(s), d = r.devices[0];
      const a = pick([{ type: "buy", item: pick(shop), rack: r.id }, d && { type: "sell", rack: r.id, uid: d.uid }, { type: "hire" },
        { type: "borrow", amount: 100 }, { type: "repay", amount: 100 }, { type: "pr" }].filter(Boolean));
      const c0 = s.cash;
      if (R() < 0.3 && Sim.apply(s, a).ok) acted += s.cash - c0;
    }
    const c0 = s.cash, f0 = s.totals.flow, seq0 = s.cashSeq;
    Sim.advance(s, 1);
    const logged = s.cashEvents.filter(e => e.n > seq0).reduce((a, e) => a + e.amt, 0);
    const gap = (s.cash - c0) - (s.totals.flow - f0) - logged;
    worst = Math.max(worst, Math.abs(gap));
    void acted;
  }
  assert.equal(s.over, "end", `played to the end (day ${s.day})`);
  const kinds = new Set(s.cashEvents.map(e => e.kind));
  for (const k of ["tax", "repair", "sale"]) assert.ok(kinds.has(k) || s.cashSeq > 120, `saw a ${k} event`);
  assert.ok(worst < 0.01, `an unexplained cash jump of $${worst.toFixed(2)}k`);
});

test("cash events are capped (old saves without the log still step)", () => {
  const s = sb(3);
  for (let i = 0; i < 200; i++) Sim.logCash(s, -1, "other", "x");
  assert.ok(s.cashEvents.length <= 120);
  assert.equal(s.cashSeq, 200);
  const old = sb(4);
  delete old.cashEvents; delete old.cashSeq; delete old.totals.flow;
  Sim.advance(old, 100);
  assert.ok(Array.isArray(old.cashEvents) && old.totals.flow != null);
});

/* ============ P0-3 pace ghost runner ============ */
test("pace ghost: bots advance in whole days up to the player's day, never ahead, and match a full bot game", () => {
  const Bots = require("../bots/bots.js"), Pace = require("../js/pace.js");
  const R = Pace.createRunner(Sim, Bots);
  R.init(11, false, 0);
  R.to(120.75);
  while (R.busy()) R.work(50);
  let rows = R.rows().rows;
  assert.equal(rows.greedy.day, 120);
  assert.equal(rows.planner.day, 120, "floor of the player's day");
  R.to(90);                                   // the target never moves backwards
  R.work(50);
  assert.equal(R.rows().rows.greedy.day, 120);
  // same seed + same settings: identical to a fresh bot game stopped at the same day
  const s = Sim.newGame(11), mem = {};
  while (s.day < 120) { Bots.POLICIES.greedy(s, mem); Sim.advance(s, 1); }
  assert.equal(rows.greedy.score, Sim.score(s));
  R.finish();
  while (R.busy()) R.work(1000);
  rows = R.rows().rows;
  assert.equal(rows.greedy.score, Bots.play(11, "greedy").score, "finishing gives the end-screen score");
  assert.ok(rows.planner.over);
});

test("pace ghost: sandbox games ghost sandbox bots", () => {
  const Bots = require("../bots/bots.js"), Pace = require("../js/pace.js");
  const R = Pace.createRunner(Sim, Bots, ["greedy"]);
  R.init(4, true, 30);
  while (R.busy()) R.work(50);
  assert.equal(R.state("greedy").sandbox, true);
  assert.equal(R.rows().rows.greedy.day, 30);
});
