// Intégration du shell : `install` ajoute une fonction `claude` qui passe par `markspot launch`,
// pour que chaque session interactive puisse écouter Markspot sans commande à retenir.
// Le bloc est entre deux marqueurs : `install` le remplace, `uninstall` le retire, et le reste
// du fichier reste octet pour octet (BOM et fins de ligne compris).
// Pur, testé dans tests/unit/shell.test.ts.

import { posix } from "node:path";
import type { Platform } from "../core/paths.ts";
import { shQuote } from "./launcher.ts";

export const BEGIN = "# >>> markspot >>>";
export const END = "# <<< markspot <<<";

/** sh, bash et zsh : si le lanceur a disparu, `claude` reste le vrai claude. */
export function shBlock(launcher: string): string[] {
  const q = shQuote(launcher);
  return [
    BEGIN,
    "# Added by markspot install, removed by markspot uninstall: each interactive claude session",
    "# can listen to Markspot's \"Envoyer a Claude\" (markspot launch).",
    "function claude {",
    `  if [ -x ${q} ]; then ${q} launch "$@"; else command claude "$@"; fi`,
    "}",
    END,
  ];
}

/** Guillemets simples de PowerShell : seule l'apostrophe se double. */
export const psQuote = (value: string) => `'${value.replaceAll("'", "''")}'`;

/** PowerShell : node est appelé directement (un .bat relirait % et ! et demande à Ctrl+C). ASCII seulement. */
export function psBlock(nodePath: string, cliPath: string): string[] {
  return [
    BEGIN,
    "# Added by markspot install, removed by markspot uninstall: each interactive claude session",
    "# can listen to Markspot's \"Envoyer a Claude\" (markspot launch).",
    "function claude {",
    `    if (Test-Path -LiteralPath ${psQuote(cliPath)}) { & ${psQuote(nodePath)} ${psQuote(cliPath)} launch @args }`,
    "    else { & (Get-Command claude -CommandType Application | Select-Object -First 1) @args }",
    "}",
    END,
  ];
}

const BOM = "﻿";

function split(content: string): { bom: string; eol: string; lines: string[] } {
  const bom = content.startsWith(BOM) ? BOM : "";
  const body = content.slice(bom.length);
  const eol = body.includes("\r\n") ? "\r\n" : "\n";
  return { bom, eol, lines: body === "" ? [] : body.split(eol) };
}

/** Début et fin (inclus) du bloc, ou null. */
function blockRange(lines: string[]): [number, number] | null {
  const start = lines.indexOf(BEGIN);
  if (start < 0) return null;
  const end = lines.indexOf(END, start);
  return end < 0 ? null : [start, end];
}

export function hasBlock(content: string, block: string[]): boolean {
  const { lines } = split(content);
  const range = blockRange(lines);
  return range !== null && lines.slice(range[0], range[1] + 1).join("\n") === block.join("\n");
}

/** Remplace le bloc, ou l'ajoute à la fin après une ligne vide. */
export function upsertBlock(content: string, block: string[]): string {
  const { bom, eol, lines } = split(content);
  const range = blockRange(lines);
  if (range) {
    lines.splice(range[0], range[1] - range[0] + 1, ...block);
    return bom + lines.join(eol);
  }
  const body = lines.join(eol);
  const trimmed = body.replace(/(\r?\n)+$/, "");
  return bom + (trimmed === "" ? "" : trimmed + eol + eol) + block.join(eol) + eol;
}

/** Retire le bloc et la ligne vide qu'upsertBlock avait mise avant lui. */
export function removeBlock(content: string): string {
  const { bom, eol, lines } = split(content);
  const range = blockRange(lines);
  if (!range) return content;
  const [start, end] = range;
  const from = start > 0 && lines[start - 1] === "" ? start - 1 : start;
  lines.splice(from, end - from + 1);
  return bom + lines.join(eol);
}

/**
 * Les fichiers de démarrage à compléter : .zshrc et .bashrc s'ils existent, plus celui du shell
 * de la personne ($SHELL), créé au besoin (macOS n'a souvent pas de .zshrc). Fish n'est pas pris.
 */
export function rcTargets(
  platform: Platform,
  home: string,
  env: { SHELL?: string | undefined; ZDOTDIR?: string | undefined },
  exists: (path: string) => boolean,
): string[] {
  if (platform === "win32") return [];
  const zshrc = posix.join(env.ZDOTDIR || home, ".zshrc");
  const bashrc = posix.join(home, ".bashrc");
  const bashProfile = posix.join(home, ".bash_profile");
  const targets = new Set<string>();
  for (const file of [zshrc, bashrc]) if (exists(file)) targets.add(file);
  if (platform === "darwin" && exists(bashProfile)) targets.add(bashProfile);
  const shell = posix.basename(env.SHELL ?? "");
  if (shell === "zsh") targets.add(zshrc);
  if (shell === "bash") targets.add(platform === "darwin" && !exists(bashrc) ? bashProfile : bashrc);
  return [...targets];
}
