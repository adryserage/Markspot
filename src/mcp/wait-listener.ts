// L'outil markspot_wait_for_annotations comme écoute : une session qui l'appelle (« écoute mes
// annotations » sans canal) s'annonce dans « Envoyer à » et reçoit les envois qui la visent.
// Le retour de l'outil confirme la réception : pas d'accusé à attendre, comme `markspot listen`.
// Le battement dure pendant l'attente et WAIT_LINGER_MS après : une session qui ne rappelle plus
// l'outil disparaît de la page au lieu d'y rester sans jamais prendre les envois.

import { hostname } from "node:os";
import { ulid } from "ulid";
import type { Thread } from "../core/model.ts";
import {
  beat,
  claimNext,
  cleanName,
  commentHash,
  completeClaim,
  releaseClaim,
  removeBeat,
  type Dispatch,
  type DispatchAuth,
  type Listener,
} from "../store/dispatch.ts";
import type { AgentStore } from "../store/store.ts";

export const WAIT_LINGER_MS = 10 * 60 * 1000;
const BEAT_MS = 10_000;

export interface WaitListener {
  /** Un envoi pour cette session et ses notes encore ouvertes, ou null. Annonce la session. */
  next(): Promise<{ dispatch: Dispatch; open: Thread[] } | null>;
  /** L'appel a rendu ces notes : l'envoi est transmis. */
  complete(dispatch: Dispatch): Promise<void>;
  /** L'appel a été annulé : l'envoi revient dans la file. */
  release(dispatch: Dispatch): Promise<void>;
  stop(): Promise<void>;
}

export function startWaitListener(options: {
  dataDir: string;
  store: AgentStore;
  name: string;
  auth: DispatchAuth;
  lingerMs?: number;
  beatMs?: number;
}): WaitListener {
  const { dataDir, store, auth } = options;
  const lingerMs = options.lingerMs ?? WAIT_LINGER_MS;
  const beatMs = options.beatMs ?? BEAT_MS;
  let me: Listener | null = null;
  let timer: NodeJS.Timeout | undefined;
  let lastCall = 0;

  const tick = async () => {
    if (!me) return;
    if (Date.now() - lastCall > lingerMs) {
      clearInterval(timer);
      timer = undefined;
      const gone = me;
      me = null; // le prochain appel se réannonce
      await removeBeat(dataDir, gone.id).catch(() => undefined);
      return;
    }
    await beat(dataDir, me).catch(() => undefined);
  };

  return {
    async next() {
      lastCall = Date.now();
      if (!me) {
        me = {
          id: ulid(),
          name: cleanName(options.name),
          cwd: process.cwd(),
          urlPrefix: "",
          startedAt: new Date().toISOString(),
          pid: process.pid,
          host: hostname(),
        };
        await beat(dataDir, me).catch(() => undefined);
        timer = setInterval(() => void tick(), beatMs);
        timer.unref();
      }
      for (;;) {
        const dispatch = await claimNext(dataDir, me, auth);
        if (!dispatch) return null;
        const open: Thread[] = [];
        for (const [i, id] of dispatch.ids.entries()) {
          const thread = await store.get(id);
          // Un commentaire changé après l'envoi (sur le partage) ne part pas.
          if (thread && !thread.resolution && commentHash(thread.annotation.comment) === dispatch.hashes[i]) open.push(thread);
        }
        if (open.length > 0) return { dispatch, open };
        await completeClaim(dataDir, dispatch, me, auth); // déjà réglées : on passe au suivant
      }
    },
    async complete(dispatch) {
      lastCall = Date.now();
      if (me) await completeClaim(dataDir, dispatch, me, auth);
    },
    async release(dispatch) {
      if (me) await releaseClaim(dataDir, dispatch, me);
    },
    async stop() {
      clearInterval(timer);
      if (me) await removeBeat(dataDir, me.id).catch(() => undefined);
      me = null;
    },
  };
}
