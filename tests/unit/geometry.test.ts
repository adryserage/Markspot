import assert from "node:assert/strict";
import { test } from "node:test";
import { contains, contextSize, cropBox, visiblePart } from "../../src/core/geometry.ts";
import { pageKeyOf, redactUrl } from "../../src/core/model.ts";

const viewport = { width: 1000, height: 800 };

test("cropBox follows the real image scale, including fractional ones", () => {
  const zone = { x: 10.3, y: 20.6, width: 100.2, height: 50.1 };
  for (const scale of [1, 1.25, 1.5, 2]) {
    const image = { width: viewport.width * scale, height: viewport.height * scale };
    const box = cropBox(zone, viewport, image);
    assert.equal(box.x, Math.floor(10.3 * scale));
    assert.equal(box.y, Math.floor(20.6 * scale));
    assert.equal(box.x + box.width, Math.ceil(110.5 * scale));
    assert.equal(box.y + box.height, Math.ceil(70.7 * scale));
  }
});

test("cropBox stays inside the image at the edges", () => {
  const image = { width: 1250, height: 1000 };
  const box = cropBox({ x: 990, y: 790, width: 50, height: 50 }, viewport, image);
  assert.equal(box.x + box.width, 1250);
  assert.equal(box.y + box.height, 1000);
});

test("visiblePart clips to the viewport and returns null when fully outside", () => {
  assert.deepEqual(visiblePart({ x: -10, y: 700, width: 50, height: 200 }, 1000, 800), {
    x: 0,
    y: 700,
    width: 40,
    height: 100,
  });
  assert.equal(visiblePart({ x: 0, y: 900, width: 50, height: 50 }, 1000, 800), null);
});

test("contextSize caps the width at 1600 px and keeps the ratio", () => {
  assert.deepEqual(contextSize({ width: 3200, height: 1800 }), { width: 1600, height: 900, scale: 0.5 });
  assert.deepEqual(contextSize({ width: 1280, height: 720 }), { width: 1280, height: 720, scale: 1 });
});

test("contains", () => {
  assert.ok(contains({ x: 0, y: 0, width: 10, height: 10 }, { x: 2, y: 2, width: 3, height: 3 }));
  assert.ok(!contains({ x: 0, y: 0, width: 10, height: 10 }, { x: 8, y: 2, width: 3, height: 3 }));
});

test("redactUrl masks secret-looking parameters in the query and the fragment", () => {
  const url = redactUrl("https://app.test/cb?code=abc&page=2#access_token=xyz&state=1");
  assert.equal(url, "https://app.test/cb?code=%5Bmasqu%C3%A9%5D&page=2#access_token=%5Bmasqu%C3%A9%5D&state=1");
  assert.equal(redactUrl("http://localhost:3000/prix"), "http://localhost:3000/prix");
});

test("pageKeyOf drops query, hash and trailing slash", () => {
  assert.equal(pageKeyOf("http://localhost:3000/prix/?a=1#b"), "http://localhost:3000/prix");
  assert.equal(pageKeyOf("https://site.test/"), "https://site.test/");
});
