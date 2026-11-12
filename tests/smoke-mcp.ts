// Essai du serveur MCP construit : le lance sur stdio avec un dossier de notes temporaire,
// appelle ses outils comme Claude Code, et sort en erreur au moindre écart.
// Lancer : npm run build && node tests/smoke-mcp.ts

import { strict as assert } from "node:assert";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { LOCAL_SCOPE, STYLE_PROPS, type NewAnnotation } from "../src/core/model.ts";
import { NewAnnotationSchema } from "../src/core/schema.ts";
import { openHostStore } from "../src/store/store.ts";

const home = await mkdtemp(join(tmpdir(), "markspot-smoke-"));
try {
  // Un dossier personnel factice : le serveur y trouve config.json et le dossier des notes.
  const dataDir = join(home, "data");
  const configDir = join(home, ".config", "markspot");
  await mkdir(configDir, { recursive: true });
  await writeFile(join(configDir, "config.json"), JSON.stringify({ dataDir }));
  // La clé d'envoi du poste factice : le processus lancé la lit, le store de l'essai aussi.
  const dispatchKey = randomBytes(32);
  await writeFile(join(configDir, "dispatch.key"), dispatchKey.toString("base64"));

  const store = await openHostStore({ dataDir, scope: LOCAL_SCOPE, dispatchKey });
  const rect = { x: 1, y: 2, width: 3, height: 4 };
  const note = NewAnnotationSchema.parse({
    id: "01JD8000000000000000000001",
    scope: "local",
    createdAt: "2026-11-12T08:15:00.000Z",
    author: { kind: "user", id: "local", name: "local" },
    source: { kind: "extension", trust: "owner" },
    page: { url: "http://localhost:3000/prix", title: "Prix" },
    mark: {
      kind: "element",
      anchor: { selector: "#acheter", tag: "button", role: null, text: "Acheter", attributes: {}, styles: Object.fromEntries(STYLE_PROPS.map((p) => [p, ""])) },
      rect,
      rectInAnchor: rect,
    },
    viewport: { width: 1000, height: 800, devicePixelRatio: 1, scrollX: 0, scrollY: 0 },
    comment: "Le bouton déborde",
    captures: { zone: { rect, width: 3, height: 4 }, context: { rect, width: 10, height: 8 } },
  }) as unknown as NewAnnotation;
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  await store.create(note, { zone: png, context: png });

  const client = new Client({ name: "markspot-smoke", version: "1.0.0" });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: ["dist/cli.js", "mcp"],
      env: { ...getDefaultEnvironment(), HOME: home, XDG_CONFIG_HOME: join(home, ".config"), XDG_DATA_HOME: join(home, "share") },
    }),
  );

  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), [
    "markspot_clear_annotations",
    "markspot_get_annotation",
    "markspot_list_annotations",
    "markspot_resolve_annotation",
    "markspot_wait_for_annotations",
  ]);
  assert.equal(tools.find((t) => t.name === "markspot_clear_annotations")?.annotations?.destructiveHint, true);

  const list = await client.callTool({ name: "markspot_list_annotations", arguments: {} });
  assert.ok(!list.isError, JSON.stringify(list.content));
  assert.equal((list.structuredContent as { total: number }).total, 1);
  const listed = JSON.stringify(list.content) + JSON.stringify(list.structuredContent);
  for (const pageData of ["/prix", "#acheter", "Acheter"]) {
    assert.ok(!listed.includes(pageData), `the list must not carry page data (${pageData})`);
  }

  const get = await client.callTool({ name: "markspot_get_annotation", arguments: { id: note.id } });
  const content = get.content as Array<{ type: string }>;
  assert.deepEqual(content.map((c) => c.type), ["text", "image", "image"]);

  const first = await client.callTool({ name: "markspot_resolve_annotation", arguments: { id: note.id, reply: "Corrigé." } });
  assert.match(JSON.stringify(first.content), /Resolved note 1/);
  const again = await client.callTool({ name: "markspot_resolve_annotation", arguments: { id: note.id, reply: "Corrigé." } });
  assert.match(JSON.stringify(again.content), /Resolved note 1/);

  // Mode écoute : une note créée pendant l'attente réveille l'appel.
  const second = { ...note, id: "01JD8000000000000000000002" } as typeof note;
  const waiting = client.callTool({ name: "markspot_wait_for_annotations", arguments: { after_seq: 1, timeout_seconds: 20 } });
  setTimeout(() => void store.create(second, { zone: png, context: png }), 1000);
  const woke = await waiting;
  const wokeData = woke.structuredContent as { last_seq: number; annotations: Array<{ id: string }> };
  assert.deepEqual(wokeData.annotations.map((a) => a.id), [second.id]);
  const quiet = await client.callTool({
    name: "markspot_wait_for_annotations",
    arguments: { after_seq: wokeData.last_seq, timeout_seconds: 5 },
  });
  assert.deepEqual((quiet.structuredContent as { annotations: unknown[] }).annotations, []);

  const noState = await client.callTool({ name: "markspot_clear_annotations", arguments: {} });
  assert.equal(noState.isError, true, "clear without state must be refused");
  const badId = await client.callTool({ name: "markspot_get_annotation", arguments: { id: "../etc" } });
  assert.equal(badId.isError, true);

  const cleared = await client.callTool({ name: "markspot_clear_annotations", arguments: { state: "resolved" } });
  assert.match(JSON.stringify(cleared.content), /Deleted 1 note/); // la note réglée ; la seconde reste ouverte

  await client.close();

  // Canal : lancé comme par `markspot claude`, le serveur s'annonce, prend l'envoi visé et le
  // pousse dans la session, sans donnée de la page ; à la fermeture, son battement disparaît.
  const project = join(home, "projet-canal");
  await mkdir(project);
  const pushed: Array<{ content: string; meta: Record<string, string> }> = [];
  const channelClient = new Client({ name: "markspot-smoke", version: "1.0.0" });
  channelClient.fallbackNotificationHandler = async (n) => {
    if (n.method === "notifications/claude/channel") pushed.push(n.params as (typeof pushed)[number]);
  };
  await channelClient.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [join(process.cwd(), "dist/cli.js"), "mcp"],
      cwd: project,
      env: { ...getDefaultEnvironment(), HOME: home, XDG_CONFIG_HOME: join(home, ".config"), XDG_DATA_HOME: join(home, "share"), MARKSPOT_CHANNEL: "1" },
    }),
  );
  assert.ok(channelClient.getServerCapabilities()?.experimental?.["claude/channel"], "the channel capability is declared");
  let listeners = await store.listeners("http://localhost:3000/prix");
  for (let i = 0; i < 30 && listeners.length === 0; i++) {
    await new Promise((r) => setTimeout(r, 200));
    listeners = await store.listeners("http://localhost:3000/prix");
  }
  assert.deepEqual(listeners.map((l) => l.name), ["projet-canal"], "the MCP server announces its session");
  const sent = await store.send([second.id], "http://localhost:3000/prix", "projet-canal");
  assert.equal(sent.kind, "sent");
  for (let i = 0; i < 50 && pushed.length === 0; i++) await new Promise((r) => setTimeout(r, 200));
  assert.equal(pushed.length, 1, "the send reaches the session as a channel message");
  assert.match(pushed[0]!.content, new RegExp(second.id));
  assert.match(pushed[0]!.content, /Le bouton déborde/);
  assert.doesNotMatch(pushed[0]!.content, /#acheter|\/prix/, "no page data in the channel message");
  assert.equal(pushed[0]!.meta.notes, "1");
  await channelClient.close();
  for (let i = 0; i < 25 && (await store.listeners("http://localhost:3000/prix")).length > 0; i++) {
    await new Promise((r) => setTimeout(r, 200));
  }
  assert.deepEqual(await store.listeners("http://localhost:3000/prix"), [], "the heartbeat goes away with the session");
  console.error("MCP smoke test passed");
} finally {
  await rm(home, { recursive: true, force: true });
}
