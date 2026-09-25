"use strict";
/* UI pass B: i18n (docs/I18N.md I1–I6). Key parity en ↔ zh, no untranslated English in zh, every key the UI and the sim
 * use exists, a whole bot campaign renders in zh without a missing key, and the sim is language-independent (I2). */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const I18N = require("../js/i18n.js");
const Sim = require("../js/sim.js");
const C = require("../js/content.js");
const Bots = require("../bots/bots.js");

const src = f => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const has = (k, lang) => I18N.raw(lang, k) != null;
const params = s => [...String(s).matchAll(/\{\$?(\w+)\}/g)].map(m => m[1]).sort().join(",");
/* English words allowed inside Chinese text: glossary abbreviations and proper names (docs/I18N.md glossary) */
const ZH_OK = new Set(["GPU", "GPUs", "HBM", "SLA", "PUE", "PPA", "CRU", "CRAC", "UPS", "ASIC", "CO2", "Web", "kW", "IT", "AI", "Roofline", "spine",
  "Kestrel", "Heron", "Lattice", "Photon", "Nanofab", "PM", "Halcyon", "Compute", "Ctrl", "Shift", "Esc", "JSON", "EN", "English", "FLOP", "Q", "u", "bot", "vs"]);
const englishWords = s => (String(s).replace(/\{\$?\w+\}/g, "").match(/[A-Za-z][A-Za-z0-9]+/g) || []).filter(w => !ZH_OK.has(w) && !/^[A-Z]\d+$/.test(w) && !/^(Y|Q|C|M|L|P|G)\d*$/.test(w));

test("key parity: every key exists in both languages with the same placeholders", () => {
  const en = new Set(I18N.keys("en")), zh = new Set(I18N.keys("zh"));
  const onlyEn = [...en].filter(k => !zh.has(k)), onlyZh = [...zh].filter(k => !en.has(k));
  assert.deepEqual(onlyEn, [], "missing zh: " + onlyEn.join(", "));
  assert.deepEqual(onlyZh, [], "missing en: " + onlyZh.join(", "));
  assert.ok(en.size > 800, `dictionary size ${en.size}`);
  const bad = [...en].filter(k => k !== "fmt.date" && params(I18N.raw("en", k)) !== params(I18N.raw("zh", k)));   // fmt.date: en uses the month name, zh its number
  assert.deepEqual(bad, [], "placeholder mismatch: " + bad.join(", "));
  const empty = [...en].filter(k => k !== "ch.racks.hint" && (!String(I18N.raw("en", k)).trim() || !String(I18N.raw("zh", k)).trim()));
  assert.deepEqual(empty, [], "empty values: " + empty.join(", "));
});

test("zh values contain no untranslated English (glossary abbreviations and proper names allowed)", () => {
  const bad = I18N.keys("zh").map(k => [k, englishWords(I18N.raw("zh", k))]).filter(([, w]) => w.length);
  assert.deepEqual(bad, [], bad.map(([k, w]) => `${k}: ${w.join(" ")}`).join("\n"));
});

test("missing keys fall back to English, then to the key, and are recorded (I6)", () => {
  I18N.add({ en: { "test.onlyEn": "only {x}" } });
  assert.equal(I18N.tl("test.onlyEn", { x: 1 }, "zh"), "only 1");
  assert.ok(I18N.missing().includes("zh:test.onlyEn"));
  assert.equal(I18N.tl("test.nowhere", null, "zh"), "test.nowhere");
  assert.equal(I18N.tl("n.polSignal.t", { pol: "@pol.export", sig: "@sig.down2" }, "zh"), "先进芯片出口管制：全院投票推迟", "@key params resolve");
});

test("dates and numbers (I5): en Oct 11, Y3 · zh 第3年 10月11日; money notation is shared", () => {
  const day = 2 * 360 + 9 * 30 + 10;
  assert.equal(I18N.tl("fmt.date", { m: I18N.tl("month.9", null, "en"), mn: 10, d: 11, y: 3 }, "en"), "Oct 11, Y3");
  assert.equal(I18N.tl("fmt.date", { m: I18N.tl("month.9", null, "zh"), mn: 10, d: 11, y: 3 }, "zh"), "第3年 10月11日");
  const l0 = I18N.lang;
  I18N.lang = "zh"; assert.equal(I18N.date(day), "第3年 10月11日");
  I18N.lang = "en"; assert.equal(I18N.date(day), "Oct 11, Y3");
  I18N.lang = l0;
  assert.equal(I18N.tl("c.needs", { x: 368 }, "zh"), "需要 $368k");
  assert.equal(I18N.tl("n.round.t", { v: "VC", x: 15380, p: 20 }, "en"), "VC: $15.38M for 20 %", "{$x} formats money");
});

