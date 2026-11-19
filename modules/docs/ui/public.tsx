import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Card, CardContent, Field, Input, Spinner, Textarea } from "@office/ui";
import type { PublicPageProps } from "@office/sdk/ui";
import { DocBody, fmtWhen, SignerBadge } from "./common.tsx";
import type { PublicDoc } from "./types.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function Frame({ children }: { children: React.ReactNode }) {
  return <main className="min-h-dvh bg-bg"><div className="mx-auto grid max-w-3xl gap-5 px-4 py-8 sm:py-12">{children}</div></main>;
}

/** /p/<tenant>/docs/sign/<signer id>#<token> */
export function SignPage(props: PublicPageProps) {
  const id = props.subPath.split("/").filter(Boolean)[0] ?? "";
  const token = typeof window !== "undefined" ? window.location.hash.slice(1) : "";
  if (!UUID.test(id) || !/^[\w-]{43}$/.test(token)) return <Frame><Alert tone="warning">This signing link is incomplete. Open the full link from your email.</Alert></Frame>;
  return <Signing {...props} id={id} token={token} />;
}

function Signing({ api, tenantSlug, errorMessage, id, token }: PublicPageProps & { id: string; token: string }) {
  const qc = useQueryClient();
  const qk = ["public", tenantSlug, "docs", "sign", id];
  const q = useQuery({ queryKey: qk, queryFn: () => api.post<PublicDoc>(`/sign/${id}/open`, { token }), retry: false, refetchOnWindowFocus: false });
  const [declining, setDeclining] = useState(false);
  if (q.isPending) return <Frame><Spinner /></Frame>;
  if (q.isError) return <Frame><h1 className="text-2xl font-semibold">Signing link</h1><Alert tone="warning">{errorMessage(q.error)}</Alert></Frame>;
  const v = q.data, d = v.document;
  const set = (x: PublicDoc) => qc.setQueryData(qk, x);
  return (
    <Frame>
      <header className="grid gap-1">
        <p className="text-sm text-muted">{d.sender} asks you to sign</p>
        <h1 className="text-2xl font-semibold tracking-tight">{d.title}</h1>
      </header>
      <Status v={v} pdfUrl={api.url(`/sign/${id}/pdf?token=${encodeURIComponent(token)}`)} />
      <Card><CardContent className="pt-5"><DocBody body={d.body} /></CardContent></Card>
      <ul className="flex flex-wrap gap-3 text-sm" aria-label="Signers">
        {v.signers.map((s, i) => <li key={i} className="flex items-center gap-2"><span>{s.name}{s.me ? " (you)" : ""}</span><SignerBadge s={s.status} /></li>)}
      </ul>
      {v.canSign && !declining && <SignForm api={api} id={id} token={token} name={v.signer.name} errorMessage={errorMessage} onDone={set} onDecline={() => setDeclining(true)} />}
      {v.canSign && declining && <DeclineForm api={api} id={id} token={token} errorMessage={errorMessage} onDone={set} onBack={() => setDeclining(false)} />}
      {d.contentHash && <p className="break-all text-xs text-muted">Document fingerprint (SHA-256): {d.contentHash}</p>}
    </Frame>
  );
}

function Status({ v, pdfUrl }: { v: PublicDoc; pdfUrl: string }) {
  const d = v.document;
  const pdf = <a className="font-medium text-primary underline" href={pdfUrl}>Download the {d.status === "completed" ? "signed " : ""}PDF</a>;
  if (d.status === "completed") return <Alert tone="success">Everyone has signed. {pdf}</Alert>;
  if (d.status === "declined") return <Alert tone="warning">This document was declined, so it can't be signed.</Alert>;
  if (d.status === "voided") return <Alert tone="warning">{d.sender} cancelled this document.</Alert>;
  if (d.status === "expired") return <Alert tone="warning">This signing link has expired. Ask {d.sender} for a new one.</Alert>;
  if (v.signer.status === "signed") return <Alert tone="success">You signed this {v.signer.signedAt ? fmtWhen(v.signer.signedAt) : ""}. We'll email you when everyone has signed. {pdf}</Alert>;
  if (v.signer.status === "waiting") return <Alert tone="warning">It isn't your turn to sign yet.</Alert>;
  return d.expiresAt ? <p className="text-sm text-muted">Please read it and sign below by {new Date(d.expiresAt).toLocaleDateString()}.</p> : null;
}

