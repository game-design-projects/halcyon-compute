"use strict";
/* v0.4.6 smart speed (DECISIONS D73): pure logic in js/qol.js (QOL.smartStep / QOL.urgentOf); ui.js smartTick wires it */
const test = require("node:test");
const assert = require("node:assert/strict");
const QOL = require("../js/qol.js");

/* ---------------- 4. smart speed (pure logic; the UI wires it in ui.js smartTick) ---------------- */
test("smart speed (D73): urgent events at >= 2x slow to 1x for HOLD days, then the chosen speed returns", () => {
  const { SMART, smartStep } = QOL;
  assert.equal(SMART.START, 2, "campaigns start at 2x");
  let r = smartStep(null, { on: true, speed: 4, day: 100, urgent: null });
  assert.deepEqual([r.state, r.set], [null, null], "quiet: nothing happens");
  r = smartStep(null, { on: true, speed: 4, day: 100, urgent: "offer" });
  assert.equal(r.set, null, "a new offer is not urgent (it waits 10-20 days)");
  r = smartStep(null, { on: true, speed: 4, day: 100, urgent: "sla" });
  assert.equal(r.set, 1); assert.equal(r.state.back, 4); assert.equal(r.why, "sla");
  let st = r.state;
  r = smartStep(st, { on: true, speed: 1, day: 100 + SMART.HOLD - 1, urgent: null });
  assert.equal(r.set, null, "holds 1x");
  r = smartStep(st, { on: true, speed: 1, day: 105, urgent: "fail" });
  assert.equal(r.set, null); assert.equal(r.state.until, 105 + SMART.HOLD, "a second urgent event extends the hold");
  st = r.state;
  r = smartStep(st, { on: true, speed: 1, day: st.until, urgent: null });
  assert.equal(r.set, 4, "back to the chosen speed"); assert.equal(r.state, null); assert.equal(r.why, "quiet");
  r = smartStep(null, { on: true, speed: 1, day: 3, urgent: "cash" });
  assert.equal(r.set, null, "at 1x there is nothing to slow down");
  r = smartStep(null, { on: false, speed: 8, day: 3, urgent: "lost" });
  assert.deepEqual([r.state, r.set], [null, null], "off: never touches the speed");
  r = smartStep({ back: 8, until: 50, why: "sla" }, { on: true, speed: 0, day: 60, urgent: null });
  assert.equal(r.set, null, "paused: it never un-pauses");
});

test("smart speed (D73): urgentOf ranks a lost customer > cash < 0 > failure > a new SLA miss; nothing on the first frame", () => {
  const snap = (o) => Object.assign({ failed: 0, miss: new Set(), neg: false, lost: 0 }, o);
  assert.equal(QOL.urgentOf(null, snap({ failed: 3 })), null);
  assert.equal(QOL.urgentOf(snap(), snap()), null);
  assert.equal(QOL.urgentOf(snap(), snap({ miss: new Set(["c1"]) })), "sla");
  assert.equal(QOL.urgentOf(snap({ miss: new Set(["c1"]) }), snap({ miss: new Set(["c1"]) })), null, "an ongoing miss is not new");
  assert.equal(QOL.urgentOf(snap(), snap({ failed: 1, miss: new Set(["c1"]) })), "fail");
  assert.equal(QOL.urgentOf(snap(), snap({ neg: true, failed: 1 })), "cash");
  assert.equal(QOL.urgentOf(snap(), snap({ lost: 1, neg: true })), "lost");
});
