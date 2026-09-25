"use strict";
/* v2 rule-level tests: one or more per mechanic M19-M66 (docs/SPEC.md §2), plus campaign structure. */
const test = require("node:test");
const assert = require("node:assert/strict");
const Sim = require("../js/sim.js");
const K = Sim.K;

const camp = (seed = 1, opts) => Sim.newGame(seed, opts);
const sb = (seed = 1, opts) => Sim.newGame(seed, Object.assign({ sandbox: true }, opts || {}));
const rack = (s, id) => Sim.rackById(s, id);
const mk = (s, type, extra) => Object.assign({ uid: s.nextId++, type, born: s.day - 100, inst: s.day - 100 }, extra || {});
/* fill a rack: one switch + n cards of `type`, workload wl */
function fill(s, id, type, n, wl) {
  const r = rack(s, id);
  r.devices = [mk(s, "sw")];
  for (let i = 0; i < n; i++) r.devices.push(mk(s, type));
  if (wl) r.workload = wl;
  return r;
}
/* inject an event to fire on the next substep */
function inject(s, e) { s.events.splice(s.firedEvents, 0, Object.assign({ day: s.day }, e)); }
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(b));

/* ============ §1 structure ============ */
test("campaign: 1800 days, 17 chapters at the spec days", () => {
  assert.equal(K.END_DAY, 1800);
  assert.equal(Sim.CHAPTERS.length, 17);
  assert.deepEqual(Sim.CHAPTERS.map(c => c.day), [0, 30, 60, 120, 240, 300, 420, 480, 570, 660, 750, 840, 930, 1020, 1110, 1200, 1290]);
  for (const c of Sim.CHAPTERS) assert.ok(c.bullets.length >= 1 && c.bullets.length <= 4, c.key);
  const s = camp(3);
  for (const [i, c] of Sim.CHAPTERS.entries()) {
    Sim.advance(s, c.day - s.day);
    assert.equal(s.chapter, i, `chapter ${c.key} at d${c.day}`);
  }
});

test("sandbox unlocks every chapter at day 0", () => {
  const s = sb(4);
  assert.equal(s.day, 0);
  assert.equal(s.chapter, 16);
  for (const c of Sim.CHAPTERS) assert.ok(Sim.on(s, c.key), c.key);
  assert.ok(Sim.shopItems(s).includes("c1"), "GPUs on sale at d0");
  assert.ok(Sim.check(s, { type: "hire" }).ok);
  assert.ok(Sim.check(s, { type: "pr" }).ok);
  assert.ok(Sim.check(s, { type: "spine", hall: 1, row: 1 }).ok);
});

test("mechanics are inactive before their chapter (campaign)", () => {
  const s = camp(2);
  Sim.advance(s, 100);
  s.cash = 1e5;
  assert.match(Sim.check(s, { type: "hire" }).msg, /chapter 6/);
  assert.match(Sim.check(s, { type: "spine", hall: 1, row: 0 }).msg, /chapter 7/);
  assert.match(Sim.check(s, { type: "borrow", amount: 100 }).msg, /chapter 10/);
  assert.match(Sim.check(s, { type: "pr" }).msg, /chapter 15/);
  // no failures before ch6 even for hot, packed racks
  for (const id of ["B1", "B2", "B3", "C1"]) fill(s, id, "c1", 4, "train");
  Sim.advance(s, 190);
  assert.ok(s.racks.every(r => r.devices.every(d => !d.failed)));
  assert.equal(Sim.stats(s).costs.salaries, 0);
  assert.equal(Sim.stats(s).costs.transit, 0);
  Sim.advance(s, 20);
  assert.ok(Sim.check(s, { type: "hire" }).ok, "ops open at d300");
});

test("ablation flags for the new groups switch their chapter off", () => {
  const s = camp(1, { mech: { ops: false, fabric: false, investors: false } });
  Sim.advance(s, 1100);
  assert.equal(Sim.on(s, "ops"), false);
  assert.equal(Sim.on(s, "fabric"), false);
  assert.equal(Sim.on(s, "investors"), false);
  assert.equal(Sim.on(s, "contracts"), true);
  assert.equal(Sim.check(s, { type: "hire" }).ok, false);
  assert.equal(s.roundOffer, null);
});

test("score = founder equity; before investors it is net worth + earnings multiple", () => {
  const s = camp(5);
  Sim.advance(s, 500);
  const p = s.profitDays.reduce((a, x) => a + x, 0) / s.profitDays.length;
  assert.equal(s.equity.own, 1);
  assert.ok(near(Sim.score(s), Sim.netWorth(s) + Math.max(0, p) * 365 * 2));
});

test("lose: bankrupt below the credit line (fired: see M49)", () => {
  const s = sb(1);
  Sim.advance(s, 1);
  s.cash = -s.creditLimit - 1;
  Sim.advance(s, 0.25);
  assert.equal(s.over, "bankrupt");
});

test("summary lists the biggest measurable losses and 3 lessons", () => {
  const s = sb(2);
  s.cash = 1e5;
  for (const id of ["B1", "B2", "B3", "B4", "B5", "C1", "C2", "C3"]) fill(s, id, "c1", 4, "train");
  Sim.advance(s, 400);
  const sum = Sim.summary(s);
  assert.ok(sum.losses.length >= 2);
  assert.ok(sum.losses[0].total >= sum.losses[1].total);
  assert.ok(sum.lessons.length >= 1 && sum.lessons.length <= 3);
  assert.match(sum.lessons[0], /You lost \$/);
  assert.ok(sum.hidden.realExotic && typeof sum.hidden.demandCut === "boolean");
  assert.ok(near(sum.score, Sim.score(s)));
});

/* ============ ch5 generations ============ */
test("M19-M21: four launches (d390..1560), rumours ~60 days ahead, old gen discounted", () => {
  assert.deepEqual(Sim.GEN_LAUNCH, [390, 780, 1170, 1560]);
  const s = camp(8);
  const rum = [];   // collected while advancing: the feed keeps only the last 60 items
  for (let d = 0; d < 1165; d++) { Sim.advance(s, 1); for (const n of s.news) if (/rumored/.test(n.title) && !rum.includes(n.day)) rum.unshift(n.day); }
  assert.equal(rum.length, 3);
  for (const [i, d] of rum.slice().reverse().entries()) assert.ok(Math.abs(Sim.GEN_LAUNCH[i] - 60 - d) <= 8);
  const c3 = s.items.c3.price;
  Sim.advance(s, 10);
  assert.equal(Sim.currentGen(s), 4);
  assert.ok(s.items.c3.oldGen, "old gen flagged");
  assert.ok(s.items.c3.price < c3 * 0.75, "old gen on sale");
  assert.ok(Sim.shopItems(s).includes("c4") && Sim.shopItems(s).includes("c3") && !Sim.shopItems(s).includes("c2"));
  const it = s.items.c4, prev = s.items.c3;
  assert.ok(it.F / prev.F > 1.4 && it.F / prev.F < 1.7);
});

