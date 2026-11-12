// Canal Claude Code : le serveur MCP d'une session écoute lui-même les envois « Envoyer à
// Claude » et les pousse dans la session, qui se réveille même inactive.
// Actif seulement quand la session a été lancée avec le drapeau des canaux (MARKSPOT_CHANNEL=1,
// posé par `markspot claude`).
//
// Claude Code ne confirme pas la réception et peut jeter un message sans erreur (canal refusé,
// canaux désactivés). Un envoi poussé reste donc réclamé jusqu'à ce que Claude ouvre ou règle
// une de ses notes (seen). Sans signe après ackMs, il revient dans la file et la session se
// tait (ni battement ni réclamation) jusqu'au prochain appel d'outil : la page la montre
// « n'écoute pas », et un `markspot listen` du même nom peut prendre l'envoi.

import { hostname } from "node:os";
import { ulid } from "ulid";
import type { AnnotationId } from "../core/model.ts";
import {
  beat,
  claimNext,
  cleanName,
  commentHash,
  completeClaim,
  hasWork,
  releaseClaim,
  removeBeat,
  touchClaim,
  type Dispatch,
  type Listener,
} from "../store/dispatch.ts";
import type { AgentStore } from "../store/store.ts";
import { renderDispatch } from "./render.ts";

export type Push = (content: string, meta: Record<string, string>) => Promise<void>;

export interface ChannelOptions {
  dataDir: string;
  store: AgentStore;
  name: string;
  push: Push;
  /** Clé qui vérifie les envois. */
  dispatchKey: Buffer;
  /** Délai sans signe de Claude avant de rendre l'envoi (2 minutes). */
  ackMs?: number;
  scanMs?: number;
  beatMs?: number;
}

export interface Channel {
  /** Claude a appelé un outil ; avec un id, il a ouvert ou réglé cette note. */
  seen(id?: AnnotationId): void;
  stop(): Promise<void>;
}

interface Pending {
  dispatch: Dispatch;
  pushedAt: number;
}

export function startChannel(options: ChannelOptions): Channel {
  const { dataDir, store, push } = options;
  const ackMs = options.ackMs ?? 120_000;
  const scanMs = options.scanMs ?? 2_000;
  const beatMs = options.beatMs ?? 10_000;
  const me: Listener = {
    id: ulid(),
    name: cleanName(options.name),
    cwd: process.cwd(),
    urlPrefix: "",
    startedAt: new Date().toISOString(),
    pid: process.pid,
    host: hostname(),
  };
  const pending = new Map<string, Pending>();
  /** Envois rendus faute de signe : un seen tardif les marque reçus, sans nouvelle poussée. */
  const released = new Map<string, AnnotationId[]>();
  const received = new Set<string>();
  let deaf = false;
  let stopped = false;
  let lastBeat = 0;
  let timer: NodeJS.Timeout | undefined;
  /** Un envoi refusé (non signé) reste dans la file : on ne le relit qu'au rythme du battement. */
  let lastEmptyClaim = 0;

  const settlePending = async () => {
    const now = Date.now();
    for (const [id, entry] of pending) {
      const threads = await Promise.all(entry.dispatch.ids.map((n) => store.get(n)));
      if (threads.every((t) => !t || t.resolution)) {
        pending.delete(id); // tout est réglé, par Claude ou à la main
        await completeClaim(dataDir, entry.dispatch, me);
      } else if (now - entry.pushedAt >= ackMs) {
        pending.delete(id);
        released.set(id, entry.dispatch.ids);
        await releaseClaim(dataDir, entry.dispatch, me);
        deaf = true; // le canal ne marche pas : on se tait jusqu'au prochain appel d'outil
        await removeBeat(dataDir, me.id);
      } else {
        await touchClaim(dataDir, entry.dispatch, me); // ne pas passer pour une réclamation abandonnée
      }
    }
  };

  const tick = async () => {
    if (pending.size > 0) await settlePending();
    if (deaf) return;
    if (Date.now() - lastBeat >= beatMs) {
      await beat(dataDir, me);
      lastBeat = Date.now();
    }
    if (!(await hasWork(dataDir))) return;
    if (Date.now() - lastEmptyClaim < beatMs) return;
    const dispatch = await claimNext(dataDir, me, options.dispatchKey);
    if (!dispatch) {
      lastEmptyClaim = Date.now();
      return;
    }
    lastEmptyClaim = 0;
    if (received.has(dispatch.id)) {
      received.delete(dispatch.id);
      return completeClaim(dataDir, dispatch, me); // Claude l'avait ouvert après le délai
    }
    const open = [];
    for (const [i, id] of dispatch.ids.entries()) {
      const thread = await store.get(id);
      // Un commentaire changé après l'envoi (sur le partage) ne part pas.
      if (thread && !thread.resolution && commentHash(thread.annotation.comment) === dispatch.hashes[i]) open.push(thread);
    }
    if (open.length === 0) return completeClaim(dataDir, dispatch, me);
    try {
      await push(renderDispatch(dispatch.id, open), { dispatch_id: dispatch.id, notes: String(open.length) });
    } catch {
      return releaseClaim(dataDir, dispatch, me); // la session est partie : l'envoi revient dans la file
    }
    pending.set(dispatch.id, { dispatch, pushedAt: Date.now() });
  };

  const loop = async () => {
    if (stopped) return;
    try {
      await tick();
    } catch {
      // partage coupé : on réessaie au tour suivant
    }
    if (!stopped) {
      timer = setTimeout(() => void loop(), scanMs);
      timer.unref();
    }
  };
  void loop();

  return {
    seen(id) {
      if (deaf) {
        deaf = false;
        lastBeat = 0; // se réannoncer au prochain tour
      }
      if (!id) return;
      for (const [key, entry] of pending) {
        if (entry.dispatch.ids.includes(id)) {
          pending.delete(key);
          void completeClaim(dataDir, entry.dispatch, me).catch(() => undefined);
        }
      }
      for (const [key, ids] of released) {
        if (ids.includes(id)) {
          released.delete(key);
          received.add(key);
        }
      }
    },
    async stop() {
      stopped = true;
      clearTimeout(timer);
      for (const entry of pending.values()) await releaseClaim(dataDir, entry.dispatch, me).catch(() => undefined);
      pending.clear();
      await removeBeat(dataDir, me.id);
    },
  };
}
