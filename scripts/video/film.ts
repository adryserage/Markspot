// Tourne les scènes réelles de la vidéo : l'extension d'essai sur la page de démo.
//   node scripts/video/film.ts <extension dir> <en|fr> <work dir> [--native]
// Chaque prise est une suite d'images, chacune tenue un nombre d'images de vidéo : le temps
// de la vidéo ne dépend pas de la vitesse du navigateur. Le curseur est noté à part (une
// capture sans fenêtre ne le dessine pas) et ajouté au montage.
// --native : l'extension complète (node build.mjs --out <dossier local>) et le programme local
// installé, avec des notes jetables (voir openDemo). Les pastilles sont alors « ouvertes » et la
// scène « resolved », où Claude répond, est tournée aussi.

import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { capture, openDemo, overlayBox, type Box, type Demo, type Lang } from "../demo-browser.ts";
import { SCRIPTS, type TakeId } from "./storyboard.ts";

// La barre d'aide, centrée, chevauche le menu des notes (coin haut droit) sous ~2300 px de
// large en français. La fenêtre est donc très large et l'image n'en garde que le centre, où
// la page de démo pose son contenu : la barre y est, le menu non.
export const FILM = { width: 2400, height: 1000, scale: 1.5 };
export const CROP = { x: (FILM.width - 1088) / 2, y: 0, width: 1088, height: 680 };

/** x, y : le pointeur, en px CSS de l'image (0..width, 0..height). */
export interface Shot { file: string; x: number; y: number; click: boolean; hold: number }
export interface Take { width: number; height: number; shots: Shot[] }

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const center = (b: Box) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

class Reel {
  readonly shots: Shot[] = [];
  readonly demo: Demo;
  readonly dir: string;
  x: number;
  y: number;
  constructor(demo: Demo, dir: string, at: { x: number; y: number }) {
    this.demo = demo;
    this.dir = dir;
    this.x = at.x;
    this.y = at.y;
  }

  async shot(hold = 1, click = false): Promise<void> {
    // Deux images d'animation : le surlignage suit le pointeur au rafraîchissement suivant.
    await this.demo.page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const file = join(this.dir, `${String(this.shots.length).padStart(4, "0")}.png`);
    await writeFile(file, await capture(this.demo, CROP));
    this.shots.push({ file, x: this.x - CROP.x, y: this.y - CROP.y, click, hold });
  }

  hold(frames: number): void {
    const last = this.shots.at(-1);
    assert.ok(last);
    last.hold += frames;
  }

  async moveTo(to: { x: number; y: number }, frames: number): Promise<void> {
    const from = { x: this.x, y: this.y };
    for (let i = 1; i <= frames; i++) {
      const k = ease(i / frames);
      this.x = from.x + (to.x - from.x) * k;
      this.y = from.y + (to.y - from.y) * k;
      await this.demo.page.mouse.move(this.x, this.y);
      await this.shot();
    }
  }

  async click(wait: number, hold: number): Promise<void> {
    await this.demo.page.mouse.down();
    await this.demo.page.mouse.up();
    await this.demo.page.waitForTimeout(wait);
    await this.shot(hold, true);
  }

  async type(text: string, framesPerChar: number): Promise<void> {
    for (const char of text) {
      await this.demo.page.keyboard.type(char);
      await this.shot(framesPerChar);
    }
  }
}

// Sous <main> : le pointeur au repos n'y surligne rien (sur <main>, toute la page jaunit).
const START = { x: CROP.x + 800, y: 600 };
let pointer = START;

async function take(demo: Demo, work: string, id: TakeId, act: (reel: Reel) => Promise<void>): Promise<void> {
  const dir = join(work, id);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  // Le pointeur reprend où la prise précédente l'a laissé.
  const reel = new Reel(demo, dir, pointer);
  await act(reel);
  pointer = { x: reel.x, y: reel.y };
  const result: Take = { width: CROP.width, height: CROP.height, shots: reel.shots };
  await writeFile(join(work, `${id}.json`), JSON.stringify(result, null, 1));
  console.log(`${id}: ${reel.shots.length} images, ${reel.shots.reduce((n, s) => n + s.hold, 0)} frames`);
}