/* ============ ch6 operations ============ */
test("M22: failure hazard is a bathtub, doubles every 5C above 30C; failed parts produce and draw nothing", () => {
  const s = sb(1);
  const it = s.items.c1;
  const at = (age, inlet) => Sim.hazard(s, { inst: s.day - age, born: 0 }, it, inlet);
  s.day = 1000;
  assert.ok(at(5, 25) > at(200, 25) * 2.5, "infant mortality");
  assert.ok(at(900, 25) > at(200, 25) * 2, "wear-out");
  assert.ok(near(at(200, 35) / at(200, 25), 2), "x2 per 5C");
  s.day = 0;
  const r = fill(s, "B1", "c1", 4, "train");
  const before = Sim.stats(s).perRack.B1;
  r.devices[1].failed = true;
  const after = Sim.stats(s).perRack.B1;
  assert.ok(near(after.out.train, before.out.train * 3 / 4));
  assert.ok(near(after.kw, before.kw - 6));
});

test("M22: failures are seeded and happen more in hot racks", () => {
  const count = (hot) => {
    let n = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const s = sb(seed);
      s.repairAuto = false;
      for (const id of ["B1", "B2", "B3", "B4"]) fill(s, id, "c1", 4, "train");
      if (hot) s.mech.heat = true; else s.mech.heat = false;
      Sim.advance(s, 300);
      n += s.racks.reduce((a, r) => a + r.devices.filter(d => d.failed).length, 0);
    }
    return n;
  };
  const a = count(true), b = count(true);
  assert.equal(a, b, "deterministic");
  assert.ok(count(false) <= a);
});

test("M23: repair = parts wait + 1 technician day, 8 % of list; auto-repair policy queues it", () => {
  const s = sb(1);
  s.repairAuto = false;
  const r = fill(s, "B1", "c1", 2, "train");
  const d = r.devices[1];
  d.failed = true;
  assert.ok(Sim.apply(s, { type: "repairPolicy", on: false }).ok);
  const cash = s.cash;
  assert.ok(Sim.apply(s, { type: "repair", rack: "B1", uid: d.uid }).ok);
  assert.ok(near(cash - s.cash, Math.round(Sim.BASE_ITEMS.c1.price * K.REPAIR_FRAC * 10) / 10));
  Sim.advance(s, K.REPAIR_PARTS_DAYS + K.REPAIR_DAYS - 0.5);
  assert.equal(d.failed, true);
  Sim.advance(s, 0.75);
  assert.equal(d.failed, false);
  // auto policy
  Sim.apply(s, { type: "repairPolicy", on: true });
  r.devices[2].failed = true;
  Sim.advance(s, 1);
  assert.ok(s.jobs.some(j => j.kind === "repair" && j.uid === r.devices[2].uid));
});

test("M24: hire takes 7 days, 1-10 technicians, firing costs 10 days of salary", () => {
  const s = sb(1);
  assert.ok(Sim.apply(s, { type: "hire" }).ok);
  Sim.advance(s, 6.75);
  assert.equal(s.techs, 3);
  Sim.advance(s, 0.5);
  assert.equal(s.techs, 4);
  assert.ok(near(Sim.stats(s).costs.salaries, 4 * K.SALARY));
  for (let i = 0; i < 10; i++) Sim.apply(s, { type: "hire" });
  assert.equal(s.techs + s.hires.length, K.TECH_MAX);
  const cash = s.cash;
  assert.ok(Sim.apply(s, { type: "fire" }).ok);
  assert.ok(near(cash - s.cash, 10 * K.SALARY));
  s.techs = 1;
  assert.equal(Sim.check(s, { type: "fire" }).ok, false);
});

test("M25: spares shelf (12 slots): store, install without shipping, swap for a failed card in 1 day", () => {
  const s = sb(1);
  const r = fill(s, "B1", "c1", 3, "train");
  const uid = r.devices[3].uid;
  assert.ok(Sim.apply(s, { type: "store", rack: "B1", uid }).ok);
  Sim.advance(s, 1.25);
  assert.equal(s.shelf.length, 1);
  assert.ok(near(Sim.stats(s).perRack.B1.kw, 0.4 + 12), "stored card draws nothing");
  // swap a spare for a failed card
  const bad = r.devices[1];
  bad.failed = true;
  const cash = s.cash;
  assert.match(Sim.check(s, { type: "repair", rack: "B1", uid: bad.uid }).msg, /spare/);
  Sim.apply(s, { type: "repair", rack: "B1", uid: bad.uid });
  assert.equal(s.cash, cash, "a swap costs no parts");
  Sim.advance(s, 1.25);
  assert.ok(r.devices.some(d => d.uid === uid), "spare now in the rack");
  assert.ok(s.shelf.some(d => d.uid === bad.uid && d.failed), "failed card on the shelf");
  // install from the shelf: technician only, no shipping
  const s2 = sb(2);
  s2.shelf.push(mk(s2, "m1"));
  fill(s2, "C1", "m1", 0, "infer");
  assert.ok(Sim.apply(s2, { type: "unstore", uid: s2.shelf[0].uid, rack: "C1" }).ok);
  Sim.advance(s2, K.INSTALL_DAYS + 0.25);
  assert.equal(rack(s2, "C1").devices.length, 2);
  // capacity
  for (let i = 0; i < 12; i++) s2.shelf.push(mk(s2, "cpu"));
  assert.match(Sim.check(s2, { type: "store", rack: "A1", uid: rack(s2, "A1").devices[1].uid }).msg, /Shelf full/);
});

/* ============ ch7 fabric ============ */
test("M26: row spine costs $160k, takes 20 days, draws 3 kW and pools the row's network", () => {
  const s = sb(1);
  s.cash = 1e4;
  const r1 = fill(s, "B1", "c1", 4, "train"), r2 = rack(s, "B2");
  r2.devices = [mk(s, "c1"), mk(s, "c1")];      // no switch of its own
  r2.workload = "train";
  r1.devices.push(mk(s, "sw"));                  // spare capacity in B1
  assert.equal(Sim.stats(s).perRack.B2.netF, 0);
  const g0 = Sim.gridKwAll(s), cash = s.cash;
  assert.ok(Sim.apply(s, { type: "spine", hall: 1, row: 1 }).ok);
  assert.equal(cash - s.cash, K.SPINE_COST);
  assert.ok(near(Sim.gridKwAll(s), g0 + K.SPINE_KW));
  Sim.advance(s, 19.75);
  assert.ok(!s.spines["1-1"]);
  Sim.advance(s, 0.5);
  assert.ok(s.spines["1-1"]);
  assert.ok(Sim.stats(s).perRack.B2.netF > 0.9, "pooled via the spine");
});

test("M27: frontier market pays 1.6x, only for >=12 training GPUs on one spine", () => {
  const s = sb(1);
  for (const id of ["B1", "B2"]) fill(s, id, "c1", 4, "train");
  s.spines["1-1"] = true;
  let st = Sim.stats(s);
  assert.equal(st.revenue.frontier, 0, "8 GPUs: no frontier");
  fill(s, "B3", "c1", 4, "train");
  st = Sim.stats(s);
  assert.ok(st.cluster["1-1"].frontier);
  assert.ok(st.revenue.frontier > 0);
  assert.ok(near(st.mk.frontier.price, st.mk.train.price * 1.6));
  assert.ok(near(st.mk.frontier.demand, 30));
  assert.ok(near(Sim.marketAt(s, 360).frontier.demand, 45), "grows 1.5x per year");
});

