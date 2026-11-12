// Sélecteur CSS unique et court pour l'élément marqué. Pur : le DOM réel ou un faux
// arbre de test fournissent les nœuds, et isUnique dit si un sélecteur ne vise que cet élément.

export interface SelectorNode {
  readonly localName: string;
  readonly id: string;
  readonly classList: Iterable<string>;
  getAttribute(name: string): string | null;
  readonly parentElement: SelectorNode | null;
  readonly previousElementSibling: SelectorNode | null;
}

export type Escape = (value: string) => string;

const MAX_DEPTH = 6;
const TEST_ATTRIBUTES = ["data-testid", "data-test", "data-cy", "name", "aria-label"];

/** Un identifiant qui ressemble à du généré (chiffres en série, hachage) ne survit pas à un build. */
export function looksGenerated(value: string): boolean {
  return /\d{3,}|[a-f0-9]{8,}|^:r|^radix-|^headlessui-|^mui-|^ember\d/i.test(value);
}

function stableClasses(node: SelectorNode): string[] {
  return [...node.classList].filter((c) => !looksGenerated(c) && c.length < 40).slice(0, 3);
}

/** Sélecteurs propres au nœud, du plus lisible au plus général, sans sa position. */
export function ownSelectors(node: SelectorNode, escape: Escape): string[] {
  const tag = node.localName;
  const candidates: string[] = [];
  if (node.id && !looksGenerated(node.id)) candidates.push(`#${escape(node.id)}`);
  for (const attribute of TEST_ATTRIBUTES) {
    const value = node.getAttribute(attribute);
    if (value && value.length < 80) candidates.push(`${tag}[${attribute}="${escape(value)}"]`);
  }
  const classes = stableClasses(node);
  if (classes.length > 0) candidates.push(tag + classes.map((c) => `.${escape(c)}`).join(""));
  candidates.push(tag);
  return candidates;
}

export function nthOfType(node: SelectorNode): string {
  let index = 1;
  for (let sibling = node.previousElementSibling; sibling; sibling = sibling.previousElementSibling) {
    if (sibling.localName === node.localName) index++;
  }
  return `${node.localName}:nth-of-type(${index})`;
}

/**
 * 1. un sélecteur propre unique (#id, attribut de test, classes) ;
 * 2. sinon la position de l'élément, précédée du plus proche ancêtre identifiable ;
 * 3. sinon le chemin complet depuis la racine.
 */
export function uniqueSelector(
  element: SelectorNode,
  isUnique: (selector: string) => boolean,
  escape: Escape,
): string {
  const own = ownSelectors(element, escape);
  for (const candidate of own) if (isUnique(candidate)) return candidate;

  const step = nthOfType(element);
  if (isUnique(step)) return step;

  // Du plus court au plus précis : ancêtre identifiable + position de l'élément,
  // puis ancêtre + chemin exact jusqu'à l'élément.
  let suffix = step;
  let current = element.parentElement;
  for (let depth = 0; current && depth < MAX_DEPTH; depth++, current = current.parentElement) {
    for (const candidate of ownSelectors(current, escape)) {
      if (candidate === current.localName) continue;
      for (const tail of new Set([step, suffix])) {
        if (isUnique(`${candidate} ${tail}`)) return `${candidate} ${tail}`;
      }
    }
    suffix = `${nthOfType(current)} > ${suffix}`;
    if (isUnique(suffix)) return suffix;
  }

  const path: string[] = [];
  for (let node: SelectorNode | null = element; node && node.localName !== "html"; node = node.parentElement) {
    path.unshift(nthOfType(node));
  }
  return `html > ${path.join(" > ")}`;
}
