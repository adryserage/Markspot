// Stockage de la version d'essai, dans chrome.storage.local. Il sera remplacé par
// l'hôte natif (MARK-5) : même forme d'Annotation, mêmes PNG.
//
// Clés : ann:<id> -> Annotation ; png:<id>:<kind> -> PNG en base64 ;
//        draft:<id> -> captures en attente du commentaire (le worker peut s'arrêter entre-temps).

import {
  CAPTURE_KINDS,
  pageKeyOf,
  type Annotation,
  type AnnotationId,
  type CaptureKind,
  type NewAnnotation,
} from "../../src/core/model.ts";
import { buildExport, type ExportFile } from "../../src/core/export.ts";
import type { CaptureResult } from "./capture.ts";

const ANN = "ann:";
const DRAFT = "draft:";
const pngKey = (id: string, kind: CaptureKind) => `png:${id}:${kind}`;

async function allAnnotations(): Promise<Annotation[]> {
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

/** Idempotent sur l'identifiant du brouillon, qui devient celui de l'annotation. */
export async function createFromDraft(
  draftId: string,
  build: (capture: CaptureResult, seq: number) => NewAnnotation,
): Promise<Annotation> {
  const existing = (await chrome.storage.local.get(ANN + draftId))[ANN + draftId] as Annotation | undefined;
  if (existing) return existing;
  const capture = (await chrome.storage.local.get(DRAFT + draftId))[DRAFT + draftId] as CaptureResult | undefined;
  if (!capture) throw new Error("Capture expired. Mark the spot again.");
  const seq = 1 + Math.max(0, ...(await allAnnotations()).map((a) => a.seq));
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
  return buildExport(annotations, (a, kind) => pngs[pngKey(a.id, kind)] ?? null, now);
}

export async function capturePng(id: AnnotationId, kind: CaptureKind): Promise<string | null> {
  const key = pngKey(id, kind);
  return ((await chrome.storage.local.get(key))[key] as string | undefined) ?? null;
}
