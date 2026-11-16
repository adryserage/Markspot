// Capture du Chrome Web Store (1280×800) : la boîte de commentaire sur la page de démo, interface en anglais.
//   node build.mjs --trial <dir> && node scripts/store-screenshot.ts <dir>
// Lance un Chromium sans fenêtre avec un profil jetable. Chromium : MARKSPOT_CHROMIUM ou Brave/Chrome.
// Écrit store-assets/screenshot-1.png.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";

const extensionDir = resolve(process.argv[2] ?? "");
assert.ok(existsSync(join(extensionDir, "manifest.json")), "usage: node scripts/store-screenshot.ts <built extension dir>");
const executable = [
  process.env.MARKSPOT_CHROMIUM,
  "C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].find((p) => p && existsSync(p));
assert.ok(executable, "no Chromium found: set MARKSPOT_CHROMIUM");

const html = await readFile(join(import.meta.dirname, "store-demo.html"));
const server = createServer((_req, res) => res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(html));
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const address = server.address();
assert.ok(address && typeof address !== "string");
const url = `http://127.0.0.1:${address.port}/`;

const profile = await mkdtemp(join(tmpdir(), "markspot-shot-"));
const port = 9300 + Math.floor(Math.random() * 500);
const child = spawn(executable, [
  "--headless=new",
  `--user-data-dir=${profile}`,
  `--remote-debugging-port=${port}`,
  "--enable-unsafe-extension-debugging",
  "--lang=en-US",
  "--no-first-run",
  "--window-size=1280,800",
  "about:blank",
]);

try {
  let browser;
  for (let i = 0; i < 40 && !browser; i++) {
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`).catch(() => undefined);
    if (!browser) await new Promise((r) => setTimeout(r, 250));
  }
  assert.ok(browser, "the browser did not open its debugging port");
  const cdp = await browser.newBrowserCDPSession();
  const { id } = (await cdp.send("Extensions.loadUnpacked", { path: extensionDir })) as { id: string };
  const context = browser.contexts()[0];
  assert.ok(context);
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(url);
  await page.waitForTimeout(1000);

  const { targetInfos } = (await cdp.send("Target.getTargets", { filter: [{ type: "tab" }] })) as {
    targetInfos: { targetId: string; url: string }[];
  };
  const tab = targetInfos.find((t) => t.url.startsWith(url));
  assert.ok(tab, "no tab target for the demo page");
  await cdp.send("Extensions.triggerAction", { id, targetId: tab.targetId });
  await page.waitForFunction(() => document.querySelector("markspot-overlay") !== null);
  await page.waitForTimeout(500);

  const box = await page.locator("#buy-starter").boundingBox();
  assert.ok(box);
  await page.mouse.click(box.x + 40, box.y + box.height / 2);
  await page.waitForTimeout(1000);
  await page.keyboard.type("This button runs past the edge of its card. Make it fit the card width, like the Team button.");
  await mkdir("store-assets", { recursive: true });
  await page.screenshot({ path: "store-assets/screenshot-1.png" });
  console.log("store-assets/screenshot-1.png");
  await browser.close();
} finally {
  child.kill();
  server.close();
  await rm(profile, { recursive: true, force: true }).catch(() => undefined);
}
