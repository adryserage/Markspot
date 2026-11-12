// Lit l'indice de fichier source dans le monde MAIN de la page, où vivent les objets de Vue,
// Svelte et React. readSourceHint est sérialisée par chrome.scripting : elle ne doit rien
// importer ni utiliser de variable extérieure, et ne rend que des primitives déjà coupées.
// Son résultat passe ensuite par cleanSourceHint (aussi dans la version d'essai, sans zod).

import { cleanSourceHint, type SourceHint } from "../../src/core/source-hint.ts";

function readSourceHint(selector: string): unknown {
  try {
    const str = (v: unknown): string | null => (typeof v === "string" ? v.slice(0, 400) : null);
    const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
    const nameOf = (type: unknown): string | null => {
      if (!type || (typeof type !== "function" && typeof type !== "object")) return null;
      const t = type as { displayName?: unknown; __name?: unknown; name?: unknown };
      return str(t.displayName) || str(t.__name) || str(t.name);
    };
    let el: Element | null = document.querySelector(selector);
    for (let depth = 0; el && depth < 25; depth++, el = el.parentElement) {
      const node = el as unknown as Record<string, unknown>;
      const vue3 = node.__vueParentComponent as { type?: { __file?: unknown } } | undefined;
      if (vue3?.type) return { framework: "vue", component: nameOf(vue3.type), file: str(vue3.type.__file) };
      const vue2 = node.__vue__ as { $options?: { __file?: unknown; name?: unknown } } | undefined;
      if (vue2?.$options) return { framework: "vue", component: str(vue2.$options.name), file: str(vue2.$options.__file) };
      // Svelte : les numéros sont rendus tels quels (leur base varie selon la version).
      const svelte = node.__svelte_meta as { loc?: { file?: unknown; line?: unknown; column?: unknown } } | undefined;
      if (svelte?.loc) {
        return { framework: "svelte", component: null, file: str(svelte.loc.file), line: num(svelte.loc.line), column: num(svelte.loc.column) };
      }
      const key = Object.keys(node).find((k) => k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$"));
      if (key) {
        type Fiber = { type?: unknown; return?: Fiber | null; _debugSource?: { fileName?: unknown; lineNumber?: unknown; columnNumber?: unknown } };
        let fiber = node[key] as Fiber | null;
        const source = fiber?._debugSource; // React 18 et avant, en développement ; absent de React 19
        let component: string | null = null;
        for (let up = 0; fiber && up < 50 && !component; up++, fiber = fiber.return ?? null) {
          if (typeof fiber.type !== "string") component = nameOf(fiber.type);
        }
        return {
          framework: "react",
          component,
          file: str(source?.fileName),
          line: num(source?.lineNumber),
          column: num(source?.columnNumber),
        };
      }
    }
  } catch {
    // getter ou Proxy piégé par la page : pas d'indice
  }
  return null;
}

/** L'indice pour l'élément de ce sélecteur dans cet onglet, ou null. Ne lève jamais, 1 s au plus. */
export async function sourceHintFor(tabId: number | undefined, selector: string): Promise<SourceHint | null> {
  if (tabId === undefined || !selector) return null;
  try {
    const run = chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", func: readSourceHint, args: [selector] });
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 1000));
    const results = await Promise.race([run.catch(() => null), timeout]);
    return cleanSourceHint(results?.[0]?.result);
  } catch {
    return null;
  }
}
