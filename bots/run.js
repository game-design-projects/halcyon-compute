#!/usr/bin/env node
/* Depth report: planner vs greedy vs idle over many seeds, with and without each mechanic group.
 * usage: node bots/run.js [--seeds N] [--ablate] [--out reports/depth.json] [--jobs J] [--only full,no ops]
 *        [--patch '{"K":{"TAX":0.3},"gpuPrice":1.4,"market":{"infer":{"base":0.5}}}']   (dev: balance sweeps
 *        without editing the sim; overrides are applied inside each worker before any game starts)
 * Games run in parallel worker threads (results are deterministic per seed, so order does not matter).
 * "Depth gap" = planner score - greedy score (score = founder equity value, SPEC §1). If removing a
 * mechanic shrinks the gap, that mechanic is carrying strategic depth. The gap is a lower bound: a better
 * planner would open it further.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const os = require("os");
const { Worker, isMainThread, parentPort } = require("worker_threads");

const CHAPTER_KEYS = ["racks", "power", "gpu", "heat", "gens", "ops", "fabric", "contracts", "memory", "finance",
  "facilities", "energy", "environment", "investors", "reputation", "policy", "disrupt"];

/* ---------------- worker: play one game, return a compact record ---------------- */
function applyPatch(Sim, patch) {
  if (!patch) return;
  Object.assign(Sim.K, patch.K || {});
  for (const [w, o] of Object.entries(patch.market || {})) Object.assign(Sim.MARKET[w], o);
  for (const [k, o] of Object.entries(patch.items || {})) Object.assign(Sim.BASE_ITEMS[k], o);
  if (patch.gpuPrice) for (const it of Object.values(Sim.BASE_ITEMS)) if (it.role === "gpu") it.price = Math.round(it.price * patch.gpuPrice);
}
let patched = false;
function playOne(job) {
  const Bots = require("./bots.js");
  const Sim = require("../js/sim.js");
  if (!patched) { applyPatch(Sim, job.patch); if (job.patch && job.patch.bots) Object.assign(Bots.CFG, job.patch.bots); patched = true; }
  const t0 = Date.now();
  const r = Bots.play(job.seed, job.policy, { mech: job.mech });
  const c = s0 => Object.assign({}, s0.contractLog, { sla: s0.losses.sla, idle: s0.losses.idle, cancelledWork: s0.losses.cancelled });
  const s = r.state;
  // idle cash: the longest stretch (days) with more than $2M in the bank, and the mean cash share of net worth in years 2-4
  let run = 0, longest = 0, prev = null;
  const share = [];
  for (const h of s.history) {
    const dd = prev ? h.d - prev.d : 0;
    if (h.cash > 2000) { run += dd; longest = Math.max(longest, run); } else run = 0;
    if (h.d >= 360 && h.d < 1440 && h.worth > 0) share.push(Math.max(0, h.cash) / h.worth);
    prev = h;
  }
  return {
    variant: job.variant, seed: job.seed, policy: job.policy, worth: r.worth, score: r.score, over: r.over,
    own: s.equity.own, rep: Sim.repOf(s), idleCashDays: longest, cashShare: share.length ? share.reduce((a, x) => a + x, 0) / share.length : 0,
    used: r.used, noted: r.noted, ms: Date.now() - t0, chapter: s.chapter, contracts: c(s),
  };
}
if (!isMainThread) {
  parentPort.on("message", job => parentPort.postMessage(playOne(job)));
  return;
}

/* ---------------- main ---------------- */
const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const N = +arg("--seeds", 12);
const ablate = args.includes("--ablate");
const out = arg("--out", "reports/depth.json");
const JOBS = Math.max(1, +arg("--jobs", Math.max(1, os.cpus().length - 2)));
const only = arg("--only", null);
const patch = arg("--patch", null) ? JSON.parse(arg("--patch")) : null;

