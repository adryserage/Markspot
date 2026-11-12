// Messages entre l'extension et l'hôte natif.
// Trames JSON précédées de leur longueur sur 4 octets little-endian (format de Chrome).
// Chrome refuse un message de plus de 1 Mo de l'hôte vers l'extension : les fils partent
// un par un, et une capture n'est renvoyée que si elle tient dans la limite.
// Chaque requête porte un requestId que sa réponse reprend ; les poussées n'en ont pas.

import type { AnnotationId, CaptureKind, NewAnnotation, Thread } from "./model.ts";

/** Ce que la page voit d'une session qui écoute (même forme que dans src/store/dispatch.ts). */
export interface PublicListener {
  name: string;
  host: string;
  urlPrefix: string;
  since: string;
}

export const HOST_NAME = "com.markspot.host";
export const MAX_FRAME_TO_EXTENSION = 1024 * 1024;
export const MAX_FRAME_TO_HOST = 64 * 1024 * 1024;
/** Une capture plus grosse n'est pas renvoyée à l'extension (base64 + enveloppe < 1 Mo). */
export const MAX_CAPTURE_TO_EXTENSION = 700 * 1024;

export type ExtensionToHost =
  | { type: "ping"; requestId: number }
  /** Rend un « thread » par note, puis « synced ». */
  | { type: "sync"; requestId: number }
  /** Idempotent sur annotation.id. Les PNG sont en base64. */
  | { type: "create"; requestId: number; annotation: NewAnnotation; pngs: Record<CaptureKind, string> }
  | { type: "capture"; requestId: number; id: AnnotationId }
  /** Nouveau commentaire ; refusé si la note est déjà réglée. */
  | { type: "edit"; requestId: number; id: AnnotationId; comment: string }
  /** Retire ces notes : les réglées seulement, ou toutes avec includeOpen. */
  | { type: "clear"; requestId: number; ids: AnnotationId[]; includeOpen?: boolean }
  /** La personne règle la note à la main. */
  | { type: "resolve"; requestId: number; id: AnnotationId; reply: string }
  /** Rouvre la note si sa résolution est toujours celle de resolvedAt. */
  | { type: "reopen"; requestId: number; id: AnnotationId; resolvedAt: string }
  /** « Envoyer à Claude » : ces notes, depuis cette page, au projet `to` (ou au seul qui écoute). */
  | { type: "send"; requestId: number; ids: AnnotationId[]; url: string; to?: string }
  /** Les sessions qui écoutent cette adresse. */
  | { type: "listeners"; requestId: number; url: string };

export type HostReply =
  | { type: "pong"; requestId: number; version: string; node: string }
  | { type: "synced"; requestId: number }
  | { type: "created"; requestId: number; thread: Thread }
  | { type: "capture"; requestId: number; png: string | null }
  | { type: "edited"; requestId: number; thread: Thread }
  | { type: "cleared"; requestId: number; ids: AnnotationId[] }
  | { type: "resolved"; requestId: number; thread: Thread }
  | { type: "reopened"; requestId: number; thread: Thread }
  | { type: "sent"; requestId: number; to: string; listening: number }
  /** Plusieurs projets écoutent et aucun n'est choisi ; ou la liste demandée. */
  | { type: "choose"; requestId: number; listeners: PublicListener[] }
  | { type: "listeners"; requestId: number; listeners: PublicListener[] }
  | { type: "rejected"; requestId: number | null; reason: string };

export type HostPush =
  | { type: "thread"; thread: Thread }
  | { type: "removed"; id: AnnotationId };

export type HostToExtension = HostReply | HostPush;

export function isReply(message: HostToExtension): message is HostReply {
  return "requestId" in message;
}
