// Seul module qui touche au dossier des notes.
//
//   <dataDir>/<scope>/<id>/annotation.json   écrit une fois par un hôte
//                         /zone.png, context.png
//                         /resolution.json   écrit une fois par un serveur MCP (link exclusif)
//   <dataDir>/<scope>/.seq/<n>               numéro de pastille réservé (création exclusive)
//   <dataDir>/.staging/<pid>-<id>/           note en cours d'écriture, invisible des lecteurs
//   <dataDir>/.trash/                        notes en cours de suppression
//
// Aucun fichier n'a deux sortes d'écrivains : pas de verrou. Deux hôtes (Brave et Chrome
// ouverts ensemble) peuvent créer en même temps : le numéro se réserve par fichier exclusif.
// Retirer une note (serveur MCP, ou hôte pour une note réglée) passe par un rename atomique
// du dossier vers .trash : de deux suppressions concurrentes, la seconde ne trouve plus rien.

import { randomBytes } from "node:crypto";
import { watch as fsWatch } from "node:fs";
import { link, mkdir, readdir, readFile, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  Annotation,
  AnnotationId,
  Author,
  CaptureKind,
  IsoTime,
  NewAnnotation,
  Resolution,
  ScopeId,
  Thread,
  ThreadState,
} from "../core/model.ts";
import { CAPTURE_KINDS, LOCAL_SCOPE, stateOf } from "../core/model.ts";
import { currentPlatform, pathsFor } from "../core/paths.ts";
import { AnnotationSchema, ResolutionSchema, parseAnnotationId, scopeDir } from "../core/schema.ts";

export interface StoreConfig {
  dataDir: string;
  scope: ScopeId;
}

/** Le dossier vient de config.json (clé dataDir) s'il est donné, sinon du système. */
export async function loadConfig(): Promise<StoreConfig> {
  const paths = pathsFor(currentPlatform(), process.env, homedir());
  let dataDir = paths.dataDir;
  try {
    const saved = JSON.parse(await readFile(join(paths.configDir, "config.json"), "utf8")) as { dataDir?: unknown };
    if (typeof saved.dataDir === "string" && saved.dataDir !== "") dataDir = saved.dataDir;
  } catch {
    // pas de réglage : dossier par défaut
  }
  return { dataDir, scope: LOCAL_SCOPE };
}

export interface ThreadFilter {
  state?: ThreadState;
  /** Préfixe de l'adresse : « http://localhost:3000 » prend toute l'application. */
  urlPrefix?: string;
}

export interface ThreadReader {
  list(filter?: ThreadFilter): Promise<Thread[]>;
  get(id: AnnotationId): Promise<Thread | null>;
  capture(id: AnnotationId, kind: CaptureKind): Promise<Uint8Array | null>;
  /** Chemin du fichier de capture, pour le donner à Claude. */
  capturePath(id: AnnotationId, kind: CaptureKind): string;
}

export type ThreadChange = { kind: "upserted"; thread: Thread } | { kind: "removed"; id: AnnotationId };

export type EditOutcome =
  | { kind: "edited"; thread: Thread }
  | { kind: "already_resolved"; thread: Thread }
  | { kind: "not_found" };

export interface HostStore extends ThreadReader {
  /** Idempotent sur annotation.id. La note apparaît entière ou pas du tout. */
  create(annotation: NewAnnotation, pngs: Record<CaptureKind, Uint8Array>): Promise<Thread>;
  /** Remplace le commentaire d'une note ouverte. Une note réglée ne change plus. */
  editComment(id: AnnotationId, comment: string): Promise<EditOutcome>;
  /** Retire celles de ces notes qui sont réglées (bouton de la page). Rend les identifiants retirés. */
  clearResolved(ids: AnnotationId[]): Promise<AnnotationId[]>;
  /** Appelle onChange pour chaque note créée, réglée ou retirée par un autre processus. */
  watch(onChange: (change: ThreadChange) => void): { close(): void };
}

export type ResolveOutcome =
  | { kind: "resolved"; thread: Thread }
  | { kind: "unchanged"; thread: Thread }
  | { kind: "already_resolved"; thread: Thread }
  | { kind: "not_found" };

export interface AgentStore extends ThreadReader {
  resolve(id: AnnotationId, reply: string, by: Author): Promise<ResolveOutcome>;
  /** Rend les identifiants retirés. Relancé, il ne retire rien de plus. */
  clear(filter: { state: ThreadState | "all"; urlPrefix?: string }): Promise<AnnotationId[]>;
}

const FILE_MODE = 0o600;
const DIR_MODE = 0o700;
const STALE_STAGING_MS = 60 * 60 * 1000;
const RESCAN_MS = 5_000;

const code = (error: unknown) => (error as NodeJS.ErrnoException).code;

