"use strict";
/* v0.4.2 fix round driven by real player telemetry (seed 298670, two sessions, v0.4.1):
 * 1. deliverability counts signed-but-not-started contracts and installs that finish by an offer's start (overbooking)
 * 2. walk-away countdown + onboarding grace (doubled patience in the first 90 days, the anchor cannot walk before day 90)
 * 3. a starter GPU offer after the GPU chapter; web offers saturate */
const test = require("node:test");
const assert = require("node:assert/strict");
const Sim = require("../js/sim.js");
const QOL = require("../js/qol.js");
const K = Sim.K;

const sb = (seed = 1) => Sim.newGame(seed, { sandbox: true });
const rack = (s, id) => Sim.rackById(s, id);
const mk = (s, type) => ({ uid: s.nextId++, type, born: s.day - 100, inst: s.day - 100 });
function serving(s, w, units, days, extra) {
  return Object.assign({ id: "k" + s.nextId++, kind: w, cust: "T", icon: "x", foreign: false, w, units, days, lead: 0, price: 0.2,
    sla: w === "web" ? K.SLA_WEB : K.SLA_INFER, penalty: 0.3, signed: s.day, start: s.day, end: s.day + days, delivered: 0, missed: 0,
    penaltyPaid: 0, missDays: 0, streak: 0 }, extra || {});
}
const webOffer = (s, units, lead, days) => ({ id: "o" + s.nextId++, kind: "web", w: "web", units, days: days || 90, lead, price: 0.2, sla: K.SLA_WEB, penalty: 0.3 });

test("telemetry 11c05598: on day 4 the board shows every one of the player's three signings as overbooked", () => {
  const s = Sim.newGame(298670);
  Sim.advance(s, 4);
  const ids = ["c21", "c22", "c20"];               // the order the player signed them in
  let signed = 0;
  for (const id of ids) {
    const o = s.offers.find(x => x.id === id);
    assert.ok(o, `offer ${id} on the board (${s.offers.map(x => x.id)})`);
    const f = QOL.offerFit(Sim, s, o);
    assert.ok(f.over, `${id}: over (free ${f.free} need ${f.need})`);
    assert.ok(f.load > 1, "the bar runs past 100 %");
    assert.ok(Sim.apply(s, { type: "signContract", id }).ok);
    signed += o.units;
  }
  const ob = Sim.overbook(s);
  assert.ok(ob.web.short >= signed - 2, `overbooked by ${ob.web.short.toFixed(1)} (signed ${signed})`);
  assert.ok(ob.web.at > s.day, "the shortfall starts when the signed contracts start");
  const al = QOL.alerts(Sim, s, Sim.stats(s), {});
  assert.ok(al.some(a => a.kind === "overbook" && a.w === "web" && a.sev === 3), "an overbooked alert");
});

test("deliverability: signed-future contracts count over their window; a contract that ends first does not", () => {
  const s = sb(3);
  const cap = Sim.capacity(s, Sim.stats(s)).web;                 // 16 web servers, anchor 15
  s.contracts.push(serving(s, "web", 10, 60, { start: s.day + 30, end: s.day + 90 }));   // signed, starts in 30 days
  const peak = Sim.commitmentPeak(s, "web", s.day + 20, s.day + 110);
  assert.equal(peak, 15 + 10, "anchor + the future contract");
  assert.equal(Sim.commitmentPeak(s, "web", s.day, s.day + 25), 15, "before it starts only the anchor");
  const f = Sim.deliverable(s, webOffer(s, 3, 20));
  assert.equal(f.peak, 25);
  assert.ok(f.over && f.free === Math.max(0, cap - 25));
  // an offer that starts after the future contract ended sees only the anchor
  const g = Sim.deliverable(s, webOffer(s, 1, 95, 30));
  assert.equal(g.peak, 15);
  assert.ok(!g.over);
});

