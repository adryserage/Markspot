import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { LOCAL_SCOPE, STYLE_PROPS, type NewAnnotation } from "../../src/core/model.ts";
import { NewAnnotationSchema } from "../../src/core/schema.ts";
import { startWaitListener } from "../../src/mcp/wait-listener.ts";
import { dispatchPaths, liveListeners } from "../../src/store/dispatch.ts";
import { openAgentStore, openHostStore } from "../../src/store/store.ts";

const dirs: string[] = [];
after(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
});
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

async function setup(id: string, lingerMs = 60_000) {
  const dataDir = await mkdtemp(join(tmpdir(), "markspot-wait-"));
  dirs.push(dataDir);
  const config = { dataDir, scope: LOCAL_SCOPE, dispatchKey: randomBytes(32) };
  const host = await openHostStore(config);
  const rect = { x: 1, y: 2, width: 3, height: 4 };
  const note = NewAnnotationSchema.parse({
    id,
    scope: "local",
    createdAt: "2026-11-12T08:15:00.000Z",
    author: { kind: "user", id: "local", name: "local" },
    source: { kind: "extension", trust: "owner" },
    page: { url: "http://localhost:3000/prix", title: "Prix" },
    mark: {
      kind: "element",
      anchor: { selector: "#acheter", tag: "button", role: null, text: "Acheter", attributes: {}, styles: Object.fromEntries(STYLE_PROPS.map((p) => [p, ""])) },
      rect,
      rectInAnchor: rect,
    },
    viewport: { width: 1000, height: 800, devicePixelRatio: 1, scrollX: 0, scrollY: 0 },
    comment: "Le bouton déborde",
    captures: { zone: { rect, width: 3, height: 4 }, context: { rect, width: 10, height: 8 } },
  }) as unknown as NewAnnotation;
  await host.create(note, { zone: png, context: png });
  const waiter = startWaitListener({
    dataDir,
    store: await openAgentStore(config),
    name: "projet",
    auth: { key: config.dispatchKey, consumedDir: join(dataDir, "consumed") },
    lingerMs,
    beatMs: 50,
  });
  return { dataDir, host, note, waiter };
}

test("the first wait announces the session; a send aimed at it is returned, then gone", async () => {
  const t = await setup("01JD8000000000000000000101");
  assert.deepEqual(await liveListeners(t.dataDir), [], "silent before any wait call");
  assert.equal(await t.waiter.next(), null);
  assert.deepEqual((await liveListeners(t.dataDir)).map((l) => l.name), ["projet"], "listed in the page");
  const sent = await t.host.send([t.note.id], "http://localhost:3000/prix", "projet");
  assert.equal(sent.kind, "sent");
  const got = await t.waiter.next();
  assert.deepEqual(got?.open.map((n) => n.annotation.id), [t.note.id]);
  await t.waiter.complete(got!.dispatch);
  assert.deepEqual((await readdir(dispatchPaths(t.dataDir).claimed)).filter((n) => n.endsWith(".json")), []);
  assert.equal(await t.waiter.next(), null, "a delivered send never comes back");
  await t.waiter.stop();
  assert.deepEqual(await liveListeners(t.dataDir), [], "stop removes the heartbeat");
});

test("an interrupted wait puts the send back; a session that stops waiting leaves the page", async () => {
  const t = await setup("01JD8000000000000000000102", 150);
  await t.waiter.next();
  await t.host.send([t.note.id], "http://localhost:3000/prix", "projet");
  const got = await t.waiter.next();
  await t.waiter.release(got!.dispatch);
  assert.equal((await readdir(dispatchPaths(t.dataDir).dispatch)).filter((n) => n.endsWith(".json")).length, 1, "back in the queue");
  await new Promise((r) => setTimeout(r, 400));
  assert.deepEqual(await liveListeners(t.dataDir), [], "gone after the linger window");
  assert.ok(await t.waiter.next(), "the next wait call announces again and takes the send");
  await t.waiter.stop();
});