test("M28: transit caps web + inference output; changes land after 5 days", () => {
  const s = sb(1);
  fill(s, "B1", "m1", 4, "infer");
  s.transit = 0;
  let st = Sim.stats(s);
  const need = st.supply.web / st.transitF + st.supply.infer / st.transitF;
  assert.ok(need > (K.TRANSIT_FREE) * 10, "demand exceeds the free uplink");
  assert.ok(st.transitF < 1);
  assert.ok(near(st.supply.web + st.supply.infer, K.TRANSIT_FREE * 10));
  assert.ok(Sim.apply(s, { type: "transit", delta: 5 }).ok);
  Sim.advance(s, 4.75);
  assert.equal(s.transit, 0);
  Sim.advance(s, 0.5);
  assert.equal(s.transit, 5);
  st = Sim.stats(s);
  assert.equal(st.transitF, 1);
  assert.ok(near(st.costs.transit, 5 * K.TRANSIT_COST));
});

/* ============ ch8 contracts ============ */
test("M29/M31: offers arrive every ~25 days, expire in 15, quoted within +-15 % of today's spot", () => {
  const s = sb(6);
  const seen = new Map();
  for (let d = 0; d < 300; d++) {
    Sim.advance(s, 1);
    for (const o of s.offers) if (!seen.has(o.id)) seen.set(o.id, Object.assign({ at: s.day }, o));
  }
  const offers = [...seen.values()].filter(o => !o.bts);   // build-to-suit offers have their own timer and premium (M29b)
  assert.ok(offers.length >= 8 && offers.length <= 20, `${offers.length} offers in 300 days`);
  for (const o of offers) {
    const q = o.price / o.repAdj;
    assert.ok(q >= o.spot * 0.85 - 1e-3 && q <= o.spot * 1.15 + 1e-3, "quote vs spot (after the reputation factor)");
    assert.ok(near(o.expires - o.at, 15, 0.1) || o.expires - o.at <= 15);
    for (const k of ["cust", "icon", "w", "units", "days", "sla", "penalty"]) assert.ok(o[k] != null, k);
  }
  assert.ok(s.offers.every(o => s.day < o.expires));
});

test("M30: contracts are served first at their price; shortfall below SLA pays the penalty", () => {
  const s = sb(1);
  fill(s, "B1", "c1", 4, "train");
  const supply = Sim.stats(s).supply.train;
  s.offers.push({ id: "cX", cust: "Test", icon: "x", foreign: false, w: "train", units: supply * 0.5, days: 90, price: 1, spot: 0.25, sla: 0.9, penalty: 1.5, expires: 20 });
  assert.ok(Sim.apply(s, { type: "signContract", id: "cX" }).ok);
  let st = Sim.stats(s);
  assert.ok(near(st.revenue.contracts, supply * 0.5 * 1));
  assert.equal(st.costs.penalties, 0);
  // now promise more than we have
  s.contracts[0].units = supply * 2;
  st = Sim.stats(s);
  assert.ok(near(st.costs.penalties, (0.9 * supply * 2 - supply) * 1.5));
  assert.ok(near(st.revenue.train, 0), "nothing left for spot");
  Sim.advance(s, 3);
  assert.ok(s.contracts[0].missed > 0);
  assert.ok(s.losses.sla > 0);
  assert.ok(Sim.apply(s, { type: "declineContract", id: "nope" }).ok === false);
});

/* ============ ch9 memory ============ */
test("M32: GPU list price and resale follow the HBM index", () => {
  const s = sb(1);
  const d = mk(s, "c1");
  rack(s, "B1").devices = [d];
  const p0 = s.items.c1.price, r0 = Sim.resale(s, d);
  s.hbm.index = 1.8;
  Sim.advance(s, 1);  // daily tick reprices
  const f = K.HBM_BASE + K.HBM_SLOPE * s.hbm.index;
  assert.equal(s.items.c1.price, Math.round(s.items.c1.base * f));
  assert.ok(s.items.c1.price > p0 * 1.2);
  assert.ok(Sim.resale(s, d) > r0 * 1.2);
  assert.equal(s.items.sw.price, 25, "non-GPU prices unaffected");
});

test("M33: shortages triple GPU shipping; about 1/3 of scare stories are false", () => {
  const s = sb(1);
  s.hbm.shortage = true;
  assert.ok(Sim.apply(s, { type: "buy", item: "c1", rack: "B1" }).ok);
  assert.equal(s.jobs.at(-1).left, K.SHORT_SHIP_DAYS);
  assert.ok(Sim.apply(s, { type: "buy", item: "sw", rack: "B1" }).ok);
  assert.equal(s.jobs.at(-1).left, K.SHIP_DAYS, "non-GPU parts ship normally");
  assert.ok(s.losses.shortage > 0);
  let real = 0, fake = 0;
  for (let seed = 1; seed <= 30; seed++) for (const x of camp(seed).hidden.scares) x.real ? real++ : fake++;
  const share = fake / (real + fake);
  assert.ok(share > 0.2 && share < 0.45, `false share ${share}`);
  // a real shock raises the index and sets the shortage flag
  const c = camp(3);
  const shock = c.events.find(e => e.kind === "hbmShock");
  Sim.advance(c, shock.day + 25 - c.day);
  assert.ok(c.hbm.shortage && c.hbm.index > 1.2);
  const scare = c.news.find(n => n.cat === "memory" && n.day < shock.day && n.day >= shock.day - 40);
  assert.ok(scare, "leading news before the shock");
});

test("M34: forward order pays today's price and lands on the shelf in 45 days, no shortage delay", () => {
  const s = sb(1);
  s.hbm.shortage = true;
  const price = s.items.m1.price, cash = s.cash;
  assert.ok(Sim.apply(s, { type: "forward", item: "m1" }).ok);
  assert.equal(cash - s.cash, price);
  s.hbm.index = 2; Sim.advance(s, 44.5);
  assert.equal(s.shelf.length, 0);
  Sim.advance(s, 0.75);
  assert.equal(s.shelf.length, 1);
  assert.equal(s.shelf[0].type, "m1");
});

/* ============ ch10 finance ============ */
test("M35: borrow in $100k steps up to 40 % of net worth at 9 %/yr", () => {
  const s = sb(1);
  s.cash = 1000;
  const lim = 0.4 * Sim.netWorth(s);
  assert.equal(Sim.check(s, { type: "borrow", amount: 50 }).ok, false);
  assert.ok(Sim.apply(s, { type: "borrow", amount: 100 }).ok);
  assert.equal(s.debt, 100);
  assert.ok(near(Sim.stats(s).costs.interest, 100 * 0.09 / 360));
  assert.equal(Sim.check(s, { type: "borrow", amount: Math.ceil(lim / 100) * 100 + 100 }).ok, false);
  assert.ok(Sim.apply(s, { type: "repay", amount: 100 }).ok);
  assert.equal(s.debt, 0);
});

test("M36: leasing: no upfront, 0.45 %/day, excluded from net worth, returned by a 1-day job", () => {
  const s = sb(1);
  fill(s, "B1", "c1", 0, "train");
  const cash = s.cash, w0 = Sim.netWorth(s);
  assert.ok(Sim.apply(s, { type: "lease", item: "c1", rack: "B1" }).ok);
  assert.equal(s.cash, cash);
  assert.ok(near(Sim.netWorth(s), w0));
  assert.ok(near(Sim.stats(s).costs.lease, Sim.BASE_ITEMS.c1.price * K.LEASE_RATE));
  Sim.advance(s, 8.25);
  const d = rack(s, "B1").devices.find(x => x.leased);
  assert.ok(d);
  assert.equal(Sim.check(s, { type: "sell", rack: "B1", uid: d.uid }).ok, false);
  assert.ok(Sim.apply(s, { type: "returnLease", rack: "B1", uid: d.uid }).ok);
  assert.equal(Sim.stats(s).costs.lease, 0);
  Sim.advance(s, 1.25);
  assert.ok(!rack(s, "B1").devices.some(x => x.leased));
});

