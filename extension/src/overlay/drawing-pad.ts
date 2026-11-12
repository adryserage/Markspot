// Calque de dessin sur la capture figée de la zone : stylo, flèche, rectangle, deux
// couleurs, annuler. On dessine sur l'image, pas sur la page vivante. Les traits sont en
// coordonnées 0..1 ; le service worker les incruste dans le gros plan à l'enregistrement.

import { MAX_STROKES, drawStrokes, type DrawColor, type DrawTool, type Stroke } from "../../../src/core/drawing.ts";

const TOOLS: Array<[DrawTool, string]> = [
  ["arrow", "Flèche"],
  ["rect", "Rectangle"],
  ["pen", "Stylo"],
];
const COLORS: Array<[DrawColor, string]> = [
  ["red", "Rouge"],
  ["yellow", "Jaune"],
];
/** Écart minimal entre deux points du stylo, en px d'écran : garde le dessin léger. */
const MIN_STEP_PX = 2;

function button(label: string, className = "tool"): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = className;
  b.textContent = label;
  return b;
}

export class DrawingPad {
  readonly element = document.createElement("div");
  readonly #canvas = document.createElement("canvas");
  readonly #image: ImageBitmap;
  #strokes: Stroke[] = [];
  #current: Stroke | null = null;
  #last: { x: number; y: number } | null = null;
  #tool: DrawTool = "arrow";
  #color: DrawColor = "red";

  constructor(image: ImageBitmap, displayWidth: number) {
    this.#image = image;
    this.element.className = "drawing";
    this.#canvas.className = "preview drawable";
    this.#canvas.width = image.width;
    this.#canvas.height = image.height;
    this.#canvas.setAttribute("aria-label", "Capture de la zone, dessine dessus avec la souris");
    const scale = Math.min(1, displayWidth / image.width, 360 / image.height);
    this.#canvas.style.width = `${Math.round(image.width * scale)}px`;
    this.#canvas.style.height = `${Math.round(image.height * scale)}px`;

    const toolbar = document.createElement("div");
    toolbar.className = "toolbar";
    toolbar.setAttribute("role", "toolbar");
    toolbar.setAttribute("aria-label", "Outils de dessin");
    const toolButtons: HTMLButtonElement[] = [];
    const colorButtons: HTMLButtonElement[] = [];
    const sync = () => {
      toolButtons.forEach((b, i) => b.setAttribute("aria-pressed", String(TOOLS[i]![0] === this.#tool)));
      colorButtons.forEach((b, i) => b.setAttribute("aria-pressed", String(COLORS[i]![0] === this.#color)));
    };
    for (const [tool, label] of TOOLS) {
      const b = button(label);
      b.addEventListener("click", () => {
        this.#tool = tool;
        sync();
      });
      toolButtons.push(b);
    }
    for (const [color, label] of COLORS) {
      const b = button(label, `tool swatch ${color}`);
      b.addEventListener("click", () => {
        this.#color = color;
        sync();
      });
      colorButtons.push(b);
    }
    const undo = button("Annuler le trait");
    undo.addEventListener("click", () => {
      this.#strokes.pop();
      this.#render();
    });
    toolbar.append(...toolButtons, ...colorButtons, undo);
    this.element.append(this.#canvas, toolbar);
    sync();

    this.#canvas.addEventListener("pointerdown", (e) => this.#down(e));
    this.#canvas.addEventListener("pointermove", (e) => this.#move(e));
    this.#canvas.addEventListener("pointerup", () => this.#up());
    this.#canvas.addEventListener("pointercancel", () => this.#up());
    this.#render();
  }

  get strokes(): Stroke[] {
    return this.#strokes.map((s) => ({ ...s, points: [...s.points] }));
  }

  #point(event: PointerEvent): [number, number] {
    const box = this.#canvas.getBoundingClientRect();
    return [(event.clientX - box.left) / box.width, (event.clientY - box.top) / box.height];
  }

  #down(event: PointerEvent): void {
    if (!event.isTrusted || event.button !== 0 || this.#strokes.length >= MAX_STROKES) return;
    event.preventDefault();
    this.#canvas.setPointerCapture(event.pointerId);
    const p = this.#point(event);
    this.#last = { x: event.clientX, y: event.clientY };
    this.#current = { tool: this.#tool, color: this.#color, points: [p, p] };
  }

  #move(event: PointerEvent): void {
    if (!event.isTrusted || !this.#current) return;
    const p = this.#point(event);
    if (this.#current.tool === "pen") {
      const last = this.#last;
      if (last && Math.hypot(event.clientX - last.x, event.clientY - last.y) < MIN_STEP_PX) return;
      this.#last = { x: event.clientX, y: event.clientY };
      this.#current.points.push(p);
    } else {
      this.#current.points[1] = p;
    }
    this.#render();
  }

  #up(): void {
    if (this.#current) this.#strokes.push(this.#current);
    this.#current = null;
    this.#last = null;
    this.#render();
  }

  #render(): void {
    const ctx = this.#canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, this.#canvas.width, this.#canvas.height);
    ctx.drawImage(this.#image, 0, 0);
    drawStrokes(ctx, this.#current ? [...this.#strokes, this.#current] : this.#strokes, this.#canvas.width, this.#canvas.height);
  }
}
