// Calculs de découpe des captures. Pur, testé dans tests/unit/geometry.test.ts.

import type { Rect } from "./model.ts";

export const CONTEXT_MAX_WIDTH = 1600;

/** Partie du rectangle visible dans la fenêtre, ou null s'il est entièrement dehors. */
export function visiblePart(rect: Rect, viewportWidth: number, viewportHeight: number): Rect | null {
  const x = Math.max(0, rect.x);
  const y = Math.max(0, rect.y);
  const right = Math.min(viewportWidth, rect.x + rect.width);
  const bottom = Math.min(viewportHeight, rect.y + rect.height);
  if (right <= x || bottom <= y) return null;
  return { x, y, width: right - x, height: bottom - y };
}

/**
 * Rectangle en pixels de l'image pour une zone en px CSS de la fenêtre.
 * L'échelle vient de la taille réelle de l'image (Windows à 125 %, zoom de la page),
 * pas du seul devicePixelRatio. Origine arrondie vers le bas, fin vers le haut, bornée à l'image.
 */
export function cropBox(
  zone: Rect,
  viewport: { width: number; height: number },
  image: { width: number; height: number },
): Rect {
  const scaleX = image.width / viewport.width;
  const scaleY = image.height / viewport.height;
  const x = Math.max(0, Math.floor(zone.x * scaleX));
  const y = Math.max(0, Math.floor(zone.y * scaleY));
  const right = Math.min(image.width, Math.ceil((zone.x + zone.width) * scaleX));
  const bottom = Math.min(image.height, Math.ceil((zone.y + zone.height) * scaleY));
  return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) };
}

/** Taille de l'image de contexte : la capture entière, réduite à CONTEXT_MAX_WIDTH de large au plus. */
export function contextSize(image: { width: number; height: number }): { width: number; height: number; scale: number } {
  const scale = Math.min(1, CONTEXT_MAX_WIDTH / image.width);
  return { width: Math.round(image.width * scale), height: Math.round(image.height * scale), scale };
}

/** Position d'un panneau de width×height gardée dans la fenêtre, avec une marge. */
export function clampToViewport(
  x: number,
  y: number,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  margin = 6,
): { x: number; y: number } {
  const maxX = Math.max(margin, viewport.width - size.width - margin);
  const maxY = Math.max(margin, viewport.height - size.height - margin);
  return { x: Math.min(Math.max(margin, x), maxX), y: Math.min(Math.max(margin, y), maxY) };
}

/** Le plus petit rectangle qui contient les deux. */
export function union(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}

export function contains(outer: Rect, inner: Rect): boolean {
  return (
    outer.x <= inner.x &&
    outer.y <= inner.y &&
    outer.x + outer.width >= inner.x + inner.width &&
    outer.y + outer.height >= inner.y + inner.height
  );
}