test("M37: 21 % tax on positive quarterly profit after 3-year straight-line depreciation", () => {
  const s = sb(1);
  Sim.apply(s, { type: "buy", item: "c1", rack: "B1" });
  assert.ok(near(s.deprec[0].rate, Sim.BASE_ITEMS.c1.price / 1080));   // v3: c1 list price is a balance constant (was 180)
  Sim.advance(s, 89.75 - s.day);
  s.fin = { rev: 1000, opex: 400, dep: 100 };
  Sim.advance(s, 0.25);
  assert.ok(Math.abs(s.lastQuarter.tax - 0.21 * 500) < 1, `tax ${s.lastQuarter.tax}`);
  Sim.advance(s, 89.75 - (s.day % 90));
  s.fin = { rev: 100, opex: 400, dep: 100 };
  Sim.advance(s, 0.25);
  assert.equal(s.lastQuarter.tax, 0, "no tax on a loss");
});

/* ============ ch11 facilities ============ */
test("M38: Hall 2 costs $1.4M, takes 75 days and adds racks D1..F6 on the same grid", () => {
  const s = sb(1);
  s.cash = 2000;
  assert.ok(Sim.apply(s, { type: "buildHall" }).ok);
  assert.equal(s.cash, 600);
  Sim.advance(s, 74.75);
  assert.equal(s.racks.length, 18);
  Sim.advance(s, 0.5);
  assert.equal(s.racks.length, 36);
  assert.ok(rack(s, "D1") && rack(s, "F6") && rack(s, "E3").hall === 2);
  assert.equal(Sim.stats(s).halls.length, 2);
  s.cash = 1e5;
  assert.ok(Sim.apply(s, { type: "buy", item: "c1", rack: "F6" }).ok);
  assert.ok(Sim.check(s, { type: "grid" }).ok, "grid still a shared constraint, with a higher tier");
});

test("M39/M40: an outage stops output unless a UPS + generator (diesel, carbon) covers it", () => {
  const s = sb(1);
  fill(s, "B1", "m1", 4, "infer");
  s.transit = 20;
  const base = Sim.stats(s).gross;
  s.outage = { start: s.day, until: s.day + 2 };
  let st = Sim.stats(s);
  assert.equal(st.gross, 0);
  assert.ok(near(st.outageLoss, base));
  s.ups = true;
  st = Sim.stats(s);
  assert.ok(near(st.gross, base));
  assert.ok(st.costs.diesel > 0 && st.dieselKw > 0 && st.draw === 0 && st.carbon > 0);
  // outages are scheduled ~2 per year from ch11
  const c = camp(4);
  const outs = c.events.filter(e => e.kind === "outage");
  assert.ok(outs.every(e => e.day >= 750));
  assert.ok(outs.length >= 2 && outs.length <= 16, `${outs.length} outages`);
  const s2 = sb(2); s2.cash = 1000;
  assert.ok(Sim.apply(s2, { type: "ups" }).ok);
  Sim.advance(s2, K.UPS_DAYS + 0.25);
  assert.equal(s2.ups, true);
});

test("M41: CRAC upgrade adds 45 kW of cooling to one hall", () => {
  const s = sb(1);
  s.cash = 1000;
  const cap = Sim.stats(s).heatCap;
  assert.ok(Sim.apply(s, { type: "crac", hall: 1 }).ok);
  Sim.advance(s, K.CRAC_DAYS + 0.25);
  assert.ok(near(Sim.stats(s).heatCap, cap + 45, 0.02));
});

/* ============ ch12 energy ============ */
test("M42: spot power noise +-15 % daily; heat waves spike it x2-3 with a 5-day warning", () => {
  const s = sb(1);
  for (let i = 0; i < 30; i++) { Sim.advance(s, 1); assert.ok(s.power.noise >= 0.85 && s.power.noise <= 1.15); }
  const waves = s.events.filter(e => e.kind === "heatWave");
  assert.ok(waves.length >= 5);
  for (const w of waves) {
    assert.ok(w.mult >= 2 && w.mult <= 3);
    assert.ok(s.events.some(e => e.day === w.day - 5 && /Heat wave/.test(e.title || "")));
  }
  const unit = Sim.seasonAt(s.day).powerPrice / K.PUE_BASE * s.power.noise;
  s.heatWave = { start: s.day, until: s.day + 5, mult: 2.5 };
  assert.ok(near(Sim.stats(s).spot, unit * 2.5));
});

test("M43: PPA fixes the price for 540 days and is paid even when unused", () => {
  const s = sb(1);
  Sim.advance(s, 30);
  const q = Sim.ppaQuote(s);
  assert.ok(q > 0 && q < 0.1);
  assert.equal(Sim.check(s, { type: "ppa", kw: 30 }).ok, false, "25 kW steps");
  assert.ok(Sim.apply(s, { type: "ppa", kw: 100 }).ok);
  assert.equal(s.ppa.end - s.ppa.start, 540);
  const st = Sim.stats(s);
  assert.ok(st.facility < 100);
  assert.equal(st.draw, 0);
  assert.ok(near(st.costs.power, 100 * s.ppa.price), "unused PPA power still paid");
  assert.equal(st.green, 1);
});

test("M44: solar yields 0-60 kW by season and the battery shaves 40 % of spike premiums", () => {
  const s = sb(1);
  s.solar = true;
  assert.ok(Sim.stats(s, { day: 200 }).solarKw > 55);
  assert.ok(Sim.stats(s, { day: 20 }).solarKw < 10);
  s.power.noise = 1;
  s.heatWave = { start: 0, until: 5, mult: 3 };
  const unit = Sim.seasonAt(0).powerPrice / K.PUE_BASE;
  assert.ok(near(Sim.stats(s).spot, unit * (1 + 2 * 0.6)));
  s.solar = false;
  assert.ok(near(Sim.stats(s).spot, unit * 3));
});

/* ============ ch13 environment ============ */
test("M45: cooling mode sets PUE; before ch13 PUE 1.3 is baked in (power bill unchanged from v1)", () => {
  const c = camp(1);
  Sim.advance(c, 100);
  const st0 = Sim.stats(c);
  assert.equal(st0.halls[0].pue, 1.3);
  assert.ok(near(st0.costs.power, st0.kw * Sim.seasonAt(c.day).powerPrice));
  const s = sb(1);
  let st = Sim.stats(s);
  assert.ok(near(st.facility, st.kw * 1.15));
  s.cash = 1000;
  assert.ok(Sim.apply(s, { type: "cooling", hall: 1, mode: "chiller" }).ok);
  Sim.advance(s, K.COOL_SWITCH_DAYS + 0.25);
  st = Sim.stats(s);
  assert.equal(s.halls[0].cooling, "chiller");
  assert.ok(near(st.facility, st.kw * 1.45));
});

