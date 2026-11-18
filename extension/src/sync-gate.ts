// Barrière du service worker : Chrome l'endort, et il se réveille avec sa liste de notes vide,
// remplie par le sync qui suit la connexion à l'hôte. Une réponse qui lit cette liste attend le
// sync, au plus waitMs si l'hôte ne répond pas (programme absent, version d'essai).

export interface SyncGate {
  /** Une connexion commence : les lectures attendent le prochain sync. */
  expect(): void;
  /** Le sync est fini : les lectures passent. */
  done(): void;
  /** Attend le sync ; après un délai dépassé, les lectures suivantes ne réattendent plus. */
  ready(): Promise<void>;
}

export function createSyncGate(waitMs: number): SyncGate {
  let synced: Promise<void> = Promise.resolve();
  let release: () => void = () => {};
  return {
    expect() {
      synced = new Promise((resolve) => (release = resolve));
    },
    done() {
      release();
    },
    async ready() {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<"timeout">((resolve) => (timer = setTimeout(() => resolve("timeout"), waitMs)));
      const outcome = await Promise.race([synced, timeout]);
      clearTimeout(timer);
      if (outcome === "timeout") release();
    },
  };
}
