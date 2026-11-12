// Messages entre l'overlay (dans la page) et le service worker.

import type { Annotation, AnnotationId, Mark, Viewport, ViewportRect } from "../../src/core/model.ts";

export type OverlayRequest =
  /** Capture l'onglet, garde le brouillon, rend la vignette du gros plan. */
  | { type: "capture"; zone: ViewportRect; pageZone: Mark["rect"]; viewport: Viewport }
  | { type: "save"; draftId: string; url: string; title: string; mark: Mark; viewport: Viewport; comment: string }
  | { type: "discard"; draftId: string }
  | { type: "list"; url: string }
  | { type: "thumbnail"; id: AnnotationId };

export type OverlayReply =
  | { ok: true; type: "captured"; draftId: string; png: string }
  | { ok: true; type: "saved"; annotation: Annotation }
  | { ok: true; type: "annotations"; annotations: Annotation[] }
  | { ok: true; type: "thumbnail"; png: string | null }
  | { ok: true; type: "done" }
  | { ok: false; error: string };

export async function ask(request: OverlayRequest): Promise<OverlayReply> {
  try {
    return (await chrome.runtime.sendMessage(request)) as OverlayReply;
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}
