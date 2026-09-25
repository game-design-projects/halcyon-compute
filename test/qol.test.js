"use strict";
/* v0.4 UI pass A: the pure UI logic in js/qol.js (no DOM). Every action it produces is an ordinary sim action. */
const test = require("node:test");
const assert = require("node:assert/strict");
const Sim = require("../js/sim.js");
const QOL = require("../js/qol.js");
const I18N = require("../js/i18n.js");
const L = (k, p) => I18N.tl(k, p, "en");
const K = Sim.K;

const sb = (seed = 1) => Sim.newGame(seed, { sandbox: true });
const rack = (s, id) => Sim.rackById(s, id);
const applyAll = (s, list) => list.map(a => { const r = Sim.apply(s, a); assert.ok(r.ok !== false, `${JSON.stringify(a)}: ${r.msg}`); return r; });

test("reason: classifies Sim.check rejections for show-not-tell feedback", () => {
  const s = sb(1);
  s.cash = 1;
  assert.equal(QOL.reason(Sim.check(s, { type: "buy", item: "c1", rack: "B1" }).msg), "cash");
  s.cash = 1e6;
  // fill A1 to the brim with web servers until the check says why it stops
  let res;
  for (let i = 0; i < 30; i++) { res = Sim.check(s, { type: "buy", item: "cpu", rack: "A1" }); if (!res.ok) break; Sim.apply(s, { type: "buy", item: "cpu", rack: "A1" }); }
  assert.ok(["space", "kw"].includes(QOL.reason(res.msg)), res.msg);
  assert.equal(QOL.reason("Grid limit 250 kW"), "grid");
  assert.equal(QOL.reason("Rack would draw 31.0 kW (limit 30)"), "kw");
  assert.equal(QOL.reason("Needs 2U, 1U free"), "space");
  assert.equal(QOL.reason("Fit-out needs $400k"), "cash");
  assert.equal(QOL.reason("Shelf full (6)"), "shelf");
  assert.equal(QOL.reason("Offer gone"), "other");
});

test("offerFit: spare capacity (installed + on its way − owed) vs the offer; hardware on order counts", () => {
  const s = Sim.newGame(7);
  const st = Sim.stats(s);
  const o = s.offers[0];
  const f = QOL.offerFit(Sim, s, o, st);
  const cap = Sim.capacity(s, st), owed = Sim.owedNow(s);
  assert.ok(Math.abs(f.free - Math.max(0, cap.web - owed.web)) < 1e-9);
  assert.equal(f.need, o.units);
  assert.equal(f.level, f.frac >= 1 ? "ok" : f.frac >= 0.5 ? "part" : "none");
  // order web servers for an empty rack: free capacity grows before they are installed
  s.cash = 5000;
  applyAll(s, [{ type: "buy", item: "sw", rack: "A3" }, ...Array.from({ length: 8 }, () => ({ type: "buy", item: "cpu", rack: "A3" }))]);
  const f2 = QOL.offerFit(Sim, s, o);
  assert.ok(f2.free > f.free + 7, `${f2.free} vs ${f.free}`);
});

test("servePreview: shows the racks that would serve an offer, without touching the state", () => {
  const s = Sim.newGame(7);
  s.cash = 5000;
  applyAll(s, [{ type: "buy", item: "sw", rack: "A3" }, ...Array.from({ length: 8 }, () => ({ type: "buy", item: "cpu", rack: "A3" }))]);
  Sim.advance(s, K.SHIP_DAYS + K.INSTALL_DAYS + 3);
  const o = s.offers.find(x => x.w === "web");
  const before = JSON.stringify(s);
  const racks = QOL.servePreview(Sim, s, o);
  assert.equal(JSON.stringify(s), before, "state untouched");
  assert.ok(Object.keys(racks).length >= 1, JSON.stringify(racks));
  assert.ok(Object.values(racks).reduce((a, x) => a + x, 0) > 0);
});

