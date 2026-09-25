#!/usr/bin/env node
/* Browser driver for AI playtesters: one persistent headless Chrome page, controlled over HTTP.
 * usage: node tools/playtest-driver.js <port> <seed> <outDir>
 * GET  /shot?name=x      -> screenshot saved to outDir/x.png, returns the path
 * GET  /text             -> visible text of HUD, goal banner, news and any open dialog
 * POST /click  {selector} | {x,y}
 * POST /drag   {from:{selector}|{x,y}, to:{selector}|{x,y}}   (real pointer moves, like a human)
 * POST /pointer {op:"down"|"move"|"up", selector|x,y}   low-level pointer, e.g. to screenshot mid-drag
 * POST /key    {key}      e.g. " " (pause), "1" "2" "3" "4" (speed)
 * POST /wait   {ms}       let real time pass (the game runs while you wait)
 * POST /read   {js}       READ-ONLY evaluation (expression string); use for inspecting, never to change state
 * GET  /quit
 */
"use strict";
const http = require("http");
const path = require("path");
const fs = require("fs");
const PW = process.env.PW_PATH || "/Users/lishuyu/.npm/_npx/e41f203b7505f1fb/node_modules/playwright";
const { chromium } = require(PW);
const [port, seed, outDir] = [+process.argv[2] || 9301, process.argv[3] || "1", process.argv[4] || "/tmp/playtest"];
fs.mkdirSync(outDir, { recursive: true });
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

(async () => {
  const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
  const errors = [];
  page.on("pageerror", e => errors.push(String(e)));
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  const url = "file://" + path.resolve(__dirname, "..", "index.html") + `?seed=${seed}`;
  await page.goto(url);
  log("driver up", port, url);

  const point = async t => {
    if (t.selector) { const b = await page.locator(t.selector).first().boundingBox(); if (!b) throw new Error("not visible: " + t.selector); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }
    return { x: t.x, y: t.y };
  };
  const handlers = {
    "GET /shot": async q => { const f = path.join(outDir, (q.get("name") || "shot") + ".png"); await page.screenshot({ path: f }); return { path: f, errors: errors.splice(0) }; },
    "GET /text": async () => ({ text: await page.evaluate(() => {
      const pick = sel => [...document.querySelectorAll(sel)].map(e => e.innerText.trim()).filter(Boolean).join("\n");
      return ["HUD:\n" + pick(".hud"), "GOAL:\n" + pick("#goal"), "DIALOG:\n" + pick("dialog[open]"), "NEWS:\n" + pick("#newsfeed").slice(0, 1500)].join("\n\n");
    }), errors: errors.splice(0) }),
    "POST /click": async b => { const p = await point(b); await page.mouse.click(p.x, p.y); return { ok: true, at: p }; },
    "POST /drag": async b => {
      const a = await point(b.from), z = await point(b.to);
      await page.mouse.move(a.x, a.y); await page.mouse.down();
      for (let i = 1; i <= 12; i++) await page.mouse.move(a.x + (z.x - a.x) * i / 12, a.y + (z.y - a.y) * i / 12);
      await page.waitForTimeout(80); await page.mouse.up();
      return { ok: true, from: a, to: z };
    },
    "POST /pointer": async b => {
      const p = b.op === "up" && !b.selector && b.x == null ? null : await point(b);
      if (p) await page.mouse.move(p.x, p.y, { steps: b.op === "move" ? 8 : 1 });
      if (b.op === "down") await page.mouse.down(); else if (b.op === "up") await page.mouse.up();
      return { ok: true, at: p };
    },
    "POST /key": async b => { await page.keyboard.press(b.key === " " ? "Space" : b.key); return { ok: true }; },
    "POST /wait": async b => { await page.waitForTimeout(Math.min(60000, b.ms || 1000)); return { ok: true }; },
    "POST /read": async b => ({ value: await page.evaluate(b.js) }),
    "GET /quit": async () => { setTimeout(async () => { await browser.close(); process.exit(0); }, 50); return { ok: true }; },
  };
  http.createServer(async (req, res) => {
    const u = new URL(req.url, "http://x"), key = `${req.method} ${u.pathname}`;
    let body = "";
    req.on("data", c => body += c);
    req.on("end", async () => {
      try {
        const h = handlers[key]; if (!h) throw new Error("no route " + key);
        const out = await h(req.method === "GET" ? u.searchParams : JSON.parse(body || "{}"));
        log(key, body.slice(0, 120));
        res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(out));
      } catch (e) { res.writeHead(400); res.end(JSON.stringify({ error: String(e.message || e) })); }
    });
  }).listen(port);
})();
