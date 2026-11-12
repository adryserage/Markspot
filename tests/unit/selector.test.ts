import assert from "node:assert/strict";
import { test } from "node:test";
import { uniqueSelector, type SelectorNode } from "../../src/core/selector.ts";

// Petit arbre factice : chaque nœud connaît son parent et son frère précédent.
interface Fake extends SelectorNode {
  parentElement: Fake | null;
  previousElementSibling: Fake | null;
  children: Fake[];
}

function node(localName: string, props: { id?: string; classes?: string[]; attrs?: Record<string, string> } = {}, children: Fake[] = []): Fake {
  const self: Fake = {
    localName,
    id: props.id ?? "",
    classList: props.classes ?? [],
    getAttribute: (name) => props.attrs?.[name] ?? null,
    parentElement: null,
    previousElementSibling: null,
    children,
  };
  children.forEach((child, i) => {
    child.parentElement = self;
    child.previousElementSibling = children[i - 1] ?? null;
  });
  return self;
}

const escape = (v: string) => v;

/** Unicité simulée : chaque test liste les sélecteurs qui ne visent que la cible. */
const uniqueAmong = (unique: string[]) => (selector: string) => unique.includes(selector);

test("an element with a stable id gets #id", () => {
  const target = node("button", { id: "acheter" });
  node("body", {}, [target]);
  assert.equal(uniqueSelector(target, uniqueAmong(["#acheter"]), escape), "#acheter");
});

test("a list item without class gets its position under the nearest identifiable ancestor", () => {
  const items = [node("li"), node("li"), node("li")];
  const list = node("ul", {}, items);
  const section = node("section", { classes: ["chiffres"] }, [list]);
  node("body", {}, [node("header"), section]);
  const selector = uniqueSelector(items[1]!, uniqueAmong(["section.chiffres li:nth-of-type(2)"]), escape);
  assert.equal(selector, "section.chiffres li:nth-of-type(2)");
});

test("never falls back to the full path when a short positional selector is unique", () => {
  const items = [node("li"), node("li")];
  node("body", {}, [node("ul", {}, items)]);
  const selector = uniqueSelector(items[1]!, uniqueAmong(["li:nth-of-type(2)"]), escape);
  assert.equal(selector, "li:nth-of-type(2)");
  assert.doesNotMatch(selector, /^html/);
});

test("generated ids and classes are skipped", () => {
  const target = node("div", { id: "radix-123", classes: ["css-1a2b3c4d"] });
  node("main", { id: "contenu" }, [node("p"), target]);
  const selector = uniqueSelector(target, uniqueAmong(["#contenu div:nth-of-type(1)"]), escape);
  assert.equal(selector, "#contenu div:nth-of-type(1)");
});

test("full path from html as the last resort", () => {
  const target = node("span");
  const html = node("html", {}, [node("body", {}, [node("div", {}, [target])])]);
  void html;
  assert.equal(uniqueSelector(target, () => false, escape), "html > body:nth-of-type(1) > div:nth-of-type(1) > span:nth-of-type(1)");
});
