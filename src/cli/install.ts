// install, uninstall et doctor. Chaque étape lit l'état avant d'écrire :
// relancer install ne change rien, uninstall défait chaque étape.

import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { HOST_NAME } from "../core/protocol.ts";
import { connectCdp, evaluateInExtension } from "./cdp.ts";

export interface Settings {
  /** Profil Chrome où l'hôte natif est déclaré. */
  chromeProfile: string;
  /** Port de débogage de ce Chrome, pour charger l'extension et la vérifier. */
  cdpUrl: string;
}

export interface Context extends Settings {
  extensionId: string;
  extensionDir: string;
  cliPath: string;
  nodePath: string;
}

export interface InstallStep {
  name: string;
  satisfied(): Promise<boolean>;
  apply(): Promise<void>;
  revert(): Promise<void>;
}

const CONFIG_FILE = join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "markspot", "config.json");
const DATA_HOME = join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), "markspot");
const LAUNCHER = join(DATA_HOME, "bin", "markspot-host");

export const DEFAULT_SETTINGS: Settings = {
  chromeProfile: join(homedir(), ".config", "google-chrome"),
  cdpUrl: "http://127.0.0.1:9222",
};

export async function readSettings(): Promise<Settings | null> {
  try {
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(await readFile(CONFIG_FILE, "utf8")) as Partial<Settings>) };
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

async function writePrivate(path: string, content: string, mode = 0o600): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, content, { mode });
  await chmod(path, mode);
}

/** Demande au service worker un aller-retour avec l'hôte. Rend la réponse ou la raison de l'échec. */
export async function pingThroughChrome(ctx: Context): Promise<{ ok: boolean; detail: string }> {
  let cdp;
  try {
    cdp = await connectCdp(ctx.cdpUrl);
  } catch (error) {
    return { ok: false, detail: (error as Error).message };
  }
  try {
    const reply = await evaluateInExtension(cdp, ctx.extensionId, "globalThis.markspot.ping()");
    if (reply === null) return { ok: false, detail: "extension service worker not running" };
    const message = reply as { type?: string };
    return { ok: message.type === "pong", detail: JSON.stringify(reply) };
  } catch (error) {
    return { ok: false, detail: (error as Error).message };
  } finally {
    cdp.close();
  }
}

export function installSteps(ctx: Context): InstallStep[] {
  const settings = JSON.stringify({ chromeProfile: ctx.chromeProfile, cdpUrl: ctx.cdpUrl }, null, 2) + "\n";
  const launcher = `#!/bin/sh\nexec "${ctx.nodePath}" "${ctx.cliPath}" host "$@"\n`;
  const hostManifestPath = join(ctx.chromeProfile, "NativeMessagingHosts", `${HOST_NAME}.json`);
  const hostManifest =
    JSON.stringify(
      {
        name: HOST_NAME,
        description: "Markspot native host",
        path: LAUNCHER,
        type: "stdio",
        allowed_origins: [`chrome-extension://${ctx.extensionId}/`],
      },
      null,
      2,
    ) + "\n";

  return [
    {
      name: `settings (${CONFIG_FILE})`,
      satisfied: async () => (await readOr(CONFIG_FILE)) === settings,
      apply: () => writePrivate(CONFIG_FILE, settings),
      revert: () => rm(CONFIG_FILE, { force: true }),
    },
    {
      name: `host launcher (${LAUNCHER})`,
      satisfied: async () => (await readOr(LAUNCHER)) === launcher,
      apply: () => writePrivate(LAUNCHER, launcher, 0o700),
      revert: () => rm(LAUNCHER, { force: true }),
    },
    {
      name: `host manifest (${hostManifestPath})`,
      satisfied: async () => (await readOr(hostManifestPath)) === hostManifest,
      apply: () => writePrivate(hostManifestPath, hostManifest, 0o644),
      revert: () => rm(hostManifestPath, { force: true }),
    },
    {
      name: `extension in Chrome (${ctx.cdpUrl})`,
      satisfied: async () => (await pingThroughChrome(ctx)).ok,
      apply: async () => {
        const cdp = await connectCdp(ctx.cdpUrl);
        try {
          const { id } = await cdp.send<{ id: string }>("Extensions.loadUnpacked", { path: ctx.extensionDir });
          if (id !== ctx.extensionId) throw new Error(`Chrome gave id ${id}, expected ${ctx.extensionId}`);
        } finally {
          cdp.close();
        }
      },
      revert: async () => {
        const cdp = await connectCdp(ctx.cdpUrl);
        try {
          await cdp.send("Extensions.uninstall", { id: ctx.extensionId });
        } finally {
          cdp.close();
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
  const ping = await pingThroughChrome(ctx);
  log(`${ping.ok ? "ok     " : "failed "}  extension <-> host round trip: ${ping.detail}`);
  if (!ping.ok) {
    log(`         if Extensions.loadUnpacked is refused, load ${ctx.extensionDir} by hand in chrome://extensions`);
  }
  return healthy && ping.ok;
}
