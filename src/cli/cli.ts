// Point d'entrée du binaire `markspot`.

import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { EXTENSION_ID, EXTENSION_ORIGIN, VERSION } from "../core/build.ts";
import { runHost } from "../host/host.ts";
import { loadConfig, openAgentStore, openHostStore } from "../store/store.ts";
import { DEFAULT_SETTINGS, doctor, install, readSettings, uninstall, type Context } from "./install.ts";

const USAGE = `markspot ${VERSION}

  markspot install [--chrome-profile <dir>] [--cdp <url>]
  markspot doctor
  markspot uninstall
  markspot mcp                 MCP server on stdio, started by Claude Code
  markspot host <origin>       started by the browser, not by hand
`;

async function context(flags: { "chrome-profile"?: string | undefined; cdp?: string | undefined }): Promise<Context> {
  const saved = (await readSettings()) ?? DEFAULT_SETTINGS;
  const cliPath = fileURLToPath(import.meta.url);
  return {
    chromeProfile: resolve(flags["chrome-profile"] ?? saved.chromeProfile),
    cdpUrl: flags.cdp ?? saved.cdpUrl,
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
      const [{ serveStdio }, { createServer }] = await Promise.all([
        import("@modelcontextprotocol/server/stdio"),
        import("../mcp/server.ts"),
      ]);
      const store = await openAgentStore(await loadConfig());
      serveStdio(() => createServer(store, VERSION));
      process.stderr.write(`markspot ${VERSION} MCP server on stdio\n`);
      return new Promise<number>(() => {}); // vit tant que Claude Code garde stdin ouvert
    }
    case "install":
    case "uninstall":
    case "doctor": {
      const { values } = parseArgs({
        args: rest,
        options: { "chrome-profile": { type: "string" }, cdp: { type: "string" } },
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
