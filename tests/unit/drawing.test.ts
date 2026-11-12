import assert from "node:assert/strict";
import { test } from "node:test";
import { drawStrokes, sanitizeStrokes, type Ctx2D } from "../../src/core/drawing.ts";

test("sanitizeStrokes keeps valid strokes, clamps points and drops the rest", () => {
  const strokes = sanitizeStrokes([
    { tool: "pen", color: "red", points: [[0.1, 0.2], [1.4, -0.3], [0.5, 0.5]] },
    { tool: "arrow", color: "yellow", points: [[0, 0], [0.3, 0.3], [0.9, 0.9]] },
    { tool: "laser", color: "red", points: [[0, 0], [1, 1]] },
    { tool: "rect", color: "blue", points: [[0, 0], [1, 1]] },
    { tool: "pen", color: "red", points: [[0.5, 0.5]] },
    "nope",
  ]);
  assert.deepEqual(strokes, [
    { tool: "pen", color: "red", points: [[0.1, 0.2], [1, 0], [0.5, 0.5]] },
    { tool: "arrow", color: "yellow", points: [[0, 0], [0.9, 0.9]] },
  ]);
  assert.deepEqual(sanitizeStrokes(null), []);
});

test("drawStrokes scales normalized points to the surface", () => {
  const calls: string[] = [];
  const ctx = new Proxy({} as Ctx2D, {
    get: (_t, name: string) => (...args: number[]) => calls.push(`${name}(${args.map((a) => Math.round(a)).join(",")})`),
    set: () => true,
  });
  drawStrokes(ctx, [{ tool: "rect", color: "red", points: [[0.5, 0.5], [0.25, 0.75]] }], 200, 100);
  assert.deepEqual(calls, ["strokeRect(50,50,50,25)", "strokeRect(50,50,50,25)"]);
});
