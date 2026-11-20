import { useEffect, useMemo, useRef, useState } from "react";
import { CircleCheck, Download, Eraser, FileText, PenLine } from "lucide-react";
import { Badge, Button, Card, Dialog, DialogContent, DialogFooter, EmptyState, Field, Input, Skeleton, Textarea, toast } from "@office/ui";
import type { PublicPageProps } from "@office/ui/module-ui";
import { PdfPages } from "./PdfPages.tsx";
import { FIELD_LABEL, b64ToBytes, downloadBase64, errorMessage, fmtDate, type FieldKind } from "./shared.tsx";

interface View {
  document: { title: string; message: string | null; status: string; companyName: string | null; senderName: string; expiresOn: string | null; pageCount: number | null; fileName: string };
  signer: { name: string; email: string; status: "pending" | "signed" | "declined"; signedAt: string | null };
  signers: { name: string; status: string; me: boolean }[];
  yourTurn: boolean; waitingFor: string | null;
  fields: { id: string; kind: FieldKind; page: number; x: number; y: number; w: number; h: number; required: boolean; label: string | null }[];
  pdf: string; signedCopy: boolean;
}
type Mark = { kind: "typed"; text: string } | { kind: "drawn"; image: string };
const SCRIPT = { fontFamily: '"Segoe Script", "Brush Script MT", "Snell Roundhand", cursive' };

/** The page a signer opens from their email: read, fill in, sign (or decline). No account needed. */
export function SignPage({ params, api }: PublicPageProps) {
  const token = params.token!;
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.get<View>(`/sign/${token}`).then(setView, (e) => setError(errorMessage(e)));
  }, [api, token]);
  const pdf = useMemo(() => (view ? b64ToBytes(view.pdf) : null), [view]);

  return (
    <div className="min-h-screen bg-muted/40">
      <header className="border-b bg-surface">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
          <FileText className="size-5 text-primary" />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-semibold">{view?.document.title ?? "Document"}</span>
            {view && <span className="block truncate text-xs text-muted-foreground">From {view.document.senderName}{view.document.companyName ? `, ${view.document.companyName}` : ""}</span>}
          </span>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">
        {error ? (
          <Card><EmptyState title="This link doesn't work" description={/not valid|not found/i.test(error) ? "It may have been replaced by a newer link, or the document was deleted. Ask the sender for a new link." : error} /></Card>
        ) : !view || !pdf ? <Skeleton className="h-[70vh]" /> : (
          <Body view={view} pdf={pdf} token={token} api={api} onChange={setView} />
        )}
      </main>
    </div>
  );
}

function Notice({ title, children, tone = "neutral" }: { title: string; children?: React.ReactNode; tone?: "neutral" | "success" | "warning" }) {
  const cls = tone === "success" ? "border-success/30 bg-success-soft" : tone === "warning" ? "border-warning/30 bg-warning-soft" : "bg-surface";
  return <div role="status" className={`mb-4 rounded-lg border p-4 ${cls}`}><p className="font-medium">{title}</p>{children && <div className="mt-1 text-sm text-muted-foreground">{children}</div>}</div>;
}