test("blueprint + blueprintDiff: copy a rack, paste onto an empty rack = the actions that rebuild it (switch first)", () => {
  const s = sb(3);
  s.cash = 1e5;
  applyAll(s, [{ type: "workload", rack: "B1", workload: "infer" }, { type: "buy", item: "sw", rack: "B1" }, { type: "buy", item: "m1", rack: "B1" }, { type: "buy", item: "m1", rack: "B1" }, { type: "mode", rack: "B1", mode: "eco" }]);
  const bp = QOL.blueprint(s, "B1");
  assert.deepEqual(bp.devices.slice().sort(), ["m1", "m1", "sw"]);
  assert.equal(bp.mode, "eco"); assert.equal(bp.workload, "infer");
  const d = QOL.blueprintDiff(s, bp, "B2");
  assert.equal(d.blocked, null);
  assert.deepEqual(d.actions.map(a => a.type + ":" + (a.item || a.workload || a.mode)), ["workload:infer", "buy:sw", "buy:m1", "buy:m1", "mode:eco"]);
  applyAll(s, d.actions);
  const r2 = rack(s, "B2");
  assert.deepEqual(r2.pending.map(x => x.type).sort(), ["m1", "m1", "sw"]);
  assert.equal(r2.mode, "eco"); assert.equal(r2.workload, "infer");
  // pasting again: nothing is missing, nothing to do
  assert.deepEqual(QOL.blueprintDiff(s, bp, "B2").actions, []);
  // a partial rack only orders what is missing
  applyAll(s, [{ type: "buy", item: "sw", rack: "B3" }]);
  assert.deepEqual(QOL.blueprintDiff(s, bp, "B3").actions.filter(a => a.type === "buy").map(a => a.item), ["m1", "m1"]);
  assert.equal(QOL.blueprint(s, "C6"), null, "an empty rack has no blueprint");
  assert.equal(QOL.nextEmptyRack(s, "B1"), "A3", "first empty rack in the hall");
});

test("fillPlan: shift+drag fill = as many orders as fit (U, kW, grid, cash), each an ordinary buy", () => {
  const s = sb(4);
  s.cash = 1e5;
  const op = { type: "buy", item: "cpu", rack: "B1" };
  const p = QOL.fillPlan(Sim, s, op);
  assert.ok(p.n >= 10, `n=${p.n}`);
  assert.ok(p.stop, "says why it stopped");
  assert.equal(p.cost, p.n * s.items.cpu.price);
  applyAll(s, p.actions);
  assert.ok(!Sim.check(s, op).ok, "the rack is full after the fill");
  assert.equal(rack(s, "B1").pending.length, p.n);
  s.cash = s.items.cpu.price * 2.5;
  assert.equal(QOL.fillPlan(Sim, s, { type: "buy", item: "cpu", rack: "B2" }).n, 2, "cash caps the fill");
});

test("undo: mode/workload/reorder/policy invert instantly; a buy undoes while it ships; a sale undoes via cancelJob then undoSell", () => {
  const s = sb(5);
  s.cash = 1e5;
  const stack = QOL.undoStack(20);
  const doIt = a => { const pre = QOL.undoPre(s, a); const r = Sim.apply(s, a); assert.ok(r.ok !== false, r.msg); stack.push(QOL.undoEntry(pre, a, s)); };
  const undo = () => { const u = stack.pop(Sim, s); assert.ok(u, "something to undo"); assert.ok(Sim.apply(s, u.inv).ok !== false); return u; };
  const r1 = rack(s, "A1");
  const mode0 = r1.mode;
  doIt({ type: "mode", rack: "A1", mode: "off" });
  assert.equal(r1.mode, "off");
  undo();
  assert.equal(r1.mode, mode0);
  const uid = r1.devices[4].uid;
  doIt({ type: "reorder", rack: "A1", uid, index: 0 });
  undo();
  assert.equal(r1.devices[4].uid, uid, "back in its slot");
  doIt({ type: "policy", key: "autoSwap", on: true });
  undo();
  assert.equal(s.policy.autoSwap, false);
  // a buy: undo while shipping = full refund (cancelJob)
  const cash0 = s.cash;
  doIt({ type: "buy", item: "c1", rack: "B1" });
  assert.ok(s.cash < cash0);
  const u = undo();
  assert.equal(u.inv.type, "cancelJob");
  assert.ok(Math.abs(s.cash - cash0) < 1, "refunded");
  assert.equal(rack(s, "B1").pending.length, 0);
  // a buy that already shipped is stale: pop skips it
  doIt({ type: "buy", item: "c1", rack: "B2" });
  Sim.advance(s, K.SHIP_DAYS + 0.5);
  assert.equal(stack.pop(Sim, s), null, "stale entries are skipped");
  // a sale: first as cancelJob while the technician works, then as undoSell after it sold
  const d = r1.devices[0];
  doIt({ type: "sell", rack: "A1", uid: d.uid });
  assert.equal(stack.peek(Sim, s).inv.type, "cancelJob");
  Sim.advance(s, K.SELL_DAYS + 0.5);
  const u2 = stack.peek(Sim, s);
  assert.equal(u2.inv.type, "undoSell");
  undo();
  assert.ok(r1.devices.some(x => x.uid === d.uid) || r1.pending.some(x => x.uid === d.uid) || s.shelf.some(x => x.uid === d.uid), "bought back");
  assert.equal(QOL.undoEntry({}, { type: "signContract", id: "x" }, s), null, "signing has no clean inverse");
});

