// Un Chromium sans fenêtre, profil jetable, avec l'extension chargée et la page de démo ouverte.
// Sert aux captures de la boutique (store-screenshot.ts) et au tournage de la vidéo (video/film.ts).
// Chromium : MARKSPOT_CHROMIUM, sinon Brave ou Chrome.

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Browser, type CDPSession, type Page } from "playwright-core";
import { connectCdp, evaluateInExtension } from "../src/cli/cdp.ts";
import { loadConfig, openAgentStore, type AgentStore } from "../src/store/store.ts";

export type Lang = "en" | "fr";
export interface Box { x: number; y: number; width: number; height: number }

export interface Demo {
  browser: Browser;
  page: Page;
  /** Session CDP de la page : boîtes dans la racine shadow fermée de l'overlay. */
  pageCdp: CDPSession;
  extensionId: string;
  url: string;
  /** Même effet qu'Alt+C. */
  toggleAnnotate(): Promise<void>;
  /** Les notes écrites par le programme local de ce navigateur (mode native seulement). */
  notes(): Promise<AgentStore>;
  close(): Promise<void>;
}

export function findChromium(): string {
  const executable = [
    process.env.MARKSPOT_CHROMIUM,
    "C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe",
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ].find((p) => p && existsSync(p));
  assert.ok(executable, "no Chromium found: set MARKSPOT_CHROMIUM");
  return executable;
}

/** Processus node du programme local en cours, sur Windows (le navigateur fermé, ils doivent sortir). */
function hostProcesses(): number[] {
  if (process.platform !== "win32") return [];
  const query = "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object CommandLine -match 'markspot.dist.cli.js.? host' | ForEach-Object ProcessId";
  const out = spawnSync("powershell", ["-NoProfile", "-Command", query], { encoding: "utf8" }).stdout ?? "";
  return out.split(/\s+/).filter(Boolean).map(Number);
}

/**
 * La fenêtre fait width×height en px CSS ; les images sortent à width×scale par height×scale.
 * native : l'extension complète parle au programme local installé. Le navigateur reçoit un
 * LOCALAPPDATA jetable : l'hôte, qu'il lance, y écrit ses notes, loin des vraies (Windows).
 */
export async function openDemo(options: {
  extensionDir: string;
  lang: Lang;
  width: number;
  height: number;
  scale: number;
  native?: boolean;
}): Promise<Demo> {
  const extensionDir = resolve(options.extensionDir);
  assert.ok(existsSync(join(extensionDir, "manifest.json")), `no built extension in ${extensionDir}`);
  const pages = {
    "/": await readFile(join(import.meta.dirname, "store-demo.html")),
    "/fr": await readFile(join(import.meta.dirname, "store-demo.fr.html")),
  };
  const server = createServer((req, res) => {
    const body = pages[req.url as keyof typeof pages];
    if (body) res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(body);
    else res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}/${options.lang === "fr" ? "fr" : ""}`;

  const profile = await mkdtemp(join(tmpdir(), "markspot-demo-"));
  const notesHome = options.native ? await mkdtemp(join(tmpdir(), "markspot-host-")) : null;
  const hostsBefore = new Set(hostProcesses());
  const port = 9300 + Math.floor(Math.random() * 500);
  const child = spawn(findChromium(), [
    "--headless=new",
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${port}`,
    "--enable-unsafe-extension-debugging",
    `--lang=${options.lang === "fr" ? "fr-CA" : "en-US"}`,
    "--no-first-run",
    "--hide-scrollbars",
    `--window-size=${options.width},${options.height}`,
    "about:blank",
  ], { env: notesHome ? { ...process.env, LOCALAPPDATA: notesHome } : process.env });
  const close = async () => {
    child.kill();
    server.close();
    await new Promise((r) => setTimeout(r, 1000));
    const left = hostProcesses().filter((pid) => !hostsBefore.has(pid));
    for (const pid of left) {
      console.error(`warning: the local program (pid ${pid}) outlived the browser, stopping it`);
      process.kill(pid);
    }
    for (const dir of [profile, notesHome]) if (dir) await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  };
  const notes = async () => {
    assert.ok(notesHome, "notes() needs openDemo({ native: true })");
    // loadConfig lit LOCALAPPDATA à l'appel : le dossier jetable le temps de le lire, jamais le vrai.
    const real = process.env.LOCALAPPDATA;
    process.env.LOCALAPPDATA = notesHome;
    try {
      const config = await loadConfig();
      assert.ok(resolve(config.dataDir).startsWith(resolve(notesHome)), `notes folder outside the throwaway one: ${config.dataDir}`);
      return await openAgentStore(config);
    } finally {
      if (real === undefined) delete process.env.LOCALAPPDATA;
      else process.env.LOCALAPPDATA = real;
    }
  };

  try {
    let browser: Browser | undefined;
    for (let i = 0; i < 40 && !browser; i++) {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`).catch(() => undefined);
      if (!browser) await new Promise((r) => setTimeout(r, 250));
    }
    assert.ok(browser, "the browser did not open its debugging port");
    const cdp = await browser.newBrowserCDPSession();
    const { id: extensionId } = (await cdp.send("Extensions.loadUnpacked", { path: extensionDir })) as { id: string };

    // La langue de l'interface se lit dans chrome.storage.local, côté service worker.
    const direct = await connectCdp(`http://127.0.0.1:${port}`);
    try {
      let ready = null;
      for (let i = 0; i < 40 && !ready; i++) {
        ready = await evaluateInExtension(direct, extensionId, "globalThis.markspot?.status()").catch(() => null);
        if (!ready) await new Promise((r) => setTimeout(r, 250));
      }
      assert.ok(ready, "the extension service worker did not start");
      await evaluateInExtension(direct, extensionId, `chrome.storage.local.set({ lang: ${JSON.stringify(options.lang)} })`);
    } finally {
      direct.close();
    }

    const context = browser.contexts()[0];
    assert.ok(context);
    const page = await context.newPage();
    const pageCdp = await context.newCDPSession(page);
    await pageCdp.send("Emulation.setDeviceMetricsOverride", {
      width: options.width,
      height: options.height,
      deviceScaleFactor: options.scale,
      mobile: false,
    });
    await page.goto(url);
    await page.evaluate(() => document.fonts.ready);
    const [width, height, scale] = await page.evaluate(() => [innerWidth, innerHeight, devicePixelRatio]);
    assert.ok(width === options.width && height === options.height && Math.abs(scale! - options.scale) < 1e-6, "the page did not take the asked size");

    const toggleAnnotate = async () => {
      const { targetInfos } = (await cdp.send("Target.getTargets", { filter: [{ type: "tab" }] })) as {
        targetInfos: { targetId: string; url: string }[];
      };
      const tab = targetInfos.find((t) => t.url === page.url());
      assert.ok(tab, "no tab target for the demo page");
      await cdp.send("Extensions.triggerAction", { id: extensionId, targetId: tab.targetId });
      await page.waitForFunction(() => document.querySelector("markspot-overlay") !== null);
      await page.waitForTimeout(400);
    };
    return { browser, page, pageCdp, extensionId, url, toggleAnnotate, notes, close: async () => (await browser.close(), await close()) };
  } catch (error) {
    await close();
    throw error;
  }
}

