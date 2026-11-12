// Comment lancer la CLI de Claude Code sans shell, sur chaque système.
// Sous Windows, `shell: true` colle les arguments sans échappement (DEP0190) : un chemin avec
// un espace se coupe en deux. On cherche donc nous-mêmes claude.exe (installation native) ou
// claude.cmd (installation npm) sur le PATH, sans jamais regarder le dossier courant.
// Tout est pur sauf realProbe ; testé dans tests/unit/claude-command.test.ts.

import { statSync } from "node:fs";
import { win32 } from "node:path";
import { currentPlatform, type Platform } from "../core/paths.ts";

export interface Probe {
  platform: Platform;
  env: { PATH?: string | undefined; PATHEXT?: string | undefined; USERPROFILE?: string | undefined; ComSpec?: string | undefined };
  isFile(path: string): boolean;
}

export interface Command {
  file: string;
  args: string[];
  /** Passer à spawn en windowsVerbatimArguments : la ligne de cmd.exe est déjà écrite. */
  verbatim: boolean;
}

const DEFAULT_PATHEXT = ".COM;.EXE;.BAT;.CMD";

/** Le premier claude.<ext> du PATH, puis l'emplacement de l'installation native ; null s'il n'y en a pas. */
export function findClaude(probe: Probe): string | null {
  const exts = (probe.env.PATHEXT || DEFAULT_PATHEXT).split(";").map((e) => e.trim()).filter(Boolean);
  for (const raw of (probe.env.PATH ?? "").split(";")) {
    const dir = raw.trim().replace(/^"(.*)"$/, "$1");
    if (!dir || !win32.isAbsolute(dir)) continue; // jamais le dossier courant ni un chemin relatif
    for (const ext of exts) {
      const file = win32.join(dir, `claude${ext.toLowerCase()}`);
      if (probe.isFile(file)) return file;
    }
  }
  if (probe.env.USERPROFILE) {
    const native = win32.join(probe.env.USERPROFILE, ".local", "bin", "claude.exe");
    if (probe.isFile(native)) return native;
  }
  return null;
}

/**
 * Un argument entre guillemets pour cmd.exe. Les caractères que cmd ou le script .cmd
 * réinterprètent même entre guillemets (" % ! fins de ligne) sont refusés plutôt qu'échappés.
 */
export function cmdQuote(arg: string): string {
  if (/["%!\r\n]/.test(arg)) {
    throw new Error(`argument not supported by a claude.cmd install (contains " % ! or a line break): ${arg}`);
  }
  // Une barre oblique inverse finale échapperait le guillemet fermant : on la double.
  return `"${arg.replace(/(\\+)$/, "$1$1")}"`;
}

/** La commande à lancer, ou null si Claude Code n'est pas installé. */
export function claudeCommand(args: string[], probe: Probe): Command | null {
  if (probe.platform !== "win32") return { file: "claude", args, verbatim: false };
  const file = findClaude(probe);
  if (!file) return null;
  if (/\.(cmd|bat)$/i.test(file)) {
    const line = [file, ...args].map(cmdQuote).join(" ");
    return { file: probe.env.ComSpec || "cmd.exe", args: ["/d", "/s", "/v:off", "/c", `"${line}"`], verbatim: true };
  }
  return { file, args, verbatim: false };
}

/** La sonde du poste : PATH et fichiers réels. */
export function realProbe(): Probe {
  return {
    platform: currentPlatform(),
    env: process.env,
    isFile: (path) => statSync(path, { throwIfNoEntry: false })?.isFile() ?? false,
  };
}
