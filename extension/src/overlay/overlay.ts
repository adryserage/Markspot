// Overlay injecté dans la page par le service worker (Alt+C ou clic sur l'icône).
// Une seule instance par onglet : une nouvelle injection bascule le mode.
// Tout vit dans une racine shadow fermée, posée dans la couche supérieure (popover),
// pour que la page ne lise ni ne modifie les notes, et que ses styles ne s'y appliquent pas.

import { fromBase64 } from "../../../src/core/base64.ts";
import { contains, visiblePart } from "../../../src/core/geometry.ts";
import type { Annotation, Mark, PageRect, Rect, Viewport, ViewportRect } from "../../../src/core/model.ts";
import { ask } from "../messages.ts";
import { describeElement } from "./anchor.ts";
import css from "./overlay.css";

const DRAG_THRESHOLD = 6;
const FONT_FAMILY = "Markspot Atkinson";

type Mode = "idle" | "picking" | "composing";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function place(node: HTMLElement, rect: Rect): void {
  node.style.left = `${rect.x}px`;
  node.style.top = `${rect.y}px`;
  node.style.width = `${rect.width}px`;
  node.style.height = `${rect.height}px`;
}

function toRect(r: DOMRect): Rect {
  return { x: r.x, y: r.y, width: r.width, height: r.height };
}

function currentViewport(): Viewport {
  return {
    width: innerWidth,
    height: innerHeight,
    devicePixelRatio,
    scrollX,
    scrollY,
  };
}

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

async function drawPng(canvas: HTMLCanvasElement, base64: string, maxWidth: number, maxHeight: number) {
  const bitmap = await createImageBitmap(new Blob([fromBase64(base64)], { type: "image/png" }));
  const scale = Math.min(1, maxWidth / bitmap.width, maxHeight / bitmap.height);
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.style.width = `${Math.round(bitmap.width * scale)}px`;
  canvas.style.height = `${Math.round(bitmap.height * scale)}px`;
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
  bitmap.close();
}

function loadFonts(): void {
  for (const weight of [400, 700]) {
    const url = chrome.runtime.getURL(`dist/fonts/atkinson-${weight}.woff2`);
    const face = new FontFace(FONT_FAMILY, `url(${url})`, { weight: String(weight) });
    document.fonts.add(face);
    face.load().catch(() => {
      // Police refusée par la page (CSP) : la pile de repli du CSS prend le relais.
    });
  }
}

class Overlay {
  readonly #host = document.createElement("markspot-overlay");
  readonly #root = this.#host.attachShadow({ mode: "closed" });
  readonly #layer = el("div", "layer");
  readonly #highlight = el("div", "highlight");
  readonly #label = el("div", "label");
  readonly #drag = el("div", "drag");
  readonly #bar = el("div", "bar");
  readonly #pins = el("div", "pins");
  #panel: HTMLElement | null = null;

  #mode: Mode = "idle";
  #annotations: Annotation[] = [];
  #target: Element | null = null;
  #dragStart: { x: number; y: number } | null = null;
  #dragging = false;
  #draftId: string | null = null;
  #frame = 0;

