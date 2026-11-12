// markspot listen : attend un envoi « Envoyer à Claude » et sort en l'imprimant.
// Une session Claude Code le lance en tâche de fond : elle n'est réveillée qu'à la sortie
// du processus, donc l'attente ne coûte aucun tour de Claude.
// Codes de sortie : 0 notes reçues, 2 délai atteint, 3 session parente disparue.

import { hostname } from "node:os";
import { ulid } from "ulid";
import { renderDispatch } from "../mcp/render.ts";
import { beat, claimNext, cleanName, completeClaim, releaseClaim, removeBeat, type Listener } from "../store/dispatch.ts";
import { loadConfig, openAgentStore } from "../store/store.ts";

const BEAT_MS = 10_000;
const SCAN_MS = 2_000;

export async function listen(options: { urlPrefix: string; timeoutSeconds: number; name: string }): Promise<number> {
  const config = await loadConfig();
  const store = await openAgentStore(config);
  const me: Listener = {
    id: ulid(),
    name: cleanName(options.name),
    cwd: process.cwd(),
    urlPrefix: options.urlPrefix,
    startedAt: new Date().toISOString(),
    pid: process.pid,
    host: hostname(),
  };
  const parent = process.ppid;
  // Sous Windows, ppid ne change pas à la mort du parent : on vérifie qu'il existe encore.
  const parentAlive = () => {
    if (process.ppid !== parent) return false;
    try {
      process.kill(parent, 0);
      return true;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === "EPERM";
    }
  };
  const stop = () => void removeBeat(config.dataDir, me.id).finally(() => process.exit(130));
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  const deadline = Date.now() + Math.max(5, options.timeoutSeconds) * 1000;
  let lastBeat = 0;
  try {
    while (Date.now() < deadline) {
      if (!parentAlive()) return 3; // orpheline : ne pas voler les envois d'une autre session
      if (Date.now() - lastBeat >= BEAT_MS) {
        await beat(config.dataDir, me);
        lastBeat = Date.now();
      }
      const dispatch = await claimNext(config.dataDir, me);
      if (dispatch) {
        const open = [];
        for (const id of dispatch.ids) {
          const thread = await store.get(id);
          if (thread && !thread.resolution) open.push(thread);
        }
        if (open.length === 0) {
          await completeClaim(config.dataDir, dispatch, me); // déjà réglées entre-temps : on continue d'écouter
          continue;
        }
        const text = `${renderDispatch(dispatch.id, open)}\n`;
        const written = await new Promise<boolean>((resolve) => process.stdout.write(text, (error) => resolve(!error)));
        if (!written) {
          await releaseClaim(config.dataDir, dispatch, me);
          return 1;
        }
        await completeClaim(config.dataDir, dispatch, me);
        return 0;
      }
      await new Promise((r) => setTimeout(r, SCAN_MS));
    }
    process.stdout.write(`Markspot: no note sent in ${options.timeoutSeconds} s. Run markspot listen again to keep listening.\n`);
    return 2;
  } finally {
    await removeBeat(config.dataDir, me.id);
  }
}
