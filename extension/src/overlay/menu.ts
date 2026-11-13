// Menu des notes, dans le coin haut droit pendant le mode annotation : la liste des notes
// de la page, un clic va à la note, « Modifier » change le commentaire d'une note ouverte,
// et « Effacer les notes réglées » retire celles que Claude a déjà réglées.

import type { PublicListener, SendTarget } from "../../../src/core/protocol.ts";
import type { NoteView } from "../messages.ts";

export interface MenuActions {
  goTo(note: NoteView): void;
  /** Rend un message d'erreur, ou null si c'est enregistré. */
  edit(note: NoteView, comment: string): Promise<string | null>;
  clearResolved(notes: NoteView[]): Promise<string | null>;
  clearAll(notes: NoteView[]): Promise<string | null>;
  /** Marque la note réglée (true) ou la rouvre (false). */
  setResolved(note: NoteView, resolved: boolean): Promise<string | null>;
  /** Règle ces notes ; rend celles qui ont été réglées et un message s'il en manque. */
  resolveAll(notes: NoteView[]): Promise<{ done: NoteView[]; error: string | null }>;
  openExport(): Promise<string | null>;
  /** « Envoyer à Claude » ; rend le message à afficher, et choose quand il faut choisir la session. */
  sendToClaude(notes: NoteView[]): Promise<{ text: string; error: boolean; choose?: boolean }>;
  /** Les sessions qui écoutent cette page, et le projet choisi pour ce site. */
  loadTargets(): Promise<{ listeners: PublicListener[]; chosen: SendTarget | null }>;
  setTarget(target: SendTarget | null): Promise<void>;
}

const UNDO_MS = 8000;

export type NoteState = "pending" | "open" | "resolved";
export const STATE_LABEL: Record<NoteState, string> = { pending: "En attente", open: "Ouverte", resolved: "Réglée" };
/** Une note réglée s'affiche réglée, même si elle attend encore le programme local. */
export const stateOf = (note: NoteView): NoteState => (note.resolution ? "resolved" : note.pending ? "pending" : "open");

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Le commentaire dans la liste : 90 caractères au plus, coupé entre deux mots, avec « … ». Entier au survol. */
function menuComment(comment: string): HTMLSpanElement {
  const flat = comment.replace(/\s+/g, " ").trim();
  // Un caractère de plus : si le 91e est une espace, le 90e mot est entier et reste.
  const words = flat.slice(0, 91).replace(/\s+\S*$/, "");
  const cut = flat.length <= 90 ? flat : `${(words || flat.slice(0, 90)).trimEnd()}…`;
  const span = el("span", "menu-comment", cut);
  span.title = flat;
  return span;
}

export class NotesMenu {
  readonly element = el("div", "menu");
  readonly #toggle = el("button", "menu-toggle");
  readonly #quick = el("div", "quick");
  readonly #quickSend = el("button", "quick-button send", "Envoyer à Claude");
  readonly #sendInPanel = el("button", "primary menu-clear", "Envoyer à Claude");
  readonly #target = el("label", "menu-target");
  readonly #targetSelect = el("select", "menu-target-select");
  /** Rangée « Envoyer à » + « Rafraîchir » : le bouton reste hors du label du choix. */
  readonly #targetRow = el("div", "menu-target-row");
  readonly #refresh = el("button", "ghost small", "Rafraîchir");
  #refreshing = false;
  #targetFocused = false;
  /** La session de chaque option, par sa position : aucune option réelle ne vaut "" comme le choix vide. */
  #targetOptions: SendTarget[] = [];
  #canSend = true;
  readonly #quickResolve = el("button", "quick-button", "Tout régler");
  readonly #quickExport = el("button", "quick-button", "Exporter");
  readonly #quickClear = el("button", "quick-button", "Effacer réglées");
  readonly #quickClearAll = el("button", "quick-button danger", "Tout effacer");
  readonly #undo = el("div", "quick-undo");
  readonly #undoText = el("span", "", "");
  readonly #undoButton = el("button", "ghost small", "Annuler");
  #undoNotes: NoteView[] = [];
  #undoTimer = 0;
  readonly #panel = el("div", "menu-panel");
  readonly #list = el("ol", "menu-list");
  readonly #clear = el("button", "ghost menu-clear", "Effacer les notes réglées");
  readonly #clearAll = el("button", "ghost menu-clear danger", "Tout effacer sur cette page");
  readonly #confirm = el("div", "menu-confirm");
  readonly #confirmText = el("p", "", "");
  readonly #no = el("button", "primary", "Non, garder");
  readonly #yes = el("button", "ghost danger", "Oui, effacer");
  readonly #message = el("p", "hint");
  /** Le programme local manque : comment l'installer. */
  readonly #install = el("div", "menu-install");
  #notes: NoteView[] = [];
  #open = false;
  #editing = false;
  readonly actions: MenuActions;

