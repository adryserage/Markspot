// Décrit l'élément marqué pour que Claude le retrouve : dans le code (texte, attributs)
// et dans la page (sélecteur unique). Tourne dans la page.

import {
  ANCHOR_TEXT_MAX,
  STYLE_PROPS,
  redactUrl,
  type ComputedStyles,
  type ElementAnchor,
} from "../../../src/core/model.ts";
import { uniqueSelector } from "../../../src/core/selector.ts";

const KEPT_ATTRIBUTES = ["id", "class", "name", "type", "role", "href", "src", "alt", "title", "placeholder", "for"];
const FORM_FIELDS = new Set(["INPUT", "TEXTAREA", "SELECT", "OPTION"]);
const MAX_ATTRIBUTE = 200;

function isUnique(selector: string, element: Element): boolean {
  try {
    const found = element.ownerDocument.querySelectorAll(selector);
    return found.length === 1 && found[0] === element;
  } catch {
    return false;
  }
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
    selector: uniqueSelector(element, (selector) => isUnique(selector, element), CSS.escape),
    tag: element.localName,
    role: element.getAttribute("role"),
    text: visibleText(element),
    attributes: attributesOf(element),
    styles: stylesOf(element),
  };
}
