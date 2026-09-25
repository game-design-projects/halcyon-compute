#!/usr/bin/env node
/* Layout regression check: the floor (the hero) must never collapse, whatever the board, banners, shelf and drawer hold.
 * Loads real game states into headless Chrome at several window sizes and asserts, per size:
 *   - floor racks >= MIN logical px tall (stage px at 1440x810; CSS px = logical x zoom)
 *   - no page scroll, zero console errors
 *   - (--drag) a catalog card dragged onto a rack at 1280x720 places an order
 * usage: node tools/layout-check.js [--log telemetry/<id>.json] [--day 730] [--out dir] [--min 70]
 *                                   [--sizes 1512x982,1280x720,1920x1080,1366x768] [--no-drag] [--lang zh]
 * States: "stress" = late + every banner, 3x offers, a full shelf (display only, 1366x768); "empty" = late with no offers;
 * "late" = the log replayed to --day (tools/replay.js algorithm) or, without a log, a greedy bot on campaign seed
 * 45823 to --day; "early" = the same seed at day 5. The Contracts drawer is docked in the late state (the worst case).
 * Exit 1 on any failure. Screenshots: <out>/<state>-<WxH>.png.
 */
"use strict";
const path = require("path");
const fs = require("fs");
const Sim = require("../js/sim.js");
const PW = process.env.PW_PATH || "/Users/lishuyu/.npm/_npx/e41f203b7505f1fb/node_modules/playwright";

const argv = process.argv.slice(2);
const opt = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const LOG = opt("--log", null), DAY = +opt("--day", 730), OUT = opt("--out", "/tmp/halcyon-layout"), MIN = +opt("--min", 70);
const SIZES = opt("--sizes", "1512x982,1280x720,1920x1080,1366x768").split(",");
const LANG = opt("--lang", "zh"), DRAG = !argv.includes("--no-drag");
const SEED = 45823;
const log = (...a) => console.log("[layout]", ...a);

/* same algorithm as tools/replay.js: snapshots and actions merged by day (real time breaks ties), advance, check, apply */
function replayTo(l, day) {
  const s = Sim.newGame(l.seed, { sandbox: l.sandbox });
  const acts = l.actions.filter(x => x.k === "act").map((x, i) => ({ d: x.d, i, x })).sort((a, b) => a.d - b.d || a.x.rt - b.x.rt || a.i - b.i);
  let rejected = 0;
  for (const e of acts) {
    if (e.d > day || s.over) break;
    if (e.d > s.day) Sim.advance(s, e.d - s.day);
    if (Sim.check(s, e.x.a).ok) Sim.apply(s, e.x.a); else rejected++;
  }
  if (day > s.day) Sim.advance(s, day - s.day);
  return { s, rejected };
}
function botTo(seed, day) {
  const Bots = require("../bots/bots.js");
  const s = Sim.newGame(seed, {}), mem = {};
  while (!s.over && s.day < day) { Bots.POLICIES.greedy(s, mem, { human: false }); Sim.advance(s, 1); }
  return s;
}
function states() {
  let late;
  if (LOG) { const r = replayTo(JSON.parse(fs.readFileSync(LOG, "utf8")), DAY); late = r.s; log(`late = ${path.basename(LOG)} replayed to d${Math.floor(late.day)} (${r.rejected} rejected)`); }
  else { late = botTo(SEED, DAY); log(`late = greedy bot, seed ${SEED}, d${Math.floor(late.day)}`); }
  const early = Sim.newGame(SEED, {}); Sim.advance(early, 5);
  const empty = JSON.parse(JSON.stringify(late)); empty.offers = [];   // the player's screenshot: an EMPTY board at year 3
  // stress (display only, never simulated): every banner at once, 3x the offers, a full spares shelf
  const stress = JSON.parse(JSON.stringify(late)), d = stress.day;
  stress.heatWave = { start: d, until: d + 20, mult: 1.5 }; stress.outage = { start: d, until: d + 5 }; stress.drought = { start: d, until: d + 30 };
  stress.hbm.shortage = true;
  stress.offers = [0, 1, 2].flatMap(k => late.offers.map(o => ({ ...o, id: o.id + "x" + k })));
  const devs = late.racks.flatMap(r => r.devices);
  stress.shelf = Array.from({ length: Math.min(12, devs.length) }, (_, i) => ({ ...devs[i], uid: 900000 + i }));
  return [{ name: "late", s: late, drawer: "contracts" }, { name: "stress", s: stress, drawer: "contracts", sizes: ["1366x768"] }, { name: "empty", s: empty, drawer: "contracts", sizes: ["1512x982"] },
    { name: "early", s: early, drawer: null, sizes: ["1280x720"] }];
}