  constructor(actions: MenuActions) {
    this.actions = actions;
    this.#toggle.type = "button";
    this.#toggle.setAttribute("aria-expanded", "false");
    this.#toggle.addEventListener("click", () => this.#setOpen(!this.#open));
    this.#clear.type = "button";
    this.#clear.addEventListener("click", (e) => {
      if (e.isTrusted) void this.#clearResolved();
    });
    this.#clearAll.type = "button";
    this.#clearAll.addEventListener("click", (e) => {
      if (e.isTrusted) this.#askClearAll();
    });
    this.#no.type = "button";
    this.#yes.type = "button";
    this.#no.addEventListener("click", () => this.#cancelClearAll());
    this.#yes.addEventListener("click", (e) => {
      if (e.isTrusted) void this.#doClearAll();
    });
    // « Oui » à gauche, sous le texte : un double-clic sur « Tout effacer » ne le touche pas.
    const answers = el("div", "actions");
    answers.append(this.#yes, this.#no);
    this.#confirm.append(this.#confirmText, answers);
    this.#confirm.hidden = true;
    this.#panel.hidden = true;
    this.#install.hidden = true;
    this.#panel.append(this.#install, this.#list, this.#message, this.#targetRow, this.#sendInPanel, this.#clear, this.#clearAll, this.#confirm);

    this.#target.append(el("span", "", "Envoyer à"), this.#targetSelect);
    this.#refresh.type = "button";
    this.#refresh.title = "Relire les sessions Claude qui écoutent";
    this.#refresh.addEventListener("click", (e) => {
      if (e.isTrusted) void this.#refreshTargets(true);
    });
    this.#targetRow.append(this.#target, this.#refresh);
    this.#targetSelect.addEventListener("focus", () => (this.#targetFocused = true));
    this.#targetSelect.addEventListener("blur", () => (this.#targetFocused = false));
    this.#targetSelect.addEventListener("change", (e) => {
      if (!e.isTrusted) return;
      const value = this.#targetSelect.value;
      void this.actions.setTarget(value === "" ? null : (this.#targetOptions[Number(value)] ?? null));
    });
    for (const button of [this.#quickSend, this.#sendInPanel]) {
      button.type = "button";
      button.addEventListener("click", (e) => {
        if (e.isTrusted) void this.#send(button);
      });
    }
    for (const button of [this.#quickResolve, this.#quickExport, this.#quickClear, this.#quickClearAll, this.#undoButton]) {
      button.type = "button";
    }
    this.#quickResolve.addEventListener("click", (e) => {
      if (e.isTrusted) void this.#resolveAll();
    });
    this.#quickExport.addEventListener("click", async (e) => {
      if (!e.isTrusted) return;
      const error = await this.actions.openExport();
      if (error) this.#say(`Export impossible : ${error}`, true);
    });
    this.#quickClear.addEventListener("click", (e) => {
      if (e.isTrusted) void this.#clearResolved();
    });
    // La confirmation vit dans le panneau : le bouton express l'ouvre puis la montre.
    this.#quickClearAll.addEventListener("click", (e) => {
      if (!e.isTrusted) return;
      this.#setOpen(true);
      this.#askClearAll();
    });
    this.#undoButton.addEventListener("click", (e) => {
      if (e.isTrusted) void this.#undoResolveAll();
    });
    this.#undo.append(this.#undoText, this.#undoButton);
    this.#undo.hidden = true;
    this.#quick.append(this.#quickSend, this.#quickResolve, this.#quickExport, this.#quickClear, this.#quickClearAll);
    const top = el("div", "menu-top");
    top.append(this.#quick, this.#toggle);
    this.element.append(top, this.#undo, this.#panel);
    this.update([]);
  }

  /** Une modification, une confirmation ou la liste des sessions est en cours : Échap s'arrête là. */
  get editing(): boolean {
    return this.#editing || !this.#confirm.hidden || this.#targetFocused;
  }

  update(notes: NoteView[]): void {
    this.#notes = notes;
    this.#toggle.textContent = notes.length === 1 ? "1 note" : `${notes.length} notes`;
    this.#toggle.disabled = notes.length === 0;
    this.#clear.hidden = !notes.some((n) => stateOf(n) === "resolved");
    this.#clearAll.hidden = notes.length === 0;
    this.#quickResolve.disabled = !notes.some((n) => stateOf(n) !== "resolved");
    const openCount = notes.filter((n) => stateOf(n) !== "resolved").length;
    for (const button of [this.#quickSend, this.#sendInPanel]) {
      button.hidden = !this.#canSend;
      button.disabled = openCount === 0;
    }
    this.#targetRow.hidden = !this.#canSend;
    this.#quickClear.disabled = !notes.some((n) => stateOf(n) === "resolved");
    this.#quickClearAll.disabled = notes.length === 0;
    this.#cancelClearAll();
    if (notes.length === 0) this.#setOpen(false);
    if (this.#open && !this.#editing) this.#render();
  }

  close(): void {
    this.#editing = false;
    this.#cancelClearAll();
    this.#hideUndo();
    this.#setOpen(false);
  }

  /** Version d'essai (pas de programme local) : pas de bouton « Envoyer à Claude ». */
  /** Sans programme local, les notes restent dans le navigateur : on dit comment l'installer. */
  setHostMissing(missing: boolean): void {
    this.#install.hidden = !missing;
    if (!missing || this.#install.childElementCount > 0) return;
    const command = "npm install -g markspot && markspot install";
    const code = el("code", "", command);
    const copy = el("button", "ghost small", "Copier");
    copy.type = "button";
    copy.addEventListener("click", (e) => {
      if (!e.isTrusted) return;
      void navigator.clipboard.writeText(command).then(
        () => (copy.textContent = "Copié"),
        () => (copy.textContent = "Sélectionne la commande"),
      );
    });
    this.#install.append(
      el("strong", "", "Installer Markspot sur ce poste"),
      el("p", "", "Le programme local n'est pas installé : tes notes restent dans ce navigateur. Dans un terminal :"),
      code,
      copy,
      el("p", "", "Puis recharge la page. Claude Code pourra lire tes notes."),
    );
  }

  setCanSend(canSend: boolean): void {
    this.#canSend = canSend;
    this.update(this.#notes);
  }

  async #send(button: HTMLButtonElement): Promise<void> {
    const open = this.#notes.filter((n) => stateOf(n) !== "resolved");
    if (open.length === 0) return;
    button.disabled = true;
    const { text, error, choose } = await this.actions.sendToClaude(open);
    button.disabled = false;
    this.#say(text, error);
    if (choose) {
      await this.#refreshTargets();
      this.#targetSelect.focus();
    }
  }

  /** Remplit « Envoyer à » : les projets qui écoutent, plus le choix gardé s'il n'écoute pas. */
  async #refreshTargets(byHand = false): Promise<void> {
    if (!this.#canSend || this.#targetFocused || this.#refreshing) return;
    this.#refreshing = true;
    this.#refresh.disabled = true;
    let loaded;
    try {
      loaded = await this.actions.loadTargets();
    } finally {
      this.#refreshing = false;
      this.#refresh.disabled = false;
    }
    // Le choix a pu être ouvert pendant la lecture : ne pas le refaire sous la souris.
    if (this.#targetFocused) return;
    const { listeners, chosen } = loaded;
    // Une option par projet et par poste ; le poste ne s'affiche que si le nom existe sur deux postes.
    const groups = new Map<string, { target: SendTarget; count: number }>();
    for (const l of listeners) {
      const key = `${l.name}\n${l.host}`;
      const group = groups.get(key);
      if (group) group.count++;
      else groups.set(key, { target: { name: l.name, host: l.host }, count: 1 });
    }
    const hostsOf = (name: string) => new Set([...groups.values()].filter((g) => g.target.name === name).map((g) => g.target.host));
    const label = (t: SendTarget) => (t.host && hostsOf(t.name).size > 1 ? `${t.name} (${t.host})` : t.name);
    const options: HTMLOptionElement[] = [new Option(groups.size === 0 ? "Aucune session n'écoute" : "Choisir la session", "")];
    this.#targetOptions = [];
    let selected = "";
    for (const { target, count } of groups.values()) {
      if (!target.name) {
        // Écoute d'une ancienne version, sans nom : on ne peut pas la viser.
        const old = new Option("(session sans nom : mets markspot à jour)", "");
        old.disabled = true;
        options.push(old);
        continue;
      }
      const value = String(this.#targetOptions.push(target) - 1);
      options.push(new Option(count > 1 ? `${label(target)} (${count} sessions)` : label(target), value));
      if (chosen && chosen.name === target.name && (chosen.host ? chosen.host === target.host : hostsOf(target.name).size === 1)) {
        selected = value;
      }
    }
    const projects = this.#targetOptions.length;
    if (chosen && !listeners.some((l) => l.name === chosen.name && (!chosen.host || l.host === chosen.host))) {
      const value = String(this.#targetOptions.push(chosen) - 1);
      options.push(new Option(`${chosen.host ? `${chosen.name} (${chosen.host})` : chosen.name} (n'écoute pas)`, value));
      selected = value;
    }
    if (!chosen && projects === 1) selected = "0";
    this.#targetSelect.replaceChildren(...options);
    this.#targetSelect.value = selected;
    if (byHand) {
      this.#say(
        groups.size === 0
          ? "Aucune session n'écoute : lance « markspot claude », ou dis « écoute mes annotations » à la session."
          : `${projects} session${projects > 1 ? "s" : ""} à l'écoute.`,
        false,
      );
    }
  }

  #say(text: string, error: boolean): void {
    // Ouvrir d'abord : l'ouverture redessine la liste et vide le message.
    if (text) this.#setOpen(true);
    this.#message.textContent = text;
    this.#message.classList.toggle("error", error);
  }

  async #resolveAll(): Promise<void> {
    const open = this.#notes.filter((n) => stateOf(n) !== "resolved");
    if (open.length === 0) return;
    this.#quickResolve.disabled = true;
    const { done, error } = await this.actions.resolveAll(open);
    this.#quickResolve.disabled = false;
    if (error) this.#say(error, true);
    if (done.length === 0) return;
    // L'annulation vit ici, hors de update() : les notes poussées pendant la boucle ne l'effacent pas.
    this.#undoNotes = done;
    this.#undoText.textContent = done.length === 1 ? "1 note réglée." : `${done.length} notes réglées.`;
    this.#undo.hidden = false;
    clearTimeout(this.#undoTimer);
    this.#undoTimer = setTimeout(() => this.#hideUndo(), UNDO_MS) as unknown as number;
  }

  async #undoResolveAll(): Promise<void> {
    const notes = this.#undoNotes;
    this.#hideUndo();
    let failed = 0;
    for (const note of notes) if (await this.actions.setResolved(note, false)) failed++;
    if (failed > 0) this.#say(`${failed} note(s) non rouverte(s) : Claude y a peut-être répondu entre-temps.`, true);
  }

  #hideUndo(): void {
    clearTimeout(this.#undoTimer);
    this.#undoNotes = [];
    this.#undo.hidden = true;
  }

  /** Un message du service worker (par exemple une résolution refusée par le programme local). */
  notify(text: string): void {
    this.#say(text, true);
  }

  cancelEdit(): void {
    this.#editing = false;
    this.#cancelClearAll();
    this.#render();
  }

  #askClearAll(): void {
    const n = this.#notes.length;
    this.#confirmText.textContent =
      n === 1
        ? "Effacer la note de cette page ? Elle disparaît pour de bon."
        : `Effacer les ${n} notes de cette page ? Elles disparaissent pour de bon, même celles qui ne sont pas réglées.`;
    this.#clearAll.hidden = true;
    this.#confirm.hidden = false;
    this.#no.focus();
  }

  #cancelClearAll(): void {
    this.#confirm.hidden = true;
    this.#clearAll.hidden = this.#notes.length === 0;
  }

  async #doClearAll(): Promise<void> {
    this.#yes.disabled = true;
    const error = await this.actions.clearAll(this.#notes);
    this.#yes.disabled = false;
    this.#cancelClearAll();
    this.#message.textContent = error ? `Non effacé : ${error}` : "";
    this.#message.classList.toggle("error", Boolean(error));
  }

  #setOpen(open: boolean): void {
    const opening = open && !this.#open;
    this.#open = open;
    this.#toggle.setAttribute("aria-expanded", String(open));
    this.#panel.hidden = !open;
    if (open) this.#render();
    if (opening) void this.#refreshTargets();
  }

  #render(): void {
    this.#message.textContent = "";
    this.#list.replaceChildren(...this.#notes.map((note) => this.#item(note)));
  }

  #item(note: NoteView): HTMLLIElement {
    const state = stateOf(note);
    const item = el("li", "menu-item");
    const go = el("button", "menu-go");
    go.type = "button";
    go.setAttribute("aria-label", `Aller à la note ${note.annotation.seq}`);
    go.append(
      el("span", `menu-seq ${state}`, String(note.annotation.seq)),
      menuComment(note.annotation.comment),
    );
    go.addEventListener("click", () => this.actions.goTo(note));
    const side = el("div", "menu-side");
    side.append(el("span", `state ${state}`, STATE_LABEL[state]));
    const toggle = el("button", "ghost small", state === "resolved" ? "Rouvrir" : "Marquer réglée");
    toggle.type = "button";
    toggle.addEventListener("click", async (e) => {
      if (!e.isTrusted) return;
      toggle.disabled = true;
      const error = await this.actions.setResolved(note, state !== "resolved");
      toggle.disabled = false;
      this.#message.textContent = error ? `Non changé : ${error}` : "";
      this.#message.classList.toggle("error", Boolean(error));
    });
    side.append(toggle);
    if (state !== "resolved") {
      const edit = el("button", "ghost small", "Modifier");
      edit.type = "button";
      edit.addEventListener("click", () => this.#startEdit(item, note));
      side.append(edit);
    }
    item.append(go, side);
    return item;
  }

  #startEdit(item: HTMLLIElement, note: NoteView): void {
    this.#editing = true;
    const form = el("form", "menu-edit");
    const field = el("textarea", "comment");
    field.value = note.annotation.comment;
    field.rows = 3;
    field.maxLength = 4000;
    field.setAttribute("aria-label", `Commentaire de la note ${note.annotation.seq}`);
    const message = el("p", "hint");
    const actions = el("div", "actions");
    const cancel = el("button", "ghost", "Annuler");
    cancel.type = "button";
    const save = el("button", "primary", "Enregistrer");
    save.type = "submit";
    actions.append(cancel, save);
    form.append(field, message, actions);
    item.replaceChildren(form);
    field.focus();

    cancel.addEventListener("click", () => this.cancelEdit());
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const comment = field.value.trim();
      if (!comment) return field.focus();
      save.disabled = true;
      const error = await this.actions.edit(note, comment);
      save.disabled = false;
      if (error) {
        message.textContent = `Non enregistré : ${error}`;
        message.classList.add("error");
        return;
      }
      this.cancelEdit();
    });
  }

  async #clearResolved(): Promise<void> {
    const resolved = this.#notes.filter((n) => stateOf(n) === "resolved");
    if (resolved.length === 0) return;
    this.#clear.disabled = true;
    const error = await this.actions.clearResolved(resolved);
    this.#clear.disabled = false;
    this.#message.textContent = error ? `Non effacé : ${error}` : "";
    this.#message.classList.toggle("error", Boolean(error));
  }
}
