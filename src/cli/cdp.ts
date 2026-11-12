// Petit client du protocole Chrome DevTools, sur le WebSocket global de Node.
// Sert à installer l'extension et à vérifier qu'elle parle à l'hôte.

export interface Cdp {
  send<T = unknown>(method: string, params?: object, sessionId?: string): Promise<T>;
  close(): void;
}

export async function connectCdp(httpUrl: string): Promise<Cdp> {
  let version: { webSocketDebuggerUrl: string };
  try {
    version = (await (await fetch(`${httpUrl}/json/version`)).json()) as typeof version;
  } catch {
    throw new Error(`Chrome is not listening on ${httpUrl}. Start it with remote debugging on that port.`);
  }
  const socket = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise<void>((resolve, reject) => {
    socket.onopen = () => resolve();
    socket.onerror = () => reject(new Error(`cannot open the DevTools socket of ${httpUrl}`));
  });

  let nextId = 0;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  socket.onmessage = (event) => {
    const message = JSON.parse(String(event.data)) as { id?: number; result?: unknown; error?: { message: string } };
    if (message.id === undefined) return;
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message.result);
  };

  return {
    send<T>(method: string, params: object = {}, sessionId?: string): Promise<T> {
      const id = ++nextId;
      return new Promise<T>((resolve, reject) => {
        pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
        socket.send(JSON.stringify({ id, method, params, sessionId }));
      });
    },
    close: () => socket.close(),
  };
}

interface TargetInfo { targetId: string; type: string; url: string }

/** Évalue une expression dans le service worker de l'extension. null si le service worker ne tourne pas. */
export async function evaluateInExtension(cdp: Cdp, extensionId: string, expression: string): Promise<unknown> {
  const { targetInfos } = await cdp.send<{ targetInfos: TargetInfo[] }>("Target.getTargets");
  const worker = targetInfos.find(
    (t) => t.type === "service_worker" && t.url.startsWith(`chrome-extension://${extensionId}/`),
  );
  if (!worker) return null;
  const { sessionId } = await cdp.send<{ sessionId: string }>("Target.attachToTarget", {
    targetId: worker.targetId,
    flatten: true,
  });
  try {
    const evaluated = await cdp.send<{ result: { value?: unknown }; exceptionDetails?: { text: string } }>(
      "Runtime.evaluate",
      { expression, awaitPromise: true, returnByValue: true },
      sessionId,
    );
    if (evaluated.exceptionDetails) throw new Error(evaluated.exceptionDetails.text);
    return evaluated.result.value ?? null;
  } finally {
    await cdp.send("Target.detachFromTarget", { sessionId });
  }
}
