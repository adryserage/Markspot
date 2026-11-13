// Langue choisie dans le menu de l'icône, gardée dans chrome.storage.local (clé « lang »).
// « auto » suit la langue de l'interface du navigateur.

import { parseLangChoice, resolveLang, type Lang, type LangChoice } from "../../src/core/i18n.ts";

export const LANG_KEY = "lang";

export async function readLangChoice(): Promise<LangChoice> {
  const stored = await chrome.storage.local.get(LANG_KEY).catch(() => ({}) as Record<string, unknown>);
  return parseLangChoice(stored[LANG_KEY]);
}

export const langOf = (choice: LangChoice): Lang => resolveLang(choice, chrome.i18n.getUILanguage());
