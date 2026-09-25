"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Sim = require("../js/sim.js");

const fresh = (seed = 1, opts) => Sim.newGame(seed, opts);
const rack = (s, id) => Sim.rackById(s, id);

test("new game: two web racks, 18 slots, starting cash", () => {
  const s = fresh();
  assert.equal(s.racks.length, 18);
  assert.equal(s.cash, Sim.K.START_CASH);
  assert.equal(rack(s, "A1").devices.length, 9);
  assert.equal(rack(s, "C6").devices.length, 0);
  assert.equal(s.chapter, 0);
});

test("determinism: same seed and actions give identical state", () => {
  const run = () => {
    const s = fresh(42);
    Sim.advance(s, 20);
    Sim.apply(s, { type: "buy", item: "cpu", rack: "A1" });
    Sim.advance(s, 200);
    return JSON.stringify([s.cash, s.day, s.roomT, s.news, s.market, s.hidden]);
  };
  assert.equal(run(), run());
});

test("seeds change hidden truths across games", () => {
  const reals = new Set(), deaths = new Set();
  for (let i = 1; i < 40; i++) { const s = fresh(i); reals.add(s.hidden.realExotic); deaths.add(s.hidden.nanofabDies); }
  assert.deepEqual([...reals].sort(), ["lattice", "photon"]);
  assert.equal(deaths.size, 2);
});

test("buy: pays now, ships 6 days, installs 2 days with a technician", () => {
  const s = fresh();
  const cash0 = s.cash;
  assert.ok(Sim.apply(s, { type: "buy", item: "sw", rack: "B1" }).ok);
  assert.equal(s.cash, cash0 - 25);
  assert.equal(rack(s, "B1").pending.length, 1);
  Sim.advance(s, 7.75);
  assert.equal(rack(s, "B1").devices.length, 0, "not installed before 8 days");
  Sim.advance(s, 0.5);
  assert.equal(rack(s, "B1").devices.length, 1);
  assert.equal(rack(s, "B1").pending.length, 0);
});

test("technicians limit parallel installs to 3", () => {
  const s = fresh();
  for (const id of ["B1", "B2", "B3", "B4"]) Sim.apply(s, { type: "buy", item: "sw", rack: id });
  Sim.advance(s, 6.25);
  assert.equal(Sim.busyTechs(s), 3);
  assert.equal(s.jobs.filter(j => j.phase === "wait").length, 1);
});

test("constraints: U, rack kW, grid kW, cash, tank compatibility", () => {
  const s = fresh();
  s.day = 80; s.cash = 1e6;
  const r = rack(s, "C1");
  for (let i = 0; i < 5; i++) assert.ok(Sim.apply(s, { type: "buy", item: "c1", rack: "C1" }).ok || i === 5);
  // 5 x 6 kW = 30 kW: full on power; 20U used
  const res = Sim.check(s, { type: "buy", item: "sw", rack: "C1" });
  assert.equal(res.ok, false);
  assert.match(res.msg, /U|kW/);
  assert.equal(Sim.check(s, { type: "mode", rack: "C1", mode: "boost" }).ok, false, "boost would exceed rack kW");
  s.day = 460;
  assert.match(Sim.check(s, { type: "buy", item: "lat1", rack: "C2" }).msg, /tank/);
  s.cash = 1;
  assert.equal(Sim.check(s, { type: "buy", item: "cpu", rack: "C2" }).ok, false);
  void r;
});

test("grid cap blocks purchases past 250 kW", () => {
  const s = fresh();
  s.day = 80; s.cash = 1e6;
  let bought = 0;
  for (const r of s.racks) for (let i = 0; i < 4; i++) if (Sim.apply(s, { type: "buy", item: "c1", rack: r.id }).ok) bought++;
  assert.ok(Sim.gridKwAll(s) <= Sim.K.GRID_KW + 1e-9);
  assert.ok(bought < 18 * 4);
});