function layout(config: StoreConfig) {
  const scope = join(config.dataDir, scopeDir(config.scope));
  return {
    scope,
    seq: join(scope, ".seq"),
    staging: join(config.dataDir, ".staging"),
    trash: join(config.dataDir, ".trash"),
    note: (id: AnnotationId) => join(scope, id),
  };
}

type Layout = ReturnType<typeof layout>;

async function readJson(path: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (code(error) === "ENOENT") return undefined;
    if (error instanceof SyntaxError) return undefined; // fichier en cours d'écriture ou abîmé
    throw error;
  }
}

async function readThread(paths: Layout, id: AnnotationId): Promise<Thread | null> {
  const rawAnnotation = await readJson(join(paths.note(id), "annotation.json"));
  if (rawAnnotation === undefined) return null;
  const annotation = AnnotationSchema.safeParse(rawAnnotation);
  if (!annotation.success) {
    process.stderr.write(`markspot: skipped unreadable note ${id}\n`);
    return null;
  }
  const rawResolution = await readJson(join(paths.note(id), "resolution.json"));
  const resolution = rawResolution === undefined ? null : ResolutionSchema.safeParse(rawResolution);
  return {
    annotation: annotation.data as unknown as Annotation,
    resolution: resolution?.success ? (resolution.data as unknown as Resolution) : null,
  };
}

function reader(paths: Layout): ThreadReader {
  return {
    async list(filter = {}) {
      let names: string[];
      try {
        names = await readdir(paths.scope);
      } catch (error) {
        if (code(error) === "ENOENT") return [];
        throw error;
      }
      const threads: Thread[] = [];
      for (const name of names) {
        const id = parseAnnotationId(name);
        if (!id) continue;
        const thread = await readThread(paths, id);
        if (!thread) continue;
        if (filter.state && stateOf(thread) !== filter.state) continue;
        if (filter.urlPrefix && !thread.annotation.page.url.startsWith(filter.urlPrefix)) continue;
        threads.push(thread);
      }
      return threads.sort((a, b) => a.annotation.seq - b.annotation.seq);
    },
    get: (id) => readThread(paths, id),
    async capture(id, kind) {
      try {
        return new Uint8Array(await readFile(join(paths.note(id), `${kind}.png`)));
      } catch (error) {
        if (code(error) === "ENOENT") return null;
        throw error;
      }
    },
    capturePath: (id, kind) => join(paths.note(id), `${kind}.png`),
  };
}

async function reserveSeq(paths: Layout, id: AnnotationId): Promise<number> {
  await mkdir(paths.seq, { recursive: true, mode: DIR_MODE });
  const taken = (await readdir(paths.seq)).map(Number).filter(Number.isInteger);
  for (let n = 1 + Math.max(0, ...taken); ; n++) {
    try {
      await writeFile(join(paths.seq, String(n)), id, { flag: "wx", mode: FILE_MODE });
      return n;
    } catch (error) {
      if (code(error) !== "EEXIST") throw error;
    }
  }
}

/** Retire une note : rename vers .trash puis suppression. false si elle n'existait plus. */
async function removeNote(paths: Layout, id: AnnotationId): Promise<boolean> {
  await mkdir(paths.trash, { recursive: true, mode: DIR_MODE });
  const trashed = join(paths.trash, `${id}-${randomBytes(4).toString("hex")}`);
  try {
    await rename(paths.note(id), trashed);
  } catch (error) {
    if (code(error) === "ENOENT") return false; // retirée par un autre processus
    throw error;
  }
  await rm(trashed, { recursive: true, force: true });
  return true;
}

/** Retire les dossiers d'écriture abandonnés depuis plus d'une heure (un autre hôte peut écrire). */
async function purgeStale(dir: string): Promise<void> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return;
  }
  for (const name of names) {
    const path = join(dir, name);
    try {
      if (Date.now() - (await stat(path)).mtimeMs > STALE_STAGING_MS) await rm(path, { recursive: true, force: true });
    } catch {
      // déjà retiré par un autre processus
    }
  }
}

