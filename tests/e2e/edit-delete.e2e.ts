// Essai sur le Chrome dédié (CDP 127.0.0.1:9223) : modifier une note depuis sa fiche, la supprimer
// depuis la fiche, et en supprimer une autre depuis le menu des notes. L'overlay est dans une
// racine shadow fermée : CDP la traverse (pierce) et on clique aux coordonnées, comme une personne.
// Lancer : npm run build && node tests/e2e/edit-delete.e2e.ts

import assert from "node:assert/strict";
import { resolve } from "node:path";
import { chromium, type CDPSession, type Page } from "playwright-core";
import { connectCdp, evaluateInExtension } from "../../src/cli/cdp.ts";
import { loadConfig, openAgentStore } from "../../src/store/store.ts";
import { serveFixtures } from "../fixtures/serve.ts";

const CDP_URL = process.env.MARKSPOT_CDP ?? "http://127.0.0.1:9223";
const EXTENSION_ID = "alimncmfokmnolijpmaikdbjhgbcblle";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type FlatNode = { nodeId: number; parentId?: number; nodeName: string; nodeType?: number; nodeValue?: string; attributes?: string[] };
let texts = new Map<number, string>();
async function flat(cdp: CDPSession): Promise<FlatNode[]> {
  const nodes = ((await cdp.send("DOM.getFlattenedDocument", { depth: -1, pierce: true })) as { nodes: FlatNode[] }).nodes;
  texts = new Map();
  for (const n of nodes) if (n.nodeType === 3 && n.parentId !== undefined) texts.set(n.parentId, (texts.get(n.parentId) ?? "") + (n.nodeValue ?? ""));
  return nodes;
}
const classes = (n: FlatNode) => {
  const a = n.attributes ?? [];
  const i = a.indexOf("class");
  return i >= 0 && i % 2 === 0 ? (a[i + 1] ?? "").split(/\s+/) : [];
};
async function click(page: Page, cdp: CDPSession, pick: (n: FlatNode, text: string) => boolean, what: string) {
  for (const n of await flat(cdp)) {
    if (!pick(n, texts.get(n.nodeId) ?? "")) continue;
    try {
      const { model } = (await cdp.send("DOM.getBoxModel", { nodeId: n.nodeId })) as { model: { content: number[] } };
      const [x1, y1, x2, , , y3] = model.content as [number, number, number, number, number, number];
      if (x2 <= x1) continue;
      await page.mouse.click((x1 + x2) / 2, (y1 + y3) / 2);
      await page.waitForTimeout(700);
      return;
    } catch {
      // nœud caché : le suivant
    }
  }
  assert.fail(`${what} not found`);
}
const button = (label: string) => (n: FlatNode, text: string) => n.nodeName === "BUTTON" && text === label;

const { url, server } = await serveFixtures();
const browser = await chromium.connectOverCDP(CDP_URL);
const cdp = await browser.newBrowserCDPSession();
const context = browser.contexts()[0]!;
const agent = await openAgentStore(await loadConfig());
let page: Page | undefined;
try {
  await cdp.send("Extensions.loadUnpacked", { path: resolve("extension") });
  const ready = await connectCdp(CDP_URL);
  try {
    for (let i = 0; i < 20; i++) {
      if (await evaluateInExtension(ready, EXTENSION_ID, "globalThis.markspot?.status()").catch(() => null)) break;
      await sleep(250);
    }
  } finally {
    ready.close();
  }
  const opened = context.waitForEvent("page", (p) => p.url().startsWith(url));
  await cdp.send("Target.createTarget", { url, newWindow: true });
  page = await opened;
  await page.waitForLoadState("domcontentloaded");
  await page.bringToFront();
  const { targetInfos } = (await cdp.send("Target.getTargets", { filter: [{ type: "tab" }] })) as { targetInfos: { targetId: string; url: string }[] };
  await cdp.send("Extensions.triggerAction", { id: EXTENSION_ID, targetId: targetInfos.find((t) => t.url.startsWith(url))!.targetId });
  await page.waitForFunction(() => document.querySelector("markspot-overlay") !== null);
  await page.waitForTimeout(500);

  // Deux notes : le bouton et le titre.
  for (const [selector, text] of [["#acheter", "Première note à modifier"], ["h1", "Deuxième note à supprimer du menu"]] as const) {
    const box = (await page.locator(selector).boundingBox())!;
    await page.mouse.move(box.x + 10, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(800);
    await page.keyboard.type(text);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(1200);
  }
  const notes = await agent.list({ urlPrefix: url });
  const first = notes.find((t) => t.annotation.comment === "Première note à modifier")!;
  const second = notes.find((t) => t.annotation.comment === "Deuxième note à supprimer du menu")!;
  assert.ok(first && second, "both notes saved");
  const pageCdp = await context.newCDPSession(page);
  await pageCdp.send("DOM.enable");

  // Fiche : Modifier, Échap annule ; Modifier, Enregistrer.
  const pin = (seq: number) => (n: FlatNode, text: string) => n.nodeName === "BUTTON" && classes(n).includes("pin") && text === String(seq);
  await click(page, pageCdp, pin(first.annotation.seq), "pin of the first note");
  await click(page, pageCdp, button("Modifier"), "Modifier in the card");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  assert.ok((await flat(pageCdp)).some((n) => texts.get(n.nodeId) === "Fermer"), "Escape cancels the edit and keeps the card");
  await click(page, pageCdp, button("Modifier"), "Modifier in the card");
  await page.keyboard.press("Control+A");
  await page.keyboard.type("Commentaire modifié depuis la fiche");
  await click(page, pageCdp, button("Enregistrer"), "Enregistrer");
  await sleep(800);
  assert.equal((await agent.get(first.annotation.id))?.annotation.comment, "Commentaire modifié depuis la fiche", "the edit reaches the notes folder");
  console.log("ok: comment edited from the card");

  // Fiche : Supprimer, puis confirmer.
  await click(page, pageCdp, button("Supprimer"), "Supprimer in the card");
  await click(page, pageCdp, button("Confirmer la suppression"), "confirm");
  await sleep(800);
  assert.equal(await agent.get(first.annotation.id), null, "the note is removed from the notes folder");
  console.log("ok: note deleted from the card");

  // Menu : Supprimer sur la ligne, puis Oui.
  await click(page, pageCdp, (n) => n.nodeName === "BUTTON" && classes(n).includes("menu-toggle"), "menu toggle");
  await click(page, pageCdp, button("Supprimer"), "Supprimer in the menu");
  await click(page, pageCdp, button("Oui, supprimer"), "Oui, supprimer");
  await sleep(800);
  assert.equal(await agent.get(second.annotation.id), null, "the second note is removed");
  console.log("ok: note deleted from the menu");
  console.log("edit and delete test passed");
} finally {
  await agent.clear({ state: "all", urlPrefix: url }).catch((error: Error) => console.error(`warning: clear ${url} by hand (${error.message})`));
  await page?.close().catch(() => undefined);
  await browser.close().catch(() => undefined);
  server.close();
}
