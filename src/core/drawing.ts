// Traits dessinés sur le gros plan d'une note. Coordonnées de 0 à 1 dans la zone : le
// même dessin se rend sur la vignette de l'overlay et sur l'image pleine taille.
// Pur : le rendu reçoit un contexte 2D (navigateur ou OffscreenCanvas).

export const DRAW_COLORS = { yellow: "#F2FF3A", red: "#E5484D" } as const;
export type DrawColor = keyof typeof DRAW_COLORS;
export type DrawTool = "pen" | "arrow" | "rect";

export interface Stroke {
  tool: DrawTool;
  color: DrawColor;
  /** Points normalisés : stylo = tracé, flèche et rectangle = [début, fin]. */
  points: Array<[number, number]>;
}

export const MAX_STROKES = 50;
export const MAX_POINTS = 2000;
/** Total des points de tous les traits : garde une note bien sous 1 Mo une fois en JSON. */
export const MAX_TOTAL_POINTS = 8000;

export interface Ctx2D {
  strokeStyle: string | CanvasGradient | CanvasPattern;
  fillStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  lineCap: CanvasLineCap;
  lineJoin: CanvasLineJoin;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  closePath(): void;
  stroke(): void;
  fill(): void;
  strokeRect(x: number, y: number, w: number, h: number): void;
}

const clamp01 = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 10_000) / 10_000;

/** Garde un trait valide : outil et couleur connus, points dans [0,1], tailles bornées. */
export function sanitizeStrokes(raw: unknown): Stroke[] {
  if (!Array.isArray(raw)) return [];
  const out: Stroke[] = [];
  let budget = MAX_TOTAL_POINTS;
  for (const item of raw.slice(0, MAX_STROKES)) {
    const s = item as Partial<Stroke>;
    if (s.tool !== "pen" && s.tool !== "arrow" && s.tool !== "rect") continue;
    if (s.color !== "yellow" && s.color !== "red") continue;
    if (!Array.isArray(s.points)) continue;
    const points = s.points
      .slice(0, MAX_POINTS)
      .filter((p): p is [number, number] => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]))
      .map(([x, y]) => [clamp01(x), clamp01(y)] as [number, number]);
    if (points.length < 2 || points.length > budget) continue;
    budget -= points.length;
    out.push({ tool: s.tool, color: s.color, points: s.tool === "pen" ? points : [points[0]!, points[points.length - 1]!] });
  }
  return out;
}

/** Dessine les traits sur une surface de width×height pixels. */
export function drawStrokes(ctx: Ctx2D, strokes: Stroke[], width: number, height: number): void {
  const line = Math.max(2, Math.round(Math.min(width, height) / 120));
  for (const stroke of strokes) {
    const pts = stroke.points.map(([x, y]) => [x * width, y * height] as const);
    const color = DRAW_COLORS[stroke.color];
    // Un liseré sombre sous la couleur : visible sur fond clair comme sur fond foncé.
    for (const [style, extra] of [["#151821", 2], [color, 0]] as const) {
      ctx.strokeStyle = style;
      ctx.fillStyle = style;
      ctx.lineWidth = line + extra;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      if (stroke.tool === "rect") {
        const [[x1, y1], [x2, y2]] = [pts[0]!, pts[pts.length - 1]!];
        ctx.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
        continue;
      }
      ctx.beginPath();
      ctx.moveTo(pts[0]![0], pts[0]![1]);
      for (const [x, y] of pts.slice(1)) ctx.lineTo(x, y);
      ctx.stroke();
      if (stroke.tool === "arrow") {
        const [x1, y1] = pts[0]!;
        const [x2, y2] = pts[pts.length - 1]!;
        const angle = Math.atan2(y2 - y1, x2 - x1);
        const head = line * 4 + extra;
        ctx.beginPath();
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - head * Math.cos(angle - Math.PI / 6), y2 - head * Math.sin(angle - Math.PI / 6));
        ctx.lineTo(x2 - head * Math.cos(angle + Math.PI / 6), y2 - head * Math.sin(angle + Math.PI / 6));
        ctx.closePath();
        ctx.fill();
      }
    }
  }
}
