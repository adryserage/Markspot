// Service worker de l'extension.
// - Alt+C ou clic sur l'icône : injecte l'overlay dans l'onglet (activeTab), qui bascule le mode.
// - Une note enregistrée entre dans la file d'envoi (local-store), puis part à l'hôte natif
//   s'il répond. L'hôte devient alors son seul propriétaire, et la note quitte la file.
// - L'hôte pousse les changements (note réglée par Claude, retirée) : le worker les relaie
//   aux overlays ouverts sur la page concernée.

import { ulid } from "ulid";
import {
  LOCAL_SCOPE,
  LOCAL_USER,
  pageKeyOf,
  redactUrl,
  type AnnotationId,
  type IsoTime,
  type Thread,
} from "../../src/core/model.ts";
import { captureTab } from "./capture.ts";
import { createHostLink } from "./link.ts";
import {
  allAnnotations,
  capturePng,
  createFromDraft,
  discardDraft,
  exportAll,
  outboxPngs,
  purgeOldDrafts,
  putDraft,
  removeFromOutbox,
} from "./local-store.ts";
import { OVERLAY_PORT, type NoteView, type OverlayPush, type OverlayReply, type OverlayRequest } from "./messages.ts";

declare const __MARKSPOT_NATIVE__: boolean;

// --------------------------------------------------------------- host link

const host = createHostLink(__MARKSPOT_NATIVE__);
/** Notes écrites par l'hôte, tenues à jour par sync et par ses poussées. */
const threads = new Map<AnnotationId, Thread>();
const overlays = new Set<chrome.runtime.Port>();

function broadcast(push: OverlayPush, url: string): void {
  const key = pageKeyOf(url);
  for (const port of overlays) {
    const portUrl = port.sender?.url;
    if (portUrl && pageKeyOf(portUrl) === key) port.postMessage(push);
  }
}

function hostView(thread: Thread): NoteView {
  return { annotation: thread.annotation, resolution: thread.resolution, pending: false };
}

host.onPush((push) => {
  if (push.type === "thread") {
    threads.set(push.thread.annotation.id, push.thread);
    broadcast({ type: "note", note: hostView(push.thread) }, push.thread.annotation.page.url);
  } else {
    const known = threads.get(push.id);
    threads.delete(push.id);
    if (known) broadcast({ type: "removed", id: push.id }, known.annotation.page.url);
  }
});

let flushing: Promise<void> = Promise.resolve();

/** Envoie la file à l'hôte, dans l'ordre. create est idempotent : une coupure ne double rien. */
function flushOutbox(): Promise<void> {
  flushing = flushing.then(async () => {
    if (!host.connected) return;
    for (const note of await allAnnotations()) {
      const pngs = await outboxPngs(note.id);
      if (!pngs) continue;
      const { schemaVersion: _version, seq: _seq, ...annotation } = note;
      const reply = await host.request({ type: "create", annotation, pngs }).catch(() => null);
      if (reply?.type !== "created") return; // hôte parti ou note refusée : on réessaiera
      threads.set(reply.thread.annotation.id, reply.thread);
      await removeFromOutbox(note.id);
      broadcast({ type: "note", note: hostView(reply.thread) }, reply.thread.annotation.page.url);
    }
  });
  return flushing;
}

host.onConnected(async () => {
  threads.clear();
  await host.request({ type: "sync" }).catch(() => null);
  await flushOutbox();
});

async function notesForPage(url: string): Promise<NoteView[]> {
  const key = pageKeyOf(url);
  const fromHost = [...threads.values()].filter((t) => pageKeyOf(t.annotation.page.url) === key).map(hostView);
  const queued = (await allAnnotations())
    .filter((a) => pageKeyOf(a.page.url) === key && !threads.has(a.id))
    .map((annotation): NoteView => ({ annotation, resolution: null, pending: true }));
  return [...fromHost, ...queued].sort((a, b) => a.annotation.seq - b.annotation.seq);
}

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

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== OVERLAY_PORT) return;
  overlays.add(port);
  port.onDisconnect.addListener(() => overlays.delete(port));
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
        page: { url: redactUrl(request.url), title: request.title.slice(0, 300) },
        mark: request.mark,
        viewport: request.viewport,
        comment: request.comment.slice(0, 4000),
        captures: capture.meta,
      }));
      await flushOutbox();
      const written = threads.get(annotation.id);
      const note: NoteView = written ? hostView(written) : { annotation, resolution: null, pending: true };
      return { ok: true, type: "saved", note };
    }
    case "discard":
      await discardDraft(request.draftId);
      return { ok: true, type: "done" };
    case "list":
      return { ok: true, type: "notes", notes: await notesForPage(request.url) };
    case "thumbnail": {
      const queued = await capturePng(request.id, "zone");
      if (queued) return { ok: true, type: "thumbnail", png: queued };
      const reply = await host.request({ type: "capture", id: request.id }).catch(() => null);
      return { ok: true, type: "thumbnail", png: reply?.type === "capture" ? reply.png : null };
    }
    case "status":
      return { ok: true, type: "status", native: __MARKSPOT_NATIVE__, connected: host.connected };
  }
}

chrome.runtime.onMessage.addListener((request: OverlayRequest, sender, sendResponse) => {
  answer(request, sender).then(sendResponse, (error: Error) => sendResponse({ ok: false, error: error.message }));
  return true;
});

// --------------------------------------------------------- icon menu

const EXPORT_MENU = "markspot-export";

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({ id: EXPORT_MENU, title: "Exporter les notes", contexts: ["action"] });
});

chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId === EXPORT_MENU) await chrome.tabs.create({ url: chrome.runtime.getURL("dist/export.html") });
});

// ---------------------------------------------------- doctor and tests

/** Point d'accès pour `markspot doctor` et les tests, par CDP. */
const api = {
  ping: () => host.request({ type: "ping" }),
  status: () => ({ native: __MARKSPOT_NATIVE__, connected: host.connected, lastError: host.lastError }),
  exportAll: () => exportAll(new Date()),
  threads: () => [...threads.values()],
};

declare global {
  // eslint-disable-next-line no-var
  var markspot: typeof api;
}
globalThis.markspot = api;

chrome.runtime.onStartup.addListener(host.connect);
chrome.runtime.onInstalled.addListener(host.connect);
host.connect();
void purgeOldDrafts(Date.now());
