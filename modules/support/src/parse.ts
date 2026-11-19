/** Turning raw email into ticket data, and text helpers. No database access here. */
import { simpleParser, type AddressObject } from "mailparser";

export interface Incoming {
  messageId: string | null; inReplyTo: string | null; references: string[];
  fromEmail: string | null; fromName: string | null; to: string[]; cc: string[];
  subject: string; body: string; date: Date | null; autoReply: boolean;
  attachments: { name: string; contentType: string; content: Buffer }[];
}

const MAX_BODY = 100_000;
const addrs = (a: AddressObject | AddressObject[] | undefined) =>
  (Array.isArray(a) ? a : a ? [a] : []).flatMap((x) => x.value).map((v) => v.address?.toLowerCase()).filter((x): x is string => !!x);
const ids = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v ? v.split(/\s+/) : []).map((s) => s.trim()).filter((s) => /^<[^<>\s]+>$/.test(s));

/** Cuts the quoted history most mail apps add under a reply, so tickets show only what is new. */
export function stripQuoted(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const markers = [
    /^On .{3,200}wrote:\s*$/i, /^El .{3,200}escribió:\s*$/i, /^Le .{3,200}a écrit\s*:\s*$/i, /^Am .{3,200}schrieb .*:\s*$/i,
    /^-{2,}\s*Original Message\s*-{2,}/i, /^-{2,}\s*Mensaje original\s*-{2,}/i, /^_{10,}\s*$/,
  ];
  let cut = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!.trim();
    if (markers.some((m) => m.test(l))) { cut = i; break; }
    // Outlook style header block: From: ... followed by Sent:/Date: within the next lines
    if (/^(From|De):\s/i.test(l) && lines.slice(i + 1, i + 4).some((n) => /^(Sent|Date|Enviado|Fecha):\s/i.test(n.trim()))) { cut = i; break; }
  }
  let out = lines.slice(0, cut);
  // Trailing "> quoted" lines.
  while (out.length && (out[out.length - 1]!.trim() === "" || out[out.length - 1]!.trimStart().startsWith(">"))) out.pop();
  const s = out.join("\n").trim();
  return s || text.trim();
}

export const ticketToken = (subject: string): number | null => {
  const m = /\[#(\d{1,9})\]/.exec(subject);
  return m ? Number(m[1]) : null;
};
export const cleanSubject = (s: string) =>
  s.replace(/\[#\d+\]/g, "").replace(/^\s*((re|fw|fwd|aw|wg|rv|tr|sv)\s*(\[\d+\])?\s*:\s*)+/i, "").replace(/\s+/g, " ").trim() || "(no subject)";

export async function parseIncoming(raw: Buffer | string): Promise<Incoming> {
  const m = await simpleParser(raw, { skipImageLinks: true, skipTextToHtml: true });
  const from = (Array.isArray(m.from) ? m.from[0] : m.from)?.value[0];
  const header = (k: string) => String(m.headers.get(k) ?? "").toLowerCase();
  const autoSubmitted = header("auto-submitted");
  const precedence = header("precedence");
  const autoReply = (!!autoSubmitted && autoSubmitted !== "no") || ["bulk", "junk", "list", "auto_reply"].includes(precedence)
    || !!m.headers.get("x-autoreply") || !!m.headers.get("x-autorespond") || header("x-auto-response-suppress").includes("all") && /auto/i.test(m.subject ?? "")
    || /^(mailer-daemon|postmaster)@/i.test(from?.address ?? "");
  const text = m.text ?? "";
  return {
    messageId: ids(m.messageId)[0] ?? null,
    inReplyTo: ids(m.inReplyTo)[0] ?? null,
    references: ids(m.references),
    fromEmail: from?.address?.toLowerCase() ?? null,
    fromName: from?.name?.trim() || null,
    to: addrs(m.to), cc: addrs(m.cc),
    subject: (m.subject ?? "").slice(0, 300),
    body: (stripQuoted(text) || "(no text)").slice(0, MAX_BODY),
    date: m.date ?? null,
    autoReply,
    attachments: m.attachments
      .filter((a) => a.contentDisposition !== "inline" || !a.related)
      .slice(0, 20)
      .map((a) => ({ name: (a.filename || "attachment").slice(0, 255), contentType: a.contentType || "application/octet-stream", content: a.content })),
  };
}

/** Fills {{customer.name}}, {{customer.firstName}}, {{ticket.number}}, {{ticket.subject}}, {{agent.name}}; unknown tags stay as typed. */
export function renderTemplate(body: string, vars: Record<string, string>): string {
  return body.replace(/\{\{\s*([a-zA-Z]+\.[a-zA-Z]+)\s*\}\}/g, (all, k: string) => (k in vars ? vars[k]! : all));
}

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const textToHtml = (t: string) => `<div style="font-family:sans-serif;font-size:14px;line-height:1.5">${t.replace(/[&<>"']/g, (c) => ESC[c]!).replace(/\r?\n/g, "<br>")}</div>`;
export const firstName = (name: string | null) => (name ?? "").trim().split(/\s+/)[0] || "there";
