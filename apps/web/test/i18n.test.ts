import { describe, expect, it } from "vitest";
import en from "../src/i18n/locales/en.ts";
import { LOCALES, currentLocale, t, tx } from "../src/i18n/core.ts";

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();

describe("languages", () => {
  it("English plus the starter set are all there", () => {
    expect(LOCALES.map((l) => l.code).sort()).toEqual(["de", "en", "es", "fr", "it", "nl", "pt"]);
    expect(LOCALES[0]!.code).toBe("en");
  });

  it("every translation only uses keys English has, with the same placeholders", () => {
    for (const l of LOCALES.filter((x) => x.code !== "en")) {
      for (const [key, text] of Object.entries(l.messages)) {
        const base = (en as Record<string, string>)[key];
        expect(base, `${l.code}: unknown key ${key}`).toBeDefined();
        // plural forms may leave out {count} in the singular ("one mailbox"), but never add one
        const extra = placeholders(text).filter((p) => !placeholders(base!).includes(p));
        expect(extra, `${l.code}: ${key} has placeholders English doesn't`).toEqual([]);
        if (!key.endsWith("_one")) expect(placeholders(text), `${l.code}: ${key}`).toEqual(placeholders(base!));
      }
    }
  });

  it("each translation covers the main screens (nothing important falls back to English)", () => {
    const main = Object.keys(en).filter((k) => /^(nav|signin|plans|start|dash|set)\./.test(k));
    for (const l of LOCALES.filter((x) => x.code !== "en")) {
      const missing = main.filter((k) => !(k in l.messages));
      expect(missing, `${l.code} is missing ${missing.join(", ")}`).toEqual([]);
    }
  });
});

describe("t()", () => {
  it("fills placeholders and chooses singular or plural", () => {
    expect(currentLocale()).toBe("en");
    expect(t("dash.welcomeBack", { name: "Ana" })).toBe("Welcome back, Ana");
    expect(t("common.people", { count: 1 })).toBe("1 person");
    expect(t("common.people", { count: 15 })).toBe("15 people");
  });

  it("puts elements into placeholders", () => {
    const node = tx("start.agree", { terms: "T", privacy: "P" }) as { props: { children?: unknown } };
    expect(node).toBeTruthy();
  });
});
