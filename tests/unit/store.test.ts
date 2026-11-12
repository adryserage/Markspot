import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { LOCAL_SCOPE, STYLE_PROPS, type AnnotationId, type NewAnnotation } from "../../src/core/model.ts";
import { NewAnnotationSchema } from "../../src/core/schema.ts";
import { openAgentStore, openHostStore, type StoreConfig } from "../../src/store/store.ts";

const dirs: string[] = [];
after(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
});

async function config(): Promise<StoreConfig> {
  const dir = await mkdtemp(join(tmpdir(), "markspot-store-"));
  dirs.push(dir);
  return { dataDir: dir, scope: LOCAL_SCOPE };
}

let counter = 0;
function newAnnotation(comment = "Le bouton déborde"): NewAnnotation {
  const id = `01JD8${String(++counter).padStart(21, "0")}` as AnnotationId;
  const rect = { x: 1, y: 2, width: 3, height: 4 };
  return NewAnnotationSchema.parse({
    id,
    scope: "local",
    createdAt: "2026-11-12T08:15:00.000Z",
    author: { kind: "user", id: "local", name: "local" },
    source: { kind: "extension", trust: "owner" },
    page: { url: "http://localhost:3000/prix", title: "Prix" },
    mark: {
      kind: "element",
      anchor: {
        selector: "#acheter",
        tag: "button",
        role: null,
        text: "Acheter",
        attributes: { id: "acheter" },
        styles: Object.fromEntries(STYLE_PROPS.map((p) => [p, "0"])),
      },
      rect,
      rectInAnchor: rect,
    },
    viewport: { width: 1000, height: 800, devicePixelRatio: 1, scrollX: 0, scrollY: 0 },
    comment,
    captures: { zone: { rect, width: 3, height: 4 }, context: { rect, width: 10, height: 8 } },
  }) as unknown as NewAnnotation;
}

const pngs = { zone: new Uint8Array([1, 2]), context: new Uint8Array([3]) };
const agent = { kind: "agent", id: "claude-code", name: "Claude" } as const;

test("create twice with the same id writes one note", async () => {
  const cfg = await config();
  const store = await openHostStore(cfg);
  const note = newAnnotation();
  const first = await store.create(note, pngs);
  const second = await store.create(note, pngs);
  assert.equal(first.annotation.seq, 1);
  assert.deepEqual(second, first);
  assert.equal((await store.list()).length, 1);
  assert.deepEqual(await store.capture(note.id, "zone"), new Uint8Array([1, 2]));
});

test("two hosts creating at the same time get distinct pin numbers", async () => {
  const cfg = await config();
  const [a, b] = await Promise.all([openHostStore(cfg), openHostStore(cfg)]);
  const notes = Array.from({ length: 6 }, () => newAnnotation());
  await Promise.all(notes.map((note, i) => (i % 2 ? a : b).create(note, pngs)));
  const seqs = (await a.list()).map((t) => t.annotation.seq);
  assert.deepEqual(seqs, [1, 2, 3, 4, 5, 6]);
});

test("resolve: first reply wins, same reply is unchanged, unknown id is not_found", async () => {
  const cfg = await config();
  const host = await openHostStore(cfg);
  const note = newAnnotation();
  await host.create(note, pngs);
  const [s1, s2] = await Promise.all([openAgentStore(cfg), openAgentStore(cfg)]);
  const [r1, r2] = await Promise.all([s1.resolve(note.id, "Corrigé", agent), s2.resolve(note.id, "Autre", agent)]);
  const kinds = [r1.kind, r2.kind].sort();
  assert.deepEqual(kinds, ["already_resolved", "resolved"]);
  assert.equal((await s1.resolve(note.id, (r1.kind === "resolved" ? "Corrigé" : "Autre"), agent)).kind, "unchanged");
  assert.equal((await s1.resolve("01JD8ZZZZZZZZZZZZZZZZZZZZZ" as AnnotationId, "x", agent)).kind, "not_found");
  const state = await s1.list({ state: "resolved" });
  assert.equal(state.length, 1);
  const leftovers = (await readdir(join(cfg.dataDir, "local", note.id))).filter((n) => n.endsWith(".tmp"));
  assert.deepEqual(leftovers, []);
});

test("clear removes matching notes once", async () => {
  const cfg = await config();
  const host = await openHostStore(cfg);
  const open = newAnnotation();
  const done = newAnnotation();
  await host.create(open, pngs);
  await host.create(done, pngs);
  const agentStore = await openAgentStore(cfg);
  await agentStore.resolve(done.id, "Fait", agent);
  assert.deepEqual(await agentStore.clear({ state: "resolved" }), [done.id]);
  assert.deepEqual(await agentStore.clear({ state: "resolved" }), []);
  assert.deepEqual((await agentStore.list()).map((t) => t.annotation.id), [open.id]);
});

