import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import type { AnnotationId } from "../../src/core/model.ts";
import {
  beat,
  chooseListener,
  claimNext,
  dispatchPaths,
  liveListeners,
  purgeDispatch,
  writeDispatch,
  type Listener,
} from "../../src/store/dispatch.ts";

const dirs: string[] = [];
after(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
});
async function dataDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "markspot-dispatch-"));
  dirs.push(dir);
  return dir;
}

const listener = (id: string, urlPrefix = "", startedAt = "2026-11-12T08:00:00.000Z"): Listener => ({
  id,
  urlPrefix,
  startedAt,
  pid: 1,
  host: "test",
});
const ids = ["01JD8000000000000000000001" as AnnotationId];

test("chooseListener prefers the longest matching prefix, then the oldest", () => {
  const all = [
    listener("a", ""),
    listener("b", "http://localhost:3000", "2026-11-12T09:00:00.000Z"),
    listener("c", "http://localhost:3000", "2026-11-12T08:30:00.000Z"),
    listener("d", "https://autre.test"),
  ];
  assert.equal(chooseListener(all, "http://localhost:3000/prix")?.id, "c");
  assert.equal(chooseListener(all, "https://site.test/")?.id, "a");
  assert.equal(chooseListener([listener("d", "https://autre.test")], "http://x.test/"), undefined);
});

test("two listeners claiming at once: exactly one gets the dispatch", async () => {
  const dir = await dataDir();
  const a = listener("a");
  const b = listener("b");
  await beat(dir, a);
  await beat(dir, b);
  await writeDispatch(dir, ids, "http://localhost:3000/prix");
  // Après le délai de grâce, les deux peuvent le prendre : le rename en laisse passer un seul.
  const file = (await readdir(dispatchPaths(dir).dispatch)).find((n) => n.endsWith(".json"))!;
  const old = new Date(Date.now() - 60_000);
  await utimes(join(dispatchPaths(dir).dispatch, file), old, old);
  const results = await Promise.all([claimNext(dir, a), claimNext(dir, b)]);
  assert.equal(results.filter(Boolean).length, 1);
  assert.deepEqual(results.find(Boolean)?.ids, ids);
});

test("a fresh dispatch waits for the chosen listener; one that does not match never takes it", async () => {
  const dir = await dataDir();
  const general = listener("general", "", "2026-11-12T08:00:00.000Z");
  const site = listener("site", "http://localhost:3000", "2026-11-12T09:00:00.000Z");
  const other = listener("other", "https://autre.test");
  for (const l of [general, site, other]) await beat(dir, l);
  await writeDispatch(dir, ids, "http://localhost:3000/prix");
  assert.equal(await claimNext(dir, other), null);
  assert.equal(await claimNext(dir, general), null, "inside the grace period, only the chosen listener takes it");
  assert.ok(await claimNext(dir, site));
});

test("a dispatch sent while nobody listens waits for the next listener", async () => {
  const dir = await dataDir();
  await writeDispatch(dir, ids, "http://localhost:3000/prix");
  const late = listener("late");
  await beat(dir, late);
  assert.ok(await claimNext(dir, late));
});

test("a malformed dispatch on a shared folder is ignored, a claim left by a dead listener comes back", async () => {
  const dir = await dataDir();
  const paths = dispatchPaths(dir);
  await mkdir(paths.dispatch, { recursive: true });
  await writeFile(join(paths.dispatch, "01JD8000000000000000000099.json"), JSON.stringify({ id: "../x", ids: "nope", url: 1 }));
  const me = listener("01JD8000000000000000000077");
  await beat(dir, me);
  assert.equal(await claimNext(dir, me), null);
  // Envoi réclamé par une écoute morte il y a deux minutes : repris par la suivante.
  await mkdir(paths.claimed, { recursive: true });
  const lost = { id: "01JD8000000000000000000055", ids, url: "http://localhost:3000/", at: "" };
  const claimedFile = join(paths.claimed, `${lost.id}-01JD8000000000000000000066.json`);
  await writeFile(claimedFile, JSON.stringify(lost));
  const old = new Date(Date.now() - 120_000);
  await utimes(claimedFile, old, old);
  assert.equal(await claimNext(dir, me), null, "requeued during this scan");
  assert.equal((await claimNext(dir, me))?.id, lost.id);
});

test("dead heartbeats are ignored and purged", async () => {
  const dir = await dataDir();
  await beat(dir, listener("dead"));
  const file = join(dispatchPaths(dir).listeners, "dead.json");
  const old = new Date(Date.now() - 120_000);
  await utimes(file, old, old);
  assert.deepEqual(await liveListeners(dir), []);
  await purgeDispatch(dir);
  assert.deepEqual((await readdir(dispatchPaths(dir).listeners)).filter((n) => n.endsWith(".json")), []);
});
