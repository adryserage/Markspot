// Textes de l'interface, en anglais (la source) et en français. Pur : aucune API de Chrome.
// Une entrée est une chaîne, ou une paire one/other choisie par Intl.PluralRules selon {count}.
// Les variables s'écrivent {nom}. La langue courante vit dans ce module : setLang la change.

export type Entry = string | { readonly one: string; readonly other: string };
export type Lang = "en" | "fr";
export type LangChoice = "auto" | Lang;

export const en = {
  // États d'une note
  "state.pending": "Pending",
  "state.open": "Open",
  "state.resolved": "Resolved",

  // Boutons communs
  "common.cancel": "Cancel",
  "common.save": "Save",
  "common.close": "Close",
  "common.edit": "Edit",
  "common.delete": "Delete",
  "common.reopen": "Reopen",
  "common.markResolved": "Mark resolved",
  "common.no": "No",
  "common.unexpected": "unexpected reply",
  "common.notSaved": "Not saved: {error}",
  "common.notCleared": "Not cleared: {error}",
  "common.notChanged": "Not changed: {error}",
  "common.notDeleted": "Not deleted: {error}",
  "common.exportFailed": "Export failed: {error}",

  // Menu des notes
  "menu.commentLabel": "Comment for note {seq}",
  "menu.count": { one: "{count} note", other: "{count} notes" },
  "menu.sendToClaude": "Send to Claude",
  "menu.refresh": "Refresh",
  "menu.refreshTitle": "Reload the Claude sessions that are listening",
  "menu.sendTo": "Send to",
  "menu.resolveAll": "Resolve all",
  "menu.export": "Export",
  "menu.clearResolvedShort": "Clear resolved",
  "menu.clearAllShort": "Clear all",
  "menu.undo": "Undo",
  "menu.clearResolved": "Clear resolved notes",
  "menu.clearAll": "Clear all on this page",
  "menu.keep": "No, keep them",
  "menu.yesClear": "Yes, clear",
  "menu.copy": "Copy",
  "menu.copied": "Copied",
  "menu.selectCommand": "Select the command",
  "menu.installTitle": "Install Markspot on this computer",
  "menu.installText": "The local program is not installed: your notes stay in this browser. In a terminal:",
  "menu.installAfter": "Then reload the page. Claude Code will be able to read your notes.",
  "menu.noListener": "No session is listening",
  "menu.chooseSession": "Choose a session",
  "menu.unnamedSession": "(unnamed session: update markspot)",
  "menu.sessionCount": "{label} ({count} sessions)",
  "menu.notListening": "{label} (not listening)",
  "menu.noListenerHelp": "No session is listening: run “markspot claude”, or tell the session “listen to my annotations”.",
  "menu.listening": { one: "{count} session listening.", other: "{count} sessions listening." },
  "menu.resolvedUndo": { one: "{count} note resolved.", other: "{count} notes resolved." },
  "menu.notReopened": {
    one: "{count} note not reopened: Claude may have replied in the meantime.",
    other: "{count} notes not reopened: Claude may have replied in the meantime.",
  },
  "menu.confirmClearAll": {
    one: "Clear the note on this page? It is gone for good.",
    other: "Clear the {count} notes on this page? They are gone for good, even the ones not resolved.",
  },
  "menu.goTo": "Go to note {seq}",
  "menu.confirmDelete": "Delete note {seq}?",
  "menu.yesDelete": "Yes, delete",

  // Overlay et fiche d'une note
  "overlay.notSent": "Not sent: {error}",
  "overlay.chooseSession": "Several sessions are listening: pick one in “Send to”, then send again.",
  "overlay.sent": { one: "{count} note sent to {to}.", other: "{count} notes sent to {to}." },
  "overlay.sentNotListening": {
    one: "{count} note sent to {to}, which is not listening right now: the session will pick it up as soon as it listens.",
    other: "{count} notes sent to {to}, which is not listening right now: the session will pick them up as soon as it listens.",
  },
  "overlay.pickHint": "Click an element or draw an area.",
  "overlay.captureFailed": "Capture failed: {error}",
  "overlay.newNote": "New note",
  "overlay.placeholder": "What's wrong here?",
  "overlay.comment": "Comment",
  "overlay.enterHint": "Enter saves, Shift+Enter adds a line.",
  "overlay.saveNote": "Save note",
  "overlay.noteNotSaved": "Note not saved: {error}",
  "overlay.noteSaved": "Note {seq} saved. Click elsewhere to add another.",
  "overlay.movePanel": "Move the panel: drag it, or use the arrow keys. Double-click to put it back.",
  "overlay.escKey": "Esc",
  "overlay.toExit": " to exit",
  "overlay.element": "{tag} “{text}”",
  "overlay.noteNotFound": "note not found: reload the page",
  "overlay.partlyCleared": "{count} cleared, the others remain: {error}",
  "overlay.partlyResolved": "{done} resolved, {missed} not: try again in a moment.",
  "overlay.pinLabel": "Note {seq}, {state}: {comment}",
  "overlay.note": "Note {seq}",
  "overlay.claudeReply": "Claude's reply",
  "overlay.resolvedByYou": "Resolved by you",
  "overlay.confirmDelete": "Confirm delete",

  // Dessin
  "draw.arrow": "Arrow",
  "draw.rect": "Rectangle",
  "draw.pen": "Pen",
  "draw.red": "Red",
  "draw.yellow": "Yellow",
  "draw.canvas": "Capture of the area, draw on it with the mouse",
  "draw.tools": "Drawing tools",
  "draw.undo": "Undo stroke",

  // Service worker : erreurs et messages rendus à la page
  "worker.noTab": "No tab to capture.",
  "worker.arrivedOpen": "Note {seq} arrived open: the local program did not take your resolution. Update markspot, then resolve it again.",
  "worker.noAnswer": "the local program did not answer",
  "worker.noteNotFound": "note not found",
  "worker.reopenFirst": "note resolved: reopen it first",
  "worker.alreadyResolved": "note already resolved",
  "worker.refused": "refused by the local program",
  "worker.unknownPage": "unknown page",
  "worker.resolvedByHand": "Resolved by hand.",
  "worker.alreadyOpen": "note already open",
  "worker.claudeReplied": "Claude just replied: read the note again",
  "worker.trialNoHost": "the trial version has no local program",
  "worker.noOpenNote": "no open note received by the local program",
  "worker.nobodyListens": "no session is listening: say “listen to my annotations” in the project's session, then send again",
  "worker.noDispatchKey": "the local program has no send key: run markspot install again on this computer",
  "worker.refusedUpdate": "refused by the local program (update it?)",
  "worker.cannotAnnotate": "Markspot can't annotate this page.",
  "worker.actionTitle": "Markspot: annotate this page (Alt+C)",
  "worker.exportMenu": "Export notes",
  "worker.langMenu": "Language",
  "worker.langAuto": "Auto (browser language)",
  "worker.langEn": "English",
  "worker.langFr": "Français",

  // Page d'export
  "export.pageTitle": "Export Markspot notes",
  "export.heading": "Export notes",
  "export.reading": "Reading notes…",
  "export.downloadFile": "Download the file",
  "export.download": "Download {file}",
  "export.hint": "Save the file where Claude Code can read it, for example in the project folder. It holds the screenshots of your notes: do not share it without looking at them.",
  "export.alreadyThere": "No notes waiting: your notes are already in the Markspot folder, where Claude Code reads them directly.",
  "export.nothing": "No notes to export. Press Alt+C on a page to create one.",
  "export.ready": { one: "{count} note ready ({size} KB).", other: "{count} notes ready ({size} KB)." },
} as const;

