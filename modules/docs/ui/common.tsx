import { Badge } from "@office/ui";
import type { DocStatus, SignerStatus } from "./types.ts";

export const P = { read: "docs:documents.read", send: "docs:documents.send", manage: "docs:templates.manage" } as const;
export const ROOT = "/m/docs/documents";
const lang = () => (typeof navigator !== "undefined" && navigator.language) || "en";
export const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(lang(), { day: "numeric", month: "short", year: "numeric" });
export const fmtWhen = (iso: string) => new Date(iso).toLocaleString(lang(), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

type Tone = "primary" | "neutral" | "success" | "danger" | "warning";
const DOC: Record<DocStatus, [string, Tone]> = {
  draft: ["Draft", "neutral"], sent: ["Waiting for signatures", "warning"], completed: ["Signed", "success"],
  declined: ["Declined", "danger"], voided: ["Cancelled", "neutral"], expired: ["Expired", "neutral"],
};
const SIG: Record<SignerStatus, [string, Tone]> = {
  waiting: ["Not sent yet", "neutral"], pending: ["Sent", "primary"], viewed: ["Opened", "warning"], signed: ["Signed", "success"], declined: ["Declined", "danger"],
};
export const DocBadge = ({ s }: { s: DocStatus }) => <Badge tone={DOC[s][1]}>{DOC[s][0]}</Badge>;
export const SignerBadge = ({ s }: { s: SignerStatus }) => <Badge tone={SIG[s][1]}>{SIG[s][0]}</Badge>;
export const STATUS_OPTIONS: [DocStatus | "", string][] = [["", "All documents"], ["draft", "Drafts"], ["sent", "Waiting"], ["completed", "Signed"], ["declined", "Declined"], ["voided", "Cancelled"], ["expired", "Expired"]];

// Same tiny format as the server: "# h1", "## h2", "- bullet", blank line = paragraph. Rendered as React text, never HTML.
type Block = { kind: "h1" | "h2" | "p"; text: string } | { kind: "ul"; items: string[] };
function blocks(body: string): Block[] {
  const out: Block[] = [];
  let para: string[] = [];
  const flush = () => { if (para.length) out.push({ kind: "p", text: para.join(" ") }); para = []; };
  for (const raw of body.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!line) { flush(); continue; }
    const h = /^(#{1,2})\s+(.*)$/.exec(line);
    if (h) { flush(); out.push({ kind: h[1]!.length === 1 ? "h1" : "h2", text: h[2]! }); continue; }
    const li = /^[-*]\s+(.*)$/.exec(line);
    if (li) { flush(); const last = out.at(-1); if (last?.kind === "ul") last.items.push(li[1]!); else out.push({ kind: "ul", items: [li[1]!] }); continue; }
    para.push(line);
  }
  flush();
  return out;
}
const FIELD = /(\{\{\s*[a-z][a-z0-9_.]*\s*\}\})/g;
const withFields = (t: string) => t.split(FIELD).map((part, i) => (i % 2 ? <mark key={i} className="rounded bg-warning/30 px-0.5 text-fg">{part}</mark> : part));
export function DocBody({ body }: { body: string }) {
  return (
    <article className="grid gap-3 text-[15px] leading-relaxed" aria-label="Document text">
      {blocks(body).map((b, i) => {
        if (b.kind === "ul") return <ul key={i} className="ml-5 list-disc">{b.items.map((it, j) => <li key={j}>{withFields(it)}</li>)}</ul>;
        if (b.kind === "h1") return <h2 key={i} className="mt-2 text-xl font-semibold">{withFields(b.text)}</h2>;
        if (b.kind === "h2") return <h3 key={i} className="mt-1 text-base font-semibold">{withFields(b.text)}</h3>;
        return <p key={i}>{withFields(b.text)}</p>;
      })}
    </article>
  );
}