function SignForm({ api, id, token, name, errorMessage, onDone, onDecline }: {
  api: PublicPageProps["api"]; id: string; token: string; name: string; errorMessage(e: unknown): string; onDone(v: PublicDoc): void; onDecline(): void;
}) {
  const [typed, setTyped] = useState(name), [agree, setAgree] = useState(false);
  const pad = useRef<SignaturePadHandle>(null);
  const sign = useMutation({
    mutationFn: () => { const sig = pad.current?.png(); return api.post<PublicDoc>(`/sign/${id}/sign`, { token, name: typed, agree, ...(sig ? { signature: sig } : {}) }); },
    onSuccess: onDone,
  });
  return (
    <Card>
      <CardContent className="grid gap-4 pt-5">
        <h2 className="text-lg font-semibold">Sign</h2>
        {sign.error && <Alert>{errorMessage(sign.error)}</Alert>}
        <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); sign.mutate(); }}>
          <Field label="Your full name">{(a) => <Input {...a} required minLength={2} maxLength={200} autoComplete="name" value={typed} onChange={(e) => setTyped(e.target.value)} />}</Field>
          <SignaturePad ref={pad} />
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
            <span>I have read this document and agree to sign it electronically. My typed name, and my drawing if I made one, count as my signature.</span>
          </label>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={!agree || sign.isPending}>{sign.isPending ? "Signing…" : "Sign document"}</Button>
            <Button type="button" variant="ghost" onClick={onDecline}>Decline to sign</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function DeclineForm({ api, id, token, errorMessage, onDone, onBack }: {
  api: PublicPageProps["api"]; id: string; token: string; errorMessage(e: unknown): string; onDone(v: PublicDoc): void; onBack(): void;
}) {
  const [reason, setReason] = useState("");
  const m = useMutation({ mutationFn: () => api.post<PublicDoc>(`/sign/${id}/decline`, { token, reason }), onSuccess: onDone });
  return (
    <Card>
      <CardContent className="grid gap-3 pt-5">
        <h2 className="text-lg font-semibold">Decline to sign</h2>
        {m.error && <Alert>{errorMessage(m.error)}</Alert>}
        <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
          <Field label="Tell the sender why">{(a) => <Textarea {...a} required rows={3} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
          <div className="flex gap-2"><Button type="submit" variant="danger" disabled={m.isPending}>Decline</Button><Button type="button" variant="ghost" onClick={onBack}>Back</Button></div>
        </form>
      </CardContent>
    </Card>
  );
}

// ───────────────────────── signature pad (optional drawing) ─────────────────────────
interface SignaturePadHandle { png(): string | null }
function SignaturePad({ ref }: { ref: React.Ref<SignaturePadHandle> }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawn = useRef(false), last = useRef<{ x: number; y: number } | null>(null);
  const [empty, setEmpty] = useState(true);
  useEffect(() => {
    const h: SignaturePadHandle = { png: () => (drawn.current && canvas.current ? canvas.current.toDataURL("image/png") : null) };
    if (typeof ref === "function") ref(h); else if (ref) (ref as React.RefObject<SignaturePadHandle | null>).current = h;
  }, [ref]);
  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * e.currentTarget.width, y: ((e.clientY - r.top) / r.height) * e.currentTarget.height };
  };
  const draw = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!last.current) return;
    const c = e.currentTarget.getContext("2d")!, p = pos(e);
    c.lineWidth = 3; c.lineCap = "round"; c.strokeStyle = "#111827";
    c.beginPath(); c.moveTo(last.current.x, last.current.y); c.lineTo(p.x, p.y); c.stroke();
    last.current = p; drawn.current = true; if (empty) setEmpty(false);
  };
  const clear = () => { const c = canvas.current; c?.getContext("2d")?.clearRect(0, 0, c.width, c.height); drawn.current = false; setEmpty(true); };
  return (
    <div className="grid gap-1">
      <span className="text-sm font-medium">Draw your signature (optional)</span>
      <canvas ref={canvas} width={600} height={160} aria-label="Signature drawing area" className="h-32 w-full touch-none rounded-md border bg-white"
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); last.current = pos(e); }} onPointerMove={draw} onPointerUp={() => { last.current = null; }} onPointerLeave={() => { last.current = null; }} />
      {!empty && <Button type="button" variant="ghost" size="sm" className="justify-self-start" onClick={clear}>Clear drawing</Button>}
    </div>
  );
}
