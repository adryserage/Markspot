// Page d'export, ouverte par le menu de l'icône. Elle lit les notes, crée le fichier
// et le propose : un téléchargement automatique, plus un lien si le premier a été annulé.
// Les textes fixes portent data-i18n : ils sont remplis dans la langue choisie.

import { exportFileName } from "../../src/core/export.ts";
import { setLang, t, type Key } from "../../src/core/i18n.ts";
import { langOf, readLangChoice } from "./lang.ts";
import { exportAll } from "./local-store.ts";
import { ask } from "./messages.ts";

const status = document.getElementById("status");
const link = document.getElementById("download") as HTMLAnchorElement | null;

async function translatePage(): Promise<void> {
  const lang = langOf(await readLangChoice());
  setLang(lang);
  document.documentElement.lang = lang;
  for (const node of document.querySelectorAll<HTMLElement>("[data-i18n]")) {
    node.textContent = t(node.dataset.i18n as Key);
  }
}

async function main(): Promise<void> {
  await translatePage();
  if (!status || !link) return;
  const now = new Date();
  const file = await exportAll(now);
  const count = file.annotations.length;
  if (count === 0) {
    const state = await ask({ type: "status" });
    status.textContent = t(state.ok && state.type === "status" && state.connected ? "export.alreadyThere" : "export.nothing");
    return;
  }
  const blob = new Blob([JSON.stringify(file, null, 2)], { type: "application/json" });
  link.href = URL.createObjectURL(blob);
  link.download = exportFileName(now);
  link.textContent = t("export.download", { file: link.download });
  link.hidden = false;
  status.textContent = t("export.ready", { count, size: Math.round(blob.size / 1024) });
  link.click();
}

main().catch((error: Error) => {
  if (status) status.textContent = t("common.exportFailed", { error: error.message });
});