test("every namespaced key literal in the UI exists (static scan of js/ui.js and index.html)", () => {
  const ns = new Set(I18N.keys("en").map(k => k.split(".")[0]));
  const ui = src("js/ui.js"), html = src("index.html");
  const lits = new Set([...ui.matchAll(/"([a-z][a-zA-Z0-9]*\.[a-zA-Z0-9.]*[a-zA-Z0-9])"/g)].map(m => m[1]).filter(k => ns.has(k.split(".")[0])));
  for (const m of html.matchAll(/data-i18n(?:-title|-aria)?="([^"]+)"/g)) lits.add(m[1]);
  const skip = /^(halcyon|app\.js|js)\b/;
  const miss = [...lits].filter(k => !skip.test(k) && !has(k, "en"));
  assert.deepEqual(miss, [], "missing: " + miss.join(", "));
  assert.ok(lits.size > 300, `scanned ${lits.size} keys`);
});

test("every dynamic key family the UI builds exists", () => {
  const need = [];
  for (const c of Sim.CHAPTERS) for (const s of ["t", "1", "2", "3", "hint", "where"]) need.push(`ch.${c.key}.${s}`);
  for (const k of Object.keys(Sim.BASE_ITEMS)) need.push("it." + k);
  for (const k of Object.keys(Sim.MODES)) need.push("mode." + k);
  for (const k of ["web", "train", "infer", "net", "cool", "tank", "empty"]) need.push("role." + k);
  for (const k of ["role", "power", "heat", "gen", "fail", "cluster", "free"]) need.push("map." + k);
  for (const k of ["hardware", "ops", "market", "contracts", "memory", "energy", "facilities", "environment", "investors", "press", "policy", "vendor", "general"]) need.push("cat." + k);
  for (const k of ["web", "infer", "train", "frontier", "bts"]) need.push("kind." + k);
  for (const k of ["evap", "chiller"]) need.push("cool." + k, `cool.${k}Tip`);
  for (let d = 0; d < 360; d += 30) need.push("season." + Sim.seasonAt(d).name, "month." + d / 30);
  for (const k of ["rising", "falling", "steady"]) need.push("trend." + k);
  for (const k of Object.keys(Sim.LOSS_LABEL)) need.push("loss." + k);
  for (const p of C.POLICIES) need.push("pol." + p.kind, `pol.${p.kind}.b`);
  for (const k of ["proposed", "passed", "failed"]) need.push("pol.st." + k);
  for (const k of ["nosw", "fail", "hot", "sla", "idle", "runway"]) need.push("alert." + k);
  for (const k of ["offer", "fail", "cash", "sla"]) need.push("ap." + k);
  for (const k of Object.keys(Bots.LABELS)) need.push("bot." + k);
  for (const k of ["tax", "repair", "sale", "refund", "restock", "unsell", "contract", "renew", "contractLost", "contractCancel"]) need.push("cash." + k);
  for (const k of ["sell", "move", "tank", "store", "unstore", "returnLease", "parts", "repair", "swap", "ship", "install"]) need.push("job." + k);
  for (const k of ["web", "train", "infer", "frontier", "contracts", "power", "staff", "transit", "interest", "lease", "water", "diesel", "carbonTax", "fines", "penalties", "repairs", "other", "tax"]) need.push("wf." + k);
  for (const k of ["bankrupt", "fired", "done"]) need.push("end." + k);
  for (const k of ["cold", "hot"]) need.push("floor." + k);
  for (const k of ["contracts", "finance", "energy", "affairs"]) need.push("dr." + k);
  for (const k of ["compute", "memory"]) need.push("hover." + k);
  for (const w of Sim.WORKLOADS.concat(["web"])) need.push("wl." + w);
  for (const k of ["up", "down"]) C.POLICY_SIGNALS[k].forEach((_, i) => need.push(`sig.${k}${i}`));
  const miss = need.filter(k => !has(k, "en") || !has(k, "zh"));
  assert.deepEqual(miss, [], "missing: " + miss.join(", "));
});

test("every key the sim emits exists: check() results, news titles, cash events", () => {
  const sim = src("js/sim.js");
  const chk = [...new Set([...sim.matchAll(/"(c\.[a-zA-Z]+)"/g)].map(m => m[1]))];
  const news = [...new Set([...sim.matchAll(/"(n\.[a-zA-Z]+)"/g)].map(m => m[1]))].filter(k => k !== "n.press" && k !== "n.scare");
  C.SCARES.forEach((_, i) => news.push("n.scare" + i));
  for (const k of Object.keys(C.PRESS)) news.push("n.press." + k);
  const miss = chk.filter(k => !has(k, "zh")).concat(news.filter(k => !has(k + ".t", "zh")));
  assert.deepEqual(miss, [], "missing: " + miss.join(", "));
  assert.ok(chk.length > 90 && news.length > 60, `${chk.length} check keys, ${news.length} news keys`);
});