export async function film(extensionDir: string, lang: Lang, work: string, native: boolean): Promise<void> {
  const text = SCRIPTS[lang];
  const labels = lang === "fr" ? { save: "Enregistrer la note" } : { save: "Save note" };
  const demo = await openDemo({ extensionDir, lang, native, ...FILM });
  try {
    const { page } = demo;
    const button = await page.locator("#buy-starter").boundingBox();
    const heading = await page.locator(".plan h2").first().boundingBox();
    assert.ok(button && heading);
    pointer = START;
    await page.mouse.move(pointer.x, pointer.y);

    await take(demo, work, "hover", async (reel) => {
      await reel.shot(18);
      await demo.toggleAnnotate();
      await reel.shot(20);
      await reel.moveTo({ x: heading.x + 40, y: heading.y + heading.height / 2 }, 22);
      reel.hold(14);
      await reel.moveTo({ x: button.x + button.width - 16, y: button.y + button.height / 2 }, 22);
      reel.hold(20);
    });

    await take(demo, work, "comment", async (reel) => {
      await reel.click(1200, 22);
      const canvas = await overlayBox(demo, { tag: "canvas", cls: "drawable" });
      await reel.moveTo({ x: canvas.x + canvas.width * 0.56, y: canvas.y + canvas.height * 0.92 }, 16);
      await page.mouse.down();
      await reel.shot(2);
      await reel.moveTo({ x: canvas.x + canvas.width * 0.94, y: canvas.y + canvas.height * 0.5 }, 16);
      await page.mouse.up();
      await reel.shot(10);
      await reel.moveTo(center(await overlayBox(demo, { tag: "textarea", cls: "comment" })), 12);
      await reel.click(150, 6);
      await reel.type(text.comment, 2);
      reel.hold(30);
    });

    await take(demo, work, "save", async (reel) => {
      await reel.moveTo(center(await overlayBox(demo, { tag: "button", cls: "primary", text: labels.save })), 14);
      await reel.click(900, 30);
      // Par le bouton : le surlignage reste sur lui, pas sur <main> qui jaunirait toute la page.
      await reel.moveTo({ x: button.x + 60, y: button.y + button.height / 2 }, 12);
      await reel.moveTo(center(await overlayBox(demo, { tag: "button", cls: "pin" })), 6);
      await reel.click(1200, 30);
    });

    if (native) {
      // Claude règle la note par le programme local, comme le fait le skill.
      const store = await demo.notes();
      // Échap ferme la fiche et sort du mode ; le mode revient pour montrer les pastilles.
      await page.keyboard.press("Escape");
      await page.waitForTimeout(400);
      await demo.toggleAnnotate();
      const [note] = await store.list({ urlPrefix: demo.url });
      assert.ok(note, "the note did not reach the local program");
      await take(demo, work, "resolved", async (reel) => {
        await reel.shot(20);
        // La correction elle-même : la page de démo n'a pas de code source à modifier.
        await page.addStyleTag({ content: ".buy { width: 100% !important; }" });
        await store.resolve(note.annotation.id, text.reply, { kind: "agent", id: "claude-code", name: "Claude" });
        await page.waitForTimeout(1500);
        await reel.shot(24);
        await reel.moveTo(center(await overlayBox(demo, { tag: "button", cls: "pin" })), 16);
        await reel.click(1200, 30);
      });
    }
  } finally {
    await demo.close();
  }
}

if (import.meta.main) {
  const [extensionDir, lang, work] = process.argv.slice(2);
  assert.ok(extensionDir && (lang === "en" || lang === "fr") && work, "usage: node scripts/video/film.ts <extension dir> <en|fr> <work dir> [--native]");
  await film(extensionDir, lang, work, process.argv.includes("--native"));
}
