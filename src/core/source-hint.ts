// Indice du fichier source d'un élément, lu dans la page en mode développement (Vue, Svelte,
// React). La page l'écrit : c'est une donnée non fiable, une piste de recherche pour Claude.
// Pur, testé dans tests/unit/source-hint.test.ts.

export const FRAMEWORKS = ["vue", "svelte", "react"] as const;
export type Framework = (typeof FRAMEWORKS)[number];

export interface SourceHint {
  framework: Framework;
  /** Nom du composant, s'il est connu. */
  component: string | null;
  /** Chemin du fichier tel que l'outil de build le donne (il peut contenir le nom d'utilisateur). */
  file: string | null;
  line: number | null;
  column: number | null;
}

export const COMPONENT_MAX = 100;
export const FILE_MAX = 300;

/** Caractères de contrôle, séparateurs de ligne Unicode et contrôles de direction du texte. */
const UNSAFE = new RegExp("[\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029\\u200e\\u200f\\u202a-\\u202e\\u2066-\\u2069]", "g");

const text = (raw: unknown, max: number): string | null => {
  if (typeof raw !== "string") return null;
  const clean = raw.replace(UNSAFE, "").trim().slice(0, max);
  return clean === "" ? null : clean;
};
const position = (raw: unknown): number | null =>
  typeof raw === "number" && Number.isInteger(raw) && raw >= 1 && raw <= 1_000_000 ? raw : null;

/** Garde un indice bien formé, coupé aux longueurs prévues ; null pour tout le reste. */
export function cleanSourceHint(raw: unknown): SourceHint | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!FRAMEWORKS.includes(r.framework as Framework)) return null;
  // Vite ajoute parfois une requête au chemin (?vue&type=script) : on la retire.
  const file = typeof r.file === "string" ? text(r.file.split(/[?#]/)[0], FILE_MAX) : null;
  const hint: SourceHint = {
    framework: r.framework as Framework,
    component: text(r.component, COMPONENT_MAX),
    file,
    line: file ? position(r.line) : null,
    column: file ? position(r.column) : null,
  };
  return hint.component || hint.file ? hint : null;
}

/** Une ligne pour Claude, les textes de la page entre guillemets JSON. */
export function describeSourceHint(hint: SourceHint): string {
  const parts: string[] = [hint.framework];
  if (hint.component) parts.push(`component ${JSON.stringify(hint.component)}`);
  if (hint.file) {
    const at = hint.line ? `:${hint.line}${hint.column ? `:${hint.column}` : ""}` : "";
    parts.push(`file ${JSON.stringify(hint.file)}${at}`);
  }
  return parts.join(", ");
}