test("M46: evaporative cooling uses water; a drought cuts evaporative cooling by 40 %", () => {
  const s = sb(1);
  let st = Sim.stats(s);
  assert.ok(st.waterRate > 0);
  const cap = st.heatCap;
  s.drought = { start: 0, until: 30 };
  assert.ok(near(Sim.stats(s).heatCap, cap * 0.6));
  s.halls[0].cooling = "chiller";
  st = Sim.stats(s);
  assert.equal(st.waterRate, 0);
  assert.ok(near(st.heatCap, cap), "chillers don't care");
  assert.ok(camp(9).events.filter(e => e.kind === "drought").every(e => e.day >= 930));
});

test("M47: carbon = grid energy x a falling intensity; PPA and solar cut it", () => {
  const s = sb(1);
  fill(s, "B1", "c1", 4, "train");
  const st = Sim.stats(s);
  assert.ok(near(st.carbon, st.draw * 24 / 1000 * K.GRID_CO2));
  assert.ok(Sim.stats(s, { day: 1440 }).carbon / Sim.stats(s, { day: 1440 }).draw < st.carbon / st.draw);
  s.ppa = { kw: 25, price: 0.05, start: 0, end: 540 };
  assert.ok(Sim.stats(s).carbon < st.carbon);
  Sim.advance(s, 5);
  assert.ok(s.env.carbon > 0);
});

/* ============ ch14 investors ============ */
test("M48: equity round offers every ~120 days; accepting dilutes you and brings cash", () => {
  const s = sb(1);
  Sim.advance(s, 20);
  const o = s.roundOffer;
  assert.ok(o && o.amount > 0 && o.pct > 0 && o.pct <= 0.2);
  assert.match(o.pitch, /gentle/);
  const cash = s.cash;
  assert.ok(Sim.apply(s, { type: "acceptRound", id: o.id }).ok);
  assert.ok(near(s.cash, cash + o.amount));
  assert.ok(near(s.equity.own, 1 - o.pct));
  assert.ok(s.board && s.board.target > 0);
  Sim.advance(s, 140);
  assert.ok(s.roundOffer || s.log.some(l => /round offer/.test(l) && !l.includes(o.id)), "a second offer ~120 days later");
});

test("M49: two missed board targets in a row get you fired at half your equity value", () => {
  const s = sb(1);
  Sim.advance(s, 20);
  Sim.apply(s, { type: "acceptRound", id: s.roundOffer.id });
  s.board.target = 1e9;
  Sim.advance(s, 181);
  assert.equal(s.board.misses, 1);
  assert.ok(!s.over);
  s.board.target = 1e9;
  Sim.advance(s, 181);
  assert.equal(s.over, "fired");
  assert.ok(s.firedScore > 0);
  assert.equal(Sim.score(s), s.firedScore);
});

test("M50: buyback buys 1 % at the current company value", () => {
  const s = sb(1);
  assert.equal(Sim.check(s, { type: "buyback" }).ok, false, "own 100 % already");
  s.equity.own = 0.8; s.cash = 1e4;
  const cost = 0.01 * Sim.companyValue(s), cash = s.cash;
  assert.ok(Sim.apply(s, { type: "buyback" }).ok);
  assert.ok(near(s.equity.own, 0.81));
  assert.ok(near(cash - s.cash, cost));
});

test("M51: score = ownership x company value (earnings multiple, reputation factor)", () => {
  const s = sb(1);
  Sim.advance(s, 100);
  s.equity.own = 0.7;
  s.rep = 100;
  const p = s.profitDays.reduce((a, x) => a + x, 0) / s.profitDays.length;
  assert.ok(near(Sim.score(s), 0.7 * (Sim.netWorth(s) + Math.max(0, p) * 730) * 1.2));
});

/* ============ ch15 reputation ============ */
test("M52: reputation falls with SLA misses and rises with fulfilled contracts", () => {
  const s = sb(1);
  s.contracts.push({ id: "k1", cust: "T", foreign: false, w: "train", units: 50, days: 20, price: 0.3, sla: 0.9, penalty: 0.1,
    start: 0, end: 20, delivered: 0, missed: 0, penaltyPaid: 0, missDays: 0, streak: 0 });
  const r0 = s.rep;
  Sim.advance(s, 10);
  assert.ok(s.rep < r0 - 1, "missed deliveries hurt");
  const s2 = sb(1);
  s2.contracts.push({ id: "k2", cust: "T", foreign: false, w: "web", units: 1, days: 5, price: 0.3, sla: 0.9, penalty: 0.1,
    start: 0, end: 5, delivered: 0, missed: 0, penaltyPaid: 0, missDays: 0, streak: 0 });
  Sim.advance(s2, 6);
  assert.equal(s2.contractLog.fulfilled, 1);
  assert.ok(s2.rep > 60.5);
});

test("M53: reputation moves demand share (+-10 %), contract prices and the score factor (+-20 %)", () => {
  const s = sb(1);
  const d0 = Sim.marketAt(s, 0).infer.demand;
  s.rep = 100;
  assert.ok(near(Sim.marketAt(s, 0).infer.demand, d0 * 1.1));
  assert.ok(near(Sim.repFactor(s), 1.2));
  s.rep = 20;
  assert.ok(near(Sim.repFactor(s), 0.8));
  assert.ok(near(Sim.marketAt(s, 0).web.demand, 30 * 0.9));
});

test("M54: PR +8 reputation decaying over 90 days; backfires during a scandal half the time", () => {
  const s = sb(1);
  s.cash = 1e4;
  assert.ok(Sim.apply(s, { type: "pr" }).ok);
  assert.ok(near(Sim.repOf(s), 68));
  s.day += 45;
  assert.ok(near(Sim.repOf(s), 64));
  s.day += 50;
  assert.ok(near(Sim.repOf(s), 60));
  let backfires = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const t = sb(seed); t.cash = 1e4; t.scandalUntil = 100;
    Sim.apply(t, { type: "pr" });
    if (t.rep < 60) backfires++;
  }
  assert.ok(backfires >= 4 && backfires <= 16, `${backfires}/20 backfired`);
});

test("M55: press events: an outage without backup makes the news and costs reputation", () => {
  const s = sb(1);
  inject(s, { kind: "outage", until: 3 });
  Sim.advance(s, 0.25);
  assert.ok(s.news.some(n => n.cat === "press"));
  assert.ok(s.rep <= 60 - K.REP_OUTAGE - 4 + 0.01);
  assert.ok(s.scandalUntil > s.day);
});

/* ============ ch16 policy ============ */
test("M56: proposals get a vote date 60-120 days out, two indirect signals, and a seeded outcome", () => {
  const s = sb(3);
  assert.equal(s.policies.length, 3);
  for (const p of s.policies) assert.ok(p.vote - p.announceDay >= 60 && p.vote - p.announceDay <= 120);
  Sim.advance(s, s.policies[0].vote + 1);
  const p = s.policies[0];
  assert.ok(p.announced && p.signals.length === 2);
  assert.ok(p.status === "passed" || p.status === "failed");
  const again = sb(3); Sim.advance(again, p.vote + 1);
  assert.equal(again.policies[0].status, p.status, "seeded");
  // signals point the right way on average
  let upPass = 0, upAll = 0, dnPass = 0, dnAll = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const t = sb(seed);
    for (const q of t.policies) {
      const h = t.hidden.policy[q.id];
      if (h.p0 > 0.6) { upAll++; if (h.u < h.p0) upPass++; } else if (h.p0 < 0.5) { dnAll++; if (h.u < h.p0) dnPass++; }
    }
  }
  assert.ok(upPass / upAll > dnPass / dnAll);
});

