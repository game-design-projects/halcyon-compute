#!/usr/bin/env node
/* Depth report: planner vs greedy vs idle over many seeds, with and without each mechanic.
 * usage: node bots/run.js [--seeds N] [--ablate] [--out reports/depth.json]
 * "Depth gap" = planner worth - greedy worth. If removing a mechanic shrinks the gap,
 * that mechanic is carrying strategic depth.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const Bots = require("./bots.js");

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const N = +arg("--seeds", 12);
const ablate = args.includes("--ablate");
const out = arg("--out", "reports/depth.json");

const VARIANTS = [["full", {}]];
if (ablate) VARIANTS.push(
  ["no heat/seasons", { heat: false }],
  ["no generations", { gens: false }],
  ["no disruption", { disrupt: false }],
  ["no network", { network: false }],
  ["no roofline", { roofline: false }],
);
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
const sd = a => { const m = mean(a); return Math.sqrt(mean(a.map(x => (x - m) ** 2))); };

const rows = [];
const t0 = Date.now();
for (const [name, mech] of VARIANTS) {
  const res = { idle: [], greedy: [], planner: [] };
  for (let seed = 1; seed <= N; seed++) {
    for (const p of Object.keys(res)) res[p].push(Bots.play(seed, p, { mech }).worth);
  }
  const gaps = res.planner.map((v, i) => v - res.greedy[i]);
  const row = {
    variant: name, n: N,
    idle: +mean(res.idle).toFixed(0), greedy: +mean(res.greedy).toFixed(0), planner: +mean(res.planner).toFixed(0),
    gap: +mean(gaps).toFixed(0), gapPct: +(mean(gaps) / mean(res.greedy) * 100).toFixed(1), gapSd: +sd(gaps).toFixed(0), plannerWins: gaps.filter(g => g > 0).length,
  };
  rows.push(row);
  console.log(`[bots] ${name.padEnd(16)} n=${N} idle=${row.idle} greedy=${row.greedy} planner=${row.planner} gap=${row.gap}±${row.gapSd} (${row.gapPct}%) planner wins ${row.plannerWins}/${N}  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
}
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ generated: new Date().toISOString(), rows }, null, 2));
console.log(`[bots] wrote ${out}`);
