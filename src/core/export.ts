// Fichier d'export des notes : tout ce qu'il faut pour que Claude les lise sans l'extension.
// Pur, testé dans tests/unit/export.test.ts.

import type { Annotation, CaptureKind, Resolution, ThreadState } from "./model.ts";

export const EXPORT_FORMAT = "markspot-export";

export interface ExportedAnnotation extends Annotation {
  /** « resolved » si la personne ou Claude a réglé la note. */
  state: ThreadState;
  resolution: Resolution | null;
  /** PNG en base64, null si la capture manque. */
  png: Record<CaptureKind, string | null>;
}

export interface ExportFile {
  format: typeof EXPORT_FORMAT;
  schemaVersion: 1;
  exportedAt: string;
  annotations: ExportedAnnotation[];
}

export function buildExport(
  annotations: Annotation[],
  pngOf: (annotation: Annotation, kind: CaptureKind) => string | null,
  now: Date,
  resolutionOf: (annotation: Annotation) => Resolution | null = () => null,
): ExportFile {
  return {
    format: EXPORT_FORMAT,
    schemaVersion: 1,
    exportedAt: now.toISOString(),
    annotations: [...annotations]
      .sort((a, b) => a.seq - b.seq)
      .map((annotation) => ({
        ...annotation,
        state: resolutionOf(annotation) ? "resolved" : "open",
        resolution: resolutionOf(annotation),
        png: { zone: pngOf(annotation, "zone"), context: pngOf(annotation, "context") },
      })),
  };
}

/** markspot-notes-2026-11-12-0805.json, heure locale, sans caractère interdit sous Windows. */
export function exportFileName(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return `markspot-notes-${date}-${pad(now.getHours())}${pad(now.getMinutes())}.json`;
}
