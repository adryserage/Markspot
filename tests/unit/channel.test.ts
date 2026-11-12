import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { LOCAL_SCOPE, STYLE_PROPS, type AnnotationId, type NewAnnotation } from "../../src/core/model.ts";
import { NewAnnotationSchema } from "../../src/core/schema.ts";
import { startChannel } from "../../src/mcp/channel.ts";
import { dispatchPaths, liveListeners } from "../../src/store/dispatch.ts";
import { openAgentStore, openHostStore } from "../../src/store/store.ts";

const dirs: string[] = [];
after(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
});

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const until = async (check: () => Promise<boolean> | boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return false;
};

async function setup(id: string) {
  const dataDir = await mkdtemp(join(tmpdir(), "markspot-channel-"));
  dirs.push(dataDir);
  const config = { dataDir, scope: LOCAL_SCOPE };
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
  const pushed: string[] = [];
  const channel = startChannel({
    dataDir,
    store: await openAgentStore(config),
    name: "projet",
    push: async (content) => void pushed.push(content),
    ackMs: 400,
    scanMs: 30,
    beatMs: 100,
  });
  const claimed = async () => (await readdir(dispatchPaths(dataDir).claimed).catch(() => [])).filter((n) => n.endsWith(".json"));
  const queued = async () => (await readdir(dispatchPaths(dataDir).dispatch).catch(() => [])).filter((n) => n.endsWith(".json"));
  return { dataDir, host, note, pushed, channel, claimed, queued };
}

test("a pushed send stays claimed until Claude opens one of its notes, then it is gone", async () => {
  const t = await setup("01JD8000000000000000000081");
  assert.ok(await until(async () => (await liveListeners(t.dataDir)).length === 1), "the session announces itself");
  await t.host.send([t.note.id], "http://localhost:3000/prix", "projet");
  assert.ok(await until(() => t.pushed.length === 1));
  assert.equal((await t.claimed()).length, 1, "kept until Claude shows it got the notes");
  t.channel.seen(t.note.id as AnnotationId);
  assert.ok(await until(async () => (await t.claimed()).length === 0));
  assert.deepEqual(await t.queued(), []);
  await t.channel.stop();
});

test("with no sign from Claude, the send goes back to the queue and the session goes quiet until the next tool call", async () => {
  const t = await setup("01JD8000000000000000000082");
  assert.ok(await until(async () => (await liveListeners(t.dataDir)).length === 1));
  await t.host.send([t.note.id], "http://localhost:3000/prix", "projet");
  assert.ok(await until(() => t.pushed.length === 1));
  assert.ok(await until(async () => (await t.queued()).length === 1), "released after ackMs");
  assert.ok(await until(async () => (await liveListeners(t.dataDir)).length === 0), "and no longer listed in the page");
  assert.equal(t.pushed.length, 1, "quiet: no second push while nobody answers");
  t.channel.seen(); // Claude appelle un outil : la session est de nouveau là
  assert.ok(await until(() => t.pushed.length === 2), "the send is pushed again");
  t.channel.seen(t.note.id as AnnotationId);
  assert.ok(await until(async () => (await t.claimed()).length === 0 && (await t.queued()).length === 0));
  await t.channel.stop();
});

test("a send whose notes are resolved meanwhile is completed without waiting", async () => {
  const t = await setup("01JD8000000000000000000083");
  assert.ok(await until(async () => (await liveListeners(t.dataDir)).length === 1));
  await t.host.send([t.note.id], "http://localhost:3000/prix", "projet");
  assert.ok(await until(() => t.pushed.length === 1));
  await t.host.resolve(t.note.id as AnnotationId, "Réglée à la main", { kind: "user", id: "local", name: "local" });
  assert.ok(await until(async () => (await t.claimed()).length === 0));
  assert.deepEqual(await t.queued(), []);
  await t.channel.stop();
});
