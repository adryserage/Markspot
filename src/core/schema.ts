// Validation des données qui entrent dans l'hôte ou le serveur MCP : trames de l'extension
// et fichiers relus. Les champs venus de la page sont tronqués plutôt que refusés, pour
// qu'une ancienne note (version d'essai, sans bornes) passe quand même.
// N'est pas importé par l'extension : zod reste hors de son paquet.

import * as z from "zod/v4";
import type { AnnotationId, ScopeId } from "./model.ts";
import { MAX_STROKES, sanitizeStrokes } from "./drawing.ts";
import { COMMENT_MAX, STYLE_PROPS } from "./model.ts";

export const MAX_ATTRIBUTES = 40;
export const REPLY_MAX = 4000;
const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;

const clip = (max: number) => z.string().transform((s) => s.slice(0, max));
const finite = z.number().finite();

export function parseAnnotationId(raw: unknown): AnnotationId | null {
  return typeof raw === "string" && ULID.test(raw) ? (raw as AnnotationId) : null;
}

export const AnnotationIdSchema = z.string().regex(ULID).transform((s) => s as AnnotationId);

/** Une portée devient un nom de dossier : seuls lettres, chiffres, tiret et point sont gardés. */
export function scopeDir(scope: ScopeId): string {
  const safe = scope.replace(/[^A-Za-z0-9.-]/g, "_");
  if (safe === "" || safe.startsWith(".")) throw new Error(`invalid scope ${scope}`);
  return safe;
}

const RectSchema = z.object({ x: finite, y: finite, width: finite, height: finite });

const AuthorSchema = z.object({
  kind: z.enum(["user", "agent"]),
  id: clip(100),
  name: clip(100),
});

const StylesSchema = z
  .record(z.string(), z.string())
  .transform((all) => Object.fromEntries(STYLE_PROPS.map((p) => [p, (all[p] ?? "").slice(0, 200)])));

const AttributesSchema = z
  .record(z.string(), z.string())
  .transform((all) =>
    Object.fromEntries(
      Object.entries(all)
        .slice(0, MAX_ATTRIBUTES)
        .map(([k, v]) => [k.slice(0, 60), v.slice(0, 200)]),
    ),
  );

const CaptureMetaSchema = z.object({ rect: RectSchema, width: finite, height: finite });

export const NewAnnotationSchema = z.object({
  id: AnnotationIdSchema,
  scope: z.literal("local"),
  createdAt: z.iso.datetime(),
  author: AuthorSchema,
  source: z.object({ kind: z.literal("extension"), trust: z.literal("owner") }),
  page: z.object({ url: clip(2000), title: clip(300) }),
  mark: z.object({
    kind: z.enum(["element", "region"]),
    anchor: z.object({
      selector: clip(1000),
      tag: clip(40),
      role: clip(60).nullable(),
      text: clip(80),
      attributes: AttributesSchema,
      styles: StylesSchema,
    }),
    rect: RectSchema,
    rectInAnchor: RectSchema,
    drawing: z.array(z.unknown()).max(MAX_STROKES).optional().transform((raw) => (raw ? sanitizeStrokes(raw) : undefined)),
  }),
  viewport: z.object({ width: finite, height: finite, devicePixelRatio: finite, scrollX: finite, scrollY: finite }),
  comment: z.string().min(1).max(COMMENT_MAX),
  captures: z.object({ zone: CaptureMetaSchema, context: CaptureMetaSchema }),
});

export const AnnotationSchema = NewAnnotationSchema.extend({
  schemaVersion: z.literal(1),
  seq: z.number().int().positive(),
  revision: z.number().int().positive().optional(),
  updatedAt: z.iso.datetime().optional(),
});

export const ResolutionSchema = z.object({
  schemaVersion: z.literal(1),
  annotationId: AnnotationIdSchema,
  resolvedAt: z.iso.datetime(),
  author: AuthorSchema,
  reply: z.string().min(1).max(REPLY_MAX),
});

const Base64Schema = z.string().regex(/^[A-Za-z0-9+/]*={0,2}$/).max(40 * 1024 * 1024);

export const ExtensionToHostSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ping"), requestId: z.number().int() }),
  z.object({ type: z.literal("sync"), requestId: z.number().int() }),
  z.object({
    type: z.literal("create"),
    requestId: z.number().int(),
    annotation: NewAnnotationSchema,
    pngs: z.object({ zone: Base64Schema, context: Base64Schema }),
  }),
  z.object({ type: z.literal("capture"), requestId: z.number().int(), id: AnnotationIdSchema }),
  z.object({
    type: z.literal("edit"),
    requestId: z.number().int(),
    id: AnnotationIdSchema,
    comment: z.string().min(1).max(COMMENT_MAX),
  }),
  z.object({
    type: z.literal("clear"),
    requestId: z.number().int(),
    ids: z.array(AnnotationIdSchema).max(500),
    includeOpen: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("resolve"),
    requestId: z.number().int(),
    id: AnnotationIdSchema,
    reply: z.string().min(1).max(REPLY_MAX),
  }),
  z.object({ type: z.literal("reopen"), requestId: z.number().int(), id: AnnotationIdSchema, resolvedAt: z.iso.datetime() }),
  z.object({
    type: z.literal("send"),
    requestId: z.number().int(),
    ids: z.array(AnnotationIdSchema).min(1).max(500),
    url: z.string().max(2000),
    to: z.string().min(1).max(80).optional(),
    /** Poste visé : deux dossiers de même nom sous Linux et Windows restent deux choix. */
    host: z.string().min(1).max(80).optional(),
  }),
  z.object({ type: z.literal("listeners"), requestId: z.number().int(), url: z.string().max(2000) }),
]);