function forcePolicy(s, kind) {
  const p = s.policies.find(x => x.kind === kind);
  s.hidden.policy[p.id].u = 0;           // will pass
  inject(s, { kind: "policyAnnounce", pid: p.id });
  inject(s, { kind: "policyVote", pid: p.id });
  Sim.advance(s, 0.25);
  assert.equal(p.status, "passed");
  return p;
}
test("M57: a carbon tax charges per tonne and ramps every quarter", () => {
  const s = sb(1);
  fill(s, "B1", "c1", 4, "train");
  forcePolicy(s, "carbonTax");
  assert.equal(s.policyFx.carbonTax, K.CARBON_TAX0);
  const st = Sim.stats(s);
  assert.ok(near(st.costs.carbonTax, K.CARBON_TAX0 * st.carbon));
  Sim.advance(s, 91);
  assert.ok(near(s.policyFx.carbonTax, K.CARBON_TAX0 + K.CARBON_TAX_STEP));
});

test("M58: the efficiency mandate fines halls above PUE 1.3 after the deadline", () => {
  const s = sb(1);
  forcePolicy(s, "mandate");
  const dl = s.policyFx.mandate.deadline;
  assert.ok(near(dl - s.day, K.MANDATE_GRACE, 0.01));
  s.halls[0].cooling = "chiller";
  assert.equal(Sim.stats(s).costs.fines, 0, "grace period");
  s.day = dl;
  assert.equal(Sim.stats(s).costs.fines, K.MANDATE_FINE);
  s.halls[0].cooling = "evap";
  assert.equal(Sim.stats(s).costs.fines, 0);
});

test("M59: export controls quota the newest generation and end foreign contracts", () => {
  const s = sb(1);
  s.cash = 1e5;
  s.contracts.push({ id: "f1", cust: "Kanto AI", foreign: true, w: "web", units: 1, days: 90, price: 0.3, sla: 0.9, penalty: 0.1,
    start: 0, end: 90, delivered: 0, missed: 0, penaltyPaid: 0, missDays: 0, streak: 0 });
  forcePolicy(s, "export");
  assert.equal(s.contracts.length, 0);
  s.exportUsed = K.EXPORT_QUOTA;
  assert.match(Sim.check(s, { type: "buy", item: "c1", rack: "B1" }).msg, /Export quota/);
  s.exportUsed = 0;
  assert.ok(Sim.apply(s, { type: "buy", item: "c1", rack: "B1" }).ok);
  assert.equal(s.exportUsed, 1);
});

test("M60: lobbying shifts the pass probability by 15 % and sometimes leaks to the press", () => {
  let leaks = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const s = sb(seed); s.cash = 1e4;
    const p = s.policies[0];
    inject(s, { kind: "policyAnnounce", pid: p.id });
    Sim.advance(s, 0.25);
    assert.ok(Sim.apply(s, { type: "lobby", policy: p.id, dir: -1 }).ok);
    assert.ok(near(p.shift, -0.15));
    assert.equal(Sim.check(s, { type: "lobby", policy: p.id, dir: 1 }).ok, false, "once per proposal");
    if (s.leaks.length) {
      leaks++;
      Sim.advance(s, 31);
      assert.ok(s.news.some(n => /lobbying revealed/i.test(n.title)));
    }
  }
  assert.ok(leaks >= 3 && leaks <= 18, `${leaks}/30 leaked`);
});

/* ============ ch17 disruption ============ */
test("M61/M64: exotics ship at d1290/1440/1590, PM-900 pitch at d1330", () => {
  assert.equal(Sim.BASE_ITEMS.lat1.avail, 1290);
  assert.equal(Sim.BASE_ITEMS.pho2.avail, 1440);
  assert.equal(Sim.BASE_ITEMS.lat3.avail, 1590);
  const s = camp(2);
  Sim.advance(s, 1285);
  assert.ok(!Sim.shopItems(s).some(k => s.items[k].role === "exotic"));
  Sim.advance(s, 50);
  assert.ok(Sim.shopItems(s).includes("lat1") && Sim.shopItems(s).includes("pho1") && Sim.shopItems(s).includes("pm9"));
});

test("M62: immersion tanks keep most of their heat out of the room", () => {
  const s = sb(1);
  const r = rack(s, "C1");
  r.devices = [mk(s, "sw"), ...Array.from({ length: 9 }, () => mk(s, "lat1"))];
  const open = Sim.stats(s).roomHeat;
  r.tank = true;
  assert.ok(Sim.stats(s).roomHeat < open - 0.7 * Sim.stats(s).perRack.C1.kw);
});

test("M63: a pilot reveals measured field performance after 10 days in a rack", () => {
  const s = camp(4);
  s.cash = 1e5;
  Sim.advance(s, 1291);
  Sim.apply(s, { type: "tank", rack: "C6" });
  Sim.advance(s, 9);
  const fake = s.hidden.fakeExotic, item = fake === "lattice" ? "lat1" : "pho1";
  Sim.apply(s, { type: "buy", item: "sw", rack: "C6" });
  Sim.apply(s, { type: "buy", item, rack: "C6" });
  Sim.advance(s, 8.5 + 9);
  assert.equal(s.measured[fake], undefined);
  Sim.advance(s, 2);
  assert.equal(s.measured[fake], 0.6);
  assert.ok(s.news.some(n => /Pilot result/.test(n.title)));
});

test("M65: the demand disruption is real in about half the seeds and cuts inference demand 35 %", () => {
  let real = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const s = camp(seed);
    if (s.hidden.demandCut) real++;
    if (seed > 4) continue;
    Sim.advance(s, 1450);
    assert.equal(s.market.dmult.infer, s.hidden.demandCut ? K.DEMAND_CUT : 1);
    assert.ok(s.news.some(n => /Preprint/.test(n.title)));
    assert.ok(s.news.some(n => s.hidden.demandCut ? /reproduced/.test(n.title) : /fail to replicate/.test(n.title)));
  }
  assert.ok(real >= 5 && real <= 15);
});

test("M66: after the real startup's second model the incumbents cut prices 25 %", () => {
  const s = camp(1);
  Sim.advance(s, 1445);
  const p = s.items.c4.base;
  Sim.advance(s, 10);
  assert.equal(s.items.c4.base, Math.round(p * 0.75));
  assert.equal(s.market.gpuCut, 0.75);
});

