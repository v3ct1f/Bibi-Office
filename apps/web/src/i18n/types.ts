import type en from "./locales/en.ts";

/** Every piece of text the app can show, by key (the English file is the master list). */
export type Messages = typeof en;
export type MessageKey = keyof Messages;
/** A language file: any subset of the keys. Missing keys fall back to English. */
export type Dict = Partial<Record<MessageKey, string>>;
/** Keys you can pass to t(): plural families (key_one / key_other) are called by their base name. */
export type TKey = { [K in MessageKey]: K extends `${infer B}_${"one" | "other"}` ? B : K }[MessageKey];
