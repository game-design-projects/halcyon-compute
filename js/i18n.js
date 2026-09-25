/* Halcyon Compute — i18n layer (docs/I18N.md I1–I6). English + 简体中文.
 * window.I18N = { lang, t(key, params), setLang(l), onChange(fn), date(day), applyDom(root), add(dict), keys(lang) }
 * window.L = I18N.t (the helper every UI string goes through since pass A).
 * Dictionaries live in js/i18n/*.js as { "key": ["English", "中文"] } pairs (loaded after this file as classic scripts,
 * so everything works from file://). `{name}` placeholders; a param value starting with "@" is itself a key
 * (the sim emits e.g. { pol: "@pol.carbonTax" } so it stays language-neutral, I2).
 * Language: ?lang=zh|en > localStorage "halcyon.lang" > navigator.language (zh* → zh) > en (I3).
 * A missing zh key falls back to English; a missing English key returns the key. Both log once under ?debug=1 (I6).
 * Classic script + CommonJS (Node tests require it; it then loads the dictionaries itself).
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) {
    for (const f of ["./i18n/ui.js", "./i18n/content.js"]) api.add(require(f));
    module.exports = api;
  } else { root.I18N = api; root.L = api.t; }
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";
  const LANGS = ["en", "zh"], STORE = "halcyon.lang";
  const D = { en: {}, zh: {} };
  const hasLoc = typeof location !== "undefined";
  const store = () => (typeof window !== "undefined" && window.localStorage) || null;   // browser only (Node 26 has a warning-only stub)
  const DEBUG = hasLoc && /[?&]debug\b/.test(location.search);
  const missing = new Set(), subs = [];
  const api = { lang: "en", LANGS };

  function detect() {
    try { const q = hasLoc && new URLSearchParams(location.search).get("lang"); if (LANGS.includes(q)) return q; } catch (e) { /* no URL */ }
    try { const st = store(), s = st && st.getItem(STORE); if (LANGS.includes(s)) return s; } catch (e) { /* storage blocked */ }
    const nav = typeof navigator !== "undefined" && (navigator.language || (navigator.languages && navigator.languages[0])) || "";
    return /^zh/i.test(nav) ? "zh" : "en";
  }
  function miss(lang, key) {
    const id = lang + ":" + key;
    if (missing.has(id)) return;
    missing.add(id);
    if (DEBUG) console.log(`[i18n] missing ${lang}: ${key}`);
  }
  /* add a dictionary: { key: [en, zh] } (or { en: {...}, zh: {...} }) */
  api.add = function (dict) {
    if (!dict) return;
    if (dict.en || dict.zh) { Object.assign(D.en, dict.en || {}); Object.assign(D.zh, dict.zh || {}); return; }
    for (const k of Object.keys(dict)) { const v = dict[k]; D.en[k] = v[0]; if (v[1] != null) D.zh[k] = v[1]; }
  };
  api.has = key => D.en[key] != null || D.zh[key] != null;
  api.keys = lang => Object.keys(D[lang || "en"]);
  api.raw = (lang, key) => D[lang][key];
  api.missing = () => Array.from(missing);
  const money = k => { const a = Math.abs(k), sg = k < 0 ? "−" : ""; return a >= 1000 ? `${sg}$${(a / 1000).toFixed(2)}M` : `${sg}$${Math.round(a * 10) % 10 && a < 10 ? a.toFixed(1) : Math.round(a)}k`; };
  api.money = money;
  function t(key, params, lang) {
    lang = lang || api.lang;
    let s = D[lang][key];
    if (s == null) {
      if (lang !== "en") { miss(lang, key); s = D.en[key]; }
      if (s == null) { miss("en", key); s = key; }
    }
    // {name} = the value; {$name} = a money amount in $k, shown the game's way ($340k / $1.20M) in both languages (I5)
    if (params) s = s.replace(/\{(\$?)(\w+)\}/g, (m, cur, k) => {
      const v = params[k];
      if (v == null) return m;
      if (cur) return money(+v);
      return typeof v === "string" && v[0] === "@" ? t(v.slice(1), params, lang) : String(v);
    });
    return s;
  }
  api.t = (key, params) => t(key, params);
  api.tl = t;                       // explicit language (tests)
  /* the first of several keys that exists (e.g. a news body key that may not be defined) */
  api.opt = (key, params) => (D[api.lang][key] != null || D.en[key] != null ? t(key, params) : null);

  /* dates: en "Oct 11, Y3", zh "第3年 10月11日" (I5) */
  api.date = function (day) {
    const doy = Math.floor(day) % 360, m = Math.floor(doy / 30), d = doy % 30 + 1, y = Math.floor(day / 360) + 1;
    return t("fmt.date", { m: t("month." + m), mn: m + 1, d, y });
  };

  /* static markup: data-i18n (text), data-i18n-title, data-i18n-aria, data-i18n-ph (placeholder) */
  api.applyDom = function (el) {
    if (typeof document === "undefined") return;
    el = el || document;
    for (const n of el.querySelectorAll("[data-i18n]")) n.textContent = t(n.getAttribute("data-i18n"));
    for (const n of el.querySelectorAll("[data-i18n-title]")) n.title = t(n.getAttribute("data-i18n-title"));
    for (const n of el.querySelectorAll("[data-i18n-aria]")) n.setAttribute("aria-label", t(n.getAttribute("data-i18n-aria")));
    document.documentElement.lang = api.lang === "zh" ? "zh-CN" : "en";
    document.documentElement.classList.toggle("lang-zh", api.lang === "zh");
    if (document.title != null) document.title = t("app.title");
  };
  api.onChange = fn => subs.push(fn);
  api.setLang = function (l, opts) {
    if (!LANGS.includes(l)) return;
    const prev = api.lang;
    api.lang = l;
    if (!(opts && opts.noStore)) { try { const st = store(); if (st) st.setItem(STORE, l); } catch (e) { /* storage blocked */ } }
    if (DEBUG) console.log("[i18n] lang", prev, "->", l);
    api.applyDom();
    if (prev !== l) for (const fn of subs) { try { fn(l, prev); } catch (e) { console.error("[i18n] listener", e); } }
  };
  api.toggle = () => api.setLang(api.lang === "zh" ? "en" : "zh");
  api.lang = detect();
  return api;
});
