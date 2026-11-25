import { describe, expect, it } from "vitest";
import { mailText } from "../ui/i18n.ts";

const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();

describe("Mail texts", () => {
  it("every translation only uses real keys and the same placeholders as English", () => {
    for (const [lang, dict] of Object.entries(mailText).filter(([l]) => l !== "en")) {
      for (const [key, text] of Object.entries(dict)) {
        const base = (mailText.en as Record<string, string>)[key];
        expect(base, `${lang}: unknown key ${key}`).toBeDefined();
        expect(holes(text as string), `${lang}: ${key}`).toEqual(holes(base!));
      }
    }
  });
  it("the main labels are translated in every language", () => {
    const main = ["compose", "inbox", "starred", "sent", "drafts", "spam", "trash", "archive", "reply", "forward", "send", "search", "delete"];
    for (const [lang, dict] of Object.entries(mailText).filter(([l]) => l !== "en")) {
      expect(main.filter((k) => !(k in dict)), lang).toEqual([]);
    }
  });
});
