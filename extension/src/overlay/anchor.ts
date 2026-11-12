// Décrit l'élément marqué pour que Claude le retrouve : dans le code (texte, attributs)
// et dans la page (sélecteur unique). Tourne dans la page.

import {
  ANCHOR_TEXT_MAX,
  STYLE_PROPS,
  redactUrl,
  type ComputedStyles,
  type ElementAnchor,
} from "../../../src/core/model.ts";

const KEPT_ATTRIBUTES = ["id", "class", "name", "type", "role", "href", "src", "alt", "title", "placeholder", "for"];
const FORM_FIELDS = new Set(["INPUT", "TEXTAREA", "SELECT", "OPTION"]);
const MAX_ATTRIBUTE = 200;

/** Un identifiant qui ressemble à du généré (chiffres en série, hachage) ne survit pas à un build. */
function looksGenerated(value: string): boolean {
  return /\d{3,}|[a-f0-9]{8,}|^:r|^radix-|^headlessui-|^mui-|^ember\d/i.test(value);
}

function isUnique(selector: string, element: Element): boolean {
  try {
    const found = element.ownerDocument.querySelectorAll(selector);
    return found.length === 1 && found[0] === element;
  } catch {
    return false;
  }
}

function stableClasses(element: Element): string[] {
  return [...element.classList].filter((c) => !looksGenerated(c) && c.length < 40).slice(0, 3);
}

/** Un pas de sélecteur pour cet élément seul, du plus lisible au plus sûr. */
function ownSelectors(element: Element): string[] {
  const tag = element.localName;
  const candidates: string[] = [];
  if (element.id && !looksGenerated(element.id)) candidates.push(`#${CSS.escape(element.id)}`);
  for (const attribute of ["data-testid", "data-test", "data-cy", "name", "aria-label"]) {
    const value = element.getAttribute(attribute);
    if (value && value.length < 80) candidates.push(`${tag}[${attribute}="${CSS.escape(value)}"]`);
  }
  const classes = stableClasses(element);
  if (classes.length > 0) candidates.push(tag + classes.map((c) => `.${CSS.escape(c)}`).join(""));
  candidates.push(tag);
  return candidates;
}

function nthOfType(element: Element): string {
  let index = 1;
  for (let sibling = element.previousElementSibling; sibling; sibling = sibling.previousElementSibling) {
    if (sibling.localName === element.localName) index++;
  }
  return `${element.localName}:nth-of-type(${index})`;
}

/** Le plus court sélecteur unique trouvé, sinon le chemin complet depuis la racine. */
export function uniqueSelector(element: Element): string {
  for (const own of ownSelectors(element)) if (isUnique(own, element)) return own;

  let suffix = ownSelectors(element)[0] ?? element.localName;
  let current: Element | null = element.parentElement;
  for (let depth = 0; current && depth < 6; depth++, current = current.parentElement) {
    for (const own of ownSelectors(current)) {
      const candidate = `${own} ${suffix}`;
      if (isUnique(candidate, element)) return candidate;
    }
    suffix = `${nthOfType(current)} > ${suffix}`;
  }

  const path: string[] = [];
  for (let node: Element | null = element; node && node !== element.ownerDocument.documentElement; node = node.parentElement) {
    path.unshift(nthOfType(node));
  }
  return `html > ${path.join(" > ")}`;
}

function visibleText(element: Element): string {
  if (FORM_FIELDS.has(element.tagName)) return "";
  const text = (element as HTMLElement).innerText ?? element.textContent ?? "";
  return text.replace(/\s+/g, " ").trim().slice(0, ANCHOR_TEXT_MAX);
}

function attributesOf(element: Element): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const attribute of element.attributes) {
    const name = attribute.name;
    if (!KEPT_ATTRIBUTES.includes(name) && !name.startsWith("data-") && !name.startsWith("aria-")) continue;
    let value = attribute.value;
    if (name === "href" || name === "src") {
      try {
        value = redactUrl(new URL(value, element.ownerDocument.baseURI).toString());
      } catch {
        // valeur qui n'est pas une adresse : gardée telle quelle
      }
    }
    kept[name] = value.slice(0, MAX_ATTRIBUTE);
  }
  return kept;
}

function stylesOf(element: Element): ComputedStyles {
  const computed = getComputedStyle(element);
  return Object.fromEntries(STYLE_PROPS.map((p) => [p, computed.getPropertyValue(p)])) as ComputedStyles;
}

export function describeElement(element: Element): ElementAnchor {
  return {
    selector: uniqueSelector(element),
    tag: element.localName,
    role: element.getAttribute("role"),
    text: visibleText(element),
    attributes: attributesOf(element),
    styles: stylesOf(element),
  };
}
