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
import { mkdir, readdir, readFile, rename, rm, stat, unlink, utimes, writeFile } from "node:fs/promises";
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
  /** Nom du projet visé : seules les écoutes de ce nom le prennent. Absent dans les anciens envois. */
  to?: string;
  /** Poste visé, avec to : seule l'écoute de ce nom sur ce poste le prend. */
  toHost?: string;
}

export interface Listener {
  id: string;
  /** Nom du projet de la session (par défaut le nom de son dossier). */
  name: string;
  /** Préfixe d'adresse écouté ; vide = toutes les pages. */
  urlPrefix: string;
  startedAt: string;
  pid: number;
  host: string;
  /** Dossier de la session : reste dans le battement, jamais rendu à la page. */
  cwd?: string;
}

/** Ce que la page voit d'une écoute. */
export interface PublicListener {
  name: string;
  host: string;
  urlPrefix: string;
  since: string;
}

export const NAME_MAX = 80;

/** Nom de projet affichable : sans caractère de contrôle, borné. */
export function cleanName(raw: string): string {
  return raw.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, NAME_MAX);
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
  const to = typeof d.to === "string" && d.to !== "" ? cleanName(d.to) : undefined;
  const toHost = to && typeof d.toHost === "string" && d.toHost !== "" ? cleanName(d.toHost) : undefined;
  return { id: d.id, ids: d.ids, url: d.url.slice(0, 2000), at: String(d.at ?? ""), ...(to ? { to } : {}), ...(toHost ? { toHost } : {}) };
}

function asListener(raw: unknown): Listener | null {
  const l = raw as Partial<Listener> | null;
  if (!l || typeof l.id !== "string" || typeof l.startedAt !== "string") return null;
  return {
    id: l.id,
    name: typeof l.name === "string" ? cleanName(l.name) : "",
    urlPrefix: typeof l.urlPrefix === "string" ? l.urlPrefix : "",
    startedAt: l.startedAt,
    pid: typeof l.pid === "number" ? l.pid : 0,
    host: typeof l.host === "string" ? l.host.slice(0, 80) : "",
  };
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
export async function writeDispatch(dataDir: string, ids: AnnotationId[], url: string, to: string, toHost?: string): Promise<Dispatch> {
  const paths = dispatchPaths(dataDir);
  await mkdir(paths.dispatch, { recursive: true });
  const dispatch: Dispatch = {
    id: ulid(),
    ids,
    url,
    at: new Date().toISOString(),
    to: cleanName(to),
    ...(toHost ? { toHost: cleanName(toHost) } : {}),
  };
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
    const listener = asListener(await readJsonFile(file));
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
  await mkdir(paths.claimed, { recursive: true });
  const now = await fsNow(paths.dispatch);
  const others = (await liveListeners(dataDir)).filter((l) => l.id !== me.id);
  // Avant la lecture de la file : une réclamation abandonnée y revient même si la file était vide.
  await requeueAbandoned(dataDir, now, new Set([me.id, ...others.map((l) => l.id)]));
  const names = (await readdir(paths.dispatch).catch(() => [] as string[])).filter((n) => n.endsWith(".json")).sort();
  if (names.length === 0) return null;
  for (const name of names) {
    const file = join(paths.dispatch, name);
    const dispatch = asDispatch(await readJsonFile(file));
    if (!dispatch || !matches(me.urlPrefix, dispatch.url)) continue;
    // Envoi visé : seules les écoutes de ce nom, même après le délai de grâce.
    if (dispatch.to !== undefined && dispatch.to !== me.name) continue;
    if (dispatch.toHost !== undefined && dispatch.toHost !== cleanName(me.host)) continue;
    let age: number;
    try {
      age = now - (await stat(file)).mtimeMs;
    } catch {
      continue;
    }
    const group = others.filter(
      (l) => (dispatch.to === undefined || l.name === dispatch.to) && (dispatch.toHost === undefined || l.host === dispatch.toHost),
    );
    if (chooseListener([...group, me], dispatch.url)?.id !== me.id && age < GRACE_MS) continue;
    const claimed = join(paths.claimed, `${dispatch.id}-${me.id}.json`);
    try {
      await renameRetry(file, claimed);
    } catch {
      continue; // une autre écoute l'a pris (ENOENT) : on passe
    }
    // rename garde l'heure d'écriture de l'envoi : l'âge d'une réclamation part de maintenant.
    const at = new Date();
    await utimes(claimed, at, at).catch(() => undefined);
    const mine = asDispatch(await readJsonFile(claimed));
    if (mine) return mine;
  }
  return null;
}

/**
 * Y a-t-il un envoi en attente ou réclamé ? Lecture seule : une session qui écoute en
 * permanence ne lance claimNext (qui écrit sur le partage) que s'il y a du travail.
 */
export async function hasWork(dataDir: string): Promise<boolean> {
  const paths = dispatchPaths(dataDir);
  for (const dir of [paths.dispatch, paths.claimed]) {
    const names = await readdir(dir).catch(() => [] as string[]);
    if (names.some((n) => n.endsWith(".json"))) return true;
  }
  return false;
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

/** L'envoi a été transmis à la session : il disparaît, il ne peut plus revenir dans la file. */
export async function completeClaim(dataDir: string, dispatch: Dispatch, me: Listener): Promise<void> {
  await rm(join(dispatchPaths(dataDir).claimed, `${dispatch.id}-${me.id}.json`), { force: true });
}

/** Rajeunit une réclamation encore en cours : elle ne passe pas pour abandonnée ni périmée. */
export async function touchClaim(dataDir: string, dispatch: Dispatch, me: Listener): Promise<void> {
  const at = new Date();
  await utimes(join(dispatchPaths(dataDir).claimed, `${dispatch.id}-${me.id}.json`), at, at).catch(() => undefined);
}

/** Les écoutes vivantes pour cette adresse, telles que la page peut les voir. */
export async function publicListeners(dataDir: string, url: string): Promise<PublicListener[]> {
  return (await liveListeners(dataDir))
    .filter((l) => matches(l.urlPrefix, url))
    .sort((a, b) => a.name.localeCompare(b.name) || a.startedAt.localeCompare(b.startedAt))
    .map((l) => ({ name: l.name, host: l.host, urlPrefix: l.urlPrefix, since: l.startedAt }));
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
