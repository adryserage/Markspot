// Format d'une annotation. Pur : ni Node, ni Chrome, ni fichier.

import type { SourceHint } from "./source-hint.ts";
import type { Stroke } from "./drawing.ts";
// Voir docs/conception.md pour le rôle de chaque champ.

type Brand<T, B extends string> = T & { readonly __brand: B };

export type AnnotationId = Brand<string, "AnnotationId">;
export type ScopeId = Brand<string, "ScopeId">;
export type IsoTime = Brand<string, "IsoTime">;
/** Adresse passée par redactUrl. */
export type PageUrl = Brand<string, "PageUrl">;
/** Origine + chemin : décide quelles annotations une page affiche. Dérivé, jamais stocké. */
export type PageKey = Brand<string, "PageKey">;

export interface Rect { x: number; y: number; width: number; height: number }
/** px CSS depuis le haut du document. */
export type PageRect = Brand<Rect, "PageRect">;
/** px CSS depuis le coin de la fenêtre. */
export type ViewportRect = Brand<Rect, "ViewportRect">;

export const LOCAL_SCOPE = "local" as ScopeId;
export const COMMENT_MAX = 4000;
export const ANCHOR_TEXT_MAX = 80;

export const STYLE_PROPS = [
  "font-family", "font-size", "font-weight", "line-height", "letter-spacing", "text-align",
  "color", "background-color", "border", "border-radius", "box-shadow", "opacity",
  "display", "position", "width", "height", "margin", "padding", "gap",
  "flex-direction", "justify-content", "align-items", "overflow", "z-index",
] as const;
export type ComputedStyles = Record<(typeof STYLE_PROPS)[number], string>;

export type Author =
  | { kind: "user"; id: string; name: string }
  | { kind: "agent"; id: string; name: string };

export const LOCAL_USER: Author = { kind: "user", id: "local", name: "local" };

/** Version hébergée : { kind: "hub-widget"; trust: "untrusted" }. */
export type Source = { kind: "extension"; trust: "owner" };

export interface ElementAnchor {
  selector: string;
  tag: string;
  role: string | null;
  /** ANCHOR_TEXT_MAX caractères au plus, jamais lu dans un champ de formulaire. */
  text: string;
  attributes: Record<string, string>;
  styles: ComputedStyles;
  /** Fichier source lu dans la page en développement (Vue, Svelte, React). Donnée de la page. */
  sourceHint?: SourceHint | null;
}

export interface Mark {
  kind: "element" | "region";
  anchor: ElementAnchor;
  rect: PageRect;
  /** La zone relative à la boîte de l'ancre, pour replacer la pastille si la page bouge. */
  rectInAnchor: Rect;
  /** Traits dessinés sur le gros plan (déjà incrustés dans zone.png). */
  drawing?: Stroke[];
}

export interface Viewport {
  width: number;
  height: number;
  devicePixelRatio: number;
  scrollX: number;
  scrollY: number;
}

export interface CaptureMeta { rect: PageRect; width: number; height: number }
export const CAPTURE_KINDS = ["zone", "context"] as const;
export type CaptureKind = (typeof CAPTURE_KINDS)[number];

export interface NewAnnotation {
  id: AnnotationId;
  scope: ScopeId;
  createdAt: IsoTime;
  author: Author;
  source: Source;
  page: { url: PageUrl; title: string };
  mark: Mark;
  viewport: Viewport;
  comment: string;
  captures: Record<CaptureKind, CaptureMeta>;
}

export interface Annotation extends NewAnnotation {
  schemaVersion: 1;
  /** Numéro de la pastille, donné par le propriétaire du stockage. */
  seq: number;
  /** Nombre de modifications du commentaire (absent = jamais modifié). */
  revision?: number;
  updatedAt?: IsoTime;
}

export interface Resolution {
  schemaVersion: 1;
  annotationId: AnnotationId;
  resolvedAt: IsoTime;
  author: Author;
  reply: string;
}

export interface Thread { annotation: Annotation; resolution: Resolution | null }
export type ThreadState = "open" | "resolved";
export const stateOf = (thread: Thread): ThreadState => (thread.resolution ? "resolved" : "open");

export function pageKeyOf(url: string): PageKey {
  const parsed = new URL(url);
  const path = parsed.pathname.length > 1 ? parsed.pathname.replace(/\/+$/, "") : parsed.pathname;
  return `${parsed.origin}${path}` as PageKey;
}

const SENSITIVE_PARAM = /token|key|code|secret|pass|session|auth|sig|jwt|otp/i;

/** Remplace la valeur des paramètres qui ressemblent à un secret, dans la requête et dans le fragment. */
export function redactUrl(raw: string): PageUrl {
  const url = new URL(raw);
  for (const name of [...url.searchParams.keys()]) {
    if (SENSITIVE_PARAM.test(name)) url.searchParams.set(name, "[masqué]");
  }
  if (url.hash.includes("=")) {
    const fragment = new URLSearchParams(url.hash.slice(1));
    let changed = false;
    for (const name of [...fragment.keys()]) {
      if (SENSITIVE_PARAM.test(name)) {
        fragment.set(name, "[masqué]");
        changed = true;
      }
    }
    if (changed) url.hash = fragment.toString();
  }
  return url.toString() as PageUrl;
}
