// File d'envoi de l'extension, dans chrome.storage.local. Une note y attend jusqu'à ce que
// l'hôte natif l'écrive en fichiers (il en devient alors le seul propriétaire). Sans hôte
// (version d'essai, hôte pas encore installé), les notes y restent et s'exportent.
//
// Clés : ann:<id> -> Annotation ; png:<id>:<kind> -> PNG en base64 ;
//        res:<id> -> Resolution, quand la personne règle une note encore en file ;
//        draft:<id> -> captures en attente du commentaire (le worker peut s'arrêter entre-temps).

import {
  CAPTURE_KINDS,
  pageKeyOf,
  type Annotation,
  type AnnotationId,
  type CaptureKind,
  type IsoTime,
  type Resolution,
  type NewAnnotation,
} from "../../src/core/model.ts";
import { decodeTime } from "ulid";
import { buildExport, type ExportFile } from "../../src/core/export.ts";
import type { CaptureResult } from "./capture.ts";

const ANN = "ann:";
const RES = "res:";
const DRAFT = "draft:";
const pngKey = (id: string, kind: CaptureKind) => `png:${id}:${kind}`;

export async function allAnnotations(): Promise<Annotation[]> {
  const keys = (await chrome.storage.local.getKeys()).filter((k) => k.startsWith(ANN));
  if (keys.length === 0) return [];
  const items = await chrome.storage.local.get(keys);
  return Object.values(items as Record<string, Annotation>).sort((a, b) => a.seq - b.seq);
}

export async function listForPage(url: string): Promise<Annotation[]> {
  const key = pageKeyOf(url);
  return (await allAnnotations()).filter((a) => pageKeyOf(a.page.url) === key);
}

export async function putDraft(id: string, capture: CaptureResult): Promise<void> {
  await chrome.storage.local.set({ [DRAFT + id]: capture });
}

export async function discardDraft(id: string): Promise<void> {
  await chrome.storage.local.remove(DRAFT + id);
}

const DRAFT_MAX_AGE_MS = 60 * 60 * 1000;

/** Un onglet fermé pendant l'écriture d'une note laisse son brouillon : on le retire après une heure. */
export async function purgeOldDrafts(now: number): Promise<void> {
  const stale = (await chrome.storage.local.getKeys()).filter((key) => {
    if (!key.startsWith(DRAFT)) return false;
    try {
      return now - decodeTime(key.slice(DRAFT.length)) > DRAFT_MAX_AGE_MS;
    } catch {
      return true;
    }
  });
  if (stale.length > 0) await chrome.storage.local.remove(stale);
}

/** Idempotent sur l'identifiant du brouillon, qui devient celui de l'annotation. */
export async function createFromDraft(
  draftId: string,
  build: (capture: CaptureResult, seq: number) => NewAnnotation,
  /** Retouche du gros plan (dessin incrusté), faite ici pour qu'un save rejoué ne la refasse pas. */
  retouchZone?: (png: string) => Promise<string>,
): Promise<Annotation> {
  const existing = (await chrome.storage.local.get(ANN + draftId))[ANN + draftId] as Annotation | undefined;
  if (existing) return existing;
  const capture = (await chrome.storage.local.get(DRAFT + draftId))[DRAFT + draftId] as CaptureResult | undefined;
  if (!capture) throw new Error("Capture expired. Mark the spot again.");
  const seq = 1 + Math.max(0, ...(await allAnnotations()).map((a) => a.seq));
  if (retouchZone) capture.png.zone = await retouchZone(capture.png.zone);
  const annotation: Annotation = { ...build(capture, seq), schemaVersion: 1, seq };
  const items: Record<string, unknown> = { [ANN + annotation.id]: annotation };
  for (const kind of CAPTURE_KINDS) items[pngKey(annotation.id, kind)] = capture.png[kind];
  await chrome.storage.local.set(items);
  await discardDraft(draftId);
  return annotation;
}

/** Toutes les notes et leurs captures, sans les brouillons. */
export async function exportAll(now: Date): Promise<ExportFile> {
  const annotations = await allAnnotations();
  const keys = annotations.flatMap((a) => CAPTURE_KINDS.map((kind) => pngKey(a.id, kind)));
  const pngs = keys.length > 0 ? ((await chrome.storage.local.get(keys)) as Record<string, string>) : {};
  const resolutions = await queuedResolutions();
  return buildExport(annotations, (a, kind) => pngs[pngKey(a.id, kind)] ?? null, now, (a) => resolutions.get(a.id) ?? null);
}

/** Les deux images d'une note en file, ou null s'il en manque une. */
export async function outboxPngs(id: AnnotationId): Promise<Record<CaptureKind, string> | null> {
  const keys = CAPTURE_KINDS.map((kind) => pngKey(id, kind));
  const items = (await chrome.storage.local.get(keys)) as Record<string, string | undefined>;
  const zone = items[pngKey(id, "zone")];
  const context = items[pngKey(id, "context")];
  return zone && context ? { zone, context } : null;
}

/** Résolutions des notes en file, par identifiant. */
export async function queuedResolutions(): Promise<Map<AnnotationId, Resolution>> {
  const keys = (await chrome.storage.local.getKeys()).filter((k) => k.startsWith(RES));
  const items = keys.length > 0 ? ((await chrome.storage.local.get(keys)) as Record<string, Resolution>) : {};
  return new Map(Object.values(items).map((r) => [r.annotationId, r]));
}

/** La personne règle (resolution) ou rouvre (null) une note encore en file. false si elle n'y est plus. */
export async function setQueuedResolution(id: AnnotationId, resolution: Resolution | null): Promise<boolean> {
  if (!(await chrome.storage.local.get(ANN + id))[ANN + id]) return false;
  if (resolution) await chrome.storage.local.set({ [RES + id]: resolution });
  else await chrome.storage.local.remove(RES + id);
  return true;
}

/** Change le commentaire d'une note encore en file. null si elle n'y est plus, "resolved" si elle est réglée. */
export async function editQueued(id: AnnotationId, comment: string): Promise<Annotation | "resolved" | null> {
  const key = ANN + id;
  const note = (await chrome.storage.local.get(key))[key] as Annotation | undefined;
  if (!note) return null;
  if ((await chrome.storage.local.get(RES + id))[RES + id]) return "resolved";
  const next: Annotation = { ...note, comment, revision: (note.revision ?? 0) + 1, updatedAt: new Date().toISOString() as IsoTime };
  await chrome.storage.local.set({ [key]: next });
  return next;
}

/** Retire une note de la file une fois que l'hôte l'a écrite. */
export async function removeFromOutbox(id: AnnotationId): Promise<void> {
  await chrome.storage.local.remove([ANN + id, RES + id, ...CAPTURE_KINDS.map((kind) => pngKey(id, kind))]);
}

export async function capturePng(id: AnnotationId, kind: CaptureKind): Promise<string | null> {
  const key = pngKey(id, kind);
  return ((await chrome.storage.local.get(key))[key] as string | undefined) ?? null;
}