test("alerts: no switch, failed part, idle capacity and runway are listed, most severe first", () => {
  const s = sb(6);
  s.cash = 1e5;
  applyAll(s, [{ type: "buy", item: "cpu", rack: "C1" }]);
  let st = Sim.stats(s);
  let al = QOL.alerts(Sim, s, st, { runway: 20 });
  assert.ok(al.some(a => a.kind === "nosw" && a.rack === "C1"));
  assert.ok(al.some(a => a.kind === "runway" && a.n === 20));
  assert.ok(al[0].sev >= al[al.length - 1].sev, "sorted by severity");
  rack(s, "A1").devices[1].failed = true;
  st = Sim.stats(s);
  al = QOL.alerts(Sim, s, st);
  assert.ok(al.some(a => a.kind === "fail" && a.rack === "A1"));
  // idle: a full web rack with no contract to serve
  s.contracts = [];
  st = Sim.stats(s);
  assert.ok(QOL.alerts(Sim, s, st).some(a => a.kind === "idle"));
  rack(s, "A1").mode = "off"; rack(s, "A2").mode = "off";
  for (const r of s.racks) r.mode = "off";
  st = Sim.stats(s);
  assert.ok(!QOL.alerts(Sim, s, st).some(a => a.kind === "idle"), "parked racks are not idle alerts");
});

test("linkColor is stable per contract id; L() (I18N.t) interpolates and falls back to the key", () => {
  assert.equal(QOL.linkColor("c19"), QOL.linkColor("c19"));
  assert.notEqual(QOL.linkColor("c19"), QOL.linkColor("c20"));
  assert.equal(L("board.free", { free: 3, need: 6 }), "3/6");
  assert.equal(L("no.such.key"), "no.such.key");
});

test("pace chip ghosts the human-paced bots (Casual, Expert) up to the player's day", () => {
  const Bots = require("../bots/bots.js"), Pace = require("../js/pace.js");
  const R = Pace.createRunner(Sim, Bots, ["casual", "expert"]);
  R.init(11, false, 0);
  R.to(60.5);
  while (R.busy()) R.work(50);
  const rows = R.rows().rows;
  assert.equal(rows.casual.day, 60); assert.equal(rows.expert.day, 60);
  const s = Sim.newGame(11), mem = {};
  while (s.day < 60) { Bots.POLICIES.casual(s, mem); Sim.advance(s, 1); }
  assert.equal(rows.casual.score, Sim.score(s), "same as a casual game stopped at the same day");
  assert.equal(Bots.LABELS.casual, "Casual"); assert.equal(Bots.LABELS.expert, "Expert");
});

test("ui.js never shadows the string helper L (a local `L` would break every L() call in its scope)", () => {
  const src = require("fs").readFileSync(require("path").join(__dirname, "..", "js", "ui.js"), "utf8");
  const bad = src.split("\n").map((l, i) => [i + 1, l]).filter(([, l]) => /(\bconst|\blet|\bvar)\s+L\s*=|[,(]\s*L\s*=[^=>]|function\s+\w*\s*\(([^)]*,\s*)?L\s*[,)]/.test(l) && !/const L = window\.L/.test(l));
  assert.deepEqual(bad, [], bad.map(([n, l]) => `${n}: ${l.trim()}`).join("\n"));
});

test("auto-pause defaults (v0.4.2 hotfix): only cash < 0 is on; offer/failure/SLA are opt-in; old settings migrate", () => {
  const src = require("fs").readFileSync(require("path").join(__dirname, "..", "js", "ui.js"), "utf8");
  const m = src.match(/AP_V = (\d+), AP_DEFAULT = (\{[^}]*\})/);
  assert.ok(m, "AP_V / AP_DEFAULT declared");
  const def = Function(`return (${m[2]})`)();
  assert.deepEqual(def, { offer: false, fail: false, cash: true, sla: false });
  assert.ok(+m[1] >= 2, "settings version bumped past the v0.4.1 default");
  assert.match(src, /if \(!\(raw\.apV >= AP_V\)\)/, "saved settings older than AP_V are migrated to the new default");
  assert.match(src, /!SET\.apFirstDone/, "one teaching pause on the very first offer");
});
