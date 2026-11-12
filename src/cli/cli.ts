// Point d'entrée du binaire `markspot`.

import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve, win32 } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { EXTENSION_ID, EXTENSION_ORIGIN, VERSION } from "../core/build.ts";
import { runHost } from "../host/host.ts";
import { loadConfig, openAgentStore, openHostStore } from "../store/store.ts";
import { BROWSER_IDS, isBrowserId } from "./browsers.ts";
import { CLI_LAUNCHER, DEFAULT_SETTINGS, HOST_STATUS_FILE, doctor, install, readSettings, uninstall, type Context } from "./install.ts";

/** Trace de la dernière connexion de l'extension, lue par doctor quand il n'a pas de port de débogage. */
async function writeHostStatus(): Promise<void> {
  try {
    await mkdir(dirname(HOST_STATUS_FILE), { recursive: true });
    await writeFile(HOST_STATUS_FILE, JSON.stringify({ at: new Date().toISOString(), version: VERSION }) + "\n");
  } catch {
    // simple trace : son absence ne doit pas empêcher l'hôte de démarrer
  }
}

const USAGE = `markspot ${VERSION}

  markspot install [--browser chrome,brave|all] [--chrome-profile <dir>] [--cdp <url>] [--data-dir <dir>]
  markspot doctor
  markspot uninstall
  markspot mcp                 MCP server on stdio, started by Claude Code
  markspot claude [args…]      start Claude Code with the Markspot channel: "Envoyer à Claude"
                               wakes the session up (research preview, asks for confirmation)
  markspot listen [--name <projet>] [--url <prefix>] [--timeout <s>]
                               wait for notes sent with "Envoyer à Claude" (exit 0), or time out (exit 2)
  markspot host <origin>       started by the browser, not by hand
`;

interface Flags {
  "chrome-profile"?: string | undefined;
  cdp?: string | undefined;
  browser?: string | undefined;
  "data-dir"?: string | undefined;
}

