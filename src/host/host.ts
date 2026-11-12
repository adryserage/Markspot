// Hôte natif : Chrome ou Brave le lance quand l'extension appelle connectNative, et le
// tue quand le port se ferme. Il écrit les notes que la page envoie et pousse à
// l'extension les changements faits par les serveurs MCP (note réglée, retirée).

import type { Readable, Writable } from "node:stream";
import { fromBase64 } from "../core/base64.ts";
import type { NewAnnotation } from "../core/model.ts";
import {
  MAX_CAPTURE_TO_EXTENSION,
  MAX_FRAME_TO_EXTENSION,
  MAX_FRAME_TO_HOST,
  type ExtensionToHost,
  type HostToExtension,
} from "../core/protocol.ts";
import { ExtensionToHostSchema } from "../core/schema.ts";
import type { HostStore } from "../store/store.ts";

export function encodeFrame(message: HostToExtension): Buffer {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  if (body.length > MAX_FRAME_TO_EXTENSION) {
    throw new Error(`frame of ${body.length} bytes exceeds the 1 MB limit to the extension`);
  }
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length);
  return Buffer.concat([header, body]);
}

export type Decoded = { ok: true; value: unknown } | { ok: false; error: string };

/** Recolle les trames coupées entre plusieurs morceaux de stdin. Ne lève jamais. */
export class FrameDecoder {
  #buffer = Buffer.alloc(0);
  #broken = false;

  get broken(): boolean {
    return this.#broken;
  }

  push(chunk: Buffer): Decoded[] {
    if (this.#broken) return [];
    this.#buffer = Buffer.concat([this.#buffer, chunk]);
    const out: Decoded[] = [];
    while (this.#buffer.length >= 4) {
      const length = this.#buffer.readUInt32LE(0);
      if (length > MAX_FRAME_TO_HOST) {
        // Flux désynchronisé : impossible de retrouver le début de la trame suivante.
        this.#broken = true;
        out.push({ ok: false, error: `frame of ${length} bytes exceeds the 64 MB limit` });
        return out;
      }
      if (this.#buffer.length < 4 + length) break;
      const body = this.#buffer.subarray(4, 4 + length).toString("utf8");
      this.#buffer = this.#buffer.subarray(4 + length);
      try {
        out.push({ ok: true, value: JSON.parse(body) });
      } catch {
        out.push({ ok: false, error: "invalid JSON frame" });
      }
    }
    return out;
  }
}

export interface HostOptions {
  /** chrome-extension://<id>/ attendu ; le navigateur passe l'origine réelle en premier argument. */
  expectedOrigin: string;
  origin: string | undefined;
  version: string;
  input: Readable;
  output: Writable;
  /** Ouvert seulement après le contrôle d'origine. */
  openStore: () => Promise<HostStore>;
}

function requestIdOf(raw: unknown): number | null {
  const id = (raw as { requestId?: unknown } | null)?.requestId;
  return typeof id === "number" ? id : null;
}

async function handle(
  message: ExtensionToHost,
  store: HostStore,
  version: string,
  send: (m: HostToExtension) => void,
): Promise<void> {
  switch (message.type) {
    case "ping":
      send({ type: "pong", requestId: message.requestId, version, node: process.version });
      return;
    case "sync":
      for (const thread of await store.list()) send({ type: "thread", thread });
      send({ type: "synced", requestId: message.requestId });
      return;
    case "create": {
      const thread = await store.create(message.annotation as NewAnnotation, {
        zone: fromBase64(message.pngs.zone),
        context: fromBase64(message.pngs.context),
      });
      send({ type: "created", requestId: message.requestId, thread });
      return;
    }
    case "capture": {
      const png = await store.capture(message.id, "zone");
      const fits = png !== null && png.length * 1.34 < MAX_CAPTURE_TO_EXTENSION;
      send({ type: "capture", requestId: message.requestId, png: fits ? Buffer.from(png).toString("base64") : null });
      return;
    }
  }
}

/** Se termine quand le navigateur ferme stdin. Rend le code de sortie. */
export async function runHost(options: HostOptions): Promise<number> {
  const { input, output } = options;
  const send = (message: HostToExtension) => {
    try {
      output.write(encodeFrame(message));
    } catch (error) {
      output.write(encodeFrame({ type: "rejected", requestId: null, reason: (error as Error).message }));
    }
  };

  if (options.origin !== options.expectedOrigin) {
    send({ type: "rejected", requestId: null, reason: `unexpected caller ${options.origin ?? "(none)"}` });
    return 1;
  }

  const store = await options.openStore();
  const watcher = store.watch((change) =>
    send(change.kind === "upserted" ? { type: "thread", thread: change.thread } : { type: "removed", id: change.id }),
  );
  const decoder = new FrameDecoder();
  let queue = Promise.resolve();

  return new Promise((resolve) => {
    input.on("data", (chunk: Buffer) => {
      for (const frame of decoder.push(chunk)) {
        // Une requête à la fois, dans l'ordre d'arrivée.
        queue = queue.then(async () => {
          if (!frame.ok) {
            send({ type: "rejected", requestId: null, reason: frame.error });
            return;
          }
          const parsed = ExtensionToHostSchema.safeParse(frame.value);
          if (!parsed.success) {
            send({ type: "rejected", requestId: requestIdOf(frame.value), reason: "invalid message" });
            return;
          }
          try {
            await handle(parsed.data as ExtensionToHost, store, options.version, send);
          } catch (error) {
            send({ type: "rejected", requestId: parsed.data.requestId, reason: (error as Error).message });
          }
        });
      }
      if (decoder.broken) input.destroy();
    });
    const finish = () => {
      watcher.close();
      void queue.then(() => resolve(decoder.broken ? 1 : 0));
    };
    input.on("end", finish);
    input.on("close", finish);
  });
}
