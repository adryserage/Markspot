// install, uninstall et doctor. Chaque étape lit l'état avant d'écrire :
// relancer install ne change rien, uninstall défait chaque étape.

import { execFile } from "node:child_process";
import { chmod, lstat, mkdir, readFile, readlink, rm, stat, symlink, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { currentPlatform, pathsFor } from "../core/paths.ts";
import { HOST_NAME } from "../core/protocol.ts";
import { BROWSER_IDS, hostTargets, isBrowserId, type BrowserId } from "./browsers.ts";
import { connectCdp, evaluateInExtension } from "./cdp.ts";
import { claudeCommand, realProbe } from "./claude-command.ts";
import { launcherFor } from "./launcher.ts";

export interface Settings {
  /** Navigateurs où déclarer l'hôte natif (voir browsers.ts). */
  browsers: BrowserId[];
  /** Profil lancé avec --user-data-dir (Chrome dédié aux essais, par exemple). */
  chromeProfile?: string;
  /** Port de débogage d'un Chrome, pour y charger l'extension et la vérifier sans clic. */
  cdpUrl?: string;
  /**
   * Dossier des notes, s'il n'est pas celui du système : par exemple un dossier partagé
   * entre deux postes. Le lanceur et le manifeste de l'hôte restent toujours en local.
   */
  dataDir?: string;
}

export interface Context extends Settings {
  extensionId: string;
  extensionDir: string;
  cliPath: string;
  nodePath: string;
  /** Dossier skill/ du paquet, lié dans ~/.claude/skills/markspot. */
  skillDir: string;
}

export interface InstallStep {
  name: string;
  satisfied(): Promise<boolean>;
  apply(): Promise<void>;
  revert(): Promise<void>;
  /** Étape à faire à la main : install affiche ce texte au lieu d'écrire. */
  manual?: string;
}

const PLATFORM = currentPlatform();
const HOME = homedir();
const PATHS = pathsFor(PLATFORM, process.env, HOME);
const CONFIG_FILE = join(PATHS.configDir, "config.json");
export const HOST_STATUS_FILE = join(PATHS.dataDir, "host-status.json");
/** La commande markspot pour les sessions Claude Code (markspot listen), toujours sur le poste. */
export const CLI_LAUNCHER = join(PATHS.dataDir, "bin", launcherFor(PLATFORM, "", "", "cli").fileName);

export const DEFAULT_SETTINGS: Settings = { browsers: [...BROWSER_IDS] };

export async function readSettings(): Promise<Settings | null> {
  try {
    const saved = JSON.parse(await readFile(CONFIG_FILE, "utf8")) as Partial<Settings>;
    return {
      browsers: (saved.browsers ?? DEFAULT_SETTINGS.browsers).filter(isBrowserId),
      ...(saved.chromeProfile ? { chromeProfile: saved.chromeProfile } : {}),
      ...(saved.cdpUrl ? { cdpUrl: saved.cdpUrl } : {}),
      ...(saved.dataDir ? { dataDir: saved.dataDir } : {}),
    };
  } catch {
    return null;
  }
}

async function readOr(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function writePrivate(path: string, content: string, mode = 0o600): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, content, { mode });
  if (PLATFORM !== "win32") await chmod(path, mode);
}

/** Demande au service worker un aller-retour avec l'hôte. Rend la réponse ou la raison de l'échec. */
export async function pingThroughChrome(cdpUrl: string, extensionId: string): Promise<{ ok: boolean; detail: string }> {
  let cdp;
  try {
    cdp = await connectCdp(cdpUrl);
  } catch (error) {
    return { ok: false, detail: (error as Error).message };
  }
  try {
    const reply = await evaluateInExtension(cdp, extensionId, "globalThis.markspot.ping()");
    if (reply === null) return { ok: false, detail: "extension service worker not running" };
    const message = reply as { type?: string };
    return { ok: message.type === "pong", detail: JSON.stringify(reply) };
  } catch (error) {
    return { ok: false, detail: (error as Error).message };
  } finally {
    cdp.close();
  }
}

const run = promisify(execFile);

async function reg(args: string[]): Promise<{ ok: boolean; out: string }> {
  try {
    const { stdout } = await run("reg", args, { windowsHide: true });
    return { ok: true, out: stdout };
  } catch {
    return { ok: false, out: "" };
  }
}

export function installSteps(ctx: Context): InstallStep[] {
  return [...browserSteps(ctx), ...claudeSteps(ctx)];
}

