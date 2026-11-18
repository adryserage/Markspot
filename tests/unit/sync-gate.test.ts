import assert from "node:assert/strict";
import { test } from "node:test";
import { createSyncGate } from "../../extension/src/sync-gate.ts";

test("after a wake-up, a reply waits for the host sync before reading the notes", async () => {
  const gate = createSyncGate(1000);
  gate.expect();
  let read = false;
  const reply = gate.ready().then(() => (read = true));
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(read, false, "the reply must not read the notes before the sync");
  gate.done();
  await reply;
  assert.equal(read, true);
});

test("a host that never answers delays the first reply only, up to the limit", async () => {
  const gate = createSyncGate(50);
  gate.expect();
  const started = Date.now();
  await gate.ready();
  assert.ok(Date.now() - started >= 45, "the first reply waits up to the limit");
  const again = Date.now();
  await gate.ready();
  assert.ok(Date.now() - again < 30, "later replies do not wait again");
});

test("without a pending connection, replies do not wait", async () => {
  const gate = createSyncGate(1000);
  const started = Date.now();
  await gate.ready();
  assert.ok(Date.now() - started < 30);
});