function Body({ view, pdf, token, api, onChange }: { view: View; pdf: Uint8Array; token: string; api: PublicPageProps["api"]; onChange: (v: View) => void }) {
  const [signature, setSignature] = useState<Mark | null>(null);
  const [initials, setInitials] = useState<Mark | null>(null);
  const [adopting, setAdopting] = useState<"signature" | "initials" | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [declining, setDeclining] = useState(false);
  const d = view.document;
  const active = view.yourTurn;

  const todo = view.fields.filter((f) => (f.kind === "signature" && !signature) || (f.kind === "initials" && !initials) || (f.kind === "text" && f.required && !values[f.id]?.trim()));
  const total = view.fields.filter((f) => f.kind === "signature" || f.kind === "initials" || (f.kind === "text" && f.required)).length;

  async function finish() {
    if (todo.length) {
      const f = todo[0]!;
      toast.error(f.kind === "text" ? `Fill in ${f.label || "the empty box"} on page ${f.page}` : `Add your ${f.kind} on page ${f.page}`);
      document.querySelector(`[data-field="${f.id}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    if (!agree) { toast.error("Tick the box to agree to sign electronically"); return; }
    setBusy(true);
    try {
      onChange(await api.post<View>(`/sign/${token}`, { agree: true, signature: signature ?? (initials as Mark), ...(initials ? { initials } : {}), values }));
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  }
  async function download() {
    try { const f = await api.get<{ fileName: string; contentType: string; data: string }>(`/sign/${token}/download`); downloadBase64(f.fileName, f.contentType, f.data); }
    catch (e) { toast.error(errorMessage(e)); }
  }

  const preview = (f: View["fields"][number]) => {
    if (f.kind === "name") return view.signer.name;
    if (f.kind === "date") return new Date().toISOString().slice(0, 10);
    const m = f.kind === "signature" ? signature : f.kind === "initials" ? initials : null;
    if (m?.kind === "drawn") return <img src={m.image} alt="" className="h-full w-full object-contain" />;
    if (m?.kind === "typed") return <span style={SCRIPT} className="text-lg">{m.text}</span>;
    return null;
  };

  return (
    <>
      {d.status === "completed" ? (
        <Notice tone="success" title="Everyone has signed">
          <p>This is the signed copy, with a certificate page at the end.</p>
          <Button className="mt-2" onClick={() => void download()}><Download /> Download signed copy</Button>
        </Notice>
      ) : view.signer.status === "signed" ? (
        <Notice tone="success" title={`You signed on ${fmtDate(view.signer.signedAt)}`}>We'll email you the signed copy once everyone has signed.</Notice>
      ) : view.signer.status === "declined" ? (
        <Notice title="You declined to sign this document">The sender has been told.</Notice>
      ) : d.status === "declined" ? (
        <Notice title="This request was declined">Someone declined to sign, so it can't be signed any more.</Notice>
      ) : d.status === "cancelled" ? (
        <Notice title="This request was cancelled">The sender cancelled it. Contact them if you have questions.</Notice>
      ) : d.status === "expired" ? (
        <Notice tone="warning" title="This signing request has expired">Ask the sender to send it again.</Notice>
      ) : view.waitingFor ? (
        <Notice title={`Waiting for ${view.waitingFor} to sign first`}>We'll email you when it's your turn. You can read the document meanwhile.</Notice>
      ) : (
        <Notice title={`${view.signer.name}, please review and sign`}>
          {d.message && <p className="whitespace-pre-line">{d.message}</p>}
          <p>Click the highlighted boxes to add your signature{view.fields.some((f) => f.kind === "text") ? " and fill in the details" : ""}.{d.expiresOn ? ` Please sign by ${fmtDate(d.expiresOn)}.` : ""}</p>
        </Notice>
      )}

      {view.signers.length > 1 && (
        <ul aria-label="Signers" className="mb-4 flex flex-wrap gap-2 text-sm">
          {view.signers.map((s, i) => (
            <li key={i}><Badge variant={s.status === "signed" ? "success" : s.status === "declined" ? "destructive" : "neutral"}>{s.status === "signed" ? "✓ " : ""}{s.name}{s.me ? " (you)" : ""}</Badge></li>
          ))}
        </ul>
      )}

      <PdfPages data={pdf} label={d.title}
        overlay={active ? (page) => view.fields.filter((f) => f.page === page).map((f) => {
          const style = { left: `${f.x * 100}%`, top: `${f.y * 100}%`, width: `${f.w * 100}%`, height: `${f.h * 100}%` };
          if (f.kind === "text") {
            return (
              <input key={f.id} data-field={f.id} aria-label={f.label || `Text on page ${f.page}`} placeholder={f.label ?? ""} value={values[f.id] ?? ""} maxLength={500}
                onChange={(e) => setValues({ ...values, [f.id]: e.target.value })}
                className="absolute rounded-sm border border-primary bg-primary/10 px-1 text-xs outline-none focus:bg-white" style={style} />
            );
          }
          const clickable = f.kind === "signature" || f.kind === "initials";
          const done = (f.kind === "signature" && signature) || (f.kind === "initials" && initials);
          return (
            <button key={f.id} type="button" data-field={f.id} disabled={!clickable}
              aria-label={clickable ? `${done ? "Change" : "Add"} your ${f.kind} on page ${f.page}` : `${FIELD_LABEL[f.kind]} (filled in automatically)`}
              onClick={() => clickable && setAdopting(f.kind as "signature" | "initials")}
              className={`absolute flex items-center justify-center overflow-hidden rounded-sm border text-xs ${clickable && !done ? "animate-pulse border-primary bg-primary/15 font-medium text-primary" : "border-primary/40 bg-primary/5"}`}
              style={style}>
              {preview(f) ?? <span className="flex items-center gap-1"><PenLine className="size-3" /> {f.kind === "signature" ? "Sign here" : "Initials"}</span>}
            </button>
          );
        }) : undefined} />

      {active && (
        <div className="sticky bottom-0 mt-4 border-t bg-surface/95 p-3 backdrop-blur">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3">
            <label className="flex flex-1 items-start gap-2 text-sm">
              <input type="checkbox" className="mt-0.5" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
              <span>I agree to sign this document electronically, and that my electronic signature is as valid as one on paper.</span>
            </label>
            <span className="text-sm text-muted-foreground">{total - todo.length} of {total} done</span>
            <Button variant="ghost" onClick={() => setDeclining(true)}>Decline</Button>
            <Button loading={busy} onClick={() => void finish()}><CircleCheck /> Finish signing</Button>
          </div>
        </div>
      )}

      {adopting && (
        <AdoptDialog kind={adopting} name={view.signer.name} current={adopting === "signature" ? signature : initials} onClose={() => setAdopting(null)}
          onAdopt={(m) => { if (adopting === "signature") setSignature(m); else setInitials(m); setAdopting(null); }} />
      )}
      {declining && <DeclineDialog token={token} api={api} onClose={() => setDeclining(false)} onDone={(v) => { setDeclining(false); onChange(v); }} />}
    </>
  );
}

function AdoptDialog({ kind, name, current, onClose, onAdopt }: { kind: "signature" | "initials"; name: string; current: Mark | null; onClose: () => void; onAdopt: (m: Mark) => void }) {
  const initialsOf = (n: string) => n.split(/\s+/).filter(Boolean).map((w) => w[0]!.toUpperCase()).join("").slice(0, 4);
  const [mode, setMode] = useState<"typed" | "drawn">(current?.kind ?? "typed");
  const [text, setText] = useState(current?.kind === "typed" ? current.text : kind === "signature" ? name : initialsOf(name));
  const canvas = useRef<HTMLCanvasElement>(null);
  const [drawn, setDrawn] = useState(false);
  const last = useRef<{ x: number; y: number } | null>(null);

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * e.currentTarget.width, y: ((e.clientY - r.top) / r.height) * e.currentTarget.height };
  };
  const clear = () => { const c = canvas.current; c?.getContext("2d")?.clearRect(0, 0, c.width, c.height); setDrawn(false); };
  function adopt() {
    if (mode === "typed") {
      if (!text.trim()) { toast.error(kind === "signature" ? "Type your name" : "Type your initials"); return; }
      onAdopt({ kind: "typed", text: text.trim().slice(0, 100) });
    } else {
      if (!drawn || !canvas.current) { toast.error("Draw your signature in the box"); return; }
      onAdopt({ kind: "drawn", image: canvas.current.toDataURL("image/png") });
    }
  }
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent title={kind === "signature" ? "Your signature" : "Your initials"} description="Used in every box of this kind in the document.">
        <div role="radiogroup" aria-label="How to sign" className="flex gap-2">
          {([["typed", "Type"], ["drawn", "Draw"]] as const).map(([m, label]) => (
            <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => setMode(m)}
              className={`rounded-md border px-3 py-1.5 text-sm font-medium ${mode === m ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent"}`}>{label}</button>
          ))}
        </div>
        {mode === "typed" ? (
          <div className="grid gap-3">
            <Field label={kind === "signature" ? "Your name" : "Your initials"}>{(a) => <Input {...a} value={text} maxLength={100} autoFocus onChange={(e) => setText(e.target.value)} />}</Field>
            <div aria-label="Preview" className="grid h-20 place-items-center rounded-md border bg-white text-3xl text-[#0d1a59]" style={SCRIPT}>{text || " "}</div>
          </div>
        ) : (
          <div className="grid gap-2">
            <canvas ref={canvas} width={600} height={200} aria-label="Draw your signature here"
              className="h-40 w-full touch-none rounded-md border bg-white"
              onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); last.current = pos(e); }}
              onPointerMove={(e) => {
                if (!last.current) return;
                const ctx = e.currentTarget.getContext("2d")!;
                const p = pos(e);
                ctx.strokeStyle = "#0d1a59"; ctx.lineWidth = 3; ctx.lineCap = "round"; ctx.lineJoin = "round";
                ctx.beginPath(); ctx.moveTo(last.current.x, last.current.y); ctx.lineTo(p.x, p.y); ctx.stroke();
                last.current = p; setDrawn(true);
              }}
              onPointerUp={() => { last.current = null; }} onPointerLeave={() => { last.current = null; }} />
            <div><Button type="button" size="sm" variant="ghost" onClick={clear}><Eraser /> Clear</Button></div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={adopt}>Use this {kind}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeclineDialog({ token, api, onClose, onDone }: { token: string; api: PublicPageProps["api"]; onClose: () => void; onDone: (v: View) => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function decline() {
    if (!reason.trim()) { setErr("Tell the sender why"); return; }
    setBusy(true);
    try { onDone(await api.post<View>(`/sign/${token}/decline`, { reason: reason.trim() })); }
    catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  }
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent title="Decline to sign?" description="The sender is told, and nobody else can sign this request.">
        <Field label="Why are you declining?" required error={err}>{(a) => <Textarea {...a} rows={3} maxLength={1000} value={reason} onChange={(e) => { setReason(e.target.value); setErr(null); }} />}</Field>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Go back</Button>
          <Button variant="destructive" loading={busy} onClick={() => void decline()}>Decline</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