test("capacityAt: pending hardware counts only if it is installed by that day", () => {
  const s = sb(4);
  s.cash = 5000;
  assert.ok(Sim.apply(s, { type: "buy", item: "sw", rack: "A3" }).ok);
  for (let i = 0; i < 6; i++) assert.ok(Sim.apply(s, { type: "buy", item: "cpu", rack: "A3" }).ok);
  const st = Sim.stats(s), now = Sim.capacityAt(s, s.day, st).web, eta = K.SHIP_DAYS + K.INSTALL_DAYS;
  assert.equal(Sim.capacityAt(s, s.day + eta - 1, st).web, now, "not yet installed");
  assert.equal(Sim.capacityAt(s, s.day + eta + 3, st).web, now + 6, "installed by then");
  assert.equal(Sim.capacity(s, st).web, now + 6, "capacity() = everything on its way");
  // an offer starting before the servers arrive cannot count them
  const early = Sim.deliverable(s, webOffer(s, 5, 2)), late = Sim.deliverable(s, webOffer(s, 5, 20));
  assert.ok(early.over && !late.over, `early free ${early.free}, late free ${late.free}`);
});

test("walk-away: countdown, doubled patience in the grace period, the anchor stays (pays penalties) until day 90", () => {
  // the v0.4.2 anchor rule (it may walk after the grace) is kept behind K.ANCHOR_STAYS 0; D71 (on by default, D81) is
  // tested in test/v046.test.js
  const A0 = K.ANCHOR_STAYS; K.ANCHOR_STAYS = 0;
  try {
  const s = sb(5);
  s.cash = 1e5;
  for (const r of s.racks) r.devices = [];              // nothing serves anything: the anchor misses too
  const c = serving(s, "infer", 20, 400);
  s.contracts.push(c);
  const anchor = s.contracts.find(x => x.anchor);
  assert.equal(Sim.walkIn(s, c), null, "not at risk before a miss");
  Sim.advance(s, 5);
  assert.equal(Sim.patience(s, c), K.SLA_WALK_DAYS * K.GRACE_PATIENCE);
  assert.equal(Sim.walkIn(s, c), K.SLA_WALK_DAYS * K.GRACE_PATIENCE - c.streak, `walkIn ${Sim.walkIn(s, c)} streak ${c.streak}`);
  Sim.advance(s, K.SLA_WALK_DAYS + 2);
  assert.ok(s.contracts.includes(c), "doubled patience: still here after the normal patience");
  assert.ok(anchor.penaltyPaid > 0, "the anchor pays less (penalties) while missed");
  Sim.advance(s, K.SLA_WALK_DAYS * K.GRACE_PATIENCE);
  assert.ok(!s.contracts.includes(c) && c.walked, "walks after the doubled patience");
  assert.ok(s.contracts.includes(anchor), `the anchor cannot walk before day ${K.GRACE_DAYS} (day ${s.day})`);
  assert.equal(Sim.walkIn(s, anchor), Math.max(0, K.GRACE_DAYS - s.day), "its countdown is the grace period");
  Sim.advance(s, K.GRACE_DAYS - s.day + 1.5);
  assert.ok(anchor.walked, "after the grace it walks (its streak is long past the patience)");
  // after the grace: normal patience for a new streak
  const t = sb(6);
  t.cash = 1e5;
  Sim.advance(t, K.GRACE_DAYS + 1);
  const d = serving(t, "infer", 20, 400);
  t.contracts.push(d);
  Sim.advance(t, 3);
  assert.equal(Sim.patience(t, d), K.SLA_WALK_DAYS);
  Sim.advance(t, K.SLA_WALK_DAYS);
  assert.ok(d.walked);
  } finally { K.ANCHOR_STAYS = A0; }
});

