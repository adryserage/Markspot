// Outils de Claude Desktop : préparer des notes sur une page, puis les envoyer à une session
// Claude Code qui écoute, par le même envoi signé que « Envoyer à Claude ».
// Visibles seulement quand l'option « Claude Desktop peut envoyer des notes » est cochée dans le
// menu de l'icône (features.json) ; chaque appel la relit aussi, au cas où la liste aurait du retard.

import type { McpServer, RegisteredTool } from "@modelcontextprotocol/server";
import { ulid } from "ulid";
import * as z from "zod/v4";
import { CAPTURE_KINDS, CLAUDE_DESKTOP, COMMENT_MAX, pageKeyOf, redactUrl, type AnnotationId, type CaptureKind, type NewAnnotation, type Thread } from "../core/model.ts";
import { NewAnnotationSchema, parseAnnotationId } from "../core/schema.ts";
import type { AgentStore, CapturePngs } from "../store/store.ts";

export const DESKTOP_TOOLS = ["markspot_list_sessions", "markspot_create_annotation", "markspot_send"] as const;

const OFF =
  'Markspot refuses: the option "Claude Desktop can send notes" is off. The user turns it on in the menu of the ' +
  "Markspot icon in the browser (right-click the icon).";

/** Une image plus grosse est refusée (10 Mo une fois décodée). */
const MAX_PNG_BASE64 = 14 * 1024 * 1024;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Largeur et hauteur lues dans l'en-tête IHDR, ou null si ce n'est pas un PNG. */
export function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24 || PNG_SIGNATURE.some((b, i) => bytes[i] !== b)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (String.fromCharCode(...bytes.subarray(12, 16)) !== "IHDR") return null;
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  return width > 0 && height > 0 ? { width, height } : null;
}

const RectInput = z.strictObject({
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().min(0),
  height: z.number().finite().min(0),
});

const Base64Png = z
  .string()
  .max(MAX_PNG_BASE64)
  .regex(/^[A-Za-z0-9+/]*={0,2}$/, "base64 without a data: prefix");

export const CreateInput = z.strictObject({
  url: z.string().min(1).max(2000).describe("Full URL of the page, as opened in your browser"),
  title: z.string().max(300).default("").describe("Page title"),
  selector: z.string().min(1).max(1000).describe("CSS selector that finds the element on that page with document.querySelector"),
  tag: z.string().min(1).max(40).describe("Tag name of the element, e.g. button"),
  element_text: z.string().default("").describe("Visible text of the element, first 80 characters"),
  comment: z.string().min(1).max(COMMENT_MAX).describe("The problem and the change you suggest, in the user's language"),
  rect: RectInput.optional().describe("Element box in CSS px from the top of the document, if you measured it"),
  zone_png: Base64Png.optional().describe("PNG screenshot of the element, base64"),
  context_png: Base64Png.optional().describe("PNG screenshot of the visible page, base64"),
});
export type CreateInput = z.output<typeof CreateInput>;

