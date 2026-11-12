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
  type Resolution,
  type Thread,
} from "../../src/core/model.ts";
import { sanitizeStrokes } from "../../src/core/drawing.ts";
import { burnStrokes, captureTab } from "./capture.ts";
import { createHostLink } from "./link.ts";
import {
  allAnnotations,
  capturePng,
  createFromDraft,
  discardDraft,
  editQueued,
  exportAll,
  queuedResolutions,
  setQueuedResolution,
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
    const resolutions = await queuedResolutions();
    for (const note of await allAnnotations()) {
      const pngs = await outboxPngs(note.id);
      if (!pngs) continue;
      const { schemaVersion: _version, seq: _seq, ...annotation } = note;
      const reply = await host.request({ type: "create", annotation, pngs }).catch(() => null);
      if (reply?.type !== "created") return; // hôte parti ou note refusée : on réessaiera
      let thread = reply.thread;
      // Réglée à la main pendant qu'elle était en file : la résolution part aussi. Un refus
      // (hôte plus ancien) n'arrête pas l'envoi des notes suivantes.
      const queuedResolution = resolutions.get(note.id);
      if (queuedResolution && !thread.resolution) {
        const resolved = await host.request({ type: "resolve", id: note.id, reply: queuedResolution.reply }).catch(() => null);
        if (resolved?.type === "resolved") thread = resolved.thread;
      }
      threads.set(thread.annotation.id, thread);
      await removeFromOutbox(note.id);
      broadcast({ type: "note", note: hostView(thread) }, thread.annotation.page.url);
    }
  });
  return flushing;
}

host.onConnected(async () => {
  threads.clear();
  await host.request({ type: "sync" }).catch(() => null);
  await flushOutbox();
});

/**
 * Retire des notes de cette page, et seulement de celle-ci. Passe après l'envoi de la file en
 * cours : sinon une note en route serait recréée par l'hôte juste après son retrait.
 */
