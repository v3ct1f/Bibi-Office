import { useEffect, useRef, useState } from "react";
import { Paperclip, Send, Trash2, X } from "lucide-react";
import { Button, Input, Textarea, cn, toast } from "@office/ui";
import { useModuleHost } from "@office/ui/module-ui";
import { tt } from "./i18n.ts";
import { addrsToText, errorMessage, fmtSize, parseAddrs, toBase64, type AccountInfo, type AttachmentInfo, type MailMessage } from "./shared.tsx";

/** What the person types; kept as text until it is saved. */
interface Form { to: string; cc: string; bcc: string; subject: string; text: string }
const formOf = (m: MailMessage): Form => ({ to: addrsToText(m.to), cc: addrsToText(m.cc), bcc: addrsToText(m.bcc), subject: m.subject, text: m.bodyText });

/**
 * The writing window. A draft exists on the server from the moment it opens and is saved as you type,
 * so closing the window (or the browser) never loses it; Drafts lists it until it is sent or discarded.
 */
export function Compose({ draft, limits, onClose, onSent }: { draft: MailMessage; limits: AccountInfo["limits"]; onClose: (changed: boolean) => void; onSent: () => void }) {
  const host = useModuleHost();
  const [form, setForm] = useState<Form>(() => formOf(draft));
  const [files, setFiles] = useState<AttachmentInfo[]>(draft.attachments);
  const [showCc, setShowCc] = useState(draft.cc.length > 0 || draft.bcc.length > 0);
  const [state, setState] = useState<"saved" | "saving" | "dirty">("saved");
  const [sending, setSending] = useState(false);
  const latest = useRef(form);
  latest.current = form;
  const pending = useRef<Promise<unknown>>(Promise.resolve());
  const closed = useRef(false);
  const textRef = useRef<HTMLTextAreaElement>(null);

  const persist = (f: Form) => {
    setState("saving");
    const run = pending.current.catch(() => {}).then(() => host.api.put(`/drafts/${draft.id}`, {
      to: parseAddrs(f.to), cc: parseAddrs(f.cc), bcc: parseAddrs(f.bcc), subject: f.subject, text: f.text,
    })).then(() => { if (latest.current === f) setState("saved"); }).catch((e) => { setState("dirty"); toast.error(errorMessage(e)); });
    pending.current = run;
    return run;
  };

  // Save about a second after the last keystroke.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    setState("dirty");
    const t = setTimeout(() => { if (!closed.current) void persist(form); }, 900);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form]);

  // Cursor goes where the writing starts: the subject for a new message, the text for a reply.
  useEffect(() => { if (form.to) { textRef.current?.focus(); textRef.current?.setSelectionRange(0, 0); } }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k: keyof Form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const close = async () => {
    closed.current = true;
    const f = latest.current;
    const empty = !f.to.trim() && !f.cc.trim() && !f.subject.trim() && files.length === 0
      && f.text.replace(/\s|--/g, "") === draft.bodyText.replace(/\s|--/g, "");
    try {
      if (empty) await host.api.del(`/drafts/${draft.id}`); else await persist(f);
    } catch { /* the draft stays where it is */ }
    onClose(true);
  };

  const discard = async () => {
    closed.current = true;
    try { await host.api.del(`/drafts/${draft.id}`); } catch (e) { toast.error(errorMessage(e)); }
    onClose(true);
  };

  const send = async () => {
    if (!parseAddrs(form.to + "," + form.cc + "," + form.bcc).length) { toast.error(tt("addRecipient")); return; }
    setSending(true);
    closed.current = true;
    try {
      await persist(latest.current);
      await host.api.post(`/drafts/${draft.id}/send`, {});
      toast.success(tt("sentOk"));
      onSent();
    } catch (e) {
      closed.current = false;
      toast.error(`${tt("sendFail")}: ${errorMessage(e)}`);
    } finally { setSending(false); }
  };

  const attach = async (list: FileList | null) => {
    if (!list) return;
    for (const f of Array.from(list)) {
      if (f.size > limits.maxFileBytes) { toast.error(tt("tooBig", { name: f.name })); continue; }
      try {
        const a = await host.api.post<AttachmentInfo>(`/drafts/${draft.id}/attachments`, { name: f.name, contentType: f.type || "application/octet-stream", data: await toBase64(f) });
        setFiles((cur) => [...cur, a]);
      } catch (e) { toast.error(`${f.name}: ${errorMessage(e)}`); }
    }
  };
  const removeFile = async (id: string) => {
    try { await host.api.del(`/drafts/${draft.id}/attachments/${id}`); setFiles((cur) => cur.filter((a) => a.id !== id)); } catch (e) { toast.error(errorMessage(e)); }
  };

  return (
    <section role="dialog" aria-label={tt("newMessage")} data-testid="compose"
      className="fixed bottom-0 right-0 z-40 flex max-h-[92dvh] w-full flex-col rounded-t-lg border bg-surface shadow-xl sm:bottom-4 sm:right-4 sm:w-[36rem] sm:rounded-lg">
      <header className="flex items-center gap-2 rounded-t-lg bg-primary px-3 py-2 text-primary-foreground">
        <h2 className="flex-1 truncate text-sm font-medium">{form.subject.trim() || tt("newMessage")}</h2>
        <span className="text-xs opacity-80" aria-live="polite" data-testid="draft-state">{state === "saving" ? tt("saving") : state === "saved" ? tt("saved") : ""}</span>
        <button type="button" aria-label={tt("close")} className="cursor-pointer rounded p-1 hover:bg-white/20" onClick={() => void close()}><X className="size-4" /></button>
      </header>
      <div className="grid min-h-0 gap-0 overflow-y-auto">
        <div className="flex items-center gap-2 border-b px-3">
          <label htmlFor="mail-to" className="w-12 shrink-0 text-xs text-muted-foreground">{tt("to")}</label>
          <Input id="mail-to" className="border-0 shadow-none focus-visible:ring-0" value={form.to} onChange={set("to")} autoComplete="off" placeholder="name@example.com" />
          {!showCc && <button type="button" className="cursor-pointer text-xs text-muted-foreground hover:text-foreground" onClick={() => setShowCc(true)}>{tt("cc")}/{tt("bcc")}</button>}
        </div>
        {showCc && (<>
          <div className="flex items-center gap-2 border-b px-3">
            <label htmlFor="mail-cc" className="w-12 shrink-0 text-xs text-muted-foreground">{tt("cc")}</label>
            <Input id="mail-cc" className="border-0 shadow-none focus-visible:ring-0" value={form.cc} onChange={set("cc")} autoComplete="off" />
          </div>
          <div className="flex items-center gap-2 border-b px-3">
            <label htmlFor="mail-bcc" className="w-12 shrink-0 text-xs text-muted-foreground">{tt("bcc")}</label>
            <Input id="mail-bcc" className="border-0 shadow-none focus-visible:ring-0" value={form.bcc} onChange={set("bcc")} autoComplete="off" />
          </div>
        </>)}
        <div className="flex items-center gap-2 border-b px-3">
          <label htmlFor="mail-subject" className="w-12 shrink-0 text-xs text-muted-foreground">{tt("subject")}</label>
          <Input id="mail-subject" className="border-0 shadow-none focus-visible:ring-0" value={form.subject} onChange={set("subject")} autoComplete="off" />
        </div>
        <Textarea ref={textRef} aria-label="Message" rows={12} value={form.text} onChange={set("text")} className="min-h-48 resize-none rounded-none border-0 shadow-none focus-visible:ring-0" />
        {files.length > 0 && (
          <ul className="flex flex-wrap gap-2 border-t px-3 py-2" aria-label="Attachments">
            {files.map((a) => (
              <li key={a.id} className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs" data-testid="draft-file">
                <Paperclip className="size-3" /><span className="max-w-40 truncate">{a.name}</span><span className="text-muted-foreground">{fmtSize(a.sizeBytes)}</span>
                <button type="button" aria-label={`${tt("remove")} ${a.name}`} className="cursor-pointer text-muted-foreground hover:text-foreground" onClick={() => void removeFile(a.id)}><X className="size-3" /></button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <footer className="flex items-center gap-2 border-t px-3 py-2">
        <Button onClick={() => void send()} disabled={sending}><Send /> {tt("send")}</Button>
        <label className={cn("inline-flex size-9 cursor-pointer items-center justify-center rounded-md hover:bg-accent")} title={tt("attach")}>
          <Paperclip className="size-4" /><span className="sr-only">{tt("attach")}</span>
          <input type="file" multiple className="sr-only" data-testid="attach-input" onChange={(e) => { void attach(e.target.files); e.target.value = ""; }} />
        </label>
        <span className="flex-1" />
        <Button variant="ghost" size="icon" aria-label={tt("discard")} title={tt("discard")} onClick={() => void discard()}><Trash2 /></Button>
      </footer>
    </section>
  );
}
