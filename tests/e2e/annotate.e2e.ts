// Essai de bout en bout de l'annotation, sur le Chrome dédié (CDP 127.0.0.1:9223).
// Lancer : node tests/e2e/annotate.e2e.ts   (après npm run build)
// Ouvre la page d'essai dans une fenêtre neuve, active le mode par l'action de l'extension
// (même effet qu'Alt+C, avec activeTab), marque le bouton, écrit une note, puis vérifie le stockage.

import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { chromium, type Page } from "playwright-core";
import { connectCdp, evaluateInExtension } from "../../src/cli/cdp.ts";
import { loadConfig, openAgentStore } from "../../src/store/store.ts";
import { serveFixtures } from "../fixtures/serve.ts";

const CDP_URL = process.env.MARKSPOT_CDP ?? "http://127.0.0.1:9223";
const EXTENSION_ID = "alimncmfokmnolijpmaikdbjhgbcblle";
const FIXTURE_TITLE = "Page d'essai Markspot";
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

  // Une 2e note sur un élément sans classe ni id : sélecteur court, pas de chemin depuis html.
  const second = await page.getByText("52 projets").boundingBox();
  assert.ok(second, "fixture list item not visible");
  await cdp.send("Extensions.triggerAction", { id: EXTENSION_ID, targetId: tab.targetId });
  await page.waitForTimeout(500);
  await page.mouse.click(second.x + 5, second.y + second.height / 2);
  await page.waitForTimeout(800);
  await page.keyboard.type("Deuxième élément de la liste.");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(400);

  // Échap pendant la capture d'une 3e note : aucun brouillon ne doit rester.
  await page.mouse.click(second.x + 5, second.y + second.height / 2 + 30);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(800);

  // Après Échap, plus rien de Markspot ne couvre la page : le coin du bouton rend le bouton.
  const atPin = await page.evaluate(([x, y]) => document.elementFromPoint(x!, y!)?.localName, [box.x + 2, box.y + 2]);
  assert.equal(atPin, "button", "a pin is still covering the page after Escape");
  const direct = await connectCdp(CDP_URL);
  try {
    // Les notes partent à l'hôte natif : on les lit dans ses fichiers, comme le fera Claude.
    const agentStore = await openAgentStore(await loadConfig());
    const stored = (await agentStore.list({ urlPrefix: url })).map((t) => t.annotation);
    const note = stored.find((n) => n.comment.startsWith("Le bouton"));
    assert.ok(note, "no annotation written by the native host for the fixture page");
    const listNote = stored.find((n) => n.comment.startsWith("Deuxième"));
    assert.ok(listNote, "the list item note was not saved");
    assert.doesNotMatch(listNote.mark.anchor.selector, /^html/, "selector fell back to the full path");
    assert.match(listNote.mark.anchor.selector, /li:nth-of-type\(2\)$/);
    assert.equal(stored.length, 2, "Escape during capture must not save a note");
    const leftovers = (await evaluateInExtension(direct, EXTENSION_ID, `chrome.storage.local.getKeys().then((k) => k.filter((x) => x.startsWith("draft:") || x.startsWith("ann:") || x.startsWith("res:")).length)`)) as number;
    assert.equal(leftovers, 0, "a draft or a queued note was left in the browser");
    assert.equal(note.comment, "Le bouton déborde de sa carte sur cette largeur.");
    assert.equal(note.mark.anchor.selector, "#acheter");
    assert.equal(note.mark.anchor.text, "Acheter");
    assert.equal(note.mark.anchor.styles.width, "340px");
    assert.deepEqual(note.mark.anchor.sourceHint, {
      framework: "vue",
      component: "OffreBase",
      file: "/src/components/OffreBase.vue",
      line: null,
      column: null,
    }, "the source hint is read in the page and cleaned");
    assert.ok((await agentStore.capture(note.id, "zone"))?.length, "zone capture missing on disk");
    console.log(`ok: note ${note.seq} written by the host, selector ${note.mark.anchor.selector}`);

    // Claude règle la note : la pastille passe à « réglée » et la fiche montre la réponse.
    await cdp.send("Extensions.triggerAction", { id: EXTENSION_ID, targetId: tab.targetId });
    await page.waitForTimeout(500);
    const outcome = await agentStore.resolve(note.id, "Largeur du bouton ramenée à 100 % de la carte.", {
      kind: "agent",
      id: "claude-code",
      name: "Claude",
    });
    assert.equal(outcome.kind, "resolved");
    await page.waitForTimeout(1500);
    const resolvedInWorker = (await evaluateInExtension(
      direct,
      EXTENSION_ID,
      `globalThis.markspot.threads().filter((t) => t.annotation.id === ${JSON.stringify(note.id)} && t.resolution).length`,
    )) as number;
    assert.equal(resolvedInWorker, 1, "the extension did not receive the resolution");
    await page.mouse.click(box.x, box.y);
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(ARTIFACTS, "5-reglee.png") });
    await page.keyboard.press("Escape");
    console.log("ok: resolution pushed to the page");

    // La page d'export s'ouvre et compte les notes ; téléchargements refusés pendant l'essai.
    await cdp.send("Browser.setDownloadBehavior", { behavior: "deny" });
    try {
      const exportPage = await context.newPage();
      await exportPage.goto(`chrome-extension://${EXTENSION_ID}/dist/export.html`);
      await exportPage.waitForFunction(() => !document.getElementById("status")?.textContent?.startsWith("Lecture"));
      const status = await exportPage.locator("#status").textContent();
      assert.match(status ?? "", /déjà dans le dossier Markspot/);
      await exportPage.screenshot({ path: join(ARTIFACTS, "6-export.png") });
      await exportPage.close();
      console.log(`ok: export page says "${status}"`);
    } finally {
      await cdp.send("Browser.setDownloadBehavior", { behavior: "default" });
    }
  } finally {
    direct.close();
  }
} finally {
  // Retire toutes les notes de la page d'essai, dans les fichiers de l'hôte et dans la file
  // du navigateur (reconnues par leur titre), même après un échec.
  await (await openAgentStore(await loadConfig())).clear({ state: "all", urlPrefix: url });
  const cleanup = await connectCdp(CDP_URL);
  try {
    await evaluateInExtension(
      cleanup,
      EXTENSION_ID,
      `chrome.storage.local.get(null).then((all) => chrome.storage.local.remove(
        Object.entries(all)
          .filter(([k, a]) => k.startsWith("ann:") && a.page.title === ${JSON.stringify(FIXTURE_TITLE)})
          .flatMap(([, a]) => ["ann:" + a.id, "png:" + a.id + ":zone", "png:" + a.id + ":context"])))`,
    );
  } finally {
    cleanup.close();
  }
  await page?.close();
  await browser.close();
  server.close();
}