test("starter GPU offer: with the GPU chapter and no GPU, one 1-2 card GPU offer is always on the board", () => {
  const s = sb(7);
  s.cash = 50;                                           // cannot afford a card: before v0.4.2 no GPU offer appeared at all
  for (let i = 0; i < 60; i++) {
    Sim.advance(s, 1);
    const g = s.offers.filter(o => !o.bts && (o.w === "train" || o.w === "infer"));
    assert.ok(g.length >= 1, `day ${s.day}: a GPU offer on the board`);
  }
  const st = s.offers.find(o => o.starter) || s.log.find(l => /starter gpu offer/.test(l));
  assert.ok(st, "a starter was made");
  const o = s.offers.find(x => x.starter);
  if (o) {
    const card = Sim.bestCard(s, o.w);
    assert.ok(o.units <= 2 * card.u + 1e-9 && o.units >= 0.5 * card.u, `${o.units} units vs card ${card.u}`);
    if (Sim.isJob(o)) assert.ok(o.days >= 60, "a starter job leaves time to buy and install");
  }
  // once a GPU is installed, no more starters
  const t = sb(7);
  t.offers = t.offers.filter(o => o.w === "web");
  assert.equal(Sim.needsStarter(t), true);
  rack(t, "B1").devices = [mk(t, "sw"), mk(t, "c1")];
  assert.equal(Sim.needsStarter(t), false);
});

test("web is unbounded and price-elastic (D61): offers keep coming at high volume, cheaper the more you hold", () => {
  // price factor: flat up to WEB_DREF, then monotonically decreasing, never below the floor
  let prev = 2;
  for (let h = 0; h <= 400; h += 5) {
    const f = Sim.webPriceAt(h);
    assert.ok(f <= prev + 1e-12, `monotone at ${h}`);
    assert.ok(f >= K.WEB_FLOOR - 1e-12 && f <= 1, `bounded at ${h}`);
    if (h <= K.WEB_DREF) assert.equal(f, 1, "flat up to the old market size");
    prev = f;
  }
  assert.equal(Sim.webPriceAt(10000), K.WEB_FLOOR);
  // a campaign-like state holding 150 web units a day still gets web offers, priced with the discount
  const s = sb(8);
  s.cash = 3000;
  Sim.advance(s, 1);
  s.contracts.push(serving(s, "web", 135, 1000, { sla: 0 }));   // sla 0: never missed, so it does not walk away
  const old = new Set(s.offers.map(o => o.id)), seen = [];
  for (let i = 0; i < 60; i++) { Sim.advance(s, 1); for (const o of s.offers) if (o.w === "web" && !old.has(o.id) && !o.renewOf && !seen.includes(o)) seen.push(o); }
  assert.ok(seen.length >= 4, `${seen.length} web offers at 150 units held`);
  const f150 = Sim.webPriceAt(150);
  for (const o of seen) {
    assert.ok(o.pf <= Sim.webPriceAt(149) + 1e-4, `discounted: pf ${o.pf}`);
    assert.ok(o.price <= o.spot * (1 + K.CONTRACT_PREMIUM) * (1 + K.QUOTE_SPREAD) * o.repAdj * f150 * 1.05 + 1e-4, `price ${o.price} spot ${o.spot} pf ${o.pf} rep ${o.repAdj}`);
    assert.ok(o.units <= Math.max(K.WEB_CAP_MIN, K.WEB_CAP_FRAC * Sim.capacity(s, Sim.stats(s)).web) + 1, `sane size ${o.units}`);
  }
  // a renewal keeps the discount it was signed at (existing book does not get cheaper when you grow)
  const c = s.contracts.find(x => x.w === "web" && !x.anchor);
  c.pf = 0.8; c.end = s.day + 5; c.renewOffered = false;
  Sim.advance(s, 1);
  const r = s.offers.find(o => o.renewOf === c.id);
  if (r) assert.equal(r.pf, 0.8);
  // determinism + save/load with elastic offers on the board
  const t = JSON.parse(JSON.stringify(s));
  Sim.advance(s, 40); Sim.advance(t, 40);
  assert.equal(JSON.stringify(s), JSON.stringify(t));
});