async function measure(browser, st, size) {
  const [w, h] = size.split("x").map(Number);
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  const errors = [];
  page.on("pageerror", e => errors.push(String(e)));
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  const save = JSON.stringify(st.s), meta = JSON.stringify({ seed: st.s.seed, sandbox: !!st.s.sandbox, day: Math.floor(st.s.day), score: 0, at: Date.now() });
  await page.addInitScript(([sv, mt]) => { try { if (!sessionStorage.getItem("lc")) { localStorage.clear(); localStorage.setItem("halcyon.save.v2", sv); localStorage.setItem("halcyon.meta.v2", mt); sessionStorage.setItem("lc", "1"); } } catch (e) { /* ignore */ } }, [save, meta]);
  await page.goto("file://" + path.resolve(__dirname, "..", "index.html") + `?lang=${LANG}&pace=0`);
  await page.click("#m-continue");
  await page.waitForTimeout(300);
  await page.evaluate(d => {
    document.querySelectorAll("dialog[open]").forEach(x => x.close());
    if (d) window.__game.openDrawer(d);
    window.__game.renderAll();
  }, st.drawer);
  await page.waitForTimeout(400);    // drawer transition
  const m = await page.evaluate(() => {
    const z = window.Stage.z, H = sel => { const e = document.querySelector(sel); if (!e || !e.offsetParent && e.id !== "drawer") return 0; return Math.round(e.getBoundingClientRect().height / z); };
    const racks = [...document.querySelectorAll("#floor .rack")].map(e => e.getBoundingClientRect()).filter(r => r.height > 0);
    const hs = racks.map(r => r.height);
    const se = document.scrollingElement;
    return {
      z, rackCss: hs.length ? Math.min(...hs) : 0, rackLogical: hs.length ? Math.min(...hs) / z : 0, racks: hs.length,
      // the rack panel: is the whole elevation visible above the pinned sell bin (else it has to scroll inside)?
      elev: (() => { const e = document.querySelector("#detail .elev"), b = document.querySelector("#detail > .bin"), d = document.getElementById("detail");
        if (!e || !d || !d.offsetParent) return null; const er = e.getBoundingClientRect(), lim = Math.min(d.getBoundingClientRect().bottom, b ? b.getBoundingClientRect().top : 1e9);
        return er.bottom <= lim + 1; })(),
      pageScroll: se.scrollHeight > innerHeight + 1 || se.scrollWidth > innerWidth + 1,
      parts: { banners: H("#banners"), goal: H("#goal"), board: H("#offerstrip"), floorbar: H(".floorbar"), floor: H(".floor-scroll"), shelf: H("#shelf-wrap"), trayTitle: H("#tray-title"), tray: H("#tray"), corp: H("#corp"), tabs: H("#infotabs"), drawer: H("#drawer") },
    };
  });
  return { page, m, errors };
}

