import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { readFile } from "node:fs/promises";
const readFileText = (f: string) => readFile(f, "utf8");
import type { AnnotationId } from "../../src/core/model.ts";
import {
  beat,
  chooseListener,
  claimNext,
  completeClaim,
  dispatchPaths,
  hasWork,
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

const listener = (id: string, urlPrefix = "", startedAt = "2026-11-12T08:00:00.000Z", name = "projet"): Listener => ({
  id,
  name,
  urlPrefix,
  startedAt,
  pid: 1,
  host: "test",
});
const ids = ["01JD8000000000000000000001" as AnnotationId];
const KEY = randomBytes(32);
const HASHES = ["h"];

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
  await writeDispatch(dir, KEY, { ids, url: "http://localhost:3000/prix", to: "projet", hashes: HASHES });
  // Après le délai de grâce, les deux peuvent le prendre : le rename en laisse passer un seul.
  const file = (await readdir(dispatchPaths(dir).dispatch)).find((n) => n.endsWith(".json"))!;
  const old = new Date(Date.now() - 60_000);
  await utimes(join(dispatchPaths(dir).dispatch, file), old, old);
  const results = await Promise.all([claimNext(dir, a, KEY), claimNext(dir, b, KEY)]);
  assert.equal(results.filter(Boolean).length, 1);
  assert.deepEqual(results.find(Boolean)?.ids, ids);
});

test("a fresh dispatch waits for the chosen listener; one that does not match never takes it", async () => {
  const dir = await dataDir();
  const general = listener("general", "", "2026-11-12T08:00:00.000Z");
  const site = listener("site", "http://localhost:3000", "2026-11-12T09:00:00.000Z");
  const other = listener("other", "https://autre.test");
  for (const l of [general, site, other]) await beat(dir, l);
  await writeDispatch(dir, KEY, { ids, url: "http://localhost:3000/prix", to: "projet", hashes: HASHES });
  assert.equal(await claimNext(dir, other, KEY), null);
  assert.equal(await claimNext(dir, general, KEY), null, "inside the grace period, only the chosen listener takes it");
  assert.ok(await claimNext(dir, site, KEY));
});

test("a dispatch sent while nobody listens waits for the next listener", async () => {
  const dir = await dataDir();
  await writeDispatch(dir, KEY, { ids, url: "http://localhost:3000/prix", to: "projet", hashes: HASHES });
  const late = listener("late");
  await beat(dir, late);
  assert.ok(await claimNext(dir, late, KEY));
});

test("a malformed dispatch on a shared folder is ignored, a claim left by a dead listener comes back", async () => {
  const dir = await dataDir();
  const paths = dispatchPaths(dir);
  await mkdir(paths.dispatch, { recursive: true });
  await writeFile(join(paths.dispatch, "01JD8000000000000000000099.json"), JSON.stringify({ id: "../x", ids: "nope", url: 1 }));
  const me = listener("01JD8000000000000000000077");
  await beat(dir, me);
  assert.equal(await claimNext(dir, me, KEY), null);
  // Envoi réclamé par une écoute morte il y a deux minutes : repris par la suivante.
  await mkdir(paths.claimed, { recursive: true });
  const lost = await writeDispatch(dir, KEY, { ids, url: "http://localhost:3000/", to: "projet", hashes: HASHES });
  const claimedFile = join(paths.claimed, `${lost.id}-01JD8000000000000000000066.json`);
  await rename(join(paths.dispatch, `${lost.id}.json`), claimedFile);
  const old = new Date(Date.now() - 120_000);
  await utimes(claimedFile, old, old);
  // Le fichier mal formé est retiré : la file est vide, la réclamation abandonnée doit quand même revenir.
  await rm(join(paths.dispatch, "01JD8000000000000000000099.json"));
  const back = (await claimNext(dir, me, KEY)) ?? (await claimNext(dir, me, KEY));
  assert.equal(back?.id, lost.id);
});

test("a delivered dispatch never comes back, a fresh claim of a dead listener waits a minute", async () => {
  const dir = await dataDir();
  const a = listener("01JD8000000000000000000011");
  await beat(dir, a);
  await writeDispatch(dir, KEY, { ids, url: "http://localhost:3000/prix", to: "projet", hashes: HASHES });
  const old = new Date(Date.now() - 120_000);
  for (const n of await readdir(dispatchPaths(dir).dispatch)) {
    if (n.endsWith(".json")) await utimes(join(dispatchPaths(dir).dispatch, n), old, old);
  }
  const got = await claimNext(dir, a, KEY);
  assert.ok(got);
  // L'écoute a est morte juste après la réclamation : sa réclamation est récente, elle reste.
  const b = listener("01JD8000000000000000000022");
  await beat(dir, b);
  assert.equal(await claimNext(dir, b, KEY), null);
  assert.equal(await claimNext(dir, b, KEY), null);
  await completeClaim(dir, got!, a);
  assert.deepEqual(await readdir(dispatchPaths(dir).claimed), []);
});

