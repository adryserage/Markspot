// Essai réel de toute la chaîne, à la main (pas en CI, coûte quelques tours de Claude) : une vraie
// session Claude Code démarrée par `markspot launch`, le Chrome dédié, une note, « Rafraîchir », le
// choix de la session, « Envoyer à Claude », puis le réveil de la session et la résolution de la note.
// Lancer : npm run build && node tests/e2e/real-session.e2e.ts

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type CDPSession, type Page } from "playwright-core";
import { connectCdp, evaluateInExtension } from "../../src/cli/cdp.ts";
import { liveListeners } from "../../src/store/dispatch.ts";
import { loadConfig, openAgentStore } from "../../src/store/store.ts";
import { serveFixtures } from "../fixtures/serve.ts";

const CDP_URL = process.env.MARKSPOT_CDP ?? "http://127.0.0.1:9223";
const EXTENSION_ID = "alimncmfokmnolijpmaikdbjhgbcblle";
const PROJECT = `essai-reel-${Date.now().toString(36)}`;
const ARTIFACTS = resolve(process.env.MARKSPOT_ARTIFACTS ?? "tests/e2e/artifacts");
const LAUNCHER = join(process.env.HOME ?? "", ".local/share/markspot/bin/markspot");
const log = (s: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${s}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type FlatNode = { nodeId: number; parentId?: number; nodeName: string; attributes?: string[]; children?: Array<{ nodeType: number; nodeValue: string }> };
const attr = (n: FlatNode, name: string) => {
  const a = n.attributes ?? [];
  const i = a.indexOf(name);
  return i >= 0 && i % 2 === 0 ? (a[i + 1] ?? "") : null;
};
/** Le texte d'un nœud : dans la vue aplatie, ses nœuds texte sont des entrées à part (parentId). */
let textByParent = new Map<number, string>();
const textOf = (n: FlatNode) => textByParent.get(n.nodeId) ?? "";

/** Les nœuds de l'overlay : CDP traverse sa racine shadow fermée (pierce). */
async function flat(cdp: CDPSession): Promise<FlatNode[]> {
  const nodes = ((await cdp.send("DOM.getFlattenedDocument", { depth: -1, pierce: true })) as { nodes: Array<FlatNode & { nodeType?: number; nodeValue?: string }> }).nodes;
  textByParent = new Map();
  for (const n of nodes) {
    if (n.nodeType === 3 && n.parentId !== undefined) textByParent.set(n.parentId, (textByParent.get(n.parentId) ?? "") + (n.nodeValue ?? ""));
  }
  return nodes;
}
async function centerOf(cdp: CDPSession, node: FlatNode | undefined) {
  assert.ok(node, "node not found in the overlay");
  const { model } = (await cdp.send("DOM.getBoxModel", { nodeId: node.nodeId })) as { model: { content: number[] } };
  const [x1, y1, x2, , , y3] = model.content as [number, number, number, number, number, number];
  return { x: (x1 + x2) / 2, y: (y1 + y3) / 2 };
}

// 1. Une vraie session Claude Code, lancée comme par la fonction `claude` du shell. Les outils de
//    Markspot sont permis d'avance : la session ne s'arrête pas sur une demande de permission.
const projectDir = join(tmpdir(), PROJECT);
await mkdir(projectDir, { recursive: true });
await writeFile(join(projectDir, "README.md"), "Projet d'essai de Markspot.\n");
const stopFile = join(projectDir, ".stop");
const driver = `
import os, pty, select, sys, time, re
pid, fd = pty.fork()
if pid == 0:
    os.chdir(sys.argv[1])
    os.execv(sys.argv[2], ["markspot", "launch", "--model", "haiku", "--allowedTools",
        "mcp__markspot__markspot_list_annotations mcp__markspot__markspot_get_annotation mcp__markspot__markspot_resolve_annotation"])
buf = b""; answered = 0; last = 0
ansi = re.compile(rb"\\x1b\\[[0-9;?]*[a-zA-Z]|\\x1b\\][^\\x07]*\\x07")
end = time.time() + 300
while time.time() < end and not os.path.exists(sys.argv[3]):
    r, _, _ = select.select([fd], [], [], 0.5)
    if r:
        try: chunk = os.read(fd, 65536)
        except OSError: break
        buf += chunk; sys.stdout.buffer.write(ansi.sub(b"", chunk)); sys.stdout.flush()
    tail = ansi.sub(b"", buf).decode("utf8", "ignore").replace(" ", "")[-400:]
    if answered < 6 and re.search(r"(\\[O/n\\]|\\[Y/n\\]|trust|Trust|Entertoconfirm|Yes,I)", tail) and time.time() - last > 3:
        os.write(fd, b"\\r"); answered += 1; last = time.time()
os.write(fd, b"\\x03"); time.sleep(0.5); os.write(fd, b"\\x03"); time.sleep(1)
try: os.killpg(pid, 9)
except Exception:
    try: os.kill(pid, 9)
    except Exception: pass
`;
const session = spawn("python3", ["-c", driver, projectDir, LAUNCHER, stopFile], { stdio: ["ignore", "pipe", "inherit"] });
let screen = "";
session.stdout.on("data", (c: Buffer) => (screen += c.toString("utf8")));
const flatScreen = () => screen.replace(/\s/g, "");

const config = await loadConfig();
const agent = await openAgentStore(config);
const { url, server } = await serveFixtures();
const browser = await chromium.connectOverCDP(CDP_URL);
const cdp = await browser.newBrowserCDPSession();
const context = browser.contexts()[0]!;
let page: Page | undefined;
try {
  log(`session « ${PROJECT} » lancée, attente de son annonce`);
  let listed = false;
  for (let i = 0; i < 180 && !listed; i++) {
    listed = (await liveListeners(config.dataDir)).some((l) => l.name === PROJECT);
    if (!listed) await sleep(500);
  }
  assert.ok(listed, `the session never announced itself.\n${screen.slice(-1500)}`);
  log("la session écoute (battement vu)");

  // 2. Le Chrome dédié : extension à jour, page d'essai, une note.
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
  const tab = targetInfos.find((t) => t.url.startsWith(url))!;
  await cdp.send("Extensions.triggerAction", { id: EXTENSION_ID, targetId: tab.targetId });
  await page.waitForFunction(() => document.querySelector("markspot-overlay") !== null);
  await page.waitForTimeout(500);
  const box = (await page.locator("#acheter").boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(800);
  await page.keyboard.type("Essai de bout en bout : ne change aucun fichier, résous seulement cette note avec la réponse OK.");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1500);
  const mine = (await agent.list({ urlPrefix: url, state: "open" })).find((t) => t.annotation.comment.startsWith("Essai de bout en bout"));
  assert.ok(mine, "the note was not written");
  const noteId = mine.annotation.id;
  log(`note ${mine.annotation.seq} écrite`);

  // 3. Le menu, comme une personne : ouvrir, « Rafraîchir », choisir la session, « Envoyer à Claude ».
  const pageCdp = await context.newCDPSession(page);
  await pageCdp.send("DOM.enable");
  const clickNode = async (pick: (n: FlatNode) => boolean, what: string) => {
    const where = await centerOf(pageCdp, (await flat(pageCdp)).find(pick)).catch(() => null);
    assert.ok(where, `${what} not found`);
    await page!.mouse.click(where.x, where.y);
    await page!.waitForTimeout(800);
  };
  await clickNode((n) => n.nodeName === "BUTTON" && (attr(n, "class") ?? "").split(/\s+/).includes("menu-toggle"), "menu toggle");
  await clickNode((n) => n.nodeName === "BUTTON" && textOf(n) === "Rafraîchir", "Rafraîchir");
  const nodes = await flat(pageCdp);
  const select = nodes.find((n) => n.nodeName === "SELECT" && (attr(n, "class") ?? "").includes("menu-target-select"));
  assert.ok(select, "picker not found");
  const options = nodes.filter((n) => n.nodeName === "OPTION" && n.parentId === select.nodeId).map(textOf);
  log(`« Envoyer à » propose : ${options.join(" | ")}`);
  const index = options.findIndex((o) => o.startsWith(PROJECT));
  assert.ok(index > 0, "the listening session is not in the picker");
  // Au clavier, la liste fermée : des événements de confiance, comme une personne.
  await pageCdp.send("DOM.focus", { nodeId: select.nodeId });
  const current = options.findIndex((_, i) => i === 0);
  for (let i = current; i < index; i++) await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Tab"); // quitter la liste : le menu ignore l'envoi tant qu'elle a le focus
  await page.waitForTimeout(500);
  await clickNode((n) => n.nodeName === "BUTTON" && textOf(n) === "Envoyer à Claude" && (attr(n, "class") ?? "").includes("primary"), "Envoyer à Claude");
  await mkdir(ARTIFACTS, { recursive: true });
  await page.screenshot({ path: join(ARTIFACTS, "reel-1-envoye.png") });
  log("« Envoyer à Claude » cliqué");

  // 4. La session se réveille et règle la note.
  let woke = false;
  for (let i = 0; i < 120 && !woke; i++) {
    woke = /Markspot:\d+notes?sentwith/.test(flatScreen());
    if (!woke) await sleep(500);
  }
  assert.ok(woke, `the session did not wake up.\n${screen.slice(-2000)}`);
  log("la session s'est réveillée avec la note");
  let reply = "";
  for (let i = 0; i < 360 && !reply; i++) {
    reply = (await agent.get(noteId))?.resolution?.reply ?? "";
    if (!reply) await sleep(500);
  }
  assert.ok(reply, `the note was not resolved.\n${screen.slice(-2000)}`);
  log(`note réglée par Claude : « ${reply} »`);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(ARTIFACTS, "reel-2-reglee.png") });
  console.log("real session test passed");
} finally {
  await writeFile(stopFile, "");
  await sleep(3000);
  session.kill("SIGKILL");
  await agent.clear({ state: "all", urlPrefix: url }).catch(() => undefined);
  await page?.close().catch(() => undefined);
  await browser.close().catch(() => undefined);
  server.close();
  const left = (await liveListeners(config.dataDir)).filter((l) => l.name === PROJECT);
  if (left.length > 0) console.error(`warning: ${left.length} heartbeat(s) of the test session left (they expire in 30 s)`);
}
