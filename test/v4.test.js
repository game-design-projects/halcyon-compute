"use strict";
/* v4 player actions: reorder a rack's slots, cancel a queued job, undo a sale, automation policies, renewals. */
const test = require("node:test");
const assert = require("node:assert/strict");
const Sim = require("../js/sim.js");
const K = Sim.K;

const sb = (seed = 1, opts) => Sim.newGame(seed, Object.assign({ sandbox: true }, opts || {}));
const rack = (s, id) => Sim.rackById(s, id);
const mk = (s, type, extra) => Object.assign({ uid: s.nextId++, type, born: s.day - 100, inst: s.day - 100 }, extra || {});
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(b));
const jobOf = (s, kind) => s.jobs.filter(j => j.kind === kind).pop();
/* cash explained: flow + logged events + the action's own delta must add up (money conservation per action) */
function books(s) { return { cash: s.cash, flow: s.totals.flow, ev: s.totals.events }; }

/* ============ reorder ============ */
test("reorder: moves a device to a slot in the same rack; instant, free, no effect on the rules", () => {
  const s = sb(1);
  const r = rack(s, "A1"), before = r.devices.map(d => d.uid), st0 = JSON.stringify(Sim.stats(s).perRack.A1.out);
  const uid = before[5], cash = s.cash;
  assert.ok(Sim.apply(s, { type: "reorder", rack: "A1", uid, index: 0 }).ok);
  assert.equal(r.devices[0].uid, uid);
  assert.deepEqual(r.devices.map(d => d.uid).sort(), before.slice().sort(), "same devices");
  assert.equal(s.cash, cash);
  assert.equal(s.jobs.length, 0, "no technician job");
  assert.equal(JSON.stringify(Sim.stats(s).perRack.A1.out), st0, "output unchanged");
  assert.ok(Sim.apply(s, { type: "reorder", rack: "A1", uid, index: 99 }).ok, "clamped");
  assert.equal(r.devices[r.devices.length - 1].uid, uid);
  assert.ok(!Sim.check(s, { type: "reorder", rack: "A2", uid, index: 0 }).ok, "not in that rack");
  assert.ok(!Sim.check(s, { type: "reorder", rack: "A1", uid, index: "x" }).ok, "bad position");
  assert.match(s.log[s.log.length - 1], /reorder/);
  const t = JSON.parse(JSON.stringify(s));
  Sim.advance(s, 30); Sim.advance(t, 30);
  assert.equal(JSON.stringify(s), JSON.stringify(t), "save/load unaffected");
});

/* ============ cancelJob ============ */
test("cancelJob: a buy still shipping = full refund (same as cancelOrder); delivered but not installed = to the shelf", () => {
  const s = sb(2);
  s.cash = 5000;
  const b0 = books(s);
  assert.ok(Sim.apply(s, { type: "buy", item: "c1", rack: "B1" }).ok);
  const j = jobOf(s, "buy");
  Sim.advance(s, 2);
  assert.ok(Sim.apply(s, { type: "cancelJob", id: j.id }).ok);
  assert.ok(near(s.cash - b0.cash, s.totals.flow - b0.flow), "exact refund: only the running flow changed cash");
  assert.equal(rack(s, "B1").pending.length, 0);
  // delivered, waiting for a technician: goes to the shelf, no refund
  s.techs = 0;                                         // nobody to install it
  assert.ok(Sim.apply(s, { type: "buy", item: "c1", rack: "B2" }).ok);
  const j2 = jobOf(s, "buy");
  Sim.advance(s, K.SHIP_DAYS + 0.5);
  assert.equal(j2.phase, "wait");
  const chk = Sim.check(s, { type: "cancelJob", id: j2.id });
  assert.ok(chk.ok && /shelf/.test(chk.msg), chk.msg);
  const cash1 = s.cash;
  assert.ok(Sim.apply(s, { type: "cancelJob", id: j2.id }).ok);
  assert.ok(s.shelf.some(d => d.uid === j2.dev.uid), "on the shelf");
  assert.ok(!rack(s, "B2").pending.length);
  assert.equal(s.cash, cash1, "no refund: you own it");
  assert.ok(!Sim.check(s, { type: "cancelJob", id: j2.id }).ok, "gone");
  assert.ok(!Sim.check(s, { type: "cancelJob", id: 424242 }).ok);
});