function browserSteps(ctx: Context): InstallStep[] {
  const settingsJson =
    JSON.stringify(
      {
        browsers: ctx.browsers,
        ...(ctx.chromeProfile ? { chromeProfile: ctx.chromeProfile } : {}),
        ...(ctx.cdpUrl ? { cdpUrl: ctx.cdpUrl } : {}),
        ...(ctx.dataDir ? { dataDir: ctx.dataDir } : {}),
      },
      null,
      2,
    ) + "\n";
  const launcher = launcherFor(PLATFORM, ctx.nodePath, ctx.cliPath);
  const launcherPath = join(PATHS.dataDir, "bin", launcher.fileName);
  const cliLauncher = launcherFor(PLATFORM, ctx.nodePath, ctx.cliPath, "cli");
  const hostManifest =
    JSON.stringify(
      {
        name: HOST_NAME,
        description: "Markspot native host",
        path: launcherPath,
        type: "stdio",
        allowed_origins: [`chrome-extension://${ctx.extensionId}/`],
      },
      null,
      2,
    ) + "\n";

  const steps: InstallStep[] = [
    {
      name: `settings (${CONFIG_FILE})`,
      satisfied: async () => (await readOr(CONFIG_FILE)) === settingsJson,
      apply: () => writePrivate(CONFIG_FILE, settingsJson),
      revert: () => rm(CONFIG_FILE, { force: true }),
    },
    {
      name: `host launcher (${launcherPath})`,
      satisfied: async () => (await readOr(launcherPath)) === launcher.content,
      apply: () => writePrivate(launcherPath, launcher.content, launcher.mode),
      revert: () => rm(launcherPath, { force: true }),
    },
    {
      name: `markspot command (${CLI_LAUNCHER})`,
      satisfied: async () => (await readOr(CLI_LAUNCHER)) === cliLauncher.content,
      apply: () => writePrivate(CLI_LAUNCHER, cliLauncher.content, cliLauncher.mode),
      revert: () => rm(CLI_LAUNCHER, { force: true }),
    },
  ];

  for (const target of hostTargets(ctx.browsers, PLATFORM, HOME, ctx.chromeProfile)) {
    if (target.kind === "dir") {
      const file = join(target.path, `${HOST_NAME}.json`);
      steps.push({
        name: `host manifest (${file})`,
        // Un navigateur absent (pas de dossier de profil) est sauté au lieu d'être créé.
        satisfied: async () => !(await exists(target.root)) || (await readOr(file)) === hostManifest,
        apply: () => writePrivate(file, hostManifest, 0o644),
        revert: () => rm(file, { force: true }),
      });
    } else {
      const file = join(PATHS.dataDir, `${HOST_NAME}.json`);
      steps.push({
        name: `host manifest (${file}, registry ${target.key})`,
        satisfied: async () =>
          (await readOr(file)) === hostManifest && (await reg(["query", target.key, "/ve"])).out.includes(file),
        apply: async () => {
          await writePrivate(file, hostManifest, 0o644);
          const added = await reg(["add", target.key, "/ve", "/t", "REG_SZ", "/d", file, "/f"]);
          if (!added.ok) throw new Error(`reg add ${target.key} failed`);
        },
        revert: async () => {
          await reg(["delete", target.key, "/f"]);
          await rm(file, { force: true });
        },
      });
    }
  }

  const cdpUrl = ctx.cdpUrl;
  if (cdpUrl) {
    steps.push({
      name: `extension in Chrome (${cdpUrl})`,
      satisfied: async () => (await pingThroughChrome(cdpUrl, ctx.extensionId)).ok,
      apply: async () => {
        const cdp = await connectCdp(cdpUrl);
        try {
          const { id } = await cdp.send<{ id: string }>("Extensions.loadUnpacked", { path: ctx.extensionDir });
          if (id !== ctx.extensionId) throw new Error(`Chrome gave id ${id}, expected ${ctx.extensionId}`);
        } finally {
          cdp.close();
        }
      },
      revert: async () => {
        const cdp = await connectCdp(cdpUrl);
        try {
          await cdp.send("Extensions.uninstall", { id: ctx.extensionId });
        } finally {
          cdp.close();
        }
      },
    });
  } else {
    steps.push({
      name: "extension in the browser",
      // L'hôte écrit host-status.json à chaque connexion de l'extension.
      satisfied: () => exists(HOST_STATUS_FILE),
      apply: async () => {},
      revert: async () => {},
      manual:
        `open chrome://extensions (or brave://extensions), turn on developer mode, ` +
        `click "Load unpacked" and choose ${ctx.extensionDir}`,
    });
  }
  return steps;
}