async function context(flags: Flags): Promise<Context> {
  const saved = (await readSettings()) ?? DEFAULT_SETTINGS;
  const cliPath = fileURLToPath(import.meta.url);
  const browsers = flags.browser
    ? flags.browser === "all"
      ? [...BROWSER_IDS]
      : flags.browser.split(",").map((b) => b.trim())
    : saved.browsers;
  const unknown = browsers.filter((b) => !isBrowserId(b));
  if (unknown.length > 0) throw new Error(`unknown browser ${unknown.join(", ")}; known: ${BROWSER_IDS.join(", ")}, all`);
  const chromeProfile = flags["chrome-profile"] ?? saved.chromeProfile;
  const cdpUrl = flags.cdp ?? saved.cdpUrl;
  // Chemin absolu exigé : l'hôte démarre avec le dossier courant du navigateur.
  const dataDir = flags["data-dir"] ?? saved.dataDir;
  if (dataDir && !(process.platform === "win32" ? win32.isAbsolute(dataDir) : isAbsolute(dataDir))) {
    throw new Error(`--data-dir must be an absolute path (got ${dataDir})`);
  }
  return {
    browsers: browsers.filter(isBrowserId),
    ...(chromeProfile ? { chromeProfile: resolve(chromeProfile) } : {}),
    ...(cdpUrl ? { cdpUrl } : {}),
    ...(dataDir ? { dataDir } : {}),
    extensionId: EXTENSION_ID,
    extensionDir: join(dirname(cliPath), "..", "extension"),
    cliPath,
    nodePath: process.execPath,
    skillDir: join(dirname(cliPath), "..", "skill"),
  };
}

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  const log = (line: string) => console.log(line);

  switch (command) {
    case "host":
      if (rest[0] === EXTENSION_ORIGIN) await writeHostStatus();
      return runHost({
        expectedOrigin: EXTENSION_ORIGIN,
        origin: rest[0],
        version: VERSION,
        input: process.stdin,
        output: process.stdout,
        openStore: async () => openHostStore(await loadConfig()),
      });
    case "mcp": {
      // Import différé : l'hôte, lancé par le navigateur, ne charge pas le SDK MCP.
      const [{ StdioServerTransport }, { createServer }, { startChannel }] = await Promise.all([
        import("@modelcontextprotocol/server/stdio"),
        import("../mcp/server.ts"),
        import("../mcp/channel.ts"),
      ]);
      const config = await loadConfig();
      const store = await openAgentStore(config);
      // Posé par `markspot claude`, qui lance Claude Code avec le drapeau des canaux.
      const channel = process.env.MARKSPOT_CHANNEL === "1";
      const server = createServer(store, VERSION, { listenCommand: CLI_LAUNCHER, channel });
      // connect() et non serveStdio() : Claude Code n'accepte les canaux qu'avec l'ancienne
      // ouverture du protocole, que serveStdio ne propose pas.
      const transport = new StdioServerTransport();
      await server.connect(transport);
      const stopChannel = channel
        ? startChannel({
            dataDir: config.dataDir,
            store,
            name: basename(process.cwd()),
            push: (content, meta) =>
              server.server.notification({ method: "notifications/claude/channel", params: { content, meta } }),
          })
        : async () => {};
      process.stderr.write(`markspot ${VERSION} MCP server on stdio${channel ? ", channel on" : ""}\n`);
      return new Promise<number>(() => {
        // Sortie explicite : stdin et les minuteries ne doivent pas garder le processus en vie.
        const close = () => void stopChannel().finally(() => process.exit(0));
        transport.onclose = close; // Claude Code ferme stdin à la fin de la session
        process.stdin.once("end", close);
        process.once("SIGINT", close);
        process.once("SIGTERM", close);
      });
    }
    case "claude": {
      // Lance Claude Code avec le canal Markspot : la session se réveille à « Envoyer à Claude ».
      const { spawn } = await import("node:child_process");
      const args = ["--dangerously-load-development-channels", "server:markspot", ...rest];
      const windows = process.platform === "win32";
      const child = spawn(windows ? ["claude", ...args.map((a) => `"${a.replaceAll('"', '\\"')}"`)].join(" ") : "claude", windows ? [] : args, {
        stdio: "inherit",
        shell: windows, // claude.cmd ou claude.exe : seul le shell trouve les deux
        env: { ...process.env, MARKSPOT_CHANNEL: "1" },
      });
      return new Promise<number>((done) => {
        child.on("error", (error) => {
          process.stderr.write(`markspot: could not start claude (${error.message}). Is Claude Code installed and on PATH?\n`);
          done(1);
        });
        child.on("exit", (code) => done(code ?? 1));
      });
    }
    case "listen": {
      const { values } = parseArgs({
        args: rest,
        options: { url: { type: "string" }, timeout: { type: "string" }, name: { type: "string" } },
      });
      const { listen } = await import("./listen.ts");
      const timeout = Number(values.timeout ?? 3600);
      if (!Number.isFinite(timeout) || timeout < 5) throw new Error("--timeout must be a number of seconds, 5 or more");
      // Nom du projet montré dans la page : par défaut le dossier de la session.
      const name = values.name ?? basename(process.cwd());
      return listen({ urlPrefix: values.url ?? "", timeoutSeconds: timeout, name });
    }
    case "install":
    case "uninstall":
    case "doctor": {
      const { values } = parseArgs({
        args: rest,
        options: {
          "chrome-profile": { type: "string" },
          cdp: { type: "string" },
          browser: { type: "string" },
          "data-dir": { type: "string" },
        },
      });
      const ctx = await context(values);
      if (command === "install") await install(ctx, log);
      if (command === "uninstall") await uninstall(ctx, log);
      if (command === "doctor") return (await doctor(ctx, log)) ? 0 : 1;
      return 0;
    }
    default:
      process.stderr.write(USAGE);
      return command === undefined || command === "--help" ? 0 : 2;
  }
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: Error) => {
    process.stderr.write(`markspot: ${error.message}\n`);
    process.exitCode = 1;
  },
);