test("a dispatch aimed at a project is taken only by that project, even after the grace period", async () => {
  const dir = await dataDir();
  const markspot = listener("01JD8000000000000000000031", "", "2026-11-12T08:00:00.000Z", "Markspot");
  const subv = listener("01JD8000000000000000000032", "", "2026-11-12T07:00:00.000Z", "Subvention.app");
  await beat(dir, markspot);
  await beat(dir, subv);
  await writeDispatch(dir, KEY, { ids, url: "http://localhost:3000/", to: "Markspot", hashes: HASHES });
  const old = new Date(Date.now() - 60_000);
  for (const n of await readdir(dispatchPaths(dir).dispatch)) {
    if (n.endsWith(".json")) await utimes(join(dispatchPaths(dir).dispatch, n), old, old);
  }
  assert.equal(await claimNext(dir, subv, KEY), null, "another project never takes it");
  assert.equal((await claimNext(dir, markspot, KEY))?.to, "Markspot");
});

test("an aimed dispatch waits while its project restarts, then the new listener of that name takes it", async () => {
  const dir = await dataDir();
  await writeDispatch(dir, KEY, { ids, url: "http://localhost:3000/", to: "Markspot", hashes: HASHES });
  const restarted = listener("01JD8000000000000000000041", "", "2026-11-12T10:00:00.000Z", "Markspot");
  await beat(dir, restarted);
  assert.equal((await claimNext(dir, restarted, KEY))?.to, "Markspot");
});

test("hasWork sees a waiting dispatch and a claimed one, nothing else", async () => {
  const dir = await dataDir();
  assert.equal(await hasWork(dir), false);
  const me = listener("01JD8000000000000000000052");
  await beat(dir, me);
  assert.equal(await hasWork(dir), false, "a heartbeat is not work");
  await writeDispatch(dir, KEY, { ids, url: "http://localhost:3000/", to: "projet", hashes: HASHES });
  assert.equal(await hasWork(dir), true);
  assert.ok(await claimNext(dir, me, KEY));
  assert.equal(await hasWork(dir), true, "a claim may come back if its listener dies");
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

test("a dispatch aimed at a project on one machine is never taken by the same name on another", async () => {
  const dir = await dataDir();
  const linux = { ...listener("01JD8000000000000000000061", "", "2026-11-12T07:00:00.000Z", "site"), host: "ADMSI" };
  const windows = { ...listener("01JD8000000000000000000062", "", "2026-11-12T08:00:00.000Z", "site"), host: "AEGISZ2" };
  await beat(dir, linux);
  await beat(dir, windows);
  await writeDispatch(dir, KEY, { ids, url: "http://localhost:3000/", to: "site", toHost: "AEGISZ2", hashes: HASHES });
  const old = new Date(Date.now() - 60_000);
  for (const n of await readdir(dispatchPaths(dir).dispatch)) {
    if (n.endsWith(".json")) await utimes(join(dispatchPaths(dir).dispatch, n), old, old);
  }
  assert.equal(await claimNext(dir, linux, KEY), null, "same name, other machine: never, even after the grace period");
  assert.equal((await claimNext(dir, windows, KEY))?.toHost, "AEGISZ2");
});

test("only a dispatch signed with this key is taken: none without key, a forged or altered one stays unclaimed", async () => {
  const dir = await dataDir();
  const me = listener("01JD8000000000000000000091");
  await beat(dir, me);
  const sent = await writeDispatch(dir, KEY, { ids, url: "http://localhost:3000/", to: "projet", hashes: HASHES });
  assert.equal(await claimNext(dir, me, null), null, "no key on this machine: nothing is taken");
  assert.equal(await claimNext(dir, me, randomBytes(32)), null, "another key: nothing is taken");
  // Un écrivain du partage change l'adresse d'un envoi signé, ou en dépose un sans signature.
  const file = join(dispatchPaths(dir).dispatch, `${sent.id}.json`);
  const raw = JSON.parse(await readFileText(file));
  await writeFile(file, JSON.stringify({ ...raw, url: "http://evil.test/" }));
  await writeFile(join(dispatchPaths(dir).dispatch, "01JD8000000000000000000092.json"), JSON.stringify({ ...raw, id: "01JD8000000000000000000092", sig: undefined }));
  assert.equal(await claimNext(dir, me, KEY), null);
  assert.equal((await readdir(dispatchPaths(dir).dispatch)).filter((n) => n.endsWith(".json")).length, 2, "refused dispatches stay for the purge");
  await writeFile(file, JSON.stringify(raw));
  assert.equal((await claimNext(dir, me, KEY))?.id, sent.id, "the untouched signed dispatch is taken");
  if (process.platform !== "win32") {
    assert.equal((await stat(dispatchPaths(dir).dispatch)).mode & 0o777, 0o700, "the dispatch folder is private");
  }
});
