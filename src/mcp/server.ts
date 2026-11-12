// Serveur MCP stdio, un par session Claude Code. Il lit le dossier des notes et n'écrit
// que les résolutions : plusieurs sessions peuvent tourner en même temps.

import { randomBytes } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { stateOf, type AnnotationId, type Thread } from "../core/model.ts";
import { REPLY_MAX, parseAnnotationId } from "../core/schema.ts";
import type { AgentStore } from "../store/store.ts";
import { renderSummary, renderThread, summary } from "./render.ts";

const AGENT = { kind: "agent", id: "claude-code", name: "Claude" } as const;
const CHARACTER_LIMIT = 25_000;
/** Une image plus grosse n'est pas jointe : Claude reçoit son chemin à la place. */
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

function idOrThrow(raw: string): AnnotationId {
  const id = parseAnnotationId(raw);
  if (!id) throw new Error(`Invalid id "${raw}". Use an id from markspot_list_annotations.`);
  return id;
}

export function createServer(store: AgentStore, version: string, listenCommand?: string): McpServer {
  const instructions = listenCommand
    ? `To listen for notes the user sends with the "Envoyer à Claude" button, run \`"${listenCommand}" listen\` as a background command (keep the quotes); it exits when notes arrive (exit 0, prints them), or after an hour (exit 2). Relaunch it before handling the notes.`
    : undefined;
  const server = new McpServer({ name: "markspot", version }, instructions ? { instructions } : {});

  server.registerTool(
    "markspot_list_annotations",
    {
      title: "List annotations",
      description:
        "List the visual notes the user left on web pages with the Markspot browser extension: id, pin number, " +
        "state, the site's origin (data from the site) and the user's comment. Call markspot_get_annotation for the " +
        "page, the marked element and the screenshots.",
      inputSchema: z.strictObject({
        state: z.enum(["open", "resolved", "all"]).default("open").describe("open (default), resolved or all"),
        url: z.string().optional().describe("Keep notes whose page URL starts with this, e.g. http://localhost:3000"),
        limit: z.number().int().min(1).max(100).default(20),
        offset: z.number().int().min(0).default(0),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ state, url, limit, offset }) => {
      const threads = await store.list({
        ...(state === "all" ? {} : { state }),
        ...(url ? { urlPrefix: url } : {}),
      });
      let count = Math.min(limit, Math.max(0, threads.length - offset));
      let page = threads.slice(offset, offset + count).map(summary);
      const build = () => ({
        total: threads.length,
        count: page.length,
        offset,
        has_more: offset + page.length < threads.length,
        ...(offset + page.length < threads.length ? { next_offset: offset + page.length } : {}),
        annotations: page,
      });
      while (JSON.stringify(build()).length > CHARACTER_LIMIT && count > 1) {
        count = Math.ceil(count / 2);
        page = page.slice(0, count);
      }
      const result = build();
      const text =
        result.total === 0
          ? "No notes match. The user creates them with Alt+C in the browser."
          : `${threads.slice(offset, offset + page.length).map(renderSummary).join("\n")}\n\n${JSON.stringify(result)}`;
      return { content: [{ type: "text", text }], structuredContent: result };
    },
  );

  server.registerTool(
    "markspot_wait_for_annotations",
    {
      title: "Wait for new annotations",
      description:
        "Listen mode: return the open notes with a pin number above after_seq (default 0, so the first call returns " +
        "every open note at once), or wait until the user leaves one in the browser. Same fields as " +
        "markspot_list_annotations. Pass last_seq from the previous call as after_seq to keep listening without " +
        "missing or repeating a note. Returns an empty list when the timeout expires.",
      inputSchema: z.strictObject({
        after_seq: z.number().int().min(0).default(0).describe("Return notes with a pin number above this (last_seq of the previous call)"),
        url: z.string().optional().describe("Only notes whose page URL starts with this"),
        timeout_seconds: z.number().int().min(5).max(600).default(300),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ after_seq, url, timeout_seconds }, ctx) => {
      const signal = (ctx as { mcpReq?: { signal?: AbortSignal } } | undefined)?.mcpReq?.signal;
      const filter = url ? { urlPrefix: url } : {};
      // Par numéro de pastille, pas par date : les horloges du navigateur et de ce poste peuvent différer.
      const baseline = after_seq;
      const deadline = Date.now() + timeout_seconds * 1000;
      while (Date.now() < deadline && !signal?.aborted) {
        const fresh = (await store.list({ ...filter, state: "open" })).filter((t) => t.annotation.seq > baseline);
        if (fresh.length > 0) {
          // 20 au plus ; last_seq est celui de la dernière rendue, pour que l'appel suivant prenne la suite.
          const batch = fresh.slice(0, 20);
          const result = {
            last_seq: batch[batch.length - 1]!.annotation.seq,
            more: fresh.length > batch.length,
            annotations: batch.map(summary),
          };
          return {
            content: [{ type: "text", text: `${batch.map(renderSummary).join("\n")}\n\n${JSON.stringify(result)}` }],
            structuredContent: result,
          };
        }
        await new Promise<void>((resolve) => {
          const done = () => {
            clearTimeout(timer);
            signal?.removeEventListener("abort", done);
            resolve();
          };
          const timer = setTimeout(done, 2000);
          signal?.addEventListener("abort", done, { once: true });
        });
      }
      const result = { last_seq: baseline, more: false, annotations: [] as ReturnType<typeof summary>[] };
      return {
        content: [{ type: "text", text: `No new note after ${timeout_seconds} s. Call again with after_seq ${baseline} to keep listening.\n\n${JSON.stringify(result)}` }],
        structuredContent: result,
      };
    },
  );

  server.registerTool(
    "markspot_get_annotation",
    {
      title: "Get annotation",
      description:
        "Full data of one note: the user's comment, the page URL, the marked element (selector, text, attributes, " +
        "computed styles), and two images: a close-up of the marked zone and the whole screen with the zone framed.",
      inputSchema: z.strictObject({ id: z.string().describe("Note id from markspot_list_annotations") }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ id }) => {
      const noteId = idOrThrow(id);
      const thread = await store.get(noteId);
      if (!thread) throw new Error(`No note ${id}. It may have been cleared; list again.`);
      const token = randomBytes(8).toString("hex");
      const text = renderThread(
        thread,
        { zone: store.capturePath(noteId, "zone"), context: store.capturePath(noteId, "context") },
        token,
      );
      const content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }> = [
        { type: "text", text },
      ];
      for (const kind of ["zone", "context"] as const) {
        const png = await store.capture(noteId, kind);
        if (png && png.length <= MAX_IMAGE_BYTES) {
          content.push({ type: "image", data: Buffer.from(png).toString("base64"), mimeType: "image/png" });
        }
      }
      return { content };
    },
  );

  server.registerTool(
    "markspot_resolve_annotation",
    {
      title: "Resolve annotation",
      description:
        "Mark a note resolved and attach the reply the user reads on the page. Call it after the fix is verified " +
        "in the browser. The first reply wins: calling again with the same reply changes nothing.",
      inputSchema: z.strictObject({
        id: z.string(),
        reply: z.string().min(1).max(REPLY_MAX).describe("What was changed, in the user's language, one or two sentences"),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ id, reply }) => {
      const outcome = await store.resolve(idOrThrow(id), reply, AGENT);
      switch (outcome.kind) {
        case "not_found":
          throw new Error(`No note ${id}. It may have been cleared; list again.`);
        case "already_resolved":
          return {
            content: [
              {
                type: "text",
                text: `Note ${outcome.thread.annotation.seq} was already resolved ${outcome.thread.resolution?.author.kind === "user" ? "by the user" : "by another session"} with: ${outcome.thread.resolution?.reply ?? ""}`,
              },
            ],
          };
        default:
          return { content: [{ type: "text", text: `Resolved note ${outcome.thread.annotation.seq} (${id}).` }] };
      }
    },
  );

  server.registerTool(
    "markspot_clear_annotations",
    {
      title: "Clear annotations",
      description:
        "Permanently delete notes and their screenshots. `state` is required: pass \"resolved\" to tidy up, " +
        "\"all\" only when the user asked to delete open notes too.",
      inputSchema: z.strictObject({
        state: z.enum(["resolved", "open", "all"]),
        url: z.string().optional().describe("Only notes whose page URL starts with this"),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ state, url }) => {
      const removed = await store.clear({ state, ...(url ? { urlPrefix: url } : {}) });
      return { content: [{ type: "text", text: `Deleted ${removed.length} note${removed.length === 1 ? "" : "s"}.` }] };
    },
  );

  return server;
}
