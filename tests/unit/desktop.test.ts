import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { LOCAL_SCOPE, LOCAL_USER } from "../../src/core/model.ts";
import { DESKTOP_TOOLS, pngSize } from "../../src/mcp/desktop.ts";
import { createServer } from "../../src/mcp/server.ts";
import { startWaitListener } from "../../src/mcp/wait-listener.ts";
import { openAgentStore, openHostStore } from "../../src/store/store.ts";

const dirs: string[] = [];
const closers: Array<() => Promise<void>> = [];
after(async () => {
  for (const close of closers) await close();
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
});

/** PNG de 1 x 1. */
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const URL_ = "http://localhost:3000/prix";

async function setup(desktopSend: boolean) {
  const dataDir = await mkdtemp(join(tmpdir(), "markspot-desktop-"));
  dirs.push(dataDir);
  const config = { dataDir, scope: LOCAL_SCOPE, dispatchKey: randomBytes(32) };
  const host = await openHostStore(config);
  if (desktopSend) await host.setDesktopSend(true);
  const agent = await openAgentStore(config);
  const server = createServer(agent, "0.5.0", { desktopSend: await agent.desktopSend(), featurePollMs: 20 });
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: "claude-desktop-test", version: "1.0.0" });
  await client.connect(clientSide);
  closers.push(async () => {
    await client.close();
    await server.close();
  });
  const names = async () => (await client.listTools()).tools.map((t) => t.name);
  const call = (name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args });
  return { config, host, client, names, call };
}

const textOf = (result: unknown) => ((result as { content: Array<{ text: string }> }).content[0]?.text ?? "");

