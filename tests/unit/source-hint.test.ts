import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanSourceHint, describeSourceHint } from "../../src/core/source-hint.ts";

test("cleanSourceHint keeps a well-formed hint and drops what the page could forge", () => {
  assert.deepEqual(cleanSourceHint({ framework: "vue", component: "PriceCard", file: "/src/PriceCard.vue?vue&type=script", line: 12, column: 3 }), {
    framework: "vue",
    component: "PriceCard",
    file: "/src/PriceCard.vue",
    line: 12,
    column: 3,
  });
  for (const bad of [null, "react", { framework: "angular", component: "X" }, { framework: "react" }]) {
    assert.equal(cleanSourceHint(bad), null);
  }
  const clipped = cleanSourceHint({ framework: "react", component: `A B‮C\n${"x".repeat(200)}`, file: "f".repeat(400), line: 1.5, column: 0 })!;
  assert.equal(clipped.component!.length, 100);
  assert.ok(!new RegExp("[\\u2028\\u202e\\n]").test(clipped.component!), "no line separators or bidi controls");
  assert.equal(clipped.file!.length, 300);
  assert.equal(clipped.line, null, "a line that is not a positive integer is dropped");
  assert.equal(clipped.column, null);
  assert.deepEqual(cleanSourceHint({ framework: "react", component: "Card", file: 42, line: 7 }), {
    framework: "react",
    component: "Card",
    file: null,
    line: null,
    column: null,
  });
});

test("describeSourceHint quotes the page's strings", () => {
  assert.equal(
    describeSourceHint({ framework: "svelte", component: null, file: "/src/App.svelte", line: 4, column: 2 }),
    'svelte, file "/src/App.svelte":4:2',
  );
  assert.equal(describeSourceHint({ framework: "react", component: 'Bad"Name', file: null, line: null, column: null }), 'react, component "Bad\\"Name"');
});