export type Key = keyof typeof en;

export const fr = {
  "state.pending": "En attente",
  "state.open": "Ouverte",
  "state.resolved": "Réglée",

  "common.cancel": "Annuler",
  "common.save": "Enregistrer",
  "common.close": "Fermer",
  "common.edit": "Modifier",
  "common.delete": "Supprimer",
  "common.reopen": "Rouvrir",
  "common.markResolved": "Marquer réglée",
  "common.no": "Non",
  "common.unexpected": "réponse inattendue",
  "common.notSaved": "Non enregistré : {error}",
  "common.notCleared": "Non effacé : {error}",
  "common.notChanged": "Non changé : {error}",
  "common.notDeleted": "Non supprimée : {error}",
  "common.exportFailed": "Export impossible : {error}",

  "menu.commentLabel": "Commentaire de la note {seq}",
  "menu.count": { one: "{count} note", other: "{count} notes" },
  "menu.sendToClaude": "Envoyer à Claude",
  "menu.refresh": "Rafraîchir",
  "menu.refreshTitle": "Relire les sessions Claude qui écoutent",
  "menu.sendTo": "Envoyer à",
  "menu.resolveAll": "Tout régler",
  "menu.export": "Exporter",
  "menu.clearResolvedShort": "Effacer réglées",
  "menu.clearAllShort": "Tout effacer",
  "menu.undo": "Annuler",
  "menu.clearResolved": "Effacer les notes réglées",
  "menu.clearAll": "Tout effacer sur cette page",
  "menu.keep": "Non, garder",
  "menu.yesClear": "Oui, effacer",
  "menu.copy": "Copier",
  "menu.copied": "Copié",
  "menu.selectCommand": "Sélectionne la commande",
  "menu.installTitle": "Installer Markspot sur ce poste",
  "menu.installText": "Le programme local n'est pas installé : tes notes restent dans ce navigateur. Dans un terminal :",
  "menu.installAfter": "Puis recharge la page. Claude Code pourra lire tes notes.",
  "menu.noListener": "Aucune session n'écoute",
  "menu.chooseSession": "Choisir la session",
  "menu.unnamedSession": "(session sans nom : mets markspot à jour)",
  "menu.sessionCount": "{label} ({count} sessions)",
  "menu.notListening": "{label} (n'écoute pas)",
  "menu.noListenerHelp": "Aucune session n'écoute : lance « markspot claude », ou dis « écoute mes annotations » à la session.",
  "menu.listening": { one: "{count} session à l'écoute.", other: "{count} sessions à l'écoute." },
  "menu.resolvedUndo": { one: "{count} note réglée.", other: "{count} notes réglées." },
  "menu.notReopened": {
    one: "{count} note(s) non rouverte(s) : Claude y a peut-être répondu entre-temps.",
    other: "{count} note(s) non rouverte(s) : Claude y a peut-être répondu entre-temps.",
  },
  "menu.confirmClearAll": {
    one: "Effacer la note de cette page ? Elle disparaît pour de bon.",
    other: "Effacer les {count} notes de cette page ? Elles disparaissent pour de bon, même celles qui ne sont pas réglées.",
  },
  "menu.goTo": "Aller à la note {seq}",
  "menu.confirmDelete": "Supprimer la note {seq} ?",
  "menu.yesDelete": "Oui, supprimer",

  "overlay.notSent": "Non envoyé : {error}",
  "overlay.chooseSession": "Plusieurs sessions écoutent : choisis-en une dans « Envoyer à », puis renvoie.",
  "overlay.sent": { one: "{count} note envoyée à {to}.", other: "{count} notes envoyées à {to}." },
  "overlay.sentNotListening": {
    one: "{count} note envoyée à {to}, qui n'écoute pas en ce moment : la session les prendra dès qu'elle écoutera.",
    other: "{count} notes envoyées à {to}, qui n'écoute pas en ce moment : la session les prendra dès qu'elle écoutera.",
  },
  "overlay.pickHint": "Clique sur un élément ou trace une zone.",
  "overlay.captureFailed": "Capture impossible : {error}",
  "overlay.newNote": "Nouvelle note",
  "overlay.placeholder": "Qu'est-ce qui ne va pas ici ?",
  "overlay.comment": "Commentaire",
  "overlay.enterHint": "Entrée enregistre, Maj+Entrée va à la ligne.",
  "overlay.saveNote": "Enregistrer la note",
  "overlay.noteNotSaved": "Note non enregistrée : {error}",
  "overlay.noteSaved": "Note {seq} enregistrée. Clique ailleurs pour en ajouter une.",
  "overlay.movePanel": "Déplacer le panneau : glisser, ou flèches du clavier. Double-clic pour le remettre en place.",
  "overlay.escKey": "Échap",
  "overlay.toExit": " pour sortir",
  "overlay.element": "{tag} « {text} »",
  "overlay.noteNotFound": "note introuvable : recharge la page",
  "overlay.partlyCleared": "{count} effacée(s), les autres restent : {error}",
  "overlay.partlyResolved": "{done} réglée(s), {missed} non : réessaie dans un instant.",
  "overlay.pinLabel": "Note {seq}, {state} : {comment}",
  "overlay.note": "Note {seq}",
  "overlay.claudeReply": "Réponse de Claude",
  "overlay.resolvedByYou": "Réglée par toi",
  "overlay.confirmDelete": "Confirmer la suppression",

  "draw.arrow": "Flèche",
  "draw.rect": "Rectangle",
  "draw.pen": "Stylo",
  "draw.red": "Rouge",
  "draw.yellow": "Jaune",
  "draw.canvas": "Capture de la zone, dessine dessus avec la souris",
  "draw.tools": "Outils de dessin",
  "draw.undo": "Annuler le trait",

  "worker.noTab": "Aucun onglet à capturer.",
  "worker.arrivedOpen": "La note {seq} est arrivée ouverte : le programme local n'a pas pris ta résolution. Mets markspot à jour, puis règle-la à nouveau.",
  "worker.noAnswer": "le programme local n'a pas répondu",
  "worker.noteNotFound": "note introuvable",
  "worker.reopenFirst": "note réglée : rouvre-la d'abord",
  "worker.alreadyResolved": "note déjà réglée",
  "worker.refused": "refusé par le programme local",
  "worker.unknownPage": "page inconnue",
  "worker.resolvedByHand": "Réglée à la main.",
  "worker.alreadyOpen": "note déjà ouverte",
  "worker.claudeReplied": "Claude vient de répondre : relis la note",
  "worker.trialNoHost": "la version d'essai n'a pas de programme local",
  "worker.noOpenNote": "aucune note ouverte reçue par le programme local",
  "worker.nobodyListens": "aucune session n'écoute : dis « écoute mes annotations » dans la session du projet, puis renvoie",
  "worker.noDispatchKey": "le programme local n'a pas de clé d'envoi : relance markspot install sur ce poste",
  "worker.refusedUpdate": "refusé par le programme local (mets-le à jour ?)",
  "worker.cannotAnnotate": "Markspot ne peut pas annoter cette page.",
  "worker.actionTitle": "Markspot : annoter cette page (Alt+C)",
  "worker.exportMenu": "Exporter les notes",
  "worker.langMenu": "Langue",
  "worker.langAuto": "Auto (langue du navigateur)",
  "worker.langEn": "English",
  "worker.langFr": "Français",

  "export.pageTitle": "Exporter les notes Markspot",
  "export.heading": "Exporter les notes",
  "export.reading": "Lecture des notes…",
  "export.downloadFile": "Télécharger le fichier",
  "export.download": "Télécharger {file}",
  "export.hint": "Enregistre le fichier là où Claude Code peut le lire, par exemple dans le dossier du projet. Il contient les captures d'écran de tes notes : ne le partage pas sans les regarder.",
  "export.alreadyThere": "Aucune note en attente : tes notes sont déjà dans le dossier Markspot, où Claude Code les lit directement.",
  "export.nothing": "Aucune note à exporter. Appuie sur Alt+C sur une page pour en créer une.",
  "export.ready": { one: "{count} note prête ({size} Ko).", other: "{count} notes prêtes ({size} Ko)." },
} satisfies Record<Key, Entry>;

const tables: Record<Lang, Record<Key, Entry>> = { en, fr };

/** « auto » suit la langue du navigateur : le français pour fr, fr-CA…, l'anglais sinon. */
export function resolveLang(choice: LangChoice, uiLanguage: string): Lang {
  if (choice !== "auto") return choice;
  return uiLanguage.toLowerCase().startsWith("fr") ? "fr" : "en";
}

/** Une valeur lue du stockage : tout ce qui n'est pas en ou fr vaut auto. */
export function parseLangChoice(value: unknown): LangChoice {
  return value === "en" || value === "fr" ? value : "auto";
}

let lang: Lang = "en";

export function setLang(next: Lang): void {
  lang = next;
}

export function currentLang(): Lang {
  return lang;
}

export type Params = Record<string, string | number>;

/** Le texte de key dans la langue courante, variables remplacées. Une variable absente reste {nom}. */
export function t(key: Key, params: Params = {}): string {
  const entry = tables[lang][key];
  const text = typeof entry === "string" ? entry : new Intl.PluralRules(lang).select(Number(params.count ?? 0)) === "one" ? entry.one : entry.other;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole));
}
