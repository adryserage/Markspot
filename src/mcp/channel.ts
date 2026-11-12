// Canal Claude Code : le serveur MCP d'une session écoute lui-même les envois « Envoyer à
// Claude » et les pousse dans la session, qui se réveille même inactive.
// Actif seulement quand la session a été lancée avec le drapeau des canaux (MARKSPOT_CHANNEL=1,
// posé par `markspot claude`) : sans lui, Claude Code jette les événements sans erreur.

import { hostname } from "node:os";
import { ulid } from "ulid";
import { beat, claimNext, cleanName, completeClaim, hasWork, releaseClaim, removeBeat, type Listener } from "../store/dispatch.ts";
import type { AgentStore } from "../store/store.ts";
import { renderDispatch } from "./render.ts";

const BEAT_MS = 10_000;
const SCAN_MS = 2_000;

export type Push = (content: string, meta: Record<string, string>) => Promise<void>;

/** Démarre l'écoute ; la fonction rendue l'arrête et retire le battement. */
export function startChannel(options: { dataDir: string; store: AgentStore; name: string; push: Push }): () => Promise<void> {
  const { dataDir, store, push } = options;
  const me: Listener = {
    id: ulid(),
    name: cleanName(options.name),
    cwd: process.cwd(),
    urlPrefix: "",
    startedAt: new Date().toISOString(),
    pid: process.pid,
    host: hostname(),
  };
  let stopped = false;
  let lastBeat = 0;
  let timer: NodeJS.Timeout | undefined;

  const tick = async () => {
    if (Date.now() - lastBeat >= BEAT_MS) {
      await beat(dataDir, me);
      lastBeat = Date.now();
    }
    if (!(await hasWork(dataDir))) return;
    const dispatch = await claimNext(dataDir, me);
    if (!dispatch) return;
    const open = [];
    for (const id of dispatch.ids) {
      const thread = await store.get(id);
      if (thread && !thread.resolution) open.push(thread);
    }
    if (open.length === 0) return completeClaim(dataDir, dispatch, me);
    try {
      await push(renderDispatch(dispatch.id, open), { dispatch_id: dispatch.id, notes: String(open.length) });
    } catch {
      return releaseClaim(dataDir, dispatch, me); // la session est partie : l'envoi revient dans la file
    }
    await completeClaim(dataDir, dispatch, me);
  };

  const loop = async () => {
    if (stopped) return;
    try {
      await tick();
    } catch {
      // partage coupé : on réessaie au tour suivant
    }
    if (!stopped) {
      timer = setTimeout(() => void loop(), SCAN_MS);
      timer.unref();
    }
  };
  void loop();

  return async () => {
    stopped = true;
    clearTimeout(timer);
    await removeBeat(dataDir, me.id);
  };
}
