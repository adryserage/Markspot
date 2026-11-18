// Essai du déroulé Claude Desktop sur le programme construit : un client MCP joue Claude Desktop,
// une vraie écoute (markspot listen) joue la session Claude Code. Dossiers jetables sur les trois
// systèmes (LOCALAPPDATA sous Windows, XDG ailleurs) : rien ne touche les vraies notes.
// Lancer : npm run build && node tests/smoke-desktop.ts

import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { currentPlatform, pathsFor } from "../src/core/paths.ts";
import { LOCAL_SCOPE } from "../src/core/model.ts";
import { openHostStore } from "../src/store/store.ts";

const CLI = join(import.meta.dirname, "..", "dist", "cli.js");
const DESKTOP = ["markspot_list_sessions", "markspot_create_annotation", "markspot_send"];
const PAGE = "http://localhost:3000/plans";
const COMMENT = "The Starter button runs past its card. Make it fit the card width.";

const root = await mkdtemp(join(tmpdir(), "markspot-desktop-"));
const env = {
  ...getDefaultEnvironment(),
  LOCALAPPDATA: join(root, "local"),
  HOME: root,
  XDG_CONFIG_HOME: join(root, ".config"),
  XDG_DATA_HOME: join(root, "share"),
};
const paths = pathsFor(currentPlatform(), env, root);
const text = (result: unknown) => ((result as { content: { text: string }[] }).content[0]?.text ?? "");
const toolNames = async (client: Client) => (await client.listTools()).tools.map((t) => t.name);

async function until<T>(what: string, probe: () => Promise<T | undefined>, ms = 8000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const value = await probe();
    if (value !== undefined) return value;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

let listener: ReturnType<typeof spawn> | undefined;
const client = new Client({ name: "smoke-desktop", version: "1" });
try {
  const key = randomBytes(32);
  await mkdir(dirname(paths.keyFile), { recursive: true });
  await writeFile(paths.keyFile, key.toString("base64"));
  await mkdir(paths.dataDir, { recursive: true });
  const store = await openHostStore({ dataDir: paths.dataDir, scope: LOCAL_SCOPE, dispatchKey: key });

  await client.connect(new StdioClientTransport({ command: process.execPath, args: [CLI, "mcp"], env, cwd: root }));
  assert.deepEqual((await toolNames(client)).filter((n) => DESKTOP.includes(n)), [], "option off: no Desktop tools");
  console.log("ok: option off, the three Desktop tools are hidden");

  // Ce que fait l'hôte quand on coche « Claude Desktop can send notes ».
  assert.equal(await store.setDesktopSend(true), true);
  await until("the Desktop tools", async () => ((await toolNames(client)).filter((n) => DESKTOP.includes(n)).length === 3 ? true : undefined));
  console.log("ok: option on, the tools appear without restarting the MCP server");

  let out = "";
  listener = spawn(process.execPath, [CLI, "listen", "--name", "demo-session", "--timeout", "60"], { env, cwd: root });
  listener.stdout?.on("data", (d) => (out += d));
  const exited = new Promise<number | null>((resolve) => listener?.on("exit", resolve));

  const sessions = await until("the listening session", async () => {
    const reply = text(await client.callTool({ name: "markspot_list_sessions", arguments: { url: PAGE } }));
    return reply.includes("demo-session") ? reply : undefined;
  });
  console.log("ok: markspot_list_sessions sees the listening session");
  void sessions;

  const created = await client.callTool({
    name: "markspot_create_annotation",
    arguments: { url: PAGE, title: "Plans", selector: "#buy-starter", tag: "button", element_text: "Start Starter", comment: COMMENT },
  });
  assert.ok(!created.isError, `create failed: ${text(created)}`);
  const structured = (created as { structuredContent?: { id?: string } }).structuredContent;
  const id = structured?.id ?? /\(([0-9A-Z]{26})\)/.exec(text(created))?.[1];
  assert.ok(id, `no note id in the reply: ${text(created)}`);
  const [thread] = (await store.list()).filter((t) => t.annotation.id === id);
  assert.equal(thread?.annotation.author.name, "Claude Desktop", "the note is signed Claude Desktop");
  console.log(`ok: note ${id} created, author Claude Desktop, no screenshot`);

  const sent = await client.callTool({ name: "markspot_send", arguments: { ids: [id], to: "demo-session" } });
  assert.ok(!sent.isError, `send failed: ${text(sent)}`);
  const code = await Promise.race([exited, new Promise<"timeout">((r) => setTimeout(() => r("timeout"), 20000))]);
  assert.equal(code, 0, `the listener did not wake up (exit ${String(code)}): ${out}`);
  assert.ok(out.includes(COMMENT), "the listener prints the note's comment");
  console.log("ok: the listening session woke up and received the note");

  assert.equal(await store.setDesktopSend(false), false);
  const refused = await client.callTool({ name: "markspot_send", arguments: { ids: [id], to: "demo-session" } }).catch((e: Error) => ({ isError: true, content: [{ text: e.message }] }));
  assert.ok(refused.isError, "option off again: markspot_send is refused");
  console.log("ok: option off again, markspot_send is refused");
} finally {
  listener?.kill();
  await client.close().catch(() => undefined);
  await rm(root, { recursive: true, force: true });
}