  constructor() {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    this.#root.adoptedStyleSheets = [sheet];
    this.#highlight.append(this.#label);
    this.#root.append(this.#layer, this.#pins, this.#highlight, this.#drag, this.#bar);

    for (const [name, value] of Object.entries({
      position: "fixed",
      inset: "0",
      width: "100vw",
      height: "100vh",
      "max-width": "none",
      "max-height": "none",
      margin: "0",
      padding: "0",
      border: "0",
      background: "transparent",
      overflow: "visible",
      "pointer-events": "none",
      "z-index": "2147483647",
      display: "block",
    })) {
      this.#host.style.setProperty(name, value, "important");
    }
    this.#host.setAttribute("popover", "manual");
    document.documentElement.append(this.#host);
    this.#host.showPopover();

    this.#layer.addEventListener("pointermove", (e) => this.#onMove(e));
    this.#layer.addEventListener("pointerdown", (e) => this.#onDown(e));
    this.#layer.addEventListener("pointerup", (e) => this.#onUp(e));
    // Les touches tapées dans l'overlay ne remontent pas aux raccourcis de la page.
    for (const type of ["keydown", "keyup", "keypress"]) {
      this.#root.addEventListener(type, (e) => e.stopPropagation());
    }
    addEventListener("keydown", (e) => this.#onKey(e), true);
    addEventListener("scroll", () => this.#schedule(), { capture: true, passive: true });
    addEventListener("resize", () => this.#schedule(), { passive: true });
    loadFonts();
  }

  async toggle(): Promise<void> {
    if (this.#mode === "idle") {
      await this.#refresh();
      this.#startPicking();
    } else {
      this.#stop();
    }
  }

  // ------------------------------------------------------------ modes

  #startPicking(): void {
    this.#closePanel();
    this.#mode = "picking";
    this.#layer.classList.add("active");
    this.#pins.hidden = false;
    this.#showBar("Clique sur un élément ou trace une zone.", true);
  }

  #stop(): void {
    this.#discardDraft();
    this.#closePanel();
    this.#mode = "idle";
    this.#layer.classList.remove("active");
    this.#highlight.hidden = true;
    this.#drag.hidden = true;
    this.#bar.hidden = true;
    this.#pins.hidden = true;
    this.#target = null;
    this.#dragStart = null;
    this.#dragging = false;
  }

  #onKey(event: KeyboardEvent): void {
    if (!event.isTrusted || event.key !== "Escape") return;
    if (this.#mode === "idle" && !this.#panel) return;
    event.preventDefault();
    event.stopPropagation();
    if (this.#mode === "composing") {
      this.#discardDraft();
      this.#startPicking();
    } else if (this.#mode === "picking") {
      this.#stop();
    } else {
      this.#closePanel();
    }
  }

  // ---------------------------------------------------------- picking

  #pick(x: number, y: number): Element | null {
    return (
      document
        .elementsFromPoint(x, y)
        .find((e) => e !== this.#host && e !== document.documentElement && e !== document.body) ?? document.body
    );
  }

  #onMove(event: PointerEvent): void {
    if (!event.isTrusted || this.#mode !== "picking") return;
    if (this.#dragStart) {
      const dx = event.clientX - this.#dragStart.x;
      const dy = event.clientY - this.#dragStart.y;
      if (!this.#dragging && Math.hypot(dx, dy) > DRAG_THRESHOLD) {
        this.#dragging = true;
        this.#highlight.hidden = true;
        this.#drag.hidden = false;
      }
      if (this.#dragging) place(this.#drag, this.#dragRect(event));
      return;
    }
    this.#target = this.#pick(event.clientX, event.clientY);
    if (!this.#target) return;
    place(this.#highlight, toRect(this.#target.getBoundingClientRect()));
    const text = (this.#target as HTMLElement).innerText?.replace(/\s+/g, " ").trim().slice(0, 32);
    this.#label.textContent = text ? `${this.#target.localName} « ${text} »` : this.#target.localName;
    this.#highlight.hidden = false;
  }

  #onDown(event: PointerEvent): void {
    if (!event.isTrusted || this.#mode !== "picking" || event.button !== 0) return;
    event.preventDefault();
    this.#dragStart = { x: event.clientX, y: event.clientY };
    this.#dragging = false;
    this.#layer.setPointerCapture(event.pointerId);
  }

  #onUp(event: PointerEvent): void {
    if (!event.isTrusted || this.#mode !== "picking" || !this.#dragStart) return;
    const region = this.#dragging ? this.#dragRect(event) : null;
    this.#dragStart = null;
    this.#dragging = false;
    this.#drag.hidden = true;
    this.#highlight.hidden = true;
    if (region) void this.#markRegion(region);
    else if (this.#target) void this.#markElement(this.#target);
  }

  #dragRect(event: PointerEvent): Rect {
    const start = this.#dragStart ?? { x: event.clientX, y: event.clientY };
    return {
      x: Math.min(start.x, event.clientX),
      y: Math.min(start.y, event.clientY),
      width: Math.abs(event.clientX - start.x),
      height: Math.abs(event.clientY - start.y),
    };
  }

  #markElement(element: Element): Promise<void> {
    const box = toRect(element.getBoundingClientRect());
    return this.#compose(element, box, "element", { x: 0, y: 0, width: box.width, height: box.height });
  }

  /** Une zone garde le plus petit élément qui la contient : Claude a toujours un texte et un sélecteur. */
  #markRegion(region: Rect): Promise<void> {
    let anchor: Element | null = this.#pick(region.x + region.width / 2, region.y + region.height / 2);
    while (anchor && anchor.parentElement && !contains(toRect(anchor.getBoundingClientRect()), region)) {
      anchor = anchor.parentElement;
    }
    const element = anchor ?? document.body;
    const box = element.getBoundingClientRect();
    return this.#compose(element, region, "region", {
      x: region.x - box.x,
      y: region.y - box.y,
      width: region.width,
      height: region.height,
    });
  }

  // -------------------------------------------------------- composing

  async #compose(element: Element, zoneInViewport: Rect, kind: Mark["kind"], rectInAnchor: Rect): Promise<void> {
    const zone = visiblePart(zoneInViewport, innerWidth, innerHeight);
    if (!zone) return;
    this.#mode = "composing";
    this.#layer.classList.remove("active");
    const viewport = currentViewport();
    const pageZone = { ...zone, x: zone.x + viewport.scrollX, y: zone.y + viewport.scrollY } as PageRect;
    const mark: Mark = { kind, anchor: describeElement(element), rect: pageZone, rectInAnchor };

    this.#host.style.setProperty("visibility", "hidden", "important");
    await nextFrame();
    await nextFrame();
    const reply = await ask({ type: "capture", zone: zone as ViewportRect, pageZone, viewport });
    this.#host.style.setProperty("visibility", "visible", "important");

    if (!reply.ok || reply.type !== "captured") {
      this.#startPicking();
      this.#showBar(`Capture impossible : ${reply.ok ? "réponse inattendue" : reply.error}`, false);
      return;
    }
    this.#draftId = reply.draftId;
    this.#bar.hidden = true;
    this.#openComposer(mark, viewport, zone, reply.png);
  }

  #openComposer(mark: Mark, viewport: Viewport, zone: Rect, png: string): void {
    const panel = el("form", "panel composer");
    const preview = el("canvas", "preview");
    void drawPng(preview, png, 316, 160);
    const field = el("textarea", "comment");
    field.placeholder = "Qu'est-ce qui ne va pas ici ?";
    field.rows = 3;
    field.maxLength = 4000;
    field.setAttribute("aria-label", "Commentaire");
    const hint = el("p", "hint", "Entrée enregistre, Maj+Entrée va à la ligne.");
    const actions = el("div", "actions");
    const cancel = el("button", "ghost", "Annuler");
    cancel.type = "button";
    const save = el("button", "primary", "Enregistrer la note");
    save.type = "submit";
    actions.append(cancel, save);
    panel.append(preview, field, hint, actions);

    const submit = async () => {
      const comment = field.value.trim();
      if (!comment || !this.#draftId) {
        field.focus();
        return;
      }
      save.disabled = true;
      const reply = await ask({
        type: "save",
        draftId: this.#draftId,
        url: location.href,
        title: document.title,
        mark,
        viewport,
        comment,
      });
      save.disabled = false;
      if (!reply.ok || reply.type !== "saved") {
        hint.textContent = `Note non enregistrée : ${reply.ok ? "réponse inattendue" : reply.error}`;
        hint.classList.add("error");
        return;
      }
      this.#draftId = null;
      this.#annotations.push(reply.annotation);
      this.#renderPins();
      this.#startPicking();
      this.#showBar(`Note ${reply.annotation.seq} enregistrée. Clique ailleurs pour en ajouter une.`, true);
    };
    panel.addEventListener("submit", (e) => {
      e.preventDefault();
      void submit();
    });
    field.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        void submit();
      }
    });
    cancel.addEventListener("click", () => {
      this.#discardDraft();
      this.#startPicking();
    });

    this.#openPanel(panel, zone);
    field.focus();
  }

  #discardDraft(): void {
    if (this.#draftId) void ask({ type: "discard", draftId: this.#draftId });
    this.#draftId = null;
  }

  // ------------------------------------------------------------ panels

  /** Place le panneau sous la zone s'il y a la place, sinon au-dessus, sans sortir de la fenêtre. */
  #openPanel(panel: HTMLElement, near: Rect): void {
    this.#closePanel();
    this.#panel = panel;
    this.#root.append(panel);
    const width = panel.offsetWidth;
    const height = panel.offsetHeight;
    const gap = 10;
    const below = near.y + near.height + gap;
    const top = below + height <= innerHeight ? below : Math.max(gap, near.y - height - gap);
    const left = Math.min(Math.max(gap, near.x), innerWidth - width - gap);
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
  }

  #closePanel(): void {
    this.#panel?.remove();
    this.#panel = null;
  }

  #showBar(message: string, withKey: boolean): void {
    this.#bar.replaceChildren(el("span", "", message));
    if (withKey) {
      const key = el("span", "key-hint");
      key.append(el("kbd", "", "Échap"), document.createTextNode(" pour sortir"));
      this.#bar.append(key);
    }
    this.#bar.hidden = false;
  }

  // -------------------------------------------------------------- pins

  async #refresh(): Promise<void> {
    const reply = await ask({ type: "list", url: location.href });
    if (reply.ok && reply.type === "annotations") {
      this.#annotations = reply.annotations;
      this.#renderPins();
    }
  }

  /** Coin haut-gauche de la zone, recalculé depuis l'ancre si elle est encore là. */
  #pinPosition(annotation: Annotation): { x: number; y: number } {
    const { anchor, rect, rectInAnchor } = annotation.mark;
    let found: Element | null = null;
    try {
      found = document.querySelector(anchor.selector);
    } catch {
      found = null;
    }
    if (found) {
      const box = found.getBoundingClientRect();
      return { x: box.x + rectInAnchor.x, y: box.y + rectInAnchor.y };
    }
    return { x: rect.x - scrollX, y: rect.y - scrollY };
  }

  #renderPins(): void {
    this.#pins.replaceChildren(
      ...this.#annotations.map((annotation) => {
        const pin = el("button", "pin", String(annotation.seq));
        pin.type = "button";
        pin.setAttribute("aria-label", `Note ${annotation.seq} : ${annotation.comment.slice(0, 60)}`);
        const { x, y } = this.#pinPosition(annotation);
        pin.style.left = `${x}px`;
        pin.style.top = `${y}px`;
        pin.addEventListener("click", () => void this.#openCard(annotation, pin));
        return pin;
      }),
    );
  }

  #schedule(): void {
    if (this.#frame || this.#mode === "idle") return;
    this.#frame = requestAnimationFrame(() => {
      this.#frame = 0;
      this.#renderPins();
    });
  }

  async #openCard(annotation: Annotation, pin: HTMLElement): Promise<void> {
    const panel = el("div", "panel card");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", `Note ${annotation.seq}`);
    const head = el("div", "card-head");
    head.append(el("strong", "", `Note ${annotation.seq}`), el("span", "state open", "Ouverte"));
    const comment = el("p", "card-comment", annotation.comment);
    const preview = el("canvas", "preview");
    const { anchor } = annotation.mark;
    const target = el("p", "card-target");
    target.append(
      document.createTextNode(anchor.text ? `${anchor.tag} « ${anchor.text} »` : anchor.tag),
      el("code", "", anchor.selector),
    );
    const close = el("button", "ghost", "Fermer");
    close.type = "button";
    close.addEventListener("click", () => this.#closePanel());
    const actions = el("div", "actions");
    actions.append(close);
    panel.append(head, comment, preview, target, actions);
    this.#openPanel(panel, toRect(pin.getBoundingClientRect()));
    close.focus();

    const reply = await ask({ type: "thumbnail", id: annotation.id });
    if (reply.ok && reply.type === "thumbnail" && reply.png) await drawPng(preview, reply.png, 316, 160);
    else preview.remove();
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __markspot: Overlay | undefined;
}

globalThis.__markspot ??= new Overlay();
void globalThis.__markspot.toggle();