/** Lance la CLI de Claude Code. ok=false si elle échoue ou n'est pas installée. */
async function claude(args: string[]): Promise<{ ok: boolean; missing: boolean }> {
  const command = claudeCommand(args, realProbe());
  if (!command) return { ok: false, missing: true };
  try {
    await run(command.file, command.args, { timeout: 60_000, windowsHide: true, windowsVerbatimArguments: command.verbatim });
    return { ok: true, missing: false };
  } catch (error) {
    return { ok: false, missing: (error as NodeJS.ErrnoException).code === "ENOENT" };
  }
}

const SKILL_LINK = join(homedir(), ".claude", "skills", "markspot");

function claudeSteps(ctx: Context): InstallStep[] {
  return [
    {
      name: "MCP server in Claude Code (claude mcp add --scope user markspot)",
      satisfied: async () => (await claude(["mcp", "get", "markspot"])).ok,
      apply: async () => {
        const result = await claude(["mcp", "add", "--scope", "user", "markspot", "--", ctx.nodePath, ctx.cliPath, "mcp"]);
        if (result.missing) throw new Error("Claude Code CLI not found in PATH; install Claude Code, then run markspot install again");
        if (!result.ok) throw new Error("claude mcp add failed");
      },
      revert: async () => void (await claude(["mcp", "remove", "--scope", "user", "markspot"])),
    },
    {
      name: `skill (${SKILL_LINK})`,
      satisfied: async () => {
        try {
          return (await readlink(SKILL_LINK)).replace(/[\\/]+$/, "") === ctx.skillDir;
        } catch {
          return false;
        }
      },
      apply: async () => {
        await mkdir(dirname(SKILL_LINK), { recursive: true });
        try {
          if ((await lstat(SKILL_LINK)).isSymbolicLink()) await unlink(SKILL_LINK);
          else throw new Error(`${SKILL_LINK} exists and is not a link; move it away first`);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        await symlink(ctx.skillDir, SKILL_LINK, "junction");
      },
      revert: async () => {
        try {
          if ((await lstat(SKILL_LINK)).isSymbolicLink()) await unlink(SKILL_LINK);
        } catch {
          // déjà absent
        }
      },
    },
  ];
}

type Log = (line: string) => void;

export async function install(ctx: Context, log: Log): Promise<void> {
  for (const step of installSteps(ctx)) {
    if (await step.satisfied()) {
      log(`ok       ${step.name}`);
      continue;
    }
    if (step.manual) {
      log(`to do    ${step.name}: ${step.manual}`);
      continue;
    }
    await step.apply();
    log(`applied  ${step.name}`);
  }
}

export async function uninstall(ctx: Context, log: Log): Promise<void> {
  for (const step of installSteps(ctx).reverse()) {
    try {
      await step.revert();
      log(`removed  ${step.name}`);
    } catch (error) {
      log(`skipped  ${step.name}: ${(error as Error).message}`);
    }
  }
}

/** Rend true si tout est en place et que l'extension parle à l'hôte. */
export async function doctor(ctx: Context, log: Log): Promise<boolean> {
  let healthy = true;
  for (const step of installSteps(ctx)) {
    const ok = await step.satisfied();
    healthy &&= ok;
    log(`${ok ? "ok     " : "missing"}  ${step.name}`);
  }
  const notes = ctx.dataDir ?? PATHS.dataDir;
  const probe = join(notes, `.doctor-${process.pid}`);
  try {
    await mkdir(notes, { recursive: true });
    await writeFile(probe, "ok");
    await rm(probe, { force: true });
    log(`ok       notes folder (${notes})`);
  } catch (error) {
    healthy = false;
    log(`failed   notes folder (${notes}): ${(error as Error).message}`);
  }
  const status = await readOr(HOST_STATUS_FILE);
  if (status) log(`         last connection of the extension to the host: ${(JSON.parse(status) as { at: string }).at}`);
  if (!ctx.cdpUrl) return healthy;
  const ping = await pingThroughChrome(ctx.cdpUrl, ctx.extensionId);
  log(`${ping.ok ? "ok     " : "failed "}  extension <-> host round trip: ${ping.detail}`);
  if (!ping.ok) {
    log(`         if Extensions.loadUnpacked is refused, load ${ctx.extensionDir} by hand in chrome://extensions`);
  }
  return healthy && ping.ok;
}
