// Envois « Envoyer à Claude » et sessions qui écoutent, dans le dossier des notes.
//
//   <dataDir>/.dispatch/<id>.json              envoi écrit par l'hôte (fichier temporaire puis rename)
//   <dataDir>/.dispatch/.claimed/<id>-<l>.json  envoi réclamé par l'écoute <l> (rename exclusif)
//   <dataDir>/.listeners/<l>.json              battement d'une écoute, réécrit toutes les 10 s
//
// Le rename d'un envoi vers un nom unique ne réussit que pour une écoute : l'autre reçoit
// ENOENT. Les âges se mesurent contre l'horloge du système de fichiers (mtime d'un fichier
// qu'on vient d'écrire) : deux postes sur un partage n'ont pas la même heure.

import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ulid } from "ulid";
import type { AnnotationId } from "../core/model.ts";
import { renameRetry } from "./store.ts";

export interface Dispatch {
  id: string;
  ids: AnnotationId[];
  /** Adresse de la page d'où l'envoi est parti. */
  url: string;
  at: string;
}

export interface Listener {
  id: string;
  /** Préfixe d'adresse écouté ; vide = toutes les pages. */
  urlPrefix: string;
  startedAt: string;
  pid: number;
  host: string;
}

const LISTENER_ALIVE_MS = 30_000;
const UNCLAIMED_MAX_MS = 24 * 60 * 60 * 1000;
const CLAIMED_MAX_MS = 60 * 60 * 1000;
/** Un envoi que l'écoute choisie n'a pas pris après ce délai est ouvert à toute écoute qui correspond. */
export const GRACE_MS = 5_000;

export function dispatchPaths(dataDir: string) {
  const dispatch = join(dataDir, ".dispatch");
  return { dispatch, claimed: join(dispatch, ".claimed"), listeners: join(dataDir, ".listeners") };
}

export const matches = (prefix: string, url: string) => prefix === "" || url.startsWith(prefix);

/** L'écoute qui doit prendre un envoi : préfixe le plus long, puis la plus ancienne, puis l'identifiant. */
export function chooseListener(listeners: Listener[], url: string): Listener | undefined {
  return listeners
    .filter((l) => matches(l.urlPrefix, url))
    .sort(
      (a, b) =>
        b.urlPrefix.length - a.urlPrefix.length || a.startedAt.localeCompare(b.startedAt) || a.id.localeCompare(b.id),
    )[0];
}

/** Heure du système de fichiers : mtime d'un fichier qu'on vient d'écrire. */
async function fsNow(dir: string): Promise<number> {
  await mkdir(dir, { recursive: true });
  const probe = join(dir, `.probe-${randomBytes(4).toString("hex")}`);
  await writeFile(probe, "");
  try {
    return (await stat(probe)).mtimeMs;
  } finally {
    await unlink(probe).catch(() => undefined);
  }
}

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;

/** Un envoi lu sur un dossier partagé n'est pas fiable : on le vérifie avant de s'en servir. */
function asDispatch(raw: unknown): Dispatch | null {
  const d = raw as Partial<Dispatch> | null;
  if (!d || typeof d.id !== "string" || !ULID.test(d.id) || typeof d.url !== "string") return null;
  if (!Array.isArray(d.ids) || d.ids.length === 0 || d.ids.length > 500) return null;
  if (!d.ids.every((id) => typeof id === "string" && ULID.test(id))) return null;
  return { id: d.id, ids: d.ids, url: d.url.slice(0, 2000), at: String(d.at ?? "") };
}

/** Envois réclamés par une écoute morte depuis plus d'une minute : remis dans la file. */
const ABANDONED_CLAIM_MS = 60_000;

async function readJsonFile<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return null;
  }
}

/** Écrit un envoi entier ou rien : une écoute ne lit jamais un JSON à moitié écrit. */
export async function writeDispatch(dataDir: string, ids: AnnotationId[], url: string): Promise<Dispatch> {
  const paths = dispatchPaths(dataDir);
  await mkdir(paths.dispatch, { recursive: true });
  const dispatch: Dispatch = { id: ulid(), ids, url, at: new Date().toISOString() };
  const tmp = join(paths.dispatch, `.tmp-${dispatch.id}`);
  await writeFile(tmp, JSON.stringify(dispatch));
  await renameRetry(tmp, join(paths.dispatch, `${dispatch.id}.json`));
  return dispatch;
}