test("a whole planner campaign renders in zh: every news item, cash event and check() result has a key and no leftovers", () => {
  const s = Sim.newGame(7), mem = {};
  const seen = new Map(), results = new Map();
  let steps = 0;
  const origCheck = Sim.check;
  while (!s.over) {
    Bots.POLICIES.planner(s, mem);
    Sim.advance(s, 1);
    for (const n of s.news) if (!seen.has(n.title)) seen.set(n.title, n);
    if (++steps % 45 === 0) {       // sample check() over the actions a player could try right now
      for (const it of Sim.shopItems(s)) for (const r of s.racks.slice(0, 4)) { const res = origCheck(s, { type: "buy", item: it, rack: r.id }); results.set(res.k, res); }
      for (const o of s.offers) { const res = origCheck(s, { type: "signContract", id: o.id }); results.set(res.k, res); }
      for (const a of [{ type: "grid" }, { type: "hire" }, { type: "fire" }, { type: "ups" }, { type: "solar" }, { type: "pr" }, { type: "borrow", amount: 100 }, { type: "repay", amount: 100 },
        { type: "buildHall" }, { type: "spine", hall: 1, row: 0 }, { type: "transit", delta: 1 }, { type: "ppa", kw: 100 }, { type: "buyback" }]) { const res = origCheck(s, a); results.set(res.k, res); }
    }
  }
  const newsK = [...seen.values()];
  const noKey = newsK.filter(n => !n.k).map(n => n.title);
  assert.deepEqual(noKey, [], "news without a key: " + noKey.join(" | "));
  const render = (k, p) => I18N.tl(k, p, "zh");
  const bad = newsK.map(n => [n.k, render(n.k + ".t", n.p), I18N.raw("zh", n.k + ".b") != null ? render(n.k + ".b", n.p) : ""])
    .filter(([k, t, b]) => /\{\$?\w+\}|@/.test(t + b) || t === k + ".t");
  assert.deepEqual(bad, [], bad.map(x => x.join(" · ")).join("\n"));
  const cashBad = (s.cashEvents || []).filter(e => !has("cash." + e.kind, "zh")).map(e => e.kind);
  assert.deepEqual(cashBad, []);
  const chkBad = [...results.values()].filter(r => !r.k || !has(r.k, "zh") || /\{\$?\w+\}/.test(render(r.k, r.p))).map(r => r.msg);
  assert.deepEqual(chkBad, [], "check results: " + chkBad.join(" | "));
  assert.ok(newsK.length > 40 && results.size > 15, `${newsK.length} news titles, ${results.size} check keys`);
});

test("the sim is language-independent (I2): the same seed and actions in en and zh give identical states", () => {
  const run = lang => {
    I18N.setLang(lang, { noStore: true });
    const s = Sim.newGame(26), mem = {};
    while (s.day < 400) { Bots.POLICIES.greedy(s, mem); Sim.advance(s, 1); }
    return JSON.stringify(s);
  };
  const l0 = I18N.lang;
  const a = run("en"), b = run("zh");
  I18N.setLang(l0, { noStore: true });
  assert.equal(a.length, b.length);
  assert.ok(a === b, "states differ between languages");
  assert.ok(!/[一-鿿]/.test(b), "no Chinese text leaks into the sim state");
});

test("QOL.reason uses the check() code first and still classifies legacy English messages", () => {
  const QOL = require("../js/qol.js");
  const s = Sim.newGame(1, { sandbox: true });
  s.cash = 1;
  const res = Sim.check(s, { type: "buy", item: "c1", rack: "B1" });
  assert.equal(res.code, "cash"); assert.equal(res.k, "c.needs"); assert.equal(QOL.reason(res), "cash");
  assert.equal(QOL.reason(res.msg), "cash");
  assert.equal(QOL.reason({ ok: false, msg: "Grid limit 250 kW", k: "c.grid", code: "grid" }), "grid");
});

test("text diet budgets (docs/I18N.md): chapter bullets, goal hints, news titles, toasts", () => {
  const words = s => String(s).replace(/\{\$?\w+\}/g, "X").split(/\s+/).filter(x => /[A-Za-z0-9]/.test(x)).length;
  const han = s => (String(s).match(/[\u4e00-\u9fff]/g) || []).length;
  const over = [];
  for (const c of Sim.CHAPTERS) {
    for (const i of [1, 2, 3]) { const k = `ch.${c.key}.${i}`; if (words(I18N.raw("en", k)) > 8 || han(I18N.raw("zh", k)) > 12) over.push(k); }
    const h = `ch.${c.key}.hint`; if (words(I18N.raw("en", h)) > 6 || han(I18N.raw("zh", h)) > 12) over.push(h);
    assert.equal(I18N.raw("en", `ch.${c.key}.4`), undefined, "at most 3 bullets");
  }
  for (const k of I18N.keys("en")) {
    if (/^n\..*\.t$/.test(k) && words(I18N.raw("en", k)) > 6) over.push(k);
    if (/^(fx|fb|cash|hint|log)\./.test(k) && words(I18N.raw("en", k)) > 5) over.push(k);
  }
  assert.deepEqual(over, [], "over budget: " + over.join(", "));
});
