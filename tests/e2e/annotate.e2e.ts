// Essai de bout en bout de l'annotation, sur le Chrome dédié (CDP 127.0.0.1:9223).
// Lancer : node tests/e2e/annotate.e2e.ts   (après npm run build)
// Ouvre la page d'essai dans une fenêtre neuve, active le mode par l'action de l'extension
// (même effet qu'Alt+C, avec activeTab), marque le bouton, écrit une note, puis vérifie le stockage.

import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { chromium, type Page } from "playwright-core";
import { connectCdp, evaluateInExtension } from "../../src/cli/cdp.ts";
import { serveFixtures } from "../fixtures/serve.ts";

const CDP_URL = process.env.MARKSPOT_CDP ?? "http://127.0.0.1:9223";
const EXTENSION_ID = "alimncmfokmnolijpmaikdbjhgbcblle";
const ARTIFACTS = resolve(process.env.MARKSPOT_ARTIFACTS ?? "tests/e2e/artifacts");

const { url, server } = await serveFixtures();
const browser = await chromium.connectOverCDP(CDP_URL);
const cdp = await browser.newBrowserCDPSession();
const context = browser.contexts()[0];
assert.ok(context, "no browser context");


let page: Page | undefined;
try {
  await cdp.send("Extensions.loadUnpacked", { path: resolve("extension") });
  // Le rechargement redémarre le service worker : attendre qu'il réponde avant d'activer le mode.
  const ready = await connectCdp(CDP_URL);
  try {
    for (let i = 0; i < 20; i++) {
      const status = await evaluateInExtension(ready, EXTENSION_ID, "globalThis.markspot?.status()").catch(() => null);
      if (status) break;
      await new Promise((r) => setTimeout(r, 250));
    }
  } finally {
    ready.close();
  }
  const opened = context.waitForEvent("page", (p) => p.url().startsWith(url));
  await cdp.send("Target.createTarget", { url, newWindow: true });
  page = await opened;
  await page.waitForLoadState("domcontentloaded");
  await page.bringToFront();

  // triggerAction veut la cible « tab » qui porte la page, pas la cible « page ».
  const { targetInfos } = (await cdp.send("Target.getTargets", { filter: [{ type: "tab" }] })) as {
    targetInfos: { targetId: string; url: string }[];
  };
  const tab = targetInfos.find((t) => t.url.startsWith(url));
  assert.ok(tab, "no tab target for the fixture page");
  await cdp.send("Extensions.triggerAction", { id: EXTENSION_ID, targetId: tab.targetId });
  await page.waitForFunction(() => document.querySelector("markspot-overlay") !== null);
  await page.waitForTimeout(500);

  const button = page.locator("#acheter");
  const box = await button.boundingBox();
  assert.ok(box, "fixture button not visible");
  await page.mouse.move(box.x + 20, box.y + box.height / 2);
  await page.waitForTimeout(150);
  await mkdir(ARTIFACTS, { recursive: true });
  await page.screenshot({ path: join(ARTIFACTS, "1-survol.png") });

  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(ARTIFACTS, "2-boite.png") });

  await page.keyboard.type("Le bouton déborde de sa carte sur cette largeur.");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(ARTIFACTS, "3-pastille.png") });

  // La pastille est au coin haut-gauche du bouton : un clic ouvre la note.
  await page.mouse.click(box.x, box.y);
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(ARTIFACTS, "4-note.png") });
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  const direct = await connectCdp(CDP_URL);
  try {
    const stored = (await evaluateInExtension(
      direct,
      EXTENSION_ID,
      `chrome.storage.local.get(null).then((all) => Object.entries(all)
        .filter(([k]) => k.startsWith("ann:"))
        .map(([, a]) => a)
        .filter((a) => a.page.url.startsWith(${JSON.stringify(url)})))`,
    )) as Array<{ seq: number; comment: string; mark: { anchor: { selector: string; text: string; styles: Record<string, string> } } }>;
    const note = stored.at(-1);
    assert.ok(note, "no annotation stored for the fixture page");
    assert.equal(note.comment, "Le bouton déborde de sa carte sur cette largeur.");
    assert.equal(note.mark.anchor.selector, "#acheter");
    assert.equal(note.mark.anchor.text, "Acheter");
    assert.equal(note.mark.anchor.styles.width, "340px");
    console.log(`ok: note ${note.seq} stored, selector ${note.mark.anchor.selector}; screenshots in ${ARTIFACTS}`);
    // Retire les notes de la page d'essai, pour ne pas les retrouver au prochain passage.
    await evaluateInExtension(
      direct,
      EXTENSION_ID,
      `chrome.storage.local.get(null).then((all) => chrome.storage.local.remove(
        Object.entries(all)
          .filter(([k, a]) => k.startsWith("ann:") && a.page.url.startsWith(${JSON.stringify(url)}))
          .flatMap(([, a]) => ["ann:" + a.id, "png:" + a.id + ":zone", "png:" + a.id + ":context"])))`,
    );
  } finally {
    direct.close();
  }
} finally {
  await page?.close();
  await browser.close();
  server.close();
}