/** La note telle que l'écrit le dossier, à partir de ce que Claude Desktop donne. Lève sur une entrée invalide. */
export function desktopNote(input: CreateInput, id: AnnotationId, now: Date): { annotation: NewAnnotation; pngs: CapturePngs } {
  let url: string;
  try {
    url = redactUrl(input.url);
  } catch {
    throw new Error(`"${input.url}" is not a URL. Pass the full address of the page.`);
  }
  const rect = input.rect ?? { x: 0, y: 0, width: 0, height: 0 };
  const pngs: CapturePngs = {};
  const captures: Partial<Record<CaptureKind, { rect: typeof rect; width: number; height: number }>> = {};
  for (const kind of CAPTURE_KINDS) {
    const base64 = input[`${kind}_png`];
    if (base64 === undefined) continue;
    const bytes = new Uint8Array(Buffer.from(base64, "base64"));
    const size = pngSize(bytes);
    if (!size) throw new Error(`${kind}_png is not a PNG image in base64.`);
    pngs[kind] = bytes;
    captures[kind] = { rect: kind === "zone" ? rect : { x: 0, y: 0, width: 0, height: 0 }, ...size };
  }
  // Par le schéma des notes : mêmes bornes et mêmes champs vides que pour une note de la page.
  const annotation = NewAnnotationSchema.parse({
    id,
    scope: "local",
    createdAt: now.toISOString(),
    author: CLAUDE_DESKTOP,
    source: { kind: "mcp", trust: "owner" },
    page: { url, title: input.title },
    mark: {
      kind: "element",
      anchor: { selector: input.selector, tag: input.tag, role: null, text: input.element_text, attributes: {}, styles: {} },
      rect,
      // La pastille se place au coin haut-gauche de l'élément.
      rectInAnchor: { x: 0, y: 0, width: rect.width, height: rect.height },
    },
    comment: input.comment,
    captures,
  }) as unknown as NewAnnotation;
  return { annotation, pngs };
}

type ToolResult = { content: Array<{ type: "text"; text: string }>; structuredContent?: Record<string, unknown>; isError?: boolean };
const refuse = (text: string): ToolResult => ({ content: [{ type: "text", text }], isError: true });

/** Les notes à envoyer : connues, ouvertes et d'une même page. Rend la page, ou la raison du refus. */
async function sendable(store: AgentStore, rawIds: string[]): Promise<{ ids: AnnotationId[]; url: string } | { error: string }> {
  const threads: Thread[] = [];
  for (const raw of rawIds) {
    const id = parseAnnotationId(raw);
    const thread = id ? await store.get(id) : null;
    if (!thread) return { error: `No note ${raw}. Use the ids returned by markspot_create_annotation.` };
    if (thread.resolution) return { error: `Note ${thread.annotation.seq} (${raw}) is already resolved; only open notes are sent.` };
    threads.push(thread);
  }
  const pages = new Set(threads.map((t) => pageKeyOf(t.annotation.page.url)));
  if (pages.size > 1) return { error: "These notes are on different pages. Send the notes of one page at a time." };
  return { ids: threads.map((t) => t.annotation.id), url: threads[0]!.annotation.page.url };
}