const GROUPS = [
  ["no heat/seasons", "heat", "heat"], ["no generations", "gens", "gens"], ["no operations", "ops", "ops"],
  ["no fabric", "fabric", "fabric"], ["no contracts", "contracts", "contracts"], ["no memory market", "memory", "memory"],
  ["no finance", "finance", "finance"], ["no facilities", "facilities", "facilities"], ["no energy", "energy", "energy"],
  ["no environment", "environment", "environment"], ["no investors", "investors", "investors"], ["no reputation", "reputation", "reputation"],
  ["no policy", "policy", "policy"], ["no disruption", "disrupt", "disrupt"], ["no network", "network", null], ["no roofline", "roofline", "gpu"],
];
let VARIANTS = [["full", {}, null]];
if (ablate) for (const [name, flag, ch] of GROUPS) VARIANTS.push([name, { [flag]: false }, ch]);
if (only) { const want = new Set(only.split(",")); VARIANTS = VARIANTS.filter(v => want.has(v[0])); }

const jobs = [];
// v4: the human-paced reference bots (Casual, Expert: what the player is compared with) run on the full game only
for (const [variant, mech] of VARIANTS) for (let seed = 1; seed <= N; seed++)
  for (const policy of variant === "full" && !args.includes("--no-human") ? ["planner", "greedy", "idle", "casual", "expert"] : ["planner", "greedy", "idle"]) jobs.push({ variant, mech, seed, policy, patch });

const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const sd = a => { const m = mean(a); return Math.sqrt(mean(a.map(x => (x - m) ** 2))); };
const median = a => { const b = a.slice().sort((x, y) => x - y); return b.length ? (b.length % 2 ? b[(b.length - 1) / 2] : (b[b.length / 2 - 1] + b[b.length / 2]) / 2) : 0; };
const fmt = v => Math.round(v).toLocaleString("en-US");

const t0 = Date.now();
const results = [];
let next = 0, doneN = 0;
console.log(`[bots] ${jobs.length} games (${VARIANTS.length} variants x ${N} seeds; 3 bots, +Casual/Expert on "full") on ${JOBS} workers`);
const workers = [];
function finish() {
  for (const w of workers) w.terminate();
  report();
}
for (let i = 0; i < Math.min(JOBS, jobs.length); i++) {
  const w = new Worker(__filename);
  workers.push(w);
  const feed = () => { if (next < jobs.length) w.postMessage(jobs[next++]); };
  w.on("message", r => {
    results.push(r);
    doneN++;
    if (doneN % 12 === 0 || doneN === jobs.length) {
      const el = (Date.now() - t0) / 1000, eta = el / doneN * (jobs.length - doneN);
      process.stdout.write(`[bots] ${doneN}/${jobs.length} games  ${el.toFixed(0)}s elapsed  ETA ${eta.toFixed(0)}s\n`);
    }
    if (doneN === jobs.length) finish(); else feed();
  });
  w.on("error", e => { console.error("[bots] worker error", e); process.exit(1); });
  feed();
}

