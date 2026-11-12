// Port natif vers l'hôte. Chaque requête porte un numéro que sa réponse reprend ;
// les poussées (note réglée, retirée) vont aux écouteurs. À la déconnexion, toutes les
// requêtes en attente échouent tout de suite, puis le port se rouvre avec un délai croissant.

import {
  HOST_NAME,
  isReply,
  type ExtensionToHost,
  type HostPush,
  type HostReply,
  type HostToExtension,
} from "../../src/core/protocol.ts";

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;
export type HostRequest = DistributiveOmit<ExtensionToHost, "requestId">;

const RETRY_MIN_MS = 1_000;
const RETRY_MAX_MS = 60_000;
const REPLY_TIMEOUT_MS = 15_000;

interface Pending {
  resolve(reply: HostReply): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

export interface HostLink {
  readonly connected: boolean;
  readonly lastError: string | null;
  request(message: HostRequest): Promise<HostReply>;
  onPush(listener: (push: HostPush) => void): void;
  /** Appelé à chaque ouverture réussie du port (après le premier message reçu). */
  onConnected(listener: () => void): void;
  connect(): void;
}

export function createHostLink(enabled: boolean): HostLink {
  let port: chrome.runtime.Port | null = null;
  let ready = false;
  let lastError: string | null = enabled ? null : "native host disabled in this build";
  let retryMs = RETRY_MIN_MS;
  let nextId = 0;
  const pending = new Map<number, Pending>();
  const pushListeners: Array<(push: HostPush) => void> = [];
  const connectedListeners: Array<() => void> = [];

  function failAll(reason: string): void {
    for (const [id, waiter] of pending) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error(reason));
      pending.delete(id);
    }
  }

  function onMessage(message: HostToExtension): void {
    retryMs = RETRY_MIN_MS;
    lastError = null;
    if (isReply(message)) {
      const waiter = message.requestId === null ? undefined : pending.get(message.requestId);
      if (!waiter) return;
      pending.delete(message.requestId as number);
      clearTimeout(waiter.timer);
      waiter.resolve(message);
      return;
    }
    for (const listener of pushListeners) listener(message);
  }

  function connect(): void {
    if (!enabled || port) return;
    const opened = chrome.runtime.connectNative(HOST_NAME);
    port = opened;
    ready = false;
    opened.onMessage.addListener(onMessage);
    opened.onDisconnect.addListener(() => {
      lastError = chrome.runtime.lastError?.message ?? "host closed the port";
      port = null;
      ready = false;
      failAll(lastError);
      setTimeout(connect, retryMs);
      retryMs = Math.min(retryMs * 2, RETRY_MAX_MS);
    });
    // Le port s'ouvre sans erreur même si l'hôte est absent : un ping confirme la connexion.
    void link.request({ type: "ping" }).then(
      () => {
        ready = true;
        for (const listener of connectedListeners) listener();
      },
      () => undefined,
    );
  }

  const link: HostLink = {
    get connected() {
      return port !== null && ready;
    },
    get lastError() {
      return lastError;
    },
    request(message) {
      connect();
      const current = port;
      if (!current) return Promise.reject(new Error(lastError ?? "no native port"));
      const requestId = ++nextId;
      return new Promise<HostReply>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(requestId);
          reject(new Error(lastError ?? "no reply from the native host"));
        }, REPLY_TIMEOUT_MS);
        pending.set(requestId, { resolve, reject, timer });
        current.postMessage({ ...message, requestId });
      });
    },
    onPush: (listener) => void pushListeners.push(listener),
    onConnected: (listener) => void connectedListeners.push(listener),
    connect,
  };
  return link;
}
