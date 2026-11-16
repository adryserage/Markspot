// Le découpage de la vidéo de démo : scènes, durées et textes, en anglais et en français.

import type { Lang } from "../demo-browser.ts";

export const FPS = 30;
/** Fondu entre deux scènes, en secondes. Chaque scène dure d'autant plus pour que son texte reste lisible. */
export const FADE = 0.4;

/** Scènes filmées dans le navigateur ; « resolved » demande le programme local (film.ts --native). */
export type TakeId = "hover" | "comment" | "save" | "resolved";
export type CardId = "title" | "terminal" | "local" | "end";

export type Scene =
  | { kind: "card"; card: CardId; seconds: number; caption?: string }
  | { kind: "footage"; take: TakeId; seconds: number; caption: string };

export interface Script {
  scenes: Scene[];
  tagline: string;
  /** Commentaire tapé dans la boîte, et les deux autres notes des captures de la boutique. */
  comment: string;
  otherNotes: [string, string];
  prompt: string;
  /** Réponse de Claude sur la note 1, tournée avec le programme local. */
  reply: string;
  claudeSteps: string[];
  local: [string, string];
  openSource: string;
  /** Carte provisoire de la scène 6, tant qu'elle n'est pas filmée avec le programme local. */
  pending: string;
}

export const SCRIPTS: Record<Lang, Script> = {
  en: {
    tagline: "Show Claude Code what to fix, right on the page.",
    comment: "This button runs past its card. Make it fit, like the Team button.",
    otherNotes: ["Say how many people each plan covers.", "Use the same green as the header."],
    prompt: "fix my annotations",
    reply: "Set .buy to width: 100% in plans.css. Both buttons now fit their cards.",
    claudeSteps: [
      "Reads note 1 and its two screenshots",
      "Finds the button in the source and fixes its width",
      "Checks the page, then resolves the note with a reply",
    ],
    local: ["Your notes stay on your computer.", "No account, no server."],
    openSource: "Free and open source.",
    pending: "Footage to film with the local program",
    scenes: [
      { kind: "card", card: "title", seconds: 3.5 },
      { kind: "footage", take: "hover", seconds: 5.5, caption: "Press Alt+C and click what's wrong." },
      { kind: "footage", take: "comment", seconds: 9, caption: "Write what you want. Draw on the screenshot if it helps." },
      { kind: "footage", take: "save", seconds: 5.5, caption: "Each note keeps the element, the page and two screenshots." },
      { kind: "card", card: "terminal", seconds: 7, caption: 'In Claude Code, say "fix my annotations".' },
      { kind: "footage", take: "resolved", seconds: 5.5, caption: "Claude fixes the code and answers on the page." },
      { kind: "card", card: "local", seconds: 3.5 },
      { kind: "card", card: "end", seconds: 5 },
    ],
  },
  fr: {
    tagline: "Montre à Claude Code quoi corriger, directement sur la page.",
    comment: "Ce bouton dépasse de sa carte. Fais-le tenir dedans, comme le bouton Équipe.",
    otherNotes: ["Dis combien de personnes couvre chaque forfait.", "Prends le même vert que l'en-tête."],
    prompt: "règle mes annotations",
    reply: "J'ai mis .buy à width: 100% dans plans.css. Les deux boutons tiennent dans leur carte.",
    claudeSteps: [
      "Lit la note 1 et ses deux captures",
      "Trouve le bouton dans le code et corrige sa largeur",
      "Vérifie la page, puis règle la note avec une réponse",
    ],
    local: ["Tes notes restent sur ton ordinateur.", "Ni compte, ni serveur."],
    openSource: "Gratuit et open source.",
    pending: "Images à filmer avec le programme local",
    scenes: [
      { kind: "card", card: "title", seconds: 3.5 },
      { kind: "footage", take: "hover", seconds: 5.5, caption: "Appuie sur Alt+C et clique sur ce qui cloche." },
      { kind: "footage", take: "comment", seconds: 9, caption: "Écris ce que tu veux. Dessine sur la capture si ça aide." },
      { kind: "footage", take: "save", seconds: 5.5, caption: "Chaque note garde l'élément, la page et deux captures." },
      { kind: "card", card: "terminal", seconds: 7, caption: "Dans Claude Code, dis « règle mes annotations »." },
      { kind: "footage", take: "resolved", seconds: 5.5, caption: "Claude corrige le code et répond sur la page." },
      { kind: "card", card: "local", seconds: 3.5 },
      { kind: "card", card: "end", seconds: 5 },
    ],
  },
};
