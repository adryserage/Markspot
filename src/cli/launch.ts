// markspot launch [options de claude] : ce que lance la fonction `claude` ajoutée par install.
// Une session interactive peut écouter Markspot (canal) : on le demande, non par défaut au bout
// de 5 s, sauf si une session écoute déjà ce projet sur ce poste. Les options passent telles
// quelles à claude : aucun mode de permission n'est ajouté, la personne garde le sien.

import { spawn } from "node:child_process";
import { constants, hostname } from "node:os";
import { basename } from "node:path";
import { cleanName, liveListeners } from "../store/dispatch.ts";
import { loadConfig } from "../store/store.ts";
import { claudeCommand, realProbe } from "./claude-command.ts";

/** Sous-commandes de claude qui n'ouvrent pas de session : pas de question. */
const NOT_A_SESSION = new Set(["mcp", "config", "update", "doctor", "install", "migrate-installer", "setup-token", "plugin", "auth", "login", "logout"]);
const NO_SESSION_FLAGS = new Set(["-p", "--print", "-v", "--version", "-h", "--help"]);

/** Faut-il poser la question ? Pur. */
export function shouldAsk(args: string[], env: Record<string, string | undefined>, interactive: boolean): boolean {
  if (!interactive) return false;
  if (env.MARKSPOT_CHANNEL === "1") return false; // déjà lancé par markspot (appel imbriqué)
  if (args.some((a) => NO_SESSION_FLAGS.has(a))) return false;
  if (args[0] !== undefined && NOT_A_SESSION.has(args[0])) return false;
  return true;
}

/** Code de sortie de claude, ou 128 + numéro du signal qui l'a arrêté. */
export function exitCodeOf(code: number | null, signal: NodeJS.Signals | null): number {
  if (code !== null) return code;
  return signal ? 128 + (constants.signals[signal] ?? 0) : 1;
}

/** Une session écoute-t-elle déjà ce projet (nom du dossier) sur ce poste ? */
async function alreadyListening(): Promise<boolean> {
  try {
    const config = await loadConfig();
    const name = cleanName(basename(process.cwd()));
    const host = hostname().slice(0, 80);
    return (await liveListeners(config.dataDir)).some((l) => l.name === name && l.host === host);
  } catch {
    return false;
  }
}

/** La question et l'écho de la réponse. Pur. */
export interface PromptText {
  question: string;
  yes: string;
  no: string;
}

/** En français si la locale commence par fr, en anglais sinon. o ou y vaut oui dans les deux. */
export function promptText(locale: string): PromptText {
  return /^fr/i.test(locale)
    ? { question: "Markspot écoute cette session ? [o/N] (non dans 5 s) ", yes: "oui", no: "non" }
    : { question: "Should Markspot listen to this session? [y/N] (no in 5 s) ", yes: "yes", no: "no" };
}

/** La réponse pour une touche. true : o, O, y ou Y ; null : Ctrl+C ; false : toute autre touche. Pur. */
export function answerFor(key: string): boolean | null {
  if (key === "\u0003") return null;
  return /^[oOyY]/.test(key);
}

/** La locale du terminal : LC_ALL, LC_MESSAGES puis LANG (la première non vide), sinon celle d'Intl. */
export function terminalLocale(
  env: Record<string, string | undefined>,
  fallback: string = Intl.DateTimeFormat().resolvedOptions().locale,
): string {
  for (const name of ["LC_ALL", "LC_MESSAGES", "LANG"]) {
    const value = env[name];
    if (value) return value;
  }
  return fallback;
}

/** Une touche, 5 s au plus. true : o ou y ; false : Entrée, autre touche ou rien ; null : Ctrl+C. */
function askOnce(): Promise<boolean | null> {
  const text = promptText(terminalLocale(process.env));
  return new Promise((resolve) => {
    const stdin = process.stdin;
    stdin.setRawMode(true); // avant la question : une touche tapée tout de suite n'est pas affichée en double
    process.stdout.write(text.question);
    const finish = (answer: boolean | null) => {
      clearTimeout(timer);
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause(); // rend le terminal à claude
      process.stdout.write(answer === null ? "\n" : `${answer ? text.yes : text.no}\n`);
      resolve(answer);
    };
    const onData = (chunk: Buffer) => finish(answerFor(chunk.toString("utf8")));
    const timer = setTimeout(() => finish(false), 5000);
    stdin.resume();
    stdin.on("data", onData);
  });
}

export async function launch(args: string[]): Promise<number> {
  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY && typeof process.stdin.setRawMode === "function");
  const env: NodeJS.ProcessEnv = { ...process.env };
  let channel = false;
  if (shouldAsk(args, env, interactive) && !(await alreadyListening())) {
    const answer = await askOnce();
    if (answer === null) return 130;
    channel = answer;
  }
  // Sans canal, la variable ne passe pas : un claude -p imbriqué ne s'annoncerait pas comme écoute.
  if (channel) env.MARKSPOT_CHANNEL = "1";
  else delete env.MARKSPOT_CHANNEL;
  let command;
  try {
    command = claudeCommand(channel ? ["--dangerously-load-development-channels", "server:markspot", ...args] : args, realProbe());
  } catch (error) {
    process.stderr.write(`markspot: ${(error as Error).message}\n`);
    return 1;
  }
  if (!command) {
    process.stderr.write("markspot: Claude Code not found. Install it, then run claude again.\n");
    return 1;
  }
  const child = spawn(command.file, command.args, { stdio: "inherit", env, windowsVerbatimArguments: command.verbatim });
  // Ctrl+C va à claude ; le lanceur attend sa sortie.
  const ignore = () => undefined;
  process.on("SIGINT", ignore);
  process.on("SIGTERM", ignore);
  return new Promise<number>((done) => {
    child.on("error", (error) => {
      process.stderr.write(`markspot: could not start claude (${error.message})\n`);
      done(1);
    });
    child.on("exit", (code, signal) => done(exitCodeOf(code, signal)));
  });
}