/* ============ determinism and persistence ============ */
function driver(seed) {  // a seeded random player that pokes every action type
  let st = seed >>> 0;
  const R = () => { let t = (st = (st + 0x6D2B79F5) >>> 0); t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const pick = a => a[Math.floor(R() * a.length)];
  const act = s => {
    const r = pick(s.racks), d = r.devices.length ? pick(r.devices) : null, shop = Sim.shopItems(s);
    const opts = [
      { type: "buy", item: pick(shop), rack: r.id }, { type: "buy", item: pick(shop), rack: r.id },
      d && { type: "sell", rack: r.id, uid: d.uid }, d && { type: "move", rack: r.id, uid: d.uid, to: pick(s.racks).id },
      { type: "mode", rack: r.id, mode: pick(["eco", "std", "boost"]) }, { type: "workload", rack: r.id, workload: pick(["train", "infer"]) },
      { type: "grid" }, { type: "tank", rack: r.id }, { type: "hire" }, { type: "fire" }, { type: "repairPolicy", on: R() < 0.7 },
      d && { type: "repair", rack: r.id, uid: d.uid }, d && { type: "store", rack: r.id, uid: d.uid },
      s.shelf.length && { type: "unstore", uid: pick(s.shelf).uid, rack: r.id },
      { type: "spine", hall: 1, row: Math.floor(R() * 3) }, { type: "transit", delta: pick([-2, 1, 2, 4]) },
      s.offers.length && { type: pick(["signContract", "declineContract"]), id: pick(s.offers).id },
      { type: "forward", item: pick(shop) }, { type: "borrow", amount: 100 }, { type: "repay", amount: 100 },
      { type: "lease", item: pick(shop), rack: r.id }, d && { type: "returnLease", rack: r.id, uid: d.uid },
      { type: "buildHall" }, { type: "ups" }, { type: "crac", hall: 1 }, { type: "ppa", kw: pick([25, 50, 100]) }, { type: "solar" },
      { type: "cooling", hall: pick([1, 2]), mode: pick(["evap", "chiller"]) },
      s.roundOffer && { type: pick(["acceptRound", "declineRound"]), id: s.roundOffer.id }, { type: "buyback" }, { type: "pr" },
      s.policies.length && { type: "lobby", policy: pick(s.policies).id, dir: pick([1, -1]) },
    ].filter(Boolean);
    const n = Math.floor(R() * 3);
    for (let i = 0; i < n; i++) {
      if (s.cash < 300) continue;   // keep a reserve
      Sim.apply(s, pick(opts));
    }
  };
  return { act, get state() { return st; }, set state(v) { st = v; } };
}
function playRandom(seed, opts, until) {
  const s = Sim.newGame(seed, opts), drv = driver(seed * 7 + 1);
  s.cash += 1e5;    // a cushion: this driver tests determinism, not strategy
  while (!s.over && s.day < (until || K.END_DAY)) { drv.act(s); Sim.advance(s, 1); }
  return { s, drv };
}

/* ============ v3 sinks: Hall 3, grid tier 4, build-to-suit contracts (SPEC §2 M38b/M07b/M29b) ============ */
test("M38b: Hall 3 needs Hall 2, costs more, takes 120 days and adds racks G1..J6 (halls stay generic)", () => {
  const s = sb(1);
  s.cash = 1e5;
  assert.equal(s.halls.length, 3);
  assert.ok(Sim.apply(s, { type: "buildHall" }).ok, "no hall given: builds the next one (Hall 2)");
  assert.ok(!Sim.check(s, { type: "buildHall", hall: 3 }).ok, "Hall 3 waits for Hall 2");
  Sim.advance(s, K.HALL_DAYS + 1);
  const cash = s.cash;
  const chk = Sim.check(s, { type: "buildHall" });
  assert.ok(chk.ok && /Hall 3/.test(chk.msg), chk.msg);
  assert.ok(Sim.apply(s, { type: "buildHall" }).ok);
  assert.ok(near(cash - s.cash, K.HALL3_COST));
  assert.ok(!Sim.check(s, { type: "buildHall" }).ok, "one at a time / all built");
  Sim.advance(s, K.HALL3_DAYS - 0.5);
  assert.equal(s.racks.length, 36);
  Sim.advance(s, 1);
  assert.equal(s.racks.length, 54);
  assert.ok(rack(s, "G1") && rack(s, "J6") && rack(s, "H3").hall === 3);
  assert.equal(Sim.stats(s).halls.length, 3);
  assert.ok(Sim.apply(s, { type: "buy", item: "c1", rack: "J6" }).ok);
  assert.ok(Sim.apply(s, { type: "spine", hall: 3, row: 2 }).ok, "spines work in Hall 3");
  assert.ok(Sim.check(s, { type: "cooling", hall: 3, mode: "chiller" }).ok);
});

test("M07b: a 4th grid tier follows the 700 kW tier, with a long lead time", () => {
  const s = sb(1);
  s.cash = 1e5;
  for (const kw of [K.GRID_KW_UP, K.GRID_KW_UP2]) { assert.ok(Sim.apply(s, { type: "grid" }).ok); Sim.advance(s, 50); assert.equal(s.gridKw, kw); }
  const cash = s.cash;
  assert.ok(Sim.apply(s, { type: "grid" }).ok);
  assert.ok(near(cash - s.cash, K.GRID_COST3));
  Sim.advance(s, K.GRID_DAYS3 - 1);
  assert.equal(s.gridKw, K.GRID_KW_UP2);
  Sim.advance(s, 1.5);
  assert.equal(s.gridKw, K.GRID_KW_UP3);
  assert.ok(!Sim.check(s, { type: "grid" }).ok, "fully upgraded");
});

test("old saves with two halls still load, step and build Hall 2", () => {
  const s = sb(1);
  s.halls = s.halls.slice(0, 2);
  const t = JSON.parse(JSON.stringify(s));
  t.cash = 5000;
  assert.ok(Sim.apply(t, { type: "buildHall" }).ok);
  Sim.advance(t, K.HALL_DAYS + 1);
  assert.equal(t.racks.length, 36);
  assert.ok(Sim.check(t, { type: "buildHall" }).ok, "Hall 3 offered once Hall 2 stands");
});

function btsOffer(s) {
  s.nextBts = s.day;
  Sim.advance(s, 1);
  return s.offers.find(o => o.bts);
}
test("M29b: build-to-suit offers are big, long, high-SLA and need an up-front fit-out", () => {
  const s = sb(3);
  Sim.advance(s, 10);
  fill(s, "A3", "m1", 4, "infer"); fill(s, "A4", "c1", 4, "train");
  const o = btsOffer(s);
  assert.ok(o, "a build-to-suit offer arrives on its own timer");
  assert.ok(o.days >= 360 && o.sla >= 0.95 && o.lead > 0 && o.fitout > 0);
  assert.ok(near(o.penalty, o.price * K.BTS_PENALTY_MULT, 1e-3));
  const st = Sim.stats(s);
  assert.ok(o.units >= st.supply[o.w] * 0.4 || o.units >= K.BTS_MIN_UNITS, "big relative to today's output");
  s.cash = o.fitout - 1;
  assert.ok(!Sim.check(s, { type: "signContract", id: o.id }).ok, "needs the fit-out cash");
  s.cash = o.fitout + 100;
  assert.ok(Sim.apply(s, { type: "signContract", id: o.id }).ok);
  assert.ok(near(s.cash, 100), "fit-out paid up front");
  assert.ok(s.deprec.length > 0, "fit-out is capex (depreciated)");
  const c = s.contracts.find(x => x.id === o.id);
  assert.ok(near(c.start, s.day + o.lead) && near(c.end, c.start + o.days));
  const before = Sim.stats(s);
  assert.equal(before.cDel[c.id] || 0, 0, "nothing delivered during the lead time");
  assert.equal(before.revenue.contracts, 0);
  Sim.advance(s, o.lead + 1);
  const after = Sim.stats(s);
  assert.ok(after.cDel[c.id] > 0, "served once it starts");
});

test("M29b/M65: a real demand cut sends inference build-to-suit customers away (no penalty, fit-out sunk)", () => {
  for (const cut of [true, false]) {
    const s = sb(5);
    s.hidden.demandCut = cut;
    s.contracts.push({ id: "b1", cust: "T", icon: "x", foreign: false, bts: true, w: "infer", units: 50, days: 400, price: 0.3, sla: 0.95, penalty: 0.9,
      start: s.day, end: s.day + 400, delivered: 0, missed: 0, penaltyPaid: 0, missDays: 0, streak: 0 });
    s.contracts.push({ id: "b2", cust: "T", icon: "x", foreign: false, bts: true, w: "train", units: 50, days: 400, price: 0.3, sla: 0.95, penalty: 0.9,
      start: s.day, end: s.day + 400, delivered: 0, missed: 0, penaltyPaid: 0, missDays: 0, streak: 0 });
    inject(s, { kind: "demandShock", group: "disrupt" });
    Sim.advance(s, 0.25);
    assert.equal(s.contracts.some(c => c.id === "b1"), !cut, `inference BTS kept iff the cut is fake (cut=${cut})`);
    assert.ok(s.contracts.some(c => c.id === "b2"), "training BTS unaffected");
  }
});

test("full 1800-day campaign with a random-action driver is deterministic", () => {
  const a = playRandom(22).s, b = playRandom(22).s;   // seed 22: takes an equity round and reaches d1800 (re-check the seed when RNG draws change)
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.equal(a.over, "end", `game lasted ${a.day} days (${a.over})`);
  assert.ok(a.equity.rounds >= 1 && a.contractLog.signed >= 1 && a.racks.length >= 36, "the driver touched the late chapters (Hall 2+)");
  const c = playRandom(26).s;
  assert.notEqual(JSON.stringify(a.hidden), JSON.stringify(c.hidden));
});

test("save/load: a JSON round-trip keeps simulating identically (campaign and sandbox)", () => {
  for (const opts of [{}, { sandbox: true }]) {
    const { s, drv } = playRandom(33, opts, 700);
    const saved = JSON.stringify(s), load = JSON.parse(saved);
    assert.equal(JSON.stringify(load), saved);
    const d2 = driver(0); d2.state = drv.state;
    for (let i = 0; i < 500 && !s.over; i++) { drv.act(s); Sim.advance(s, 1); d2.act(load); Sim.advance(load, 1); }
    assert.equal(JSON.stringify(load), JSON.stringify(s));
  }
});

test("stats stays cheap on a busy late-game state", () => {
  const { s } = playRandom(5, { sandbox: true }, 900);
  const t = process.hrtime.bigint();
  for (let i = 0; i < 2000; i++) Sim.stats(s, { eq: true });
  const us = Number(process.hrtime.bigint() - t) / 2000 / 1000;
  assert.ok(us < 200, `stats ${us.toFixed(1)} us`);
});

/* ============ coyote-time undo: cancel a purchase while it is still shipping (docs/GAME_FEEL.md) ============ */
test("cancelOrder: full refund while shipping, the pending card is removed, books restored", () => {
  const s = sb(1);
  s.cash = 5000;
  Sim.advance(s, 0.5);
  const snap = { cash: s.cash, capex: s.totals.capex, dep: s.deprec.length, u: Sim.usedU(s, rack(s, "A1")) };
  assert.ok(Sim.apply(s, { type: "buy", item: "c1", rack: "A1" }).ok);
  const job = s.jobs[s.jobs.length - 1], uid = job.dev.uid, price = job.paid;
  assert.equal(job.phase, "ship");
  assert.ok(near(snap.cash - s.cash, price) && price > 0);
  Sim.advance(s, 1);   // mid-shipping
  const cash1 = s.cash;
  const chk = Sim.check(s, { type: "cancelOrder", uid });
  assert.ok(chk.ok && /refund/i.test(chk.msg), chk.msg);
  assert.ok(Sim.apply(s, { type: "cancelOrder", uid }).ok);
  assert.ok(near(s.cash - cash1, price), "refund is exactly the price paid");
  assert.equal(rack(s, "A1").pending.length, 0, "pending card removed");
  assert.equal(Sim.usedU(s, rack(s, "A1")), snap.u, "rack space freed");
  assert.ok(!s.jobs.some(j => j.dev && j.dev.uid === uid), "job removed");
  assert.equal(s.deprec.length, snap.dep, "no depreciation for a cancelled order");
  assert.ok(near(s.totals.capex, snap.capex));
  assert.ok(/cancel/.test(s.log[s.log.length - 1]), "log line");
  assert.ok(!Sim.check(s, { type: "cancelOrder", uid }).ok, "cannot cancel twice");
});

test("cancelOrder: rejected once shipping ends, for other jobs and for unknown ids", () => {
  const s = sb(1);
  s.cash = 5000;
  assert.ok(Sim.apply(s, { type: "buy", item: "c1", rack: "A1" }).ok);
  const uid = s.jobs[s.jobs.length - 1].dev.uid;
  Sim.advance(s, K.SHIP_DAYS + 0.25);   // now waiting for / being installed by a technician
  assert.notEqual(s.jobs.find(j => j.dev && j.dev.uid === uid).phase, "ship");
  const r = Sim.check(s, { type: "cancelOrder", uid });
  assert.ok(!r.ok && /shipped/i.test(r.msg), r.msg);
  assert.ok(!Sim.check(s, { type: "cancelOrder", uid: 999999 }).ok);
  assert.ok(!Sim.check(s, { type: "cancelOrder" }).ok);
  // a forward order (phase "contract") is not a coyote-time purchase
  assert.ok(Sim.apply(s, { type: "forward", item: "c1" }).ok);
  const f = s.jobs[s.jobs.length - 1];
  assert.ok(!Sim.check(s, { type: "cancelOrder", uid: f.dev.uid }).ok);
});

test("cancelOrder: a lease still shipping can be cancelled (nothing to refund)", () => {
  const s = sb(1);
  s.cash = 5000;
  const cash = s.cash;
  assert.ok(Sim.apply(s, { type: "lease", item: "c1", rack: "A2" }).ok);
  const uid = s.jobs[s.jobs.length - 1].dev.uid;
  assert.ok(Sim.apply(s, { type: "cancelOrder", uid }).ok);
  assert.equal(rack(s, "A2").pending.length, 0);
  assert.equal(s.cash, cash);
});

test("cancelOrder: deterministic, and a cancelled order leaves the game unchanged but for ids", () => {
  const run = cancel => {
    const s = sb(5);
    s.cash = 5000;
    Sim.advance(s, 3);
    Sim.apply(s, { type: "buy", item: "c1", rack: "B2" });
    const uid = s.jobs[s.jobs.length - 1].dev.uid;
    Sim.advance(s, 2);
    if (cancel) Sim.apply(s, { type: "cancelOrder", uid });
    Sim.advance(s, 200);
    return s;
  };
  assert.equal(JSON.stringify(run(true)), JSON.stringify(run(true)), "same actions, same state");
  const a = run(true), base = sb(5);
  base.cash = 5000;
  Sim.advance(base, 200 + 5);
  assert.ok(near(a.cash, base.cash, 1e-9), `cash ${a.cash} vs never-bought ${base.cash}`);
  assert.ok(near(Sim.score(a), Sim.score(base), 1e-9), `score ${Sim.score(a)} vs ${Sim.score(base)}`);
});