function report() {
  const rows = [];
  for (const [variant, , chapter] of VARIANTS) {
    const R = p => results.filter(x => x.variant === variant && x.policy === p).sort((a, b) => a.seed - b.seed);
    const P = R("planner"), G = R("greedy"), I = R("idle");
    const gaps = P.map((p, i) => p.score - G[i].score), rel = P.map((p, i) => p.score / Math.max(1, G[i].score) - 1);
    const wgaps = P.map((p, i) => p.worth - G[i].worth);
    const row = {
      variant, n: P.length,
      idle: { score: mean(I.map(x => x.score)), worth: mean(I.map(x => x.worth)), bankrupt: I.filter(x => x.over === "bankrupt").length },
      greedy: { score: mean(G.map(x => x.score)), worth: mean(G.map(x => x.worth)), bankrupt: G.filter(x => x.over === "bankrupt").length, idleCashDays: mean(G.map(x => x.idleCashDays)), ms: mean(G.map(x => x.ms)) },
      planner: { score: mean(P.map(x => x.score)), worth: mean(P.map(x => x.worth)), fired: P.filter(x => x.over === "fired").length, bankrupt: P.filter(x => x.over === "bankrupt").length,
        idleCashDays: mean(P.map(x => x.idleCashDays)), idleCashDaysMax: Math.max(...P.map(x => x.idleCashDays)), cashShare: mean(P.map(x => x.cashShare)), own: mean(P.map(x => x.own)), ms: mean(P.map(x => x.ms)) },
      scoreGap: mean(gaps), scoreGapSd: sd(gaps), scoreGapPct: mean(gaps) / Math.max(1, mean(G.map(x => x.score))) * 100,
      relGapMedianPct: median(rel) * 100, relGapMinPct: Math.min(...rel) * 100,
      plannerWins: gaps.filter(g => g > 0).length, winsAt25: rel.filter(r => r >= 0.25).length,
      worthGap: mean(wgaps), worthGapPct: mean(wgaps) / Math.max(1, mean(G.map(x => x.worth))) * 100, plannerWinsWorth: wgaps.filter(g => g > 0).length,
      cashShare: { planner: mean(P.map(x => x.cashShare)), greedy: mean(G.map(x => x.cashShare)) },
      idleShareOfPlannerPct: mean(I.map(x => x.score)) / Math.max(1, mean(P.map(x => x.score))) * 100,
      // does the planner still use the ablated chapter? (should be 0 when it is switched off)
      ablatedChapterUse: chapter ? P.filter(x => (x.used[chapter] || 0) > 0).length : null,
    };
    const cstat = (L, k) => mean(L.map(x => x.contracts[k] || 0));
    row.contracts = {};
    for (const [nm, L] of [["planner", P], ["greedy", G], ["idle", I]]) row.contracts[nm] = { signed: cstat(L, "signed"), fulfilled: cstat(L, "fulfilled"), failed: cstat(L, "failed"), cancelled: cstat(L, "cancelled"), sla: cstat(L, "sla"), idle: cstat(L, "idle"), chapter: mean(L.map(x => x.chapter)) };
    if (variant === "full") {
      const CA = R("casual"), EX = R("expert");
      if (CA.length) {
        row.human = {
          casual: { score: mean(CA.map(x => x.score)), min: Math.min(...CA.map(x => x.score)), max: Math.max(...CA.map(x => x.score)), bankrupt: CA.filter(x => x.over === "bankrupt").length, fired: CA.filter(x => x.over === "fired").length, ms: mean(CA.map(x => x.ms)) },
          expert: { score: mean(EX.map(x => x.score)), min: Math.min(...EX.map(x => x.score)), max: Math.max(...EX.map(x => x.score)), bankrupt: EX.filter(x => x.over === "bankrupt").length, fired: EX.filter(x => x.over === "fired").length, ms: mean(EX.map(x => x.ms)) },
          expertBeatsCasual: EX.filter((x, i) => x.score > CA[i].score).length,
          casualBeatsIdle: CA.filter((x, i) => x.score > I[i].score).length,
        };
        for (const [nm, L] of [["casual", CA], ["expert", EX]]) row.contracts[nm] = { signed: cstat(L, "signed"), fulfilled: cstat(L, "fulfilled"), failed: cstat(L, "failed"), cancelled: cstat(L, "cancelled"), sla: cstat(L, "sla"), idle: cstat(L, "idle"), chapter: mean(L.map(x => x.chapter)) };
        console.log(`[bots] human-paced (full game, n=${CA.length}): Casual mean ${fmt(row.human.casual.score)} (min ${fmt(row.human.casual.min)}, max ${fmt(row.human.casual.max)}, bankrupt ${row.human.casual.bankrupt}) | Expert mean ${fmt(row.human.expert.score)} (min ${fmt(row.human.expert.min)}, max ${fmt(row.human.expert.max)}, bankrupt ${row.human.expert.bankrupt}, fired ${row.human.expert.fired}) | Expert > Casual ${row.human.expertBeatsCasual}/${CA.length}, Casual > Idle ${row.human.casualBeatsIdle}/${CA.length}`);
      }
      row.perSeedHuman = CA.map((c, i) => ({ seed: c.seed, casual: Math.round(c.score), expert: Math.round(EX[i].score), casualOver: c.over, expertOver: EX[i].over }));
      console.log(`[bots] contracts (mean per game): ` + Object.entries(row.contracts).map(([nm, c]) => `${nm} signed ${c.signed.toFixed(0)} ok ${c.fulfilled.toFixed(0)} short ${c.failed.toFixed(0)} (cancelled ${c.cancelled.toFixed(1)}) SLA $${fmt(c.sla)}k idle $${fmt(c.idle)}k ch ${(c.chapter + 1).toFixed(1)}`).join(" | "));
      row.coverage = {};
      // games where the chapter changed an action / where it at least produced an explicit decision (incl. declines)
      for (const k of CHAPTER_KEYS) row.coverage[k] = { games: P.filter(x => (x.used[k] || 0) > 0).length, decisions: P.filter(x => (x.used[k] || 0) + (x.noted[k] || 0) > 0).length, meanActions: +mean(P.map(x => x.used[k] || 0)).toFixed(1) };
      row.perSeed = P.map((p, i) => ({ seed: p.seed, planner: Math.round(p.score), greedy: Math.round(G[i].score), idle: Math.round(I[i].score), plannerWorth: Math.round(p.worth), greedyWorth: Math.round(G[i].worth), over: p.over, greedyOver: G[i].over, own: +p.own.toFixed(2), idleCashDays: p.idleCashDays, used: p.used }));
    }
    rows.push(row);
    console.log(`[bots] ${variant.padEnd(18)} n=${row.n} score: idle=${fmt(row.idle.score)} greedy=${fmt(row.greedy.score)} planner=${fmt(row.planner.score)} gap=${fmt(row.scoreGap)}±${fmt(row.scoreGapSd)} (${row.scoreGapPct.toFixed(0)}%, median ${row.relGapMedianPct.toFixed(0)}%, min ${row.relGapMinPct.toFixed(0)}%) wins ${row.plannerWins}/${row.n} (>=25%: ${row.winsAt25}) | worth: greedy=${fmt(row.greedy.worth)} planner=${fmt(row.planner.worth)} (${row.worthGapPct.toFixed(0)}%, wins ${row.plannerWinsWorth}) | fired ${row.planner.fired} bankrupt g${row.greedy.bankrupt}/p${row.planner.bankrupt}/i${row.idle.bankrupt} | idle/planner ${row.idleShareOfPlannerPct.toFixed(1)}% | cash share Y2-4: planner ${(row.cashShare.planner * 100).toFixed(0)}% greedy ${(row.cashShare.greedy * 100).toFixed(0)}% | cash>2M: planner ${row.planner.idleCashDays.toFixed(0)}d (max ${row.planner.idleCashDaysMax}) greedy ${row.greedy.idleCashDays.toFixed(0)}d${row.ablatedChapterUse != null ? ` | ablated ch used in ${row.ablatedChapterUse} games` : ""}`);
    if (row.coverage) console.log(`[bots] planner chapter coverage (games using it / ${row.n}, mean actions): ` + CHAPTER_KEYS.map(k => `${k} ${row.coverage[k].games}${row.coverage[k].decisions > row.coverage[k].games ? "/" + row.coverage[k].decisions + "d" : ""} (${row.coverage[k].meanActions})`).join(", "));
  }
  const timing = { plannerSecPerGame: mean(results.filter(x => x.policy === "planner").map(x => x.ms)) / 1000, greedySecPerGame: mean(results.filter(x => x.policy === "greedy").map(x => x.ms)) / 1000, workers: JOBS };
  console.log(`[bots] timing (per game, inside a worker; ${JOBS} parallel): planner ${timing.plannerSecPerGame.toFixed(2)}s, greedy ${timing.greedySecPerGame.toFixed(2)}s; wall ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({ generated: new Date().toISOString(), patch, method: "bots/run.js: Bots.play per seed 1..N, score = Sim.score (founder equity), worth = Sim.netWorth", timing, rows }, null, 2));
  console.log(`[bots] wrote ${out}`);
}
