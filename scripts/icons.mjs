// Rend les icônes PNG de l'extension à partir des SVG de extension/icons/src/.
//   node scripts/icons.mjs
// Chromium vient de MARKSPOT_CHROMIUM, sinon du premier navigateur trouvé dans la liste ci-dessous.

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";

const SRC = "extension/icons/src";
const OUT = "extension/icons";

// 128 garde 16 px de marge transparente, comme le demande le Chrome Web Store.
// 48 recadre le même dessin sans marge. 32 et 16 ont chacun un dessin calé sur leur grille de pixels.
const RENDERS = [
  { size: 128, svg: "icon.svg" },
  { size: 48, svg: "icon.svg", viewBox: "16 16 96 96" },
  { size: 32, svg: "icon-small.svg" },
  { size: 16, svg: "icon-16.svg" },
];

const CANDIDATES = [
  process.env.MARKSPOT_CHROMIUM,
  "C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];
const executablePath = CANDIDATES.find((p) => p && existsSync(p));
if (!executablePath) throw new Error("no Chromium found: set MARKSPOT_CHROMIUM");

const browser = await chromium.launch({ executablePath, headless: true });
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const { size, svg, viewBox } of RENDERS) {
    let markup = await readFile(join(SRC, svg), "utf8");
    if (viewBox) markup = markup.replace(/viewBox="[^"]*"/, `viewBox="${viewBox}"`);
    markup = markup.replace("<svg ", `<svg width="${size}" height="${size}" `);
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block}</style>${markup}`);
    await page.locator("svg").screenshot({ path: join(OUT, `icon-${size}.png`), omitBackground: true });
    console.log(`icon-${size}.png`);
  }
} finally {
  await browser.close();
}
