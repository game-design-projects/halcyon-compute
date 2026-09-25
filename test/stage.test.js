"use strict";
/* Stage fit math (js/stage.js): uniform scale-to-fit with letterboxing, never larger than the window. */
const test = require("node:test");
const assert = require("node:assert");
const Stage = require("../js/stage.js");

const SIZES = [[1920, 1080], [1280, 720], [1600, 900], [1366, 768], [1152, 648], [960, 540], [1320, 770], [2560, 1440], [1024, 768], [3440, 1440]];

test("stage: the stylesheet box is 1440x810 and maps to the 1920x1080 design at zoom 4/3", () => {
  assert.strictEqual(Stage.STAGE_W, 1440); assert.strictEqual(Stage.STAGE_H, 810);
  assert.strictEqual(Stage.STAGE_W / Stage.STAGE_H, 16 / 9);
  const f = Stage.fit(1920, 1080);
  assert.ok(Math.abs(f.z - 4 / 3) < 1e-3, `zoom ${f.z}`);
});

test("stage: fit never exceeds the window, fills one axis, and centres the letterbox", () => {
  for (const [w, h] of SIZES) {
    const f = Stage.fit(w, h);
    assert.ok(f.w <= w + 1e-9 && f.h <= h + 1e-9, `${w}x${h}: stage ${f.w}x${f.h} overflows`);
    assert.ok(w - f.w < 1 || h - f.h < 1, `${w}x${h}: neither axis filled (${f.w}x${f.h})`);
    assert.ok(Math.abs(f.x - (w - f.w) / 2) < 1e-9 && Math.abs(f.y - (h - f.h) / 2) < 1e-9, "centred");
    assert.ok(f.x >= 0 && f.y >= 0);
  }
});

test("stage: 16:9 windows have no letterbox; 4:3 and ultrawide letterbox on the right axis", () => {
  for (const [w, h] of [[1920, 1080], [1280, 720], [960, 540], [1600, 900]]) { const f = Stage.fit(w, h); assert.ok(f.x < 1 && f.y < 1, `${w}x${h}`); }
  assert.ok(Stage.fit(1024, 768).y > 50, "4:3 -> bars top and bottom");
  assert.ok(Stage.fit(3440, 1440).x > 400, "ultrawide -> bars left and right");
  assert.strictEqual(Stage.fit(960, 540).z, 0.6666);
});

test("stage: degenerate windows fall back to zoom 1", () => {
  assert.strictEqual(Stage.fit(0, 0).z, 1);
  assert.strictEqual(Stage.fit(NaN, 500).z, 1);
});