test("watch reports a resolution written by another process", async () => {
  const cfg = await config();
  const host = await openHostStore(cfg);
  const note = newAnnotation();
  await host.create(note, pngs);
  const changes: string[] = [];
  const watcher = host.watch((c) => changes.push(c.kind === "upserted" ? `up:${c.thread.resolution?.reply ?? ""}` : "removed"));
  await new Promise((r) => setTimeout(r, 300));
  await (await openAgentStore(cfg)).resolve(note.id, "Corrigé", agent);
  await new Promise((r) => setTimeout(r, 600));
  watcher.close();
  assert.deepEqual(changes, ["up:Corrigé"]);
});

test("editComment bumps the revision, and a resolved note no longer changes", async () => {
  const cfg = await config();
  const host = await openHostStore(cfg);
  const note = newAnnotation();
  await host.create(note, pngs);
  const edited = await host.editComment(note.id, "Le bouton déborde sur mobile");
  assert.equal(edited.kind, "edited");
  assert.equal(edited.kind === "edited" && edited.thread.annotation.revision, 1);
  assert.equal((await host.get(note.id))?.annotation.comment, "Le bouton déborde sur mobile");
  await (await openAgentStore(cfg)).resolve(note.id, "Fait", agent);
  assert.equal((await host.editComment(note.id, "Autre chose")).kind, "already_resolved");
  assert.equal((await host.editComment("01JD8ZZZZZZZZZZZZZZZZZZZZZ" as AnnotationId, "x")).kind, "not_found");
});

test("clearNotes removes resolved notes, and open ones only with includeOpen", async () => {
  const cfg = await config();
  const host = await openHostStore(cfg);
  const open = newAnnotation();
  const done = newAnnotation();
  await host.create(open, pngs);
  await host.create(done, pngs);
  await (await openAgentStore(cfg)).resolve(done.id, "Fait", agent);
  assert.deepEqual(await host.clearNotes([open.id, done.id], { includeOpen: false }), [done.id]);
  assert.deepEqual((await host.list()).map((t) => t.annotation.id), [open.id]);
  assert.deepEqual(await host.clearNotes([open.id], { includeOpen: true }), [open.id]);
  assert.deepEqual(await host.list(), []);
});

test("the user resolves and reopens a note; a stale reopen keeps a newer reply", async () => {
  const cfg = await config();
  const host = await openHostStore(cfg);
  const note = newAnnotation();
  await host.create(note, pngs);
  const user = { kind: "user", id: "local", name: "local" } as const;
  const resolved = await host.resolve(note.id, "Réglée à la main.", user);
  assert.equal(resolved.kind, "resolved");
  const seen = resolved.kind === "resolved" ? resolved.thread.resolution!.resolvedAt : "";
  assert.equal((await host.reopen(note.id, seen)).kind, "reopened");
  assert.equal((await host.get(note.id))?.resolution, null);
  // Claude répond, puis un « Rouvrir » en retard qui visait l'ancienne réponse ne retire rien.
  await new Promise((r) => setTimeout(r, 5)); // dates à la milliseconde : deux réponses distinctes
  await (await openAgentStore(cfg)).resolve(note.id, "Corrigé par Claude", agent);
  assert.equal((await host.reopen(note.id, seen)).kind, "changed");
  assert.equal((await host.get(note.id))?.resolution?.reply, "Corrigé par Claude");
});

test("when link is refused (SMB share from Windows), exclusive create still lets one reply win", async () => {
  const cfg = await config();
  await (await openHostStore(cfg)).create(newAnnotation(), pngs);
  const refused = Object.assign(new Error("not permitted"), { code: "EPERM" });
  const smb = { ...cfg, linkFile: async () => Promise.reject(refused) };
  const [a, b] = await Promise.all([openAgentStore(smb), openAgentStore(smb)]);
  const id = (await a.list())[0]!.annotation.id;
  const results = await Promise.all([a.resolve(id, "Un", agent), b.resolve(id, "Deux", agent)]);
  assert.deepEqual(results.map((r) => r.kind).sort(), ["already_resolved", "resolved"]);
  assert.equal((await a.resolve(id, (await a.get(id))!.resolution!.reply, agent)).kind, "unchanged");
});

test("an empty, old resolution file (write interrupted) no longer blocks the note", async () => {
  const cfg = await config();
  const host = await openHostStore(cfg);
  const note = newAnnotation();
  await host.create(note, pngs);
  const file = join(cfg.dataDir, "local", note.id, "resolution.json");
  await writeFile(file, "");
  const old = new Date(Date.now() - 60_000);
  await utimes(file, old, old);
  assert.equal((await host.get(note.id))?.resolution, null);
  assert.equal((await (await openAgentStore(cfg)).resolve(note.id, "Corrigé", agent)).kind, "resolved");
});

test("an id with a path inside is refused", () => {
  const bad = { ...newAnnotation(), id: "../../etc/passwd" };
  assert.equal(NewAnnotationSchema.safeParse(bad).success, false);
});
