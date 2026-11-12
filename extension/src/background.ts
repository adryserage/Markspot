// Service worker de l'extension.
// - Alt+C ou clic sur l'icône : injecte l'overlay dans l'onglet (activeTab), qui bascule le mode.
// - Messages de l'overlay : capture, enregistrement, liste des annotations de la page.
// - Version complète : garde un port natif ouvert vers l'hôte. La version d'essai n'en a pas.

import { ulid } from "ulid";
import {
  LOCAL_SCOPE,
  LOCAL_USER,
  redactUrl,
  type AnnotationId,
  type IsoTime,
} from "../../src/core/model.ts";
import { HOST_NAME, type ExtensionToHost, type HostToExtension } from "../../src/core/protocol.ts";
import { captureTab } from "./capture.ts";
import {
  capturePng,
  createFromDraft,
  discardDraft,
  exportAll,
  listForPage,
  purgeOldDrafts,
  putDraft,
} from "./local-store.ts";
import type { OverlayReply, OverlayRequest } from "./messages.ts";

declare const __MARKSPOT_NATIVE__: boolean;

// ------------------------------------------------------------------ overlay

async function injectOverlay(tab: chrome.tabs.Tab | undefined): Promise<void> {
  if (tab?.id === undefined) return;
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["dist/overlay.js"] });
    await chrome.action.setBadgeText({ tabId: tab.id, text: "" });
  } catch {
    await chrome.action.setBadgeText({ tabId: tab.id, text: "!" });
    await chrome.action.setTitle({ tabId: tab.id, title: "Markspot ne peut pas annoter cette page." });
  }
}

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command === "toggle-annotate") await injectOverlay(tab);
});
chrome.action.onClicked.addListener(injectOverlay);

// --------------------------------------------------------- icon menu

const EXPORT_MENU = "markspot-export";

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({ id: EXPORT_MENU, title: "Exporter les notes", contexts: ["action"] });
});

chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId === EXPORT_MENU) await chrome.tabs.create({ url: chrome.runtime.getURL("dist/export.html") });
});

async function answer(request: OverlayRequest, sender: chrome.runtime.MessageSender): Promise<OverlayReply> {
  switch (request.type) {
    case "capture": {
      const windowId = sender.tab?.windowId;
      if (windowId === undefined) return { ok: false, error: "No tab to capture." };
      const capture = await captureTab(windowId, request.zone, request.pageZone, request.viewport);
      const draftId = ulid();
      await putDraft(draftId, capture);
      return { ok: true, type: "captured", draftId, png: capture.png.zone };
    }
    case "save": {
      const annotation = await createFromDraft(request.draftId, (capture) => ({
        id: request.draftId as AnnotationId,
        scope: LOCAL_SCOPE,
        createdAt: new Date().toISOString() as IsoTime,
        author: LOCAL_USER,
        source: { kind: "extension", trust: "owner" },
        page: { url: redactUrl(request.url), title: request.title },
        mark: request.mark,
        viewport: request.viewport,
        comment: request.comment.slice(0, 4000),
        captures: capture.meta,
      }));
      return { ok: true, type: "saved", annotation };
    }
    case "discard":
      await discardDraft(request.draftId);
      return { ok: true, type: "done" };
    case "list":
      return { ok: true, type: "annotations", annotations: await listForPage(request.url) };
    case "thumbnail":
      return { ok: true, type: "thumbnail", png: await capturePng(request.id, "zone") };
  }
}

chrome.runtime.onMessage.addListener((request: OverlayRequest, sender, sendResponse) => {
  answer(request, sender).then(sendResponse, (error: Error) => sendResponse({ ok: false, error: error.message }));
  return true;
});

// --------------------------------------------------------------- native host

const RETRY_MIN_MS = 1_000;
const RETRY_MAX_MS = 60_000;
const REPLY_TIMEOUT_MS = 5_000;

let port: chrome.runtime.Port | null = null;
let lastError: string | null = null;
let retryMs = RETRY_MIN_MS;
const waiting: Array<(message: HostToExtension) => void> = [];

function connect(): void {
  if (!__MARKSPOT_NATIVE__ || port) return;
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
  status: () => ({ native: __MARKSPOT_NATIVE__, connected: port !== null, lastError }),
  exportAll: () => exportAll(new Date()),
};

declare global {
  // eslint-disable-next-line no-var
  var markspot: typeof api;
}
globalThis.markspot = api;

chrome.runtime.onStartup.addListener(connect);
chrome.runtime.onInstalled.addListener(connect);
connect();
void purgeOldDrafts(Date.now());
