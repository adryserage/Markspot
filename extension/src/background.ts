// Service worker de l'extension. Garde un port natif ouvert : tant qu'il est
// connecté, Chrome garde l'hôte en vie et ne met pas le service worker en veille.

import { HOST_NAME, type ExtensionToHost, type HostToExtension } from "../../src/core/protocol.ts";

const RETRY_MIN_MS = 1_000;
const RETRY_MAX_MS = 60_000;
const REPLY_TIMEOUT_MS = 5_000;

let port: chrome.runtime.Port | null = null;
let lastError: string | null = null;
let retryMs = RETRY_MIN_MS;
const waiting: Array<(message: HostToExtension) => void> = [];

function connect(): void {
  if (port) return;
  const opened = chrome.runtime.connectNative(HOST_NAME);
  port = opened;
  opened.onMessage.addListener((message: HostToExtension) => {
    retryMs = RETRY_MIN_MS;
    lastError = null;
    waiting.shift()?.(message);
  });
  opened.onDisconnect.addListener(() => {
    lastError = chrome.runtime.lastError?.message ?? "host closed the port";
    port = null;
    setTimeout(connect, retryMs);
    retryMs = Math.min(retryMs * 2, RETRY_MAX_MS);
  });
}

function request(message: ExtensionToHost): Promise<HostToExtension> {
  connect();
  const current = port;
  if (!current) return Promise.reject(new Error(lastError ?? "no native port"));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(lastError ?? "no reply from host")), REPLY_TIMEOUT_MS);
    waiting.push((reply) => {
      clearTimeout(timer);
      resolve(reply);
    });
    current.postMessage(message);
  });
}

/** Point d'accès pour `markspot doctor` et les tests, par CDP. */
const api = {
  ping: () => request({ type: "ping" }),
  status: () => ({ connected: port !== null, lastError }),
};

declare global {
  // eslint-disable-next-line no-var
  var markspot: typeof api;
}
globalThis.markspot = api;

chrome.runtime.onStartup.addListener(connect);
chrome.runtime.onInstalled.addListener(connect);
connect();
