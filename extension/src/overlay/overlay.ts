// Overlay injecté dans la page par le service worker (Alt+C ou clic sur l'icône).
// Une seule instance par onglet : une nouvelle injection bascule le mode.
// Tout vit dans une racine shadow fermée, posée dans la couche supérieure (popover),
// pour que la page ne lise ni ne modifie les notes, et que ses styles ne s'y appliquent pas.

import { fromBase64 } from "../../../src/core/base64.ts";
import { clampToViewport, contains, visiblePart } from "../../../src/core/geometry.ts";
import type { Annotation, Mark, PageRect, Rect, Viewport, ViewportRect } from "../../../src/core/model.ts";
import { OVERLAY_PORT, ask, type NoteView, type OverlayPush } from "../messages.ts";
import { describeElement } from "./anchor.ts";
import { DrawingPad } from "./drawing-pad.ts";
import { commentForm, NotesMenu, STATE_LABEL, stateOf } from "./menu.ts";
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

const stateClass = stateOf;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

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
  /** Retire les écouteurs du panneau ouvert quand il se ferme. */
  #panelListeners: AbortController | null = null;
  readonly #menu: NotesMenu;

  #mode: Mode = "idle";
  /** Annule une modification ou une suppression en cours dans la fiche (Échap). */
  #cardCancel: (() => void) | null = null;
  #notes: NoteView[] = [];
  #port: chrome.runtime.Port | null = null;
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
    this.#menu = new NotesMenu({
      goTo: (note) => void this.#goTo(note),
      edit: (note, comment) => this.#edit(note, comment),
      clearResolved: (notes) => this.#clearNotes(notes, false),
      clearAll: (notes) => this.#clearNotes(notes, true),
      clearOne: (note) => this.#clearOne(note),
      setResolved: (note, resolved) => this.#setResolved(note, resolved),
      resolveAll: (notes) => this.#resolveAll(notes),
      sendToClaude: async (notes) => {
        const reply = await ask({ type: "send", ids: notes.map((n) => n.annotation.id) });
        if (!reply.ok) return { text: `Non envoyé : ${reply.error}`, error: true };
        if (reply.type === "choose") {
          return { text: "Plusieurs sessions écoutent : choisis-en une dans « Envoyer à », puis renvoie.", error: true, choose: true };
        }
        if (reply.type !== "sent") return { text: "Non envoyé : réponse inattendue", error: true };
        const what = reply.count === 1 ? "1 note envoyée" : `${reply.count} notes envoyées`;
        const to = reply.host ? `${reply.to} (${reply.host})` : reply.to;
        return reply.listening > 0
          ? { text: `${what} à ${to}.`, error: false }
          : { text: `${what} à ${to}, qui n'écoute pas en ce moment : la session les prendra dès qu'elle écoutera.`, error: false };
      },
      loadTargets: async () => {
        const reply = await ask({ type: "targets" });
        return reply.ok && reply.type === "targets" ? { listeners: reply.listeners, chosen: reply.chosen } : { listeners: [], chosen: null };
      },
      setTarget: async (target) => {
        await ask({ type: "setTarget", target });
      },
      openExport: async () => {
        const reply = await ask({ type: "openExport" });
        return reply.ok ? null : reply.error;
      },
    });
    this.#menu.element.hidden = true;
    this.#root.append(this.#layer, this.#pins, this.#highlight, this.#drag, this.#bar, this.#menu.element);

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
    // Ce qu'on tape dans l'overlay ne remonte pas aux écouteurs de la page (raccourcis, saisie).
    // Limite : un écouteur de la page posé en capture sur window ou document le voit quand même.
    for (const type of [
      "keydown",
      "keyup",
      "keypress",
      "input",
      "beforeinput",
      "textInput",
      "compositionstart",
      "compositionupdate",
      "compositionend",
      "paste",
      "cut",
      "copy",
    ]) {
      this.#root.addEventListener(type, (e) => e.stopPropagation());
    }
    addEventListener("keydown", (e) => this.#onKey(e), true);
    addEventListener("scroll", () => this.#schedule(), { capture: true, passive: true });
    addEventListener("resize", () => this.#schedule(), { passive: true });
    loadFonts();
  }

  async toggle(): Promise<void> {
    if (this.#mode === "idle") {
      this.#listen();
      const status = await ask({ type: "status" });
      this.#menu.setCanSend(status.ok && status.type === "status" && status.native);
      this.#menu.setHostMissing(status.ok && status.type === "status" && status.missing);
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
    this.#menu.element.hidden = false;
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
    this.#menu.close();
    this.#menu.element.hidden = true;
    this.#target = null;
    this.#dragStart = null;
    this.#dragging = false;
  }

  #onKey(event: KeyboardEvent): void {
    if (!event.isTrusted || event.key !== "Escape") return;
    if (this.#mode === "idle" && !this.#panel) return;
    event.preventDefault();
    event.stopPropagation();
    // Une modification ou une suppression en cours dans la fiche s'annule d'abord.
    if (this.#cardCancel) {
      const cancel = this.#cardCancel;
      this.#cardCancel = null;
      cancel();
      return;
    }
    // Une modification en cours dans le menu s'annule d'abord, sans quitter le mode.
    if (this.#menu.editing) {
      this.#menu.cancelEdit();
      return;
    }
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

    // Échap pendant la capture : la personne est sortie, on jette le brouillon.
    if (this.#mode !== "composing") {
      if (reply.ok && reply.type === "captured") void ask({ type: "discard", draftId: reply.draftId });
      return;
    }
    if (!reply.ok || reply.type !== "captured") {
      this.#startPicking();
      this.#showBar(`Capture impossible : ${reply.ok ? "réponse inattendue" : reply.error}`, false);
      return;
    }
    this.#draftId = reply.draftId;
    this.#bar.hidden = true;
    await this.#openComposer(mark, viewport, zone, reply.png);
  }

  /** La boîte s'ouvre directement sur la capture, prête pour le dessin. */
  async #openComposer(mark: Mark, viewport: Viewport, zone: Rect, png: string): Promise<void> {
    const panel = el("form", "panel composer wide");
    const bar = el("div", "panel-bar");
    bar.append(el("span", "panel-title", "Nouvelle note"), el("span", "grip"));
    let pad: DrawingPad | null = null;
    let capture: HTMLElement;
    try {
      const bitmap = await createImageBitmap(new Blob([fromBase64(png)], { type: "image/png" }));
      pad = new DrawingPad(bitmap, Math.min(560, innerWidth - 60));
      capture = pad.element;
    } catch {
      // Image illisible : simple vignette, sans dessin.
      const preview = el("canvas", "preview");
      void drawPng(preview, png, 316, 160);
      capture = preview;
      panel.classList.remove("wide");
    }
    // Échap pendant le décodage : la personne est sortie.
    if (this.#mode !== "composing") {
      this.#discardDraft();
      return;
    }
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
    panel.append(bar, capture, field, hint, actions);

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
        strokes: pad?.strokes ?? [],
      });
      save.disabled = false;
      if (!reply.ok || reply.type !== "saved") {
        hint.textContent = `Note non enregistrée : ${reply.ok ? "réponse inattendue" : reply.error}`;
        hint.classList.add("error");
        return;
      }
      this.#draftId = null;
      this.#upsert(reply.note);
      this.#startPicking();
      this.#showBar(`Note ${reply.note.annotation.seq} enregistrée. Clique ailleurs pour en ajouter une.`, true);
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

    const pageZone = mark.rect;
    this.#openPanel(panel, () => ({ ...pageZone, x: pageZone.x - scrollX, y: pageZone.y - scrollY }), bar);
    field.focus();
  }

  #discardDraft(): void {
    if (this.#draftId) void ask({ type: "discard", draftId: this.#draftId });
    this.#draftId = null;
  }

  // ------------------------------------------------------------ panels

  /** Place le panneau sous la zone s'il y a la place, sinon au-dessus, sans sortir de la fenêtre. */
  /**
   * Ouvre un panneau près de « home() » et le rend déplaçable par sa barre.
   * home est relu au double-clic : la zone ou la pastille a pu bouger avec le défilement.
   */
  #openPanel(panel: HTMLElement, home: () => Rect, bar: HTMLElement): void {
    this.#closePanel();
    this.#panel = panel;
    this.#root.append(panel);
    this.#placePanel(panel, home());
    this.#makeDraggable(panel, bar, home);
  }

  #makeDraggable(panel: HTMLElement, bar: HTMLElement, home: () => Rect): void {
    const THRESHOLD = 3;
    let start: { x: number; y: number; left: number; top: number } | null = null;
    let moving = false;
    const moveTo = (left: number, top: number) => {
      const at = clampToViewport(left, top, { width: panel.offsetWidth, height: panel.offsetHeight }, { width: innerWidth, height: innerHeight });
      panel.style.left = `${at.x}px`;
      panel.style.top = `${at.y}px`;
    };
    const end = () => {
      start = null;
      moving = false;
      bar.classList.remove("grabbing");
    };
    bar.tabIndex = 0;
    bar.setAttribute("role", "button");
    bar.setAttribute("aria-label", "Déplacer le panneau : glisser, ou flèches du clavier. Double-clic pour le remettre en place.");
    // Garde le focus dans le champ de commentaire pendant le glissement.
    bar.addEventListener("mousedown", (e) => e.preventDefault());
    bar.addEventListener("pointerdown", (e) => {
      if (!e.isTrusted || e.button !== 0) return;
      e.preventDefault();
      bar.setPointerCapture(e.pointerId);
      start = { x: e.clientX, y: e.clientY, left: panel.offsetLeft, top: panel.offsetTop };
    });
    bar.addEventListener("pointermove", (e) => {
      if (!e.isTrusted || !start) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (!moving && Math.hypot(dx, dy) < THRESHOLD) return;
      moving = true;
      bar.classList.add("grabbing");
      moveTo(start.left + dx, start.top + dy);
    });
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) bar.addEventListener(type, end);
    bar.addEventListener("dblclick", (e) => {
      if (e.isTrusted) this.#placePanel(panel, home());
    });
    bar.addEventListener("keydown", (e) => {
      const step = e.shiftKey ? 40 : 10;
      const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (!delta) return;
      e.preventDefault();
      moveTo(panel.offsetLeft + delta[0]!, panel.offsetTop + delta[1]!);
    });
    // Le panneau grandit après coup (vignette, champ agrandi) ou la fenêtre rétrécit : il reste visible.
    const keepInside = () => {
      if (panel.isConnected) moveTo(panel.offsetLeft, panel.offsetTop);
    };
    const listeners = new AbortController();
    this.#panelListeners = listeners;
    const observer = new ResizeObserver(keepInside);
    observer.observe(panel);
    listeners.signal.addEventListener("abort", () => observer.disconnect());
    addEventListener("resize", keepInside, { passive: true, signal: listeners.signal });
  }

  #placePanel(panel: HTMLElement, near: Rect): void {
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
    this.#cardCancel = null;
    this.#panelListeners?.abort();
    this.#panelListeners = null;
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
    if (reply.ok && reply.type === "notes") {
      this.#notes = reply.notes;
      this.#renderPins();
      this.#menu.update(this.#notes);
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

  /** Le service worker pousse les notes réglées ou retirées pendant que la page est ouverte. */
  #listen(): void {
    if (this.#port) return;
    const port = chrome.runtime.connect({ name: OVERLAY_PORT });
    this.#port = port;
    port.onMessage.addListener((push: OverlayPush) => {
      if (push.type === "note") this.#upsert(push.note);
      else if (push.type === "removed") this.#remove([push.id]);
      else this.#menu.notify(push.text);
    });
    port.onDisconnect.addListener(() => {
      this.#port = null;
    });
  }

  #upsert(note: NoteView): void {
    this.#notes = [...this.#notes.filter((n) => n.annotation.id !== note.annotation.id), note].sort(
      (a, b) => a.annotation.seq - b.annotation.seq,
    );
    this.#renderPins();
    this.#menu.update(this.#notes);
  }

  #remove(ids: string[]): void {
    const gone = new Set(ids);
    if (!this.#notes.some((n) => gone.has(n.annotation.id))) return;
    this.#notes = this.#notes.filter((n) => !gone.has(n.annotation.id));
    this.#closePanel();
    this.#renderPins();
    this.#menu.update(this.#notes);
  }

  /** Défile jusqu'à l'élément de la note, puis ouvre sa fiche près de la pastille. */
  async #goTo(note: NoteView): Promise<void> {
    let anchor: Element | null = null;
    try {
      anchor = document.querySelector(note.annotation.mark.anchor.selector);
    } catch {
      anchor = null;
    }
    if (anchor) anchor.scrollIntoView({ block: "center", behavior: "instant" });
    else scrollTo({ top: Math.max(0, note.annotation.mark.rect.y - innerHeight / 3), behavior: "instant" });
    await sleep(120);
    this.#renderPins();
    await this.#openCard(note);
  }

  async #edit(note: NoteView, comment: string): Promise<string | null> {
    const reply = await ask({ type: "edit", id: note.annotation.id, comment });
    if (!reply.ok) return reply.error;
    if (reply.type !== "edited") return "réponse inattendue";
    this.#upsert(reply.note);
    return null;
  }

  /** Une seule note : si elle n'a pas été retirée, c'est un échec (déjà effacée ailleurs ?). */
  async #clearOne(note: NoteView): Promise<string | null> {
    const reply = await ask({ type: "clear", ids: [note.annotation.id], includeOpen: true });
    if (!reply.ok) return reply.error;
    if (reply.type !== "cleared") return "réponse inattendue";
    this.#remove(reply.ids);
    if (reply.ids.includes(note.annotation.id)) return null;
    return reply.error ?? "note introuvable : recharge la page";
  }

  async #clearNotes(notes: NoteView[], includeOpen: boolean): Promise<string | null> {
    const reply = await ask({ type: "clear", ids: notes.map((n) => n.annotation.id), includeOpen });
    if (!reply.ok) return reply.error;
    if (reply.type !== "cleared") return "réponse inattendue";
    // Même en erreur, les notes déjà retirées disparaissent de la page.
    this.#remove(reply.ids);
    return reply.error ? `${reply.ids.length} effacée(s), les autres restent : ${reply.error}` : null;
  }

  /** Une à une, dans l'ordre : le worker sait si chaque note est en file ou chez le programme local. */
  async #resolveAll(notes: NoteView[]): Promise<{ done: NoteView[]; error: string | null }> {
    const done: NoteView[] = [];
    for (const note of notes) {
      if (!(await this.#setResolved(note, true))) done.push(note);
    }
    const missed = notes.length - done.length;
    return { done, error: missed > 0 ? `${done.length} réglée(s), ${missed} non : réessaie dans un instant.` : null };
  }

  async #setResolved(note: NoteView, resolved: boolean): Promise<string | null> {
    const reply = await ask(
      resolved ? { type: "resolve", id: note.annotation.id, reply: "" } : { type: "reopen", id: note.annotation.id },
    );
    if (!reply.ok) return reply.error;
    if (reply.type !== "state") return "réponse inattendue";
    this.#upsert(reply.note);
    return null;
  }

  #renderPins(): void {
    this.#pins.replaceChildren(
      ...this.#notes.map((note) => {
        const { annotation } = note;
        const pin = el("button", `pin ${stateClass(note)}`, String(annotation.seq));
        pin.type = "button";
        pin.setAttribute("aria-label", `Note ${annotation.seq}, ${STATE_LABEL[stateClass(note)]} : ${annotation.comment.slice(0, 60)}`);
        const { x, y } = this.#pinPosition(annotation);
        pin.style.left = `${x}px`;
        pin.style.top = `${y}px`;
        pin.addEventListener("click", () => void this.#openCard(note));
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

  async #openCard(note: NoteView): Promise<void> {
    const { annotation, resolution } = note;
    const panel = el("div", "panel card");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", `Note ${annotation.seq}`);
    const head = el("div", "card-head panel-bar");
    const state = stateClass(note);
    head.append(el("strong", "", `Note ${annotation.seq}`), el("span", `state ${state}`, STATE_LABEL[state]));
    const comment = el("p", "card-comment", annotation.comment);
    const answer = resolution ? el("div", "card-reply") : null;
    if (answer && resolution) {
      answer.append(
        el("strong", "", resolution.author.kind === "agent" ? "Réponse de Claude" : "Réglée par toi"),
        el("p", "", resolution.reply),
      );
    }
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
    // « Modifier » : le commentaire devient un champ ; enregistré, la fiche se rouvre à jour.
    const editButton = resolution ? null : el("button", "ghost", "Modifier");
    if (editButton) {
      editButton.type = "button";
      editButton.addEventListener("click", (e) => {
        if (!e.isTrusted) return;
        const restore = () => {
          this.#cardCancel = null;
          form.replaceWith(comment);
          actions.hidden = false;
        };
        const form = commentForm(note, {
          save: (text) => this.#edit(note, text),
          done: () => {
            this.#cardCancel = null;
            const fresh = this.#notes.find((n) => n.annotation.id === annotation.id);
            if (fresh) void this.#openCard(fresh);
            else this.#closePanel();
          },
          cancel: restore,
        });
        comment.replaceWith(form);
        actions.hidden = true;
        this.#cardCancel = restore;
      });
    }
    // « Supprimer » : un second clic confirme ; Échap ou un délai annule.
    const remove = el("button", "ghost danger-text", "Supprimer");
    remove.type = "button";
    remove.addEventListener("click", async (e) => {
      if (!e.isTrusted) return;
      if (!remove.classList.contains("confirming")) {
        remove.classList.add("confirming");
        remove.textContent = "Confirmer la suppression";
        this.#cardCancel = () => {
          remove.classList.remove("confirming");
          remove.textContent = "Supprimer";
        };
        return;
      }
      this.#cardCancel = null;
      remove.disabled = true;
      const error = await this.#clearOne(note);
      if (error) {
        remove.disabled = false;
        remove.textContent = `Non supprimée : ${error}`;
      }
    });
    const toggle = el("button", "ghost", resolution ? "Rouvrir" : "Marquer réglée");
    toggle.type = "button";
    toggle.addEventListener("click", async (e) => {
      if (!e.isTrusted) return;
      const error = await this.#setResolved(note, !resolution);
      if (error) {
        toggle.textContent = `Non changé : ${error}`;
        return;
      }
      this.#closePanel();
    });
    const actions = el("div", "actions");
    actions.append(toggle, ...(editButton ? [editButton] : []), remove, close);
    head.append(el("span", "grip"));
    panel.append(head, comment, ...(answer ? [answer] : []), preview, target, actions);
    this.#openPanel(
      panel,
      () => {
        const { x, y } = this.#pinPosition(annotation);
        return { x: x - 14, y: y - 14, width: 28, height: 28 };
      },
      head,
    );
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