export async function openHostStore(config: StoreConfig): Promise<HostStore> {
  const paths = layout(config);
  await mkdir(paths.scope, { recursive: true, mode: DIR_MODE });
  await mkdir(paths.staging, { recursive: true, mode: DIR_MODE });
  await purgeStale(paths.staging);
  await purgeStale(paths.trash);
  const read = reader(paths);

  return {
    ...read,
    async create(input, pngs) {
      const existing = await read.get(input.id);
      if (existing) return existing;
      const seq = await reserveSeq(paths, input.id);
      const annotation: Annotation = { ...input, schemaVersion: 1, seq };
      const staging = join(paths.staging, `${process.pid}-${input.id}`);
      await rm(staging, { recursive: true, force: true });
      await mkdir(staging, { mode: DIR_MODE });
      await writeFile(join(staging, "annotation.json"), JSON.stringify(annotation, null, 2), { mode: FILE_MODE });
      for (const kind of CAPTURE_KINDS) await writeFile(join(staging, `${kind}.png`), pngs[kind], { mode: FILE_MODE });
      try {
        await rename(staging, paths.note(input.id));
      } catch (error) {
        await rm(staging, { recursive: true, force: true });
        if (code(error) !== "EEXIST" && code(error) !== "ENOTEMPTY") throw error;
      }
      const thread = await read.get(input.id);
      if (!thread) throw new Error(`note ${input.id} vanished after creation`);
      return thread;
    },

    async clearResolved(ids) {
      const removed: AnnotationId[] = [];
      for (const id of ids) {
        const thread = await read.get(id);
        // Une note réglée ne change plus : aucune course avec resolve ou editComment.
        if (thread?.resolution && (await removeNote(paths, id))) removed.push(id);
      }
      return removed;
    },

    async editComment(id, comment) {
      const thread = await read.get(id);
      if (!thread) return { kind: "not_found" };
      if (thread.resolution) return { kind: "already_resolved", thread };
      if (thread.annotation.comment === comment) return { kind: "edited", thread };
      const next: Annotation = {
        ...thread.annotation,
        comment,
        revision: (thread.annotation.revision ?? 0) + 1,
        updatedAt: new Date().toISOString() as IsoTime,
      };
      const file = join(paths.note(id), "annotation.json");
      const tmp = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
      await writeFile(tmp, JSON.stringify(next, null, 2), { mode: FILE_MODE });
      await rename(tmp, file);
      const now = await read.get(id);
      return now ? { kind: "edited", thread: now } : { kind: "not_found" };
    },

    watch(onChange) {
      const known = new Map<string, string>();
      const fingerprint = (t: Thread) =>
        `${t.annotation.seq}|${t.annotation.revision ?? 0}|${t.resolution?.resolvedAt ?? ""}|${t.resolution?.reply ?? ""}`;
      let timer: NodeJS.Timeout | null = null;
      let running = Promise.resolve();
      const rescan = () =>
        (running = running.then(async () => {
          const threads = await read.list();
          const seen = new Set<string>();
          for (const thread of threads) {
            const id = thread.annotation.id;
            seen.add(id);
            const print = fingerprint(thread);
            if (known.get(id) !== print) {
              const isNew = !known.has(id);
              known.set(id, print);
              if (!isNew || initialized) onChange({ kind: "upserted", thread });
            }
          }
          for (const id of [...known.keys()]) {
            if (!seen.has(id)) {
              known.delete(id);
              onChange({ kind: "removed", id: id as AnnotationId });
            }
          }
          initialized = true;
        }).catch(() => undefined));
      let initialized = false;
      const schedule = () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => void rescan(), 150);
      };
      void rescan();
      // fs.watch n'est qu'un déclencheur : il peut manquer un événement, d'où la relecture régulière.
      const watcher = fsWatch(paths.scope, { recursive: true }, schedule);
      const interval = setInterval(() => void rescan(), RESCAN_MS);
      return {
        close() {
          watcher.close();
          clearInterval(interval);
          if (timer) clearTimeout(timer);
        },
      };
    },
  };
}

export async function openAgentStore(config: StoreConfig): Promise<AgentStore> {
  const paths = layout(config);
  const read = reader(paths);

  return {
    ...read,
    async resolve(id, reply, by) {
      const thread = await read.get(id);
      if (!thread) return { kind: "not_found" };
      const decide = (t: Thread): ResolveOutcome =>
        t.resolution?.reply === reply ? { kind: "unchanged", thread: t } : { kind: "already_resolved", thread: t };
      if (thread.resolution) return decide(thread);

      const resolution: Resolution = {
        schemaVersion: 1,
        annotationId: id,
        resolvedAt: new Date().toISOString() as IsoTime,
        author: by,
        reply,
      };
      const tmp = join(paths.note(id), `.resolution.${process.pid}.${randomBytes(4).toString("hex")}.tmp`);
      try {
        await writeFile(tmp, JSON.stringify(resolution, null, 2), { mode: FILE_MODE });
        await link(tmp, join(paths.note(id), "resolution.json"));
      } catch (error) {
        if (code(error) === "ENOENT") return { kind: "not_found" };
        if (code(error) !== "EEXIST") throw error;
        const now = await read.get(id);
        return now ? decide(now) : { kind: "not_found" };
      } finally {
        await unlink(tmp).catch(() => undefined);
      }
      const done = await read.get(id);
      return done ? { kind: "resolved", thread: done } : { kind: "not_found" };
    },

    async clear(filter) {
      const threads = await read.list({
        ...(filter.state === "all" ? {} : { state: filter.state }),
        ...(filter.urlPrefix ? { urlPrefix: filter.urlPrefix } : {}),
      });
      const removed: AnnotationId[] = [];
      for (const { annotation } of threads) {
        if (await removeNote(paths, annotation.id)) removed.push(annotation.id);
      }
      return removed;
    },
  };
}
