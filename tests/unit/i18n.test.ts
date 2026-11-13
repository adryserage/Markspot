import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { currentLang, en, fr, parseLangChoice, resolveLang, setLang, t, type Entry } from "../../src/core/i18n.ts";

afterEach(() => setLang("en"));

const forms = (entry: Entry): Array<[string, string]> =>
  typeof entry === "string" ? [["", entry]] : [["one", entry.one], ["other", entry.other]];
const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

test("en and fr have the same keys, with the same shape", () => {
  assert.deepEqual(Object.keys(fr).sort(), Object.keys(en).sort());
  for (const key of Object.keys(en) as Array<keyof typeof en>) {
    assert.equal(typeof fr[key], typeof en[key], `${key}: one is plural, the other is not`);
  }
});

test("every placeholder is kept in both languages", () => {
  for (const key of Object.keys(en) as Array<keyof typeof en>) {
    const english = forms(en[key]);
    const french = forms(fr[key]);
    for (const [i, [form, text]] of english.entries()) {
      assert.deepEqual(placeholders(french[i]![1]), placeholders(text), `${key} ${form}`);
    }
  }
});

test("no entry is empty", () => {
  for (const table of [en, fr]) {
    for (const [key, entry] of Object.entries(table)) {
      for (const [, text] of forms(entry)) assert.ok(text.length > 0, key);
    }
  }
});

test("t fills placeholders and keeps unknown ones", () => {
  assert.equal(t("overlay.noteSaved", { seq: 3 }), "Note 3 saved. Click elsewhere to add another.");
  assert.equal(t("menu.goTo"), "Go to note {seq}");
  setLang("fr");
  assert.equal(currentLang(), "fr");
  assert.equal(t("menu.confirmDelete", { seq: 7 }), "Supprimer la note 7 ?");
});

test("plural entries pick one or other with the language's rules", () => {
  assert.equal(t("menu.count", { count: 1 }), "1 note");
  assert.equal(t("menu.count", { count: 2 }), "2 notes");
  assert.equal(t("menu.count", { count: 0 }), "0 notes");
  assert.equal(t("overlay.sent", { count: 3, to: "site" }), "3 notes sent to site.");
  setLang("fr");
  assert.equal(t("menu.resolvedUndo", { count: 1 }), "1 note réglée.");
  assert.equal(t("menu.resolvedUndo", { count: 4 }), "4 notes réglées.");
  assert.equal(t("menu.count", { count: 0 }), "0 note", "French puts 0 in the singular");
  assert.equal(t("export.ready", { count: 2, size: 12 }), "2 notes prêtes (12 Ko).");
});

test("resolveLang: auto follows the browser, fr* gives French", () => {
  assert.equal(resolveLang("auto", "fr"), "fr");
  assert.equal(resolveLang("auto", "fr-CA"), "fr");
  assert.equal(resolveLang("auto", "FR"), "fr");
  assert.equal(resolveLang("auto", "en-US"), "en");
  assert.equal(resolveLang("auto", "de"), "en");
  assert.equal(resolveLang("auto", ""), "en");
  assert.equal(resolveLang("en", "fr-FR"), "en");
  assert.equal(resolveLang("fr", "en-US"), "fr");
});

test("parseLangChoice: anything but en or fr is auto", () => {
  assert.equal(parseLangChoice("en"), "en");
  assert.equal(parseLangChoice("fr"), "fr");
  for (const value of [undefined, null, "auto", "de", 3, {}]) assert.equal(parseLangChoice(value), "auto");
});