/** Enregistre les trois outils. set(on) les montre ou les cache ; le SDK prévient le client (tools/list_changed). */
export function registerDesktopTools(server: McpServer, store: AgentStore, initiallyOn: boolean): { set(on: boolean): void } {
  const guarded =
    <A,>(run: (args: A) => Promise<ToolResult>) =>
    async (args: A): Promise<ToolResult> =>
      (await store.desktopSend()) ? run(args) : refuse(OFF);

  const tools: RegisteredTool[] = [
    server.registerTool(
      "markspot_list_sessions",
      {
        title: "List listening Claude Code sessions",
        description:
          "Markspot, for Claude Desktop: list the Claude Code sessions listening for notes on this page (project " +
          "name and computer), the same list as the page's \"Send to\" picker. Call it before markspot_send, show " +
          "the list to the user and ask which session should receive the notes. Never pick one yourself. An empty " +
          "list means nobody listens: ask the user to start one (`markspot claude`, or tell a Claude Code session " +
          "\"listen to my annotations\") and call again.",
        inputSchema: z.strictObject({ url: z.string().min(1).max(2000).describe("Full URL of the page the notes are for") }),
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      },
      guarded(async ({ url }: { url: string }) => {
        const sessions = (await store.listeners(url)).map((l) => ({ name: l.name, host: l.host, url_prefix: l.urlPrefix, since: l.since }));
        const text =
          sessions.length === 0
            ? "No Claude Code session is listening for this page."
            : sessions.map((s, i) => `${i + 1}. ${s.name || "(unnamed)"} on ${s.host || "unknown computer"}`).join("\n");
        return { content: [{ type: "text", text: `${text}\n\n${JSON.stringify({ sessions })}` }], structuredContent: { sessions } };
      }),
    ),
    server.registerTool(
      "markspot_create_annotation",
      {
        title: "Prepare a note on a page",
        description:
          "Markspot, for Claude Desktop: save one note on an element of a web page, after you looked at the page " +
          "with your browser tool. The note appears on the page as a numbered pin marked \"From Claude Desktop\", and " +
          "Claude Code reads it like the user's notes. Give a real CSS selector, the element's text and, when you " +
          "can, PNG screenshots. Creating a note sends nothing. Flow: 1) ask the user which session gets the notes " +
          "(markspot_list_sessions); 2) analyze the page and create one note per problem; 3) show the user the " +
          "prepared notes as a numbered list (pin number and comment) and ask which numbers to send; 4) call " +
          "markspot_send with only the notes the user confirmed. Returns the note id and its pin number.",
        inputSchema: CreateInput,
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      },
      guarded(async (input: CreateInput) => {
        const { annotation, pngs } = desktopNote(input, ulid() as AnnotationId, new Date());
        const thread = await store.create(annotation, pngs);
        const result = { id: thread.annotation.id, seq: thread.annotation.seq, screenshots: Object.keys(pngs) };
        return {
          content: [{ type: "text", text: `Created note ${result.seq} (${result.id}). Nothing is sent yet.\n\n${JSON.stringify(result)}` }],
          structuredContent: result,
        };
      }),
    ),
    server.registerTool(
      "markspot_send",
      {
        title: "Send notes to a Claude Code session",
        description:
          "Markspot, for Claude Desktop: send open notes of one page to the listening Claude Code session the user " +
          "chose, which wakes up, fixes them and resolves each note with a reply. Only call it after the user " +
          "explicitly confirmed which note numbers to send from the numbered list you showed, and which session " +
          "receives them; never send without that confirmation, and send only those notes. Afterwards, read the " +
          "replies with markspot_list_annotations (state resolved) or markspot_get_annotation, check the page again " +
          "in your browser and offer the user another pass.",
        inputSchema: z.strictObject({
          ids: z.array(z.string()).min(1).max(50).describe("Ids of the notes the user confirmed"),
          to: z.string().min(1).max(80).describe("Project name of the session the user chose, from markspot_list_sessions"),
          host: z.string().min(1).max(80).optional().describe("Computer of that session, from markspot_list_sessions"),
        }),
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      },
      guarded(async ({ ids, to, host }: { ids: string[]; to: string; host?: string | undefined }) => {
        const chosen = await sendable(store, ids);
        if ("error" in chosen) return refuse(chosen.error);
        const outcome = await store.send(chosen.ids, chosen.url, to, host);
        switch (outcome.kind) {
          case "nokey":
            return refuse("No dispatch key on this computer. The user runs `markspot install`, then you send again.");
          case "nobody":
            return refuse("No Claude Code session is listening for this page.");
          case "choose": {
            const list = outcome.listeners.map((l) => `${l.name} on ${l.host}`).join(", ");
            return refuse(`Several sessions named ${to} listen on different computers (${list}). Ask the user which one, then pass host.`);
          }
          case "sent": {
            const result = { sent: chosen.ids.length, to: outcome.to, host: outcome.host ?? null, listening: outcome.listening };
            const waiting = outcome.listening === 0 ? " Nobody listens under that name right now: the notes wait for that session for up to 24 hours." : "";
            return {
              content: [{ type: "text", text: `Sent ${result.sent} note${result.sent === 1 ? "" : "s"} to ${outcome.to}${outcome.host ? ` on ${outcome.host}` : ""}.${waiting}\n\n${JSON.stringify(result)}` }],
              structuredContent: result,
            };
          }
        }
      }),
    ),
  ];
  let on = initiallyOn;
  if (!on) for (const tool of tools) tool.disable();
  return {
    set(next) {
      if (next === on) return;
      on = next;
      for (const tool of tools) (on ? tool.enable() : tool.disable());
    },
  };
}