test("cancelJob: move returns the device to its origin rack; sell and store put it back; a technician is freed at once", () => {
  const s = sb(3);
  const A1 = rack(s, "A1"), uid = A1.devices[3].uid;
  assert.ok(Sim.apply(s, { type: "move", rack: "A1", uid, to: "B1" }).ok);
  const mv = jobOf(s, "move");
  Sim.advance(s, 0.25);
  assert.equal(mv.phase, "work");
  assert.equal(Sim.busyTechs(s), 1);
  assert.ok(Sim.apply(s, { type: "cancelJob", id: mv.id }).ok);
  assert.equal(Sim.busyTechs(s), 0, "the technician is free");
  assert.ok(A1.devices.some(d => d.uid === uid) && !rack(s, "B1").pending.length, "back in A1");
  // sell: cancelled before it completes, back at its old slot, no money moved
  const at = A1.devices.findIndex(d => d.uid === uid), cash = s.cash;
  assert.ok(Sim.apply(s, { type: "sell", rack: "A1", uid }).ok);
  const sl = jobOf(s, "sell");
  assert.ok(Sim.apply(s, { type: "cancelJob", id: sl.id }).ok);
  assert.equal(A1.devices.findIndex(d => d.uid === uid), at, "same slot");
  assert.equal(s.cash, cash);
  // store (to the shelf): back in the rack
  assert.ok(Sim.apply(s, { type: "store", rack: "A1", uid }).ok);
  assert.ok(Sim.apply(s, { type: "cancelJob", id: jobOf(s, "store").id }).ok);
  assert.ok(A1.devices.some(d => d.uid === uid));
});

test("cancelJob: a repair waiting for parts is refunded (a logged cash event); one in progress stops without refund", () => {
  const s = sb(4);
  s.repairAuto = false;
  const r = rack(s, "B1");
  r.devices = [mk(s, "sw"), mk(s, "c1", { failed: true })];
  const uid = r.devices[1].uid;
  const cash = s.cash;
  assert.ok(Sim.apply(s, { type: "repair", uid, useSpare: false }).ok);
  const j = jobOf(s, "repair");
  assert.equal(j.phase, "parts");
  const seq = s.cashSeq;
  assert.ok(Sim.apply(s, { type: "cancelJob", id: j.id }).ok);
  assert.ok(near(s.cash, cash), "refunded");
  assert.ok(s.cashEvents.some(e => e.n > seq && e.kind === "refund" && e.amt > 0));
  assert.ok(r.devices[1].failed, "still broken");
});

test("cancelJob: builds refund 100 % on the first day, then pro rata minus 10 %; books and depreciation undone", () => {
  const s = sb(5);
  s.cash = 1e4;
  const c0 = s.cash, f0 = s.totals.flow;
  assert.ok(Sim.apply(s, { type: "buildHall" }).ok);
  const hall = jobOf(s, "buildHall");
  Sim.advance(s, 0.5);
  assert.ok(Sim.apply(s, { type: "cancelJob", id: hall.id }).ok);
  assert.ok(near(s.cash - c0, s.totals.flow - f0, 1e-6), "full refund in the first day");
  assert.ok(!s.deprec.some(x => x.job === hall.id), "no depreciation left");
  assert.ok(Sim.apply(s, { type: "grid" }).ok);
  const g = jobOf(s, "grid"), paid = g.paid, c1 = s.cash, f1 = s.totals.flow;
  Sim.advance(s, g.total / 2);
  const chk = Sim.check(s, { type: "cancelJob", id: g.id });
  assert.ok(chk.ok, chk.msg);
  assert.ok(Sim.apply(s, { type: "cancelJob", id: g.id }).ok);
  const back = (s.cash - c1) - (s.totals.flow - f1);   // c1 is after paying for the grid
  assert.ok(near(back, paid * 0.5 * (1 - K.CANCEL_FEE), 0.02), `refund ${back} of ${paid}`);
  assert.equal(s.gridKw, K.GRID_KW, "not upgraded");
  assert.ok(s.cashEvents.some(e => e.kind === "refund" && /grid/.test(e.label)));
});

