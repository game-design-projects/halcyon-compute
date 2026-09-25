#!/usr/bin/env node
/* Replay an exported gameplay log (js/telemetry.js) through the deterministic sim, verify it against the recorded
 * snapshots, and print an analysis of how the player played.
 * usage: node tools/replay.js <log.json> [--bots] [--json out.json]
 * Needs the same game build as the log (log.build); a mismatch is reported, since replays can then diverge.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const Sim = require("../js/sim.js");

const args = process.argv.slice(2);
if (!args[0]) { console.error("usage: node tools/replay.js <log.json> [--bots] [--json out.json]"); process.exit(2); }
const log = JSON.parse(fs.readFileSync(args[0], "utf8"));
const withBots = args.includes("--bots");
const jsonOut = args.includes("--json") ? args[args.indexOf("--json") + 1] : null;
const money = k => (Math.abs(k) >= 1000 ? `$${(k / 1000).toFixed(2)}M` : `$${Math.round(k)}k`);
const fmtDay = d => `d${Math.round(d)}`;

console.log(`[replay] seed=${log.seed} sandbox=${log.sandbox} build=${log.build} continued=${log.continued} ` +
  `actions=${log.actions.length} events=${log.events.length} snaps=${log.snaps.length} viewport=${log.viewport} embedded=${log.embedded}`);
if (log.continued) console.log("[replay] WARNING: the session continued from a save; the replay starts from a fresh game, so state will diverge. Analysis only.");

/* 1. deterministic replay */
const s = Sim.newGame(log.seed, { sandbox: log.sandbox });
const timeline = [
  ...log.snaps.map(x => ({ d: x.d, kind: 0, x })),
  ...log.actions.filter(x => x.k === "act").map((x, i) => ({ d: x.d, kind: 1, i, x })),
].sort((a, b) => a.d - b.d || a.kind - b.kind || (a.i || 0) - (b.i || 0));
let drift = 0, maxDrift = 0, firstDrift = null, rejectedOnReplay = [];
for (const e of timeline) {
  if (s.over) break;
  if (e.d > s.day) Sim.advance(s, e.d - s.day);
  if (e.kind === 1) {
    const r = Sim.check(s, e.x.a);
    if (!r.ok) rejectedOnReplay.push({ d: e.d, a: e.x.a, msg: r.msg });
    else Sim.apply(s, e.x.a);
  } else {
    const dc = Math.abs(s.cash - e.x.cash);
    maxDrift = Math.max(maxDrift, dc);
    if (dc > 1 && firstDrift == null) firstDrift = { d: e.d, replay: s.cash, recorded: e.x.cash };
    drift++;
  }
}
const lastDay = Math.max(0, ...log.snaps.map(x => x.d), ...log.actions.map(x => x.d));
if (!s.over && lastDay > s.day) Sim.advance(s, lastDay - s.day);
const verified = !log.continued && firstDrift == null && rejectedOnReplay.length === 0;
console.log(`[replay] ${verified ? "VERIFIED" : "DIVERGED"}: ${drift} snapshots checked, max cash drift ${maxDrift.toFixed(2)}k` +
  (firstDrift ? `, first drift at ${fmtDay(firstDrift.d)} (replay ${money(firstDrift.replay)} vs recorded ${money(firstDrift.recorded)})` : "") +
  (rejectedOnReplay.length ? `, ${rejectedOnReplay.length} actions rejected on replay (first: ${JSON.stringify(rejectedOnReplay[0])})` : ""));

/* 2. analysis of how they played */
const acts = log.actions.filter(x => x.k === "act"), rej = log.actions.filter(x => x.k === "rej");
const byType = {};
for (const a of acts) byType[a.a.type] = (byType[a.a.type] || 0) + 1;
const rejByMsg = {};
for (const r of rej) { const m = String(r.msg).replace(/\$[\d.]+[kM]?/g, "$X").replace(/\d+/g, "N"); rejByMsg[m] = (rejByMsg[m] || 0) + 1; }
const ev = t => log.events.filter(e => e.t === t);
const speedTime = {};        // real seconds spent at each speed
let prev = { rt: 0, v: 1 };
for (const e of ev("speed")) { speedTime[prev.v] = (speedTime[prev.v] || 0) + (e.rt - prev.rt) / 1000; prev = { rt: e.rt, v: e.data.v }; }
const endRt = Math.max(0, ...log.events.map(e => e.rt), ...log.actions.map(e => e.rt));
speedTime[prev.v] = (speedTime[prev.v] || 0) + (endRt - prev.rt) / 1000;
const drawers = {};
for (const e of ev("drawer")) if (e.data.open) drawers[e.data.k] = (drawers[e.data.k] || 0) + 1;
const chapters = ev("chapter").filter(e => e.data.fresh).map(e => `${e.data.key}@${fmtDay(e.d)}`);
const idleGaps = [];        // long stretches of game time with no player action
let lastAct = 0;
for (const a of acts) { if (a.d - lastAct > 90) idleGaps.push(`${fmtDay(lastAct)}→${fmtDay(a.d)}`); lastAct = a.d; }
const over = ev("over")[0];
const report = {
  verified, seed: log.seed, build: log.build, realMinutes: +(endRt / 60000).toFixed(1), lastDay: Math.round(lastDay),
  outcome: over ? over.data.over : "unfinished", finalScore: over && over.data.summary ? over.data.summary.score : Sim.score(s),
  actionsByType: byType, rejections: rejByMsg, realSecondsAtSpeed: Object.fromEntries(Object.entries(speedTime).map(([k, v]) => [k, +v.toFixed(0)])),
  drawersOpened: drawers, chaptersSeen: chapters, idleGapsOver90Days: idleGaps, jsErrors: ev("jsError").map(e => e.data),
  toastsShown: ev("toast").length,
};
if (withBots) {
  const Bots = require("../bots/bots.js");
  for (const p of ["greedy", "planner"]) {
    const r = Bots.play(log.seed, p, { sandbox: log.sandbox });
    report[`${p}Score`] = Sim.score ? Sim.score(r.state) : r.worth;
  }
}
console.log(JSON.stringify(report, null, 1));
if (jsonOut) { fs.mkdirSync(path.dirname(jsonOut), { recursive: true }); fs.writeFileSync(jsonOut, JSON.stringify(report, null, 1)); }
process.exit(verified || log.continued ? 0 : 1);