test("roofline: compute card wins training, memory card wins inference", () => {
  const s = fresh();
  const perf = (item, w) => {
    const p = Sim.shallowClone(s);
    const r = Sim.rackById(p, "C1");
    r.devices = [{ uid: 1, type: "sw" }, { uid: 2, type: item }];
    r.workload = w;
    return Sim.stats(p).perRack.C1.out[w];
  };
  assert.ok(perf("c1", "train") > perf("m1", "train"));
  assert.ok(perf("m1", "infer") > perf("c1", "infer"));
});

test("network: a GPU rack without a switch earns nothing; training needs more network", () => {
  const s = fresh();
  const r = rack(s, "C1");
  r.devices = [{ uid: 1, type: "c1" }];
  assert.equal(Sim.stats(s).perRack.C1.out.train, 0);
  r.devices = [{ uid: 1, type: "sw" }, ...[2, 3, 4, 5].map(u => ({ uid: u, type: "c1" }))];
  assert.equal(Sim.stats(s).perRack.C1.netF, 1, "4 GPUs x 4 = 16 = one switch");
  r.devices.push({ uid: 6, type: "cpu" });
  assert.ok(Sim.stats(s).perRack.C1.netF < 1);
});

test("heat: summer has less cooling capacity; room temperature has inertia", () => {
  assert.ok(Sim.seasonAt(200).heatCap < Sim.seasonAt(20).heatCap);
  const s = fresh();
  s.roomT = 18;
  const target = Sim.stats(s).tTarget;
  Sim.advance(s, 1);
  assert.ok(s.roomT > 18 && s.roomT < target, "moves toward target but not instantly");
});

test("throttling above 32C inlet", () => {
  assert.equal(Sim.throttleAt(31), 1);
  assert.ok(Sim.throttleAt(34) < 1);
  assert.ok(Sim.throttleAt(60) >= 0.5);
});

test("hot neighbours raise a rack's inlet temperature", () => {
  const s = fresh();
  const full = u => [{ uid: u, type: "sw" }, ...[1, 2, 3, 4].map(i => ({ uid: u * 10 + i, type: "c1" }))];
  rack(s, "C2").devices = full(2);
  const alone = Sim.stats(s, { eq: true }).perRack.C2.inlet;
  rack(s, "C1").devices = full(1); rack(s, "C3").devices = full(3);
  const packed = Sim.stats(s, { eq: true }).perRack.C2.inlet;
  assert.ok(packed > alone + 1);
});

test("markets saturate: oversupply sells at a quarter price", () => {
  const s = fresh();
  const st0 = Sim.stats(s);
  assert.ok(st0.supply.web < st0.mk.web.demand);
  const r = rack(s, "B1");
  r.devices = [{ uid: 900, type: "sw" }];
  for (let i = 0; i < 19; i++) r.devices.push({ uid: 901 + i, type: "cpu" });
  const r2 = rack(s, "B2");
  r2.devices = [{ uid: 990, type: "sw" }];
  for (let i = 0; i < 19; i++) r2.devices.push({ uid: 991 + i, type: "cpu" });
  const st = Sim.stats(s);
  const p = st.mk.web.price, D = st.mk.web.demand, S = st.supply.web;
  assert.ok(S > D);
  assert.ok(Math.abs(st.revenue.web - p * (D + 0.25 * (S - D))) < 1e-9);
});

test("generation launch drops compute prices and resale of older cards", () => {
  const s = fresh(3);
  s.cash = 1e6;
  Sim.advance(s, 80);
  Sim.apply(s, { type: "buy", item: "c1", rack: "B1" });
  Sim.advance(s, 10);
  const d = rack(s, "B1").devices[0];
  Sim.advance(s, 385 - s.day);
  const pBefore = Sim.marketAt(s, s.day).train.price, rBefore = Sim.resale(s, d);
  Sim.advance(s, 10);
  assert.ok(Sim.marketAt(s, s.day).train.price < pBefore * 0.8);
  assert.ok(Sim.resale(s, d) < rBefore * 0.7);
  assert.ok(Sim.shopItems(s).includes("c2"));
});

