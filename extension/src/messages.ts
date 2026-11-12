// Messages entre l'overlay (dans la page) et le service worker.

import type { Stroke } from "../../src/core/drawing.ts";
import type { Annotation, AnnotationId, Mark, Resolution, Viewport, ViewportRect } from "../../src/core/model.ts";

/** Ce que la page affiche d'une note. pending : pas encore écrite par l'hôte. */
export interface NoteView {
  annotation: Annotation;
  resolution: Resolution | null;
  pending: boolean;
}

export type OverlayRequest =
  /** Capture l'onglet, garde le brouillon, rend la vignette du gros plan. */
  | { type: "capture"; zone: ViewportRect; pageZone: Mark["rect"]; viewport: Viewport }
  | {
      type: "save";
      draftId: string;
      url: string;
      title: string;
      mark: Mark;
      viewport: Viewport;
      comment: string;
      /** Traits dessinés sur le gros plan, incrustés par le service worker. */
      strokes: Stroke[];
    }
  | { type: "edit"; id: AnnotationId; comment: string }
  /** Retire ces notes de cette page : les réglées seulement, ou toutes avec includeOpen. */
  | { type: "clear"; ids: AnnotationId[]; includeOpen: boolean }
  /** La personne règle la note à la main, ou la rouvre. */
  | { type: "resolve"; id: AnnotationId; reply: string }
  | { type: "reopen"; id: AnnotationId }
  /** Ouvre la page d'export dans un nouvel onglet. */
  | { type: "openExport" }
  /** « Envoyer à Claude » : les notes ouvertes de la page, à la session qui écoute. */
  | { type: "send"; ids: AnnotationId[] }
  | { type: "discard"; draftId: string }
  | { type: "list"; url: string }
  | { type: "thumbnail"; id: AnnotationId }
  | { type: "status" };

export type OverlayReply =
  | { ok: true; type: "captured"; draftId: string; png: string }
  | { ok: true; type: "saved"; note: NoteView }
  | { ok: true; type: "edited"; note: NoteView }
  /** error : une partie seulement a été effacée (ids dit lesquelles). */
  | { ok: true; type: "cleared"; ids: AnnotationId[]; error?: string }
  | { ok: true; type: "state"; note: NoteView }
  | { ok: true; type: "sent"; count: number; listeners: number }
  | { ok: true; type: "notes"; notes: NoteView[] }
  | { ok: true; type: "thumbnail"; png: string | null }
  | { ok: true; type: "status"; native: boolean; connected: boolean }
  | { ok: true; type: "done" }
  | { ok: false; error: string };

/** Poussé par le service worker sur le port « overlay » ouvert par la page. */
export type OverlayPush = { type: "note"; note: NoteView } | { type: "removed"; id: AnnotationId };

export const OVERLAY_PORT = "markspot-overlay";

export async function ask(request: OverlayRequest): Promise<OverlayReply> {
  try {
    return (await chrome.runtime.sendMessage(request)) as OverlayReply;
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}
