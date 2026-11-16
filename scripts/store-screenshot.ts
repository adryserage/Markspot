// Captures du Chrome Web Store (1280×800) sur la page de démo, avec le programme local installé
// (notes jetables, voir openDemo) et l'extension complète construite dans un dossier local.
//   node build.mjs --out <dir> && node scripts/store-screenshot.ts <dir> [en|fr]
// Sans langue : les deux. Écrit store-assets/screenshot-<n>.png (anglais) et
// store-assets/fr/screenshot-<n>.png : 1 la boîte de commentaire avec une flèche, 2 le
// surlignage au survol, 3 les pastilles et la note réglée par Claude, 4 le menu, 5 l'export.

import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { capture, openDemo, overlayBox, type Box, type Demo, type Lang } from "./demo-browser.ts";
import { SCRIPTS } from "./video/storyboard.ts";

// Fenêtre très large : la barre d'aide centrée y laisse le menu des notes libre (voir
// video/film.ts), et le menu, cadré seul à droite, ne touche ni la barre ni la page. Chaque
// image en garde 1088×680 px CSS, qui sortent à 1280×800.
const WINDOW = { width: 3100, height: 1000, scale: 1280 / 1088 };
const CENTER: Box = { x: (WINDOW.width - 1088) / 2, y: 0, width: 1088, height: 680 };
const RIGHT: Box = { x: WINDOW.width - 1088, y: 0, width: 1088, height: 680 };

const center = (b: Box) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

/** Une capture sans fenêtre ne dessine pas le pointeur : une flèche est posée dans la page. */
async function showCursor(demo: Demo, at: { x: number; y: number }): Promise<void> {
  await demo.page.evaluate(({ x, y }) => {
    const cursor = document.getElementById("demo-cursor") ?? document.documentElement.appendChild(document.createElement("div"));
    cursor.id = "demo-cursor";
    cursor.style.cssText = `position:fixed;left:${x - 2}px;top:${y - 2}px;width:22px;height:30px;z-index:2147483647;pointer-events:none`;
    cursor.innerHTML =
      '<svg viewBox="0 0 34 46" width="22" height="30"><path d="M3 3 L3 37 L12 29 L18 43 L24 40 L18 27 L30 27 Z" fill="#151821" stroke="#fff" stroke-width="2.5" stroke-linejoin="round"/></svg>';
  }, at);
}

async function hideCursor(demo: Demo): Promise<void> {
  await demo.page.evaluate(() => document.getElementById("demo-cursor")?.remove());
}

async function note(demo: Demo, at: { x: number; y: number }, comment: string): Promise<void> {
  await demo.page.mouse.click(at.x, at.y);
  await demo.page.waitForTimeout(1200);
  await demo.page.keyboard.type(comment);
  await demo.page.keyboard.press("Enter");
  await demo.page.waitForTimeout(800);
}

async function shoot(extensionDir: string, lang: Lang): Promise<void> {
  const text = SCRIPTS[lang];
  const out = lang === "en" ? "store-assets" : "store-assets/fr";
  await mkdir(out, { recursive: true });
  const save = async (n: number, png: Buffer) => {
    const file = join(out, `screenshot-${n}.png`);
    await writeFile(file, png);
    console.log(file);
  };

  const demo = await openDemo({ extensionDir, lang, native: true, ...WINDOW });
  try {
    const { page } = demo;
    const button = await page.locator("#buy-starter").boundingBox();
    const intro = await page.locator("main > p").boundingBox();
    const team = await page.locator(".plan h2").nth(1).boundingBox();
    assert.ok(button && intro && team);
    await demo.toggleAnnotate();

    const overflow = { x: button.x + button.width - 16, y: button.y + button.height / 2 };
    // Le surlignage reste sur le dernier élément survolé (un <main> survolé jaunit toute la
    // page) : avant une capture, il revient sur le bouton de la note 1.
    const parkHighlight = async () => {
      await page.mouse.move(button.x + 40, button.y + button.height / 2);
      await page.waitForTimeout(200);
    };
    await page.mouse.move(overflow.x, overflow.y);
    await page.waitForTimeout(300);
    await showCursor(demo, overflow);
    await save(2, await capture(demo, CENTER));
    await hideCursor(demo);

    await page.mouse.click(overflow.x, overflow.y);
    await page.waitForTimeout(1200);
    const canvas = await overlayBox(demo, { tag: "canvas", cls: "drawable" });
    await page.mouse.move(canvas.x + canvas.width * 0.56, canvas.y + canvas.height * 0.92);
    await page.mouse.down();
    await page.mouse.move(canvas.x + canvas.width * 0.94, canvas.y + canvas.height * 0.5, { steps: 8 });
    await page.mouse.up();
    const field = center(await overlayBox(demo, { tag: "textarea", cls: "comment" }));
    await page.mouse.click(field.x, field.y);
    await page.keyboard.type(text.comment);
    await save(1, await capture(demo, CENTER));
    await page.keyboard.press("Enter");
    await page.waitForTimeout(800);

    await note(demo, { x: intro.x + 120, y: intro.y + intro.height / 2 }, text.otherNotes[0]);
    await note(demo, { x: team.x + 20, y: team.y + team.height / 2 }, text.otherNotes[1]);
    // Claude règle la note 1, comme dans la vidéo.
    const store = await demo.notes();
    const first = (await store.list({ urlPrefix: demo.url })).find((t) => t.annotation.comment === text.comment);
    assert.ok(first, "note 1 did not reach the local program");
    await page.addStyleTag({ content: ".buy { width: 100% !important; }" });
    await store.resolve(first.annotation.id, text.reply, { kind: "agent", id: "claude-code", name: "Claude" });
    await page.waitForTimeout(1500);
    await parkHighlight();
    const pin = center(await overlayBox(demo, { tag: "button", cls: "pin", text: "1" }));
    await page.mouse.click(pin.x, pin.y);
    await page.waitForTimeout(1200);
    await save(3, await capture(demo, CENTER));
    // Échap ferme la fiche et sort du mode : le mode revient pour le menu.
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    await demo.toggleAnnotate();
    await parkHighlight();

    const toggle = center(await overlayBox(demo, { tag: "button", cls: "menu-toggle" }));
    await page.mouse.click(toggle.x, toggle.y);
    await page.waitForTimeout(600);
    await save(4, await capture(demo, RIGHT));

    // La page d'export lance un téléchargement : refusé, la page affiche quand même son lien.
    const cdp = await demo.browser.newBrowserCDPSession();
    await cdp.send("Browser.setDownloadBehavior", { behavior: "deny" });
    await page.goto(`chrome-extension://${demo.extensionId}/dist/export.html`);
    await page.waitForFunction(() => !/^(Lecture|Reading)/.test(document.getElementById("status")?.textContent ?? ""));
    await page.waitForTimeout(300);
    await save(5, await capture(demo, CENTER));
  } finally {
    await demo.close();
  }
}

const [extensionDir, only] = process.argv.slice(2);
assert.ok(extensionDir && (!only || only === "en" || only === "fr"), "usage: node scripts/store-screenshot.ts <built extension dir> [en|fr]");
for (const lang of only ? [only as Lang] : (["en", "fr"] as const)) await shoot(extensionDir, lang);