/** Capture de la page (ou de clip, en px CSS) en pixels réels, mise à l'échelle comprise. PNG sans transparence. */
export async function capture(demo: Demo, clip?: Box): Promise<Buffer> {
  const { data } = (await demo.pageCdp.send("Page.captureScreenshot", {
    format: "png",
    ...(clip ? { clip: { ...clip, scale: 1 } } : {}),
  })) as { data: string };
  return Buffer.from(data, "base64");
}

interface DomNode {
  nodeId: number;
  localName: string;
  attributes?: string[];
  children?: DomNode[];
  shadowRoots?: DomNode[];
  contentDocument?: DomNode;
}

/**
 * Boîte (px CSS) du premier élément de l'overlay dont le nom et la classe correspondent, ou dont
 * le texte vaut text. L'overlay vit dans une racine shadow fermée : seul CDP (pierce) la traverse.
 */
export async function overlayBox(demo: Demo, match: { tag: string; cls?: string; text?: string }): Promise<Box> {
  const { root } = (await demo.pageCdp.send("DOM.getDocument", { depth: -1, pierce: true })) as { root: DomNode };
  const candidates: DomNode[] = [];
  const walk = (node: DomNode) => {
    if (node.localName === match.tag) {
      const attrs = node.attributes ?? [];
      const cls = attrs[attrs.indexOf("class") + 1] ?? "";
      if (!match.cls || (attrs.includes("class") && cls.split(/\s+/).includes(match.cls))) candidates.push(node);
    }
    for (const child of [...(node.shadowRoots ?? []), ...(node.children ?? [])]) walk(child);
  };
  walk(root);
  for (const node of candidates) {
    if (match.text !== undefined) {
      const { object } = (await demo.pageCdp.send("DOM.resolveNode", { nodeId: node.nodeId })) as { object: { objectId: string } };
      const { result } = (await demo.pageCdp.send("Runtime.callFunctionOn", {
        objectId: object.objectId,
        functionDeclaration: "function () { return this.textContent.trim(); }",
        returnByValue: true,
      })) as { result: { value: string } };
      if (result.value !== match.text) continue;
    }
    const model = (await demo.pageCdp.send("DOM.getBoxModel", { nodeId: node.nodeId }).catch(() => null)) as {
      model: { border: number[] };
    } | null;
    if (!model) continue;
    const [x1, y1, x2, , , y3] = model.model.border as [number, number, number, number, number, number];
    return { x: x1, y: y1, width: x2 - x1, height: y3 - y1 };
  }
  throw new Error(`overlay element not found: ${JSON.stringify(match)}`);
}