async function eventually(check: () => Promise<boolean>, what: string): Promise<void> {
  const deadline = Date.now() + 3000;
  while (!(await check())) {
    if (Date.now() > deadline) assert.fail(what);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

const note = { url: URL_, title: "Prix", selector: "#acheter", tag: "button", element_text: "Acheter", comment: "Le bouton déborde sur mobile" };

test("option off: the Claude Desktop tools are hidden and a call is refused", async () => {
  const t = await setup(false);
  const tools = await t.names();
  assert.ok(tools.includes("markspot_list_annotations"), "the Claude Code tools stay");
  for (const name of DESKTOP_TOOLS) assert.ok(!tools.includes(name), `${name} hidden`);
  await assert.rejects(t.call("markspot_create_annotation", note));
  assert.deepEqual(await t.host.list(), [], "nothing written");
});

test("option turned on while running: the tools appear, and disappear when it is turned off", async () => {
  const t = await setup(false);
  await t.host.setDesktopSend(true);
  await eventually(async () => (await t.names()).includes("markspot_send"), "tools shown");
  for (const name of DESKTOP_TOOLS) assert.ok((await t.names()).includes(name));
  await t.host.setDesktopSend(false);
  await eventually(async () => !(await t.names()).includes("markspot_send"), "tools hidden again");
});

test("option turned off just before a call: the tool refuses without writing", async () => {
  const t = await setup(true);
  assert.ok((await t.names()).includes("markspot_create_annotation"));
  await t.host.setDesktopSend(false);
  const result = await t.call("markspot_create_annotation", note).catch((error: Error) => ({ isError: true, content: [{ text: error.message }] }));
  assert.equal((result as { isError?: boolean }).isError, true);
  assert.deepEqual(await t.host.list(), [], "nothing written");
});

test("a note created by Claude Desktop shows its author and keeps the screenshot it was given", async () => {
  const t = await setup(true);
  const result = await t.call("markspot_create_annotation", { ...note, zone_png: PNG, rect: { x: 10, y: 20, width: 30, height: 40 } });
  const created = result.structuredContent as { id: string; seq: number; screenshots: string[] };
  assert.equal(created.seq, 1);
  assert.deepEqual(created.screenshots, ["zone"]);
  const [thread] = await t.host.list();
  assert.deepEqual(thread?.annotation.author, { kind: "agent", id: "claude-desktop", name: "Claude Desktop" });
  assert.equal(thread?.annotation.mark.anchor.selector, "#acheter");
  assert.deepEqual(Object.keys(thread?.annotation.captures ?? {}), ["zone"]);
  assert.equal(thread?.annotation.captures.zone?.width, 1);
  assert.ok(await t.host.capture(thread!.annotation.id, "zone"));
  assert.equal(await t.host.capture(thread!.annotation.id, "context"), null);

  const read = await t.call("markspot_get_annotation", { id: created.id });
  const content = read.content as Array<{ type: string; text?: string }>;
  assert.match(content[0]!.text!, /Comment written by Claude Desktop/);
  assert.deepEqual(content.map((c) => c.type), ["text", "image"], "one image, the one given");
});

test("a note without any screenshot is read by Claude Code without an image", async () => {
  const t = await setup(true);
  const created = (await t.call("markspot_create_annotation", note)).structuredContent as { id: string };
  const read = await t.call("markspot_get_annotation", { id: created.id });
  const content = read.content as Array<{ type: string; text?: string }>;
  assert.deepEqual(content.map((c) => c.type), ["text"]);
  assert.match(content[0]!.text!, /No screenshot/);
  assert.match(textOf(await t.call("markspot_list_annotations", {})), /from Claude Desktop/);
});

test("anything but a PNG is refused, and nothing is written", async () => {
  const t = await setup(true);
  const result = await t.call("markspot_create_annotation", { ...note, zone_png: Buffer.from("GIF89a not a png at all").toString("base64") });
  assert.equal(result.isError, true);
  assert.match(textOf(result), /not a PNG/);
  assert.deepEqual(await t.host.list(), []);
  assert.equal(pngSize(Buffer.from(PNG, "base64"))?.width, 1);
  assert.equal(pngSize(new Uint8Array(30)), null);
});

test("send: the listening session is listed, and the signed dispatch reaches it with the chosen notes only", async () => {
  const t = await setup(true);
  const waiter = startWaitListener({
    dataDir: t.config.dataDir,
    store: await openAgentStore(t.config),
    name: "boutique",
    auth: { key: t.config.dispatchKey, consumedDir: join(t.config.dataDir, "consumed") },
    beatMs: 50,
  });
  closers.push(() => waiter.stop());
  assert.equal(await waiter.next(), null, "the session announces itself");

  const sessions = (await t.call("markspot_list_sessions", { url: URL_ })).structuredContent as { sessions: Array<{ name: string }> };
  assert.deepEqual(sessions.sessions.map((s) => s.name), ["boutique"]);

  const ids: string[] = [];
  for (const comment of ["Premier", "Deuxième", "Troisième"]) {
    ids.push(((await t.call("markspot_create_annotation", { ...note, comment })).structuredContent as { id: string }).id);
  }
  const sent = await t.call("markspot_send", { ids: [ids[0], ids[2]], to: "boutique" });
  assert.equal(sent.isError, undefined, textOf(sent));
  assert.deepEqual(sent.structuredContent, { sent: 2, to: "boutique", host: (sent.structuredContent as { host: string }).host, listening: 1 });

  const got = await waiter.next();
  assert.deepEqual(got?.open.map((n) => n.annotation.comment), ["Premier", "Troisième"]);
});

test("send refuses an unknown id, a resolved note and notes from two pages", async () => {
  const t = await setup(true);
  const a = ((await t.call("markspot_create_annotation", note)).structuredContent as { id: string }).id;
  const b = ((await t.call("markspot_create_annotation", { ...note, url: "http://localhost:3000/panier" })).structuredContent as { id: string }).id;
  const c = ((await t.call("markspot_create_annotation", note)).structuredContent as { id: string }).id;
  await t.host.resolve(c as never, "Fait", LOCAL_USER);
  for (const [ids, reason] of [
    [["01JD8000000000000000000999"], /No note/],
    [[c], /already resolved/],
    [[a, b], /different pages/],
  ] as const) {
    const result = await t.call("markspot_send", { ids, to: "boutique" });
    assert.equal(result.isError, true);
    assert.match(textOf(result), reason);
  }
});