async function dragTest(page) {
  // drag the first affordable catalog card onto the first rack that accepts it; success = a new order (job) exists
  const before = await page.evaluate(() => window.__game.S.jobs.length + window.__game.S.racks.reduce((n, r) => n + r.devices.length, 0));
  const target = await page.evaluate(() => {
    const S = window.__game.S, it = [...document.querySelectorAll('#tray .item[data-drag="new"]')].find(b => b.style.opacity === "");
    if (!it) return null;
    const k = it.dataset.item, r = S.racks.find(x => window.Sim.check(S, { type: "buy", item: k, rack: x.id }).ok && document.querySelector(`#floor .rack[data-rack="${x.id}"]`));
    return r ? { item: k, rack: r.id } : null;
  });
  if (!target) return { ok: false, why: "no affordable item/rack pair" };
  const box = async sel => { const b = await page.locator(sel).first().boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
  const a = await box(`#tray .item[data-item="${target.item}"]`), z = await box(`#floor .rack[data-rack="${target.rack}"]`);
  await page.mouse.move(a.x, a.y); await page.mouse.down();
  for (let i = 1; i <= 14; i++) await page.mouse.move(a.x + (z.x - a.x) * i / 14, a.y + (z.y - a.y) * i / 14);
  await page.waitForTimeout(100); await page.mouse.up(); await page.waitForTimeout(300);
  await page.evaluate(() => document.querySelectorAll("dialog[open]").forEach(x => x.close()));
  const after = await page.evaluate(() => window.__game.S.jobs.length + window.__game.S.racks.reduce((n, r) => n + r.devices.length, 0));
  return { ok: after > before, ...target };
}

(async () => {
  const { chromium } = require(PW);
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
  let fail = 0;
  const runs = [];
  for (const st of states()) for (const size of st.sizes || SIZES) runs.push([st, size]);
  for (const [st, size] of runs) {
    const { page, m, errors } = await measure(browser, st, size);
    const shot = path.join(OUT, `${st.name}-${size}.png`);
    await page.screenshot({ path: shot });
    let drag = null;
    if (DRAG && st.name === "early" && size === "1280x720") drag = await dragTest(page);
    let fold = null;
    if (st.name === "late" && size === "1280x720") {   // the docked drawer folds to its header and gives the rack panel the height
      const h = () => page.evaluate(() => [document.getElementById("drawer"), document.getElementById("infotabs")].map(e => Math.round(e.getBoundingClientRect().height / window.Stage.z)));
      const [d0, t0] = await h(); await page.click("#drawer-min"); await page.waitForTimeout(100);
      const [d1, t1] = await h(); await page.click("#drawer-min"); await page.waitForTimeout(100);
      const [d2] = await h();
      fold = { ok: d1 < 50 && t1 > t0 && d2 === d0, drawer: [d0, d1, d2], tabs: [t0, t1] };
    }
    const bad = [];
    if (m.rackLogical < MIN) bad.push(`rack ${m.rackLogical.toFixed(1)} < ${MIN}`);
    if (m.pageScroll) bad.push("page scrolls");
    if (m.elev === false) bad.push("rack elevation cut off");
    if (errors.length) bad.push(`${errors.length} console errors: ${errors[0]}`);
    if (drag && !drag.ok) bad.push(`drag failed (${JSON.stringify(drag)})`);
    if (fold && !fold.ok) bad.push(`drawer fold failed (${JSON.stringify(fold)})`);
    fail += bad.length ? 1 : 0;
    log(`${bad.length ? "FAIL" : "ok  "} ${st.name.padEnd(5)} ${size.padEnd(9)} zoom ${m.z.toFixed(3)} rack ${m.rackLogical.toFixed(1)} logical / ${m.rackCss.toFixed(1)} css px (${m.racks} racks) elevation ${m.elev == null ? "-" : m.elev ? "full" : "CUT"}` +
      (drag ? ` drag ${drag.ok ? "ok" : "FAIL"} ${drag.item}->${drag.rack}` : "") + (fold ? ` fold ${fold.ok ? "ok" : "FAIL"} drawer ${fold.drawer.join("->")}` : "") + ` parts ${JSON.stringify(m.parts)}` + (bad.length ? `  <- ${bad.join("; ")}` : ""));
    log(`     screenshot ${shot}`);
    await page.close();
  }
  await browser.close();
  log(fail ? `${fail} of ${runs.length} checks FAILED` : `all ${runs.length} checks passed (min rack ${MIN} logical px)`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