/* ============ undoSell (coyote time for sales) ============ */
test("undoSell: within 10 days, buy it back for exactly the sale price; the device keeps its age and type", () => {
  const s = sb(6);
  s.cash = 3000;
  const r = rack(s, "B1");
  r.devices = [mk(s, "sw"), mk(s, "c1", { born: -200, inst: -190 })];
  const d = r.devices[1], born = d.born;
  const c0 = s.cash, f0 = s.totals.flow;
  assert.ok(Sim.apply(s, { type: "sell", rack: "B1", uid: d.uid }).ok);
  Sim.advance(s, 2);
  const x = s.recentlySold.find(y => y.uid === d.uid);
  assert.ok(x && x.until === x.day + K.UNSELL_DAYS, "listed for the UI with a countdown");
  assert.ok(s.cashEvents.some(e => e.kind === "sale"));
  assert.ok(Sim.apply(s, { type: "buyBack", uid: d.uid, rack: "B1" }).ok, "alias of undoSell");
  assert.ok(near(s.cash - c0, s.totals.flow - f0), "sell + buy back is money-neutral");
  assert.ok(s.cashEvents.some(e => e.kind === "unsell" && e.amt < 0));
  Sim.advance(s, K.INSTALL_DAYS + 0.5);
  const back = r.devices.find(y => y.uid === d.uid);
  assert.ok(back && back.born === born && back.type === "c1", "same device, same age");
  assert.ok(!s.recentlySold.some(y => y.uid === d.uid));
  // no rack given and no room: the shelf; after 10 days: gone
  assert.ok(Sim.apply(s, { type: "sell", rack: "B1", uid: d.uid }).ok);
  Sim.advance(s, K.UNSELL_DAYS + 2);
  assert.ok(!Sim.check(s, { type: "undoSell", uid: d.uid }).ok, "expired");
  // leased cards are returned, never sold: nothing to buy back
  r.devices.push(mk(s, "c1", { leased: true, leaseRate: 1 }));
  assert.ok(!Sim.check(s, { type: "sell", rack: "B1", uid: r.devices[r.devices.length - 1].uid }).ok);
});

/* ============ automation policies ============ */
test("policy autoSwap: without auto-repair, a failed part with a matching spare is swapped automatically", () => {
  const s = sb(7);
  s.repairAuto = false;
  assert.ok(Sim.apply(s, { type: "policy", key: "autoSwap", on: true }).ok);
  const r = rack(s, "B1");
  r.devices = [mk(s, "sw"), mk(s, "c1", { failed: true })];
  s.shelf.push(mk(s, "c1"));
  Sim.advance(s, 1);
  assert.ok(s.jobs.some(j => j.kind === "swap") || !r.devices[1].failed || s.shelf.some(d => d.failed), "a swap was queued");
  Sim.advance(s, 3);
  assert.ok(r.devices.every(d => !d.failed), "working card in the rack");
  assert.ok(s.shelf.some(d => d.failed), "the broken one is on the shelf");
  // no spare: nothing happens (no repair bill)
  const t = sb(7);
  t.repairAuto = false;
  Sim.apply(t, { type: "policy", key: "autoSwap", on: true });
  rack(t, "B1").devices = [mk(t, "sw"), mk(t, "m1", { failed: true })];
  const cash = t.cash;
  Sim.advance(t, 2);
  assert.ok(!t.jobs.some(j => j.kind === "repair"));
  assert.ok(t.cash > cash - 5);
});

test("policy keepSpares: auto-orders at list price and normal shipping to the shelf, logged, only when affordable", () => {
  const s = sb(8);
  s.cash = 1000;
  assert.ok(!Sim.check(s, { type: "policy", key: "keepSpares", item: "lat1", n: 2 }).ok, "not exotic cards");
  assert.ok(!Sim.check(s, { type: "policy", key: "keepSpares", item: "c1", n: 99 }).ok);
  assert.ok(Sim.apply(s, { type: "policy", key: "keepSpares", item: "c1", n: 2 }).ok);
  Sim.advance(s, 1);
  const orders = s.jobs.filter(j => j.kind === "restock");
  assert.equal(orders.length, 2);
  assert.equal(s.cashEvents.filter(e => e.kind === "restock").length, 2);
  Sim.advance(s, K.SHIP_DAYS + 1);
  assert.equal(s.shelf.filter(d => d.type === "c1").length, 2);
  Sim.advance(s, 5);
  assert.equal(s.jobs.filter(j => j.kind === "restock").length, 0, "target met: no more orders");
  const poor = sb(8);
  poor.cash = 10;
  Sim.apply(poor, { type: "policy", key: "keepSpares", item: "c1", n: 2 });
  Sim.advance(poor, 3);
  assert.equal(poor.jobs.filter(j => j.kind === "restock").length, 0, "skips when unaffordable");
  assert.ok(Sim.apply(s, { type: "policy", key: "keepSpares", item: "c1", n: 0 }).ok);
  assert.equal(s.policy.keepSpares.c1, undefined);
});