export async function liveListeners(dataDir: string): Promise<Listener[]> {
  const paths = dispatchPaths(dataDir);
  const now = await fsNow(paths.listeners);
  const alive: Listener[] = [];
  for (const name of await readdir(paths.listeners).catch(() => [] as string[])) {
    if (!name.endsWith(".json")) continue;
    const file = join(paths.listeners, name);
    try {
      if (now - (await stat(file)).mtimeMs > LISTENER_ALIVE_MS) continue;
    } catch {
      continue;
    }
    const listener = await readJsonFile<Listener>(file);
    if (listener) alive.push(listener);
  }
  return alive;
}

export async function beat(dataDir: string, me: Listener): Promise<void> {
  const paths = dispatchPaths(dataDir);
  await mkdir(paths.listeners, { recursive: true });
  const tmp = join(paths.listeners, `.tmp-${me.id}`);
  await writeFile(tmp, JSON.stringify(me));
  await renameRetry(tmp, join(paths.listeners, `${me.id}.json`));
}

export async function removeBeat(dataDir: string, id: string): Promise<void> {
  await rm(join(dispatchPaths(dataDir).listeners, `${id}.json`), { force: true });
}

/**
 * Réclame le prochain envoi pour cette écoute, ou null. Seule l'écoute choisie le prend
 * pendant GRACE_MS ; ensuite, toute écoute dont le préfixe correspond.
 */
export async function claimNext(dataDir: string, me: Listener): Promise<Dispatch | null> {
  const paths = dispatchPaths(dataDir);
  const names = (await readdir(paths.dispatch).catch(() => [] as string[])).filter((n) => n.endsWith(".json")).sort();
  if (names.length === 0) return null;
  await mkdir(paths.claimed, { recursive: true });
  const now = await fsNow(paths.dispatch);
  const others = (await liveListeners(dataDir)).filter((l) => l.id !== me.id);
  await requeueAbandoned(dataDir, now, new Set([me.id, ...others.map((l) => l.id)]));
  for (const name of names) {
    const file = join(paths.dispatch, name);
    const dispatch = asDispatch(await readJsonFile(file));
    if (!dispatch || !matches(me.urlPrefix, dispatch.url)) continue;
    let age: number;
    try {
      age = now - (await stat(file)).mtimeMs;
    } catch {
      continue;
    }
    if (chooseListener([...others, me], dispatch.url)?.id !== me.id && age < GRACE_MS) continue;
    const claimed = join(paths.claimed, `${dispatch.id}-${me.id}.json`);
    try {
      await renameRetry(file, claimed);
    } catch {
      continue; // une autre écoute l'a pris (ENOENT) : on passe
    }
    const mine = asDispatch(await readJsonFile(claimed));
    if (mine) return mine;
  }
  return null;
}

/** Une écoute tuée entre la réclamation et la sortie ne doit pas perdre l'envoi. */
async function requeueAbandoned(dataDir: string, now: number, alive: Set<string>): Promise<void> {
  const paths = dispatchPaths(dataDir);
  for (const name of await readdir(paths.claimed).catch(() => [] as string[])) {
    const owner = name.replace(/\.json$/, "").split("-")[1];
    if (!owner || alive.has(owner)) continue;
    const file = join(paths.claimed, name);
    try {
      if (now - (await stat(file)).mtimeMs < ABANDONED_CLAIM_MS) continue;
      await renameRetry(file, join(paths.dispatch, `${name.split("-")[0]}.json`));
    } catch {
      // déjà repris par une autre écoute
    }
  }
}

/** Remet un envoi réclamé dans la file (l'écoute n'a pas pu le transmettre). */
export async function releaseClaim(dataDir: string, dispatch: Dispatch, me: Listener): Promise<void> {
  const paths = dispatchPaths(dataDir);
  await rename(join(paths.claimed, `${dispatch.id}-${me.id}.json`), join(paths.dispatch, `${dispatch.id}.json`)).catch(
    () => undefined,
  );
}

/** Retire les envois jamais réclamés (24 h), les réclamés (1 h) et les battements morts. */
export async function purgeDispatch(dataDir: string): Promise<void> {
  const paths = dispatchPaths(dataDir);
  for (const [dir, maxAge] of [
    [paths.dispatch, UNCLAIMED_MAX_MS],
    [paths.claimed, CLAIMED_MAX_MS],
    [paths.listeners, LISTENER_ALIVE_MS],
  ] as const) {
    const names = (await readdir(dir).catch(() => [] as string[])).filter((n) => n !== ".claimed");
    if (names.length === 0) continue;
    const now = await fsNow(dir);
    for (const name of names) {
      const file = join(dir, name);
      try {
        if (now - (await stat(file)).mtimeMs > maxAge) await rm(file, { force: true });
      } catch {
        // déjà retiré par un autre processus
      }
    }
  }
}
