// Page d'export, ouverte par le menu de l'icône. Elle lit les notes, crée le fichier
// et le propose : un téléchargement automatique, plus un lien si le premier a été annulé.

import { exportFileName } from "../../src/core/export.ts";
import { exportAll } from "./local-store.ts";
import { ask } from "./messages.ts";

const status = document.getElementById("status");
const link = document.getElementById("download") as HTMLAnchorElement | null;

async function main(): Promise<void> {
  if (!status || !link) return;
  const now = new Date();
  const file = await exportAll(now);
  const count = file.annotations.length;
  if (count === 0) {
    const state = await ask({ type: "status" });
    status.textContent =
      state.ok && state.type === "status" && state.connected
        ? "Aucune note en attente : tes notes sont déjà dans le dossier Markspot, où Claude Code les lit directement."
        : "Aucune note à exporter. Appuie sur Alt+C sur une page pour en créer une.";
    return;
  }
  const blob = new Blob([JSON.stringify(file, null, 2)], { type: "application/json" });
  link.href = URL.createObjectURL(blob);
  link.download = exportFileName(now);
  link.textContent = `Télécharger ${link.download}`;
  link.hidden = false;
  status.textContent = `${count} note${count > 1 ? "s" : ""} prête${count > 1 ? "s" : ""} (${Math.round(blob.size / 1024)} Ko).`;
  link.click();
}

main().catch((error: Error) => {
  if (status) status.textContent = `Export impossible : ${error.message}`;
});
