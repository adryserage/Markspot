// Monte la vidéo d'une langue : chaque scène est rendue image par image dans scenes.html
// (cartes animées, ou prise filmée avec curseur et texte), encodée, puis les scènes sont
// enchaînées en fondu.
//   node scripts/video/render.ts <en|fr> <work dir> <out.mp4>
// La prise « resolved » absente (pas de programme local), sa scène devient une carte provisoire.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";
import { findChromium, type Lang } from "../demo-browser.ts";
import type { Take } from "./film.ts";
import { FADE, FPS, SCRIPTS, type Scene } from "./storyboard.ts";

const SCREEN_WIDTH = 1440;
/** Le cercle du clic s'efface en 10 images. */
const RING_FRAMES = 10;

export function ffmpeg(args: string[]): void {
  const result = spawnSync(process.env.FFMPEG ?? "ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: "inherit" });
  assert.equal(result.status, 0, `ffmpeg failed: ${args.join(" ")}`);
}

interface FootageFrame { src: string; x: number; y: number; sinceClick: number | null }

/** Une image de vidéo par entrée : la capture tenue, le curseur, et le temps depuis le dernier clic. */
function expand(take: Take): FootageFrame[] {
  const frames: FootageFrame[] = [];
  let clickAt: number | null = null;
  for (const shot of take.shots) {
    if (shot.click) clickAt = frames.length;
    const src = pathToFileURL(shot.file).href;
    for (let i = 0; i < shot.hold; i++) {
      const since = clickAt === null ? null : frames.length - clickAt;
      frames.push({ src, x: shot.x, y: shot.y, sinceClick: since !== null && since < RING_FRAMES ? since : null });
    }
  }
  return frames;
}

export async function render(lang: Lang, work: string, out: string): Promise<void> {
  const text = SCRIPTS[lang];
  const browser = await chromium.launch({ executablePath: findChromium(), headless: true });
  const segments: { file: string; frames: number }[] = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await page.goto(pathToFileURL(join(import.meta.dirname, "scenes.html")).href);

    for (const [index, scene] of text.scenes.entries()) {
      const name = `${index}-${scene.kind === "card" ? scene.card : scene.take}`;
      const dir = join(work, "render", name);
      await rm(dir, { recursive: true, force: true });
      await mkdir(dir, { recursive: true });

      const takeFile = scene.kind === "footage" ? join(work, "footage", `${scene.take}.json`) : null;
      const take = takeFile && existsSync(takeFile) ? (JSON.parse(await readFile(takeFile, "utf8")) as Take) : null;
      const footage = take ? expand(take) : [];
      const fade = index < text.scenes.length - 1 ? FADE : 0;
      const frames = Math.max(Math.round((scene.seconds + fade) * FPS), footage.length + Math.round(fade * FPS));

      await page.evaluate((spec) => (window as unknown as { setup(s: unknown): Promise<void> }).setup(spec), {
        ...sceneSpec(scene),
        lang,
        text,
        pending: scene.kind === "footage" && !take,
        scale: take ? SCREEN_WIDTH / take.width : 1,
        // Le texte entre après le fondu d'arrivée et sort avant celui de départ.
        captionIn: (index > 0 ? FADE : 0) + 0.1,
        captionOut: frames / FPS - fade - 0.35,
      });

      // Une image identique à la précédente n'est pas recapturée : elle dure plus longtemps.
      const unique: { file: string; count: number }[] = [];
      let last = "";
      for (let i = 0; i < frames; i++) {
        const shot = footage.length > 0 ? footage[Math.min(i, footage.length - 1)] : null;
        const signature = await page.evaluate(
          ([t, s]) => (window as unknown as { frame(t: number, s: unknown): Promise<string> }).frame(t, s),
          [i / FPS, shot] as const,
        );
        if (signature === last) {
          unique.at(-1)!.count++;
          continue;
        }
        last = signature;
        const file = join(dir, `${String(unique.length).padStart(4, "0")}.png`);
        await page.screenshot({ path: file });
        unique.push({ file, count: 1 });
      }

      const list = unique.map((u) => `file '${u.file.replaceAll("\\", "/")}'\nduration ${u.count / FPS}`);
      list.push(`file '${unique.at(-1)!.file.replaceAll("\\", "/")}'`);
      await writeFile(join(dir, "list.txt"), `${list.join("\n")}\n`);
      const file = join(work, "render", `${name}.mp4`);
      ffmpeg(["-f", "concat", "-safe", "0", "-i", join(dir, "list.txt"), "-fps_mode", "cfr", "-r", String(FPS), "-frames:v", String(frames), "-c:v", "libx264", "-crf", "12", "-pix_fmt", "yuv420p", file]);
      segments.push({ file, frames });
      console.log(`${name}: ${frames} frames, ${unique.length} rendered`);
    }
  } finally {
    await browser.close();
  }

  // Fondus : chaque scène commence FADE secondes avant la fin de la précédente.
  const filters: string[] = [];
  let offset = 0;
  let label = "0:v";
  for (let i = 1; i < segments.length; i++) {
    offset += segments[i - 1]!.frames / FPS - FADE;
    const next = i === segments.length - 1 ? "out" : `v${i}`;
    filters.push(`[${label}][${i}:v]xfade=transition=fade:duration=${FADE}:offset=${offset.toFixed(4)}[${next}]`);
    label = next;
  }
  await mkdir(dirname(resolve(out)), { recursive: true });
  ffmpeg([
    ...segments.flatMap((s) => ["-i", s.file]),
    "-filter_complex", filters.join(";"),
    "-map", "[out]",
    "-r", String(FPS),
    "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
    out,
  ]);
  console.log(out);
}

function sceneSpec(scene: Scene): { kind: string; card?: string; caption?: string | undefined } {
  return scene.kind === "card" ? { kind: "card", card: scene.card, caption: scene.caption } : { kind: "footage", caption: scene.caption };
}

if (import.meta.main) {
  const [lang, work, out] = process.argv.slice(2);
  assert.ok((lang === "en" || lang === "fr") && work && out, "usage: node scripts/video/render.ts <en|fr> <work dir> <out.mp4>");
  await render(lang, work, out);
}
