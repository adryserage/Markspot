// Une capture de l'onglet donne deux images : le gros plan de la zone, et l'écran
// visible entier réduit, avec la zone encadrée. Tourne dans le service worker.

import { fromBase64, toBase64 } from "../../src/core/base64.ts";
import { contextSize, cropBox } from "../../src/core/geometry.ts";
import type { CaptureKind, CaptureMeta, PageRect, Viewport, ViewportRect } from "../../src/core/model.ts";

export interface CaptureResult {
  png: Record<CaptureKind, string>;
  meta: Record<CaptureKind, CaptureMeta>;
}

const INK = "#151821";
const MARKER = "#F2FF3A";

async function encode(canvas: OffscreenCanvas): Promise<string> {
  const blob = await canvas.convertToBlob({ type: "image/png" });
  return toBase64(new Uint8Array(await blob.arrayBuffer()));
}

function context2d(canvas: OffscreenCanvas): OffscreenCanvasRenderingContext2D {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas unavailable");
  return ctx;
}

export async function captureTab(
  windowId: number,
  zone: ViewportRect,
  pageZone: PageRect,
  viewport: Viewport,
): Promise<CaptureResult> {
  const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: "png" });
  const shot = await createImageBitmap(new Blob([fromBase64(dataUrl.slice(dataUrl.indexOf(",") + 1))]));
  const image = { width: shot.width, height: shot.height };

  const box = cropBox(zone, viewport, image);
  const crop = new OffscreenCanvas(box.width, box.height);
  context2d(crop).drawImage(shot, box.x, box.y, box.width, box.height, 0, 0, box.width, box.height);

  const size = contextSize(image);
  const whole = new OffscreenCanvas(size.width, size.height);
  const ctx = context2d(whole);
  ctx.drawImage(shot, 0, 0, size.width, size.height);
  const frame = { x: box.x * size.scale, y: box.y * size.scale, w: box.width * size.scale, h: box.height * size.scale };
  ctx.lineWidth = 6;
  ctx.strokeStyle = INK;
  ctx.strokeRect(frame.x - 3, frame.y - 3, frame.w + 6, frame.h + 6);
  ctx.lineWidth = 3;
  ctx.strokeStyle = MARKER;
  ctx.strokeRect(frame.x - 3, frame.y - 3, frame.w + 6, frame.h + 6);
  shot.close();

  const viewportRect = {
    x: viewport.scrollX,
    y: viewport.scrollY,
    width: viewport.width,
    height: viewport.height,
  } as PageRect;
  return {
    png: { zone: await encode(crop), context: await encode(whole) },
    meta: {
      zone: { rect: pageZone, width: box.width, height: box.height },
      context: { rect: viewportRect, width: size.width, height: size.height },
    },
  };
}