test("fake exotic vendor: 60% field performance, dies at day 840; real one keeps shipping", () => {
  const s = fresh(5);
  s.cash = 1e6;
  Sim.advance(s, 900);
  const fake = s.hidden.fakeExotic, real = s.hidden.realExotic;
  assert.equal(s.vendors[fake].dead, true);
  assert.equal(s.vendors[real].dead, false);
  const realTop = Object.values(s.items).find(i => i.vendor === real && i.model === 2);
  assert.ok(Sim.shopItems(s).includes(realTop.key));
  assert.ok(Object.values(s.items).filter(i => i.vendor === fake).every(i => i.field === 0.6));
});

test("benchmark signal: real vendor's curve accelerates, fake one flattens", () => {
  for (const seed of [1, 2, 3, 4]) {
    const s = fresh(seed);
    Sim.advance(s, 830);
    const r = s.bench[s.hidden.realExotic], f = s.bench[s.hidden.fakeExotic];
    assert.ok(r.at(-1).v > f.at(-1).v, `seed ${seed}: real ends higher`);
    assert.ok(f[3].v > r[3].v * 0.95, `seed ${seed}: fake looks as good early on`);
  }
});

test("PM-900: boosts bandwidth while alive, bricks the rack when Nanofab dies", () => {
  let seed = 1, s;
  do { s = fresh(seed++); } while (!s.hidden.nanofabDies);
  s.cash = 1e6;
  Sim.advance(s, 530);
  const r = rack(s, "C1");
  r.workload = "infer";
  r.devices = [{ uid: 1, type: "sw" }, { uid: 2, type: "m1" }, { uid: 3, type: "m1" }];
  const base = Sim.stats(s).perRack.C1.raw.infer;
  r.devices.push({ uid: 4, type: "pm9" });
  assert.ok(Sim.stats(s).perRack.C1.raw.infer > base * 1.2);
  assert.ok(s.items.pm9.price < Sim.BASE_ITEMS.pm9.price, "pitched at a discount");
  Sim.advance(s, 800 - s.day);
  assert.equal(Sim.stats(s).perRack.C1.penalty, 0.6);
  assert.equal(Sim.resale(s, r.devices[3]), 0);
});

test("chapters unlock over time and gate the shop", () => {
  const s = fresh();
  assert.ok(!Sim.shopItems(s).includes("c1"));
  Sim.advance(s, 80);
  assert.ok(Sim.shopItems(s).includes("c1"));
  assert.equal(s.chapter, 2);
  Sim.advance(s, 400);
  assert.equal(s.chapter, 5);
});

test("tank conversion needs an empty rack and takes a technician", () => {
  const s = fresh();
  s.cash = 1e6;
  assert.equal(Sim.check(s, { type: "tank", rack: "A1" }).ok, false);
  assert.ok(Sim.apply(s, { type: "tank", rack: "C6" }).ok);
  Sim.advance(s, Sim.K.TANK_DAYS + 0.5);
  assert.equal(rack(s, "C6").tank, true);
});

test("move and sell round-trip", () => {
  const s = fresh();
  const uid = rack(s, "A1").devices[3].uid;
  assert.ok(Sim.apply(s, { type: "move", rack: "A1", uid, to: "A2" }).ok);
  Sim.advance(s, 1.5);
  assert.ok(rack(s, "A2").devices.some(d => d.uid === uid));
  const cash = s.cash, st = Sim.stats(s).net;
  assert.ok(Sim.apply(s, { type: "sell", rack: "A2", uid }).ok);
  Sim.advance(s, 1.5);
  assert.ok(s.cash > cash + st * 1.5 - 1, "got resale money");
});

test("game ends at day 1080 and doing nothing still survives", () => {
  const s = fresh();
  Sim.advance(s, 2000);
  assert.equal(s.over, "end");
  assert.ok(Sim.netWorth(s) > 0);
});

test("ablation flags switch mechanics off", () => {
  const s = fresh(1, { mech: { heat: false, gens: false, disrupt: false } });
  Sim.advance(s, 1000);
  assert.ok(!Sim.shopItems(s).includes("c2"));
  assert.ok(!Sim.shopItems(s).some(k => s.items[k].role === "exotic"));
  assert.equal(Sim.stats(s).perRack.A1.throttle, 1);
});
