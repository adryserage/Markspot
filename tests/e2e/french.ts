// Les essais de bout en bout lisent l'interface en français : la langue de l'extension passe à
// « fr » le temps de l'essai, puis reprend la valeur d'avant (ou « auto » s'il n'y en avait pas).

import { connectCdp, evaluateInExtension } from "../../src/cli/cdp.ts";

/** À appeler après le rechargement de l'extension, avant d'injecter l'overlay. Rend la remise en état. */
export async function useFrench(cdpUrl: string, extensionId: string): Promise<() => Promise<void>> {
  const cdp = await connectCdp(cdpUrl);
  let before: { old: unknown } | null;
  try {
    before = (await evaluateInExtension(
      cdp,
      extensionId,
      `chrome.storage.local.get("lang").then(async (s) => { await chrome.storage.local.set({ lang: "fr" }); return { old: s.lang ?? null }; })`,
    )) as { old: unknown } | null;
  } finally {
    cdp.close();
  }
  if (!before) throw new Error("the extension service worker is not running: cannot set the language");
  const old = before.old;
  return async () => {
    const again = await connectCdp(cdpUrl);
    try {
      await evaluateInExtension(
        again,
        extensionId,
        old === null ? `chrome.storage.local.remove("lang")` : `chrome.storage.local.set({ lang: ${JSON.stringify(old)} })`,
      );
    } finally {
      again.close();
    }
  };
}