function clearOnPage(
  page: string,
  ids: AnnotationId[],
  includeOpen: boolean,
): Promise<{ ids: AnnotationId[]; error?: string }> {
  const run = flushing.then(async () => {
    const wanted = new Set(ids);
    const removed: AnnotationId[] = [];
    const resolutions = await queuedResolutions();
    for (const note of await allAnnotations()) {
      if (!wanted.has(note.id) || pageKeyOf(note.page.url) !== page) continue;
      if (!includeOpen && !resolutions.has(note.id)) continue;
      await removeFromOutbox(note.id);
      removed.push(note.id);
      broadcast({ type: "removed", id: note.id }, note.page.url);
    }
    const onHost = ids.filter((id) => {
      const thread = threads.get(id);
      return thread && pageKeyOf(thread.annotation.page.url) === page && (includeOpen || thread.resolution);
    });
    if (onHost.length > 0) {
      const reply = await host.request({ type: "clear", ids: onHost, includeOpen }).catch(() => null);
      // Les notes déjà retirées de la file le restent : on dit lesquelles, avec l'erreur.
      if (reply?.type !== "cleared") return { ids: removed, error: "le programme local n'a pas répondu" };
      for (const id of reply.ids) {
        const known = threads.get(id);
        threads.delete(id);
        removed.push(id);
        if (known) broadcast({ type: "removed", id }, known.annotation.page.url);
      }
    }
    return { ids: removed };
  });
  flushing = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** Vue d'une note encore en file, avec sa résolution locale. Diffusée aux onglets de sa page. */
async function queuedView(id: AnnotationId): Promise<NoteView> {
  const annotation = (await allAnnotations()).find((a) => a.id === id);
  if (!annotation) throw new Error("note introuvable");
  const note: NoteView = { annotation, resolution: (await queuedResolutions()).get(id) ?? null, pending: true };
  broadcast({ type: "note", note }, annotation.page.url);
  return note;
}

async function notesForPage(url: string): Promise<NoteView[]> {
  const key = pageKeyOf(url);
  const fromHost = [...threads.values()].filter((t) => pageKeyOf(t.annotation.page.url) === key).map(hostView);
  const resolutions = await queuedResolutions();
  const queued = (await allAnnotations())
    .filter((a) => pageKeyOf(a.page.url) === key && !threads.has(a.id))
    .map((annotation): NoteView => ({ annotation, resolution: resolutions.get(annotation.id) ?? null, pending: true }));
  return [...fromHost, ...queued].sort((a, b) => a.annotation.seq - b.annotation.seq);
}

// ----------------------------------------------------- Envoyer à Claude

/** Le projet qui reçoit les envois d'un site, gardé par origine (jamais une valeur venue de la page). */
const targetKey = (url: string) => `target:${new URL(url).origin}`;

async function chosenTarget(url: string): Promise<string | null> {
  const key = targetKey(url);
  return ((await chrome.storage.local.get(key))[key] as string | undefined) ?? null;
}

async function saveTarget(url: string, name: string | null): Promise<void> {
  if (name) await chrome.storage.local.set({ [targetKey(url)]: name.slice(0, 80) });
  else await chrome.storage.local.remove(targetKey(url));
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
      const strokes = sanitizeStrokes(request.strokes);
      const annotation = await createFromDraft(request.draftId, (capture) => ({
        id: request.draftId as AnnotationId,
        scope: LOCAL_SCOPE,
        createdAt: new Date().toISOString() as IsoTime,
        author: LOCAL_USER,
        source: { kind: "extension", trust: "owner" },
        page: { url: redactUrl(request.url), title: request.title.slice(0, 300) },
        mark: strokes.length > 0 ? { ...request.mark, drawing: strokes } : request.mark,
        viewport: request.viewport,
        comment: request.comment.slice(0, 4000),
        captures: capture.meta,
      }), strokes.length > 0 ? (png) => burnStrokes(png, strokes) : undefined);
      await flushOutbox();
      const written = threads.get(annotation.id);
      const note: NoteView = written ? hostView(written) : { annotation, resolution: null, pending: true };
      return { ok: true, type: "saved", note };
    }
    case "edit": {
      const queued = await editQueued(request.id, request.comment.slice(0, 4000));
      if (queued === "resolved") return { ok: false, error: "note réglée : rouvre-la d'abord" };
      if (queued) {
        const note: NoteView = { annotation: queued, resolution: null, pending: true };
        broadcast({ type: "note", note }, queued.page.url);
        return { ok: true, type: "edited", note };
      }
      const reply = await host.request({ type: "edit", id: request.id, comment: request.comment.slice(0, 4000) });
      if (reply.type !== "edited") {
        return { ok: false, error: reply.type === "rejected" && reply.reason === "note already resolved" ? "note déjà réglée" : "refusé par le programme local" };
      }
      threads.set(reply.thread.annotation.id, reply.thread);
      broadcast({ type: "note", note: hostView(reply.thread) }, reply.thread.annotation.page.url);
      return { ok: true, type: "edited", note: hostView(reply.thread) };
    }
    case "clear": {
      if (!sender.url) return { ok: false, error: "page inconnue" };
      const result = await clearOnPage(pageKeyOf(sender.url), request.ids, request.includeOpen);
      return { ok: true, type: "cleared", ...result };
    }
    case "resolve": {
      const reply = request.reply.trim().slice(0, 4000) || "Réglée à la main.";
      const resolution: Resolution = {
        schemaVersion: 1,
        annotationId: request.id,
        resolvedAt: new Date().toISOString() as IsoTime,
        author: LOCAL_USER,
        reply,
      };
      if (await setQueuedResolution(request.id, resolution)) return { ok: true, type: "state", note: await queuedView(request.id) };
      const answer = await host.request({ type: "resolve", id: request.id, reply });
      if (answer.type !== "resolved") return { ok: false, error: "note introuvable" };
      threads.set(answer.thread.annotation.id, answer.thread);
      broadcast({ type: "note", note: hostView(answer.thread) }, answer.thread.annotation.page.url);
      return { ok: true, type: "state", note: hostView(answer.thread) };
    }
    case "reopen": {
      if (await setQueuedResolution(request.id, null)) return { ok: true, type: "state", note: await queuedView(request.id) };
      const known = threads.get(request.id);
      if (!known?.resolution) return { ok: false, error: "note déjà ouverte" };
      const answer = await host.request({ type: "reopen", id: request.id, resolvedAt: known.resolution.resolvedAt });
      if (answer.type !== "reopened") {
        return { ok: false, error: answer.type === "rejected" && answer.reason === "resolution changed" ? "Claude vient de répondre : relis la note" : "note introuvable" };
      }
      threads.set(answer.thread.annotation.id, answer.thread);
      broadcast({ type: "note", note: hostView(answer.thread) }, answer.thread.annotation.page.url);
      return { ok: true, type: "state", note: hostView(answer.thread) };
    }
    case "send": {
      if (!__MARKSPOT_NATIVE__) return { ok: false, error: "la version d'essai n'a pas de programme local" };
      if (!sender.url) return { ok: false, error: "page inconnue" };
      const page = pageKeyOf(sender.url);
      await flushOutbox(); // les notes encore en file partent d'abord au programme local
      const ids = request.ids.filter((id) => {
        const thread = threads.get(id);
        return thread && !thread.resolution && pageKeyOf(thread.annotation.page.url) === page;
      });
      if (ids.length === 0) return { ok: false, error: "aucune note ouverte reçue par le programme local" };
      const to = await chosenTarget(sender.url);
      const reply = await host.request({ type: "send", ids, url: sender.url, ...(to ? { to } : {}) });
      if (reply.type === "choose") return { ok: true, type: "choose", listeners: reply.listeners };
      if (reply.type === "rejected" && reply.reason === "nobody listens") {
        return { ok: false, error: "aucune session n'écoute : dis « écoute mes annotations » dans la session du projet, puis renvoie" };
      }
      if (reply.type !== "sent") return { ok: false, error: "refusé par le programme local (mets-le à jour ?)" };
      await saveTarget(sender.url, reply.to);
      return { ok: true, type: "sent", count: ids.length, to: reply.to, listening: reply.listening };
    }
    case "targets": {
      if (!__MARKSPOT_NATIVE__ || !sender.url) return { ok: true, type: "targets", listeners: [], chosen: null };
      const reply = await host.request({ type: "listeners", url: sender.url }).catch(() => null);
      const listeners = reply?.type === "listeners" ? reply.listeners : [];
      return { ok: true, type: "targets", listeners, chosen: await chosenTarget(sender.url) };
    }
    case "setTarget":
      if (!sender.url) return { ok: false, error: "page inconnue" };
      await saveTarget(sender.url, request.name);
      return { ok: true, type: "done" };
    case "openExport":
      await openExportPage(sender.tab);
      return { ok: true, type: "done" };
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

async function openExportPage(nextTo?: chrome.tabs.Tab): Promise<void> {
  await chrome.tabs.create({
    url: chrome.runtime.getURL("dist/export.html"),
    ...(nextTo?.index !== undefined ? { index: nextTo.index + 1 } : {}),
  });
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === EXPORT_MENU) await openExportPage(tab);
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