test("renewals: a customer on track offers the same deal re-priced to the market; autoRenew signs it (no gap)", () => {
  for (const auto of [false, true]) {
    const s = sb(9);
    const r = rack(s, "B1");
    r.devices = [mk(s, "sw"), ...Array.from({ length: 6 }, () => mk(s, "cpu"))];
    const c = { id: "kR", kind: "web", cust: "Renew Co", icon: "x", foreign: false, w: "web", units: 5, days: 40, lead: 0, price: 0.3, sla: 0.9,
      penalty: 0.45, signed: s.day, start: s.day, end: s.day + 40, delivered: 0, missed: 0, penaltyPaid: 0, missDays: 0, streak: 0 };
    s.contracts.push(c);
    if (auto) assert.ok(Sim.apply(s, { type: "policy", key: "autoRenew", on: true }).ok);
    Sim.advance(s, 40 - K.RENEW_BEFORE + 1);
    const o = s.offers.find(x => x.renewOf === "kR"), nc = s.contracts.find(x => x.renewOf === "kR");
    if (!auto) {
      assert.ok(o && o.cust === "Renew Co" && o.units === 5 && o.days === 40, "renewal offer on the board");
      assert.ok(near(o.start == null ? s.day + o.lead : o.start, c.end, 1), "starts when the old one ends");
      const idx = Sim.marketAt(s, s.day).web.price * (1 + K.CONTRACT_PREMIUM);
      assert.ok(o.price >= idx * (1 - K.QUOTE_SPREAD) - 1e-6 && o.price <= idx * (1 + K.QUOTE_SPREAD) * 1.2 + 1e-6, "re-priced to the market");
    } else {
      assert.ok(nc && !o, "signed automatically");
      assert.ok(near(nc.start, c.end, 1e-6), "no gap");
      assert.ok(s.cashEvents.some(e => e.kind === "renew"));
    }
  }
  // a customer that is being short-changed does not offer a renewal
  const t = sb(9);
  const bad = { id: "kB", kind: "infer", cust: "Short Co", icon: "x", foreign: false, w: "infer", units: 50, days: 30, lead: 0, price: 0.3, sla: 0.95,
    penalty: 0.45, signed: t.day, start: t.day, end: t.day + 30, delivered: 0, missed: 0, penaltyPaid: 0, missDays: 0, streak: 0 };
  t.cash = 1e5; t.contracts.push(bad);
  Sim.advance(t, 25);
  assert.ok(!t.offers.some(x => x.renewOf === "kB"));
});

test("policies are part of the state: deterministic and JSON round-trip safe", () => {
  const run = () => {
    const s = sb(10);
    s.cash = 2000;
    Sim.apply(s, { type: "policy", key: "keepSpares", item: "m1", n: 1 });
    Sim.apply(s, { type: "policy", key: "autoRenew", on: true });
    Sim.apply(s, { type: "policy", key: "autoSwap", on: true });
    Sim.advance(s, 120);
    return s;
  };
  const a = run(), b = run();
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  const c = JSON.parse(JSON.stringify(a));
  Sim.advance(a, 60); Sim.advance(c, 60);
  assert.equal(JSON.stringify(a), JSON.stringify(c));
  const camp = Sim.newGame(1);
  assert.match(Sim.check(camp, { type: "policy", key: "autoSwap", on: true }).msg, /chapter 6/, "gated by the operations chapter");
  assert.ok(Sim.check(camp, { type: "policy", key: "autoRenew", on: true }).ok, "renewals: from day 0");
});
