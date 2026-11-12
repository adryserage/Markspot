// Hôte natif : Chrome le lance quand l'extension appelle connectNative, et le tue
// quand le port se ferme. Il est donc unique tant que Chrome n'en ouvre qu'un.

import type { Readable, Writable } from "node:stream";
import {
  MAX_FRAME_TO_EXTENSION,
  MAX_FRAME_TO_HOST,
  parseExtensionMessage,
  type ExtensionToHost,
  type HostToExtension,
} from "../core/protocol.ts";

export function encodeFrame(message: HostToExtension): Buffer {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  if (body.length > MAX_FRAME_TO_EXTENSION) {
    throw new Error(`frame of ${body.length} bytes exceeds the 1 MB limit to the extension`);
  }
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length);
  return Buffer.concat([header, body]);
}

/** Recolle les trames coupées entre plusieurs morceaux de stdin. */
export class FrameDecoder {
  #buffer = Buffer.alloc(0);

  push(chunk: Buffer): unknown[] {
    this.#buffer = Buffer.concat([this.#buffer, chunk]);
    const messages: unknown[] = [];
    while (this.#buffer.length >= 4) {
      const length = this.#buffer.readUInt32LE(0);
      if (length > MAX_FRAME_TO_HOST) throw new Error(`frame of ${length} bytes exceeds the 64 MB limit`);
      if (this.#buffer.length < 4 + length) break;
      messages.push(JSON.parse(this.#buffer.subarray(4, 4 + length).toString("utf8")));
      this.#buffer = this.#buffer.subarray(4 + length);
    }
    return messages;
  }
}

export interface HostOptions {
  /** chrome-extension://<id>/ attendu ; Chrome passe l'origine réelle en premier argument. */
  expectedOrigin: string;
  origin: string | undefined;
  version: string;
  input: Readable;
  output: Writable;
}

export function handle(message: ExtensionToHost, version: string): HostToExtension {
  switch (message.type) {
    case "ping":
      return { type: "pong", version, node: process.version };
  }
}

/** Se termine quand Chrome ferme stdin. Rend le code de sortie. */
export function runHost(options: HostOptions): Promise<number> {
  const { input, output } = options;
  const send = (message: HostToExtension) => output.write(encodeFrame(message));

  if (options.origin !== options.expectedOrigin) {
    send({ type: "rejected", reason: `unexpected caller ${options.origin ?? "(none)"}` });
    return Promise.resolve(1);
  }

  const decoder = new FrameDecoder();
  return new Promise((resolve) => {
    input.on("data", (chunk: Buffer) => {
      for (const raw of decoder.push(chunk)) {
        const message = parseExtensionMessage(raw);
        send(message ? handle(message, options.version) : { type: "rejected", reason: "unknown message" });
      }
    });
    input.on("end", () => resolve(0));
  });
}
