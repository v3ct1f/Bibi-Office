import { useState, type FormEvent } from "react";
import { ArrowLeft, Ban, Bell, Download, ExternalLink, Signature, Link2, Pencil, Trash2 } from "lucide-react";
import {
  Badge, Button, Card, ConfirmDialog, CopyField, Dialog, DialogContent, DialogFooter, EmptyState, ErrorState, DatePicker, Field, Input, PageHeader, Select, Skeleton, toast,
} from "@office/ui";
import { useModuleHost, type PageProps } from "@office/ui/module-ui";
import { RequestEditor } from "./Editor.tsx";
import { PdfPages } from "./PdfPages.tsx";
import {
  FIELD_LABEL, SIGNER_COLORS, StatusBadge, b64ToBytes, downloadBase64, errorMessage, fmtDate, fmtDateTime, fmtSize, openBase64, useLoad,
  type Config, type DocDetail, type SignerInfo,
} from "./shared.tsx";

const ACTIVITY: Record<string, string> = {
  created: "Created", sent: "Sent for signature", emailed: "Signing link emailed", reminded: "Reminder emailed", viewed: "Opened",
  signed: "Signed", declined: "Declined", completed: "Signed by everyone", cancelled: "Cancelled", expired: "Expired", link_replaced: "New signing link made",
};

export function DocumentPage({ params }: PageProps) {
  const host = useModuleHost();
  const id = params.id!;
  const cfg = useLoad(() => host.api.get<Config>("/config"), [host]);
  const doc = useLoad(() => host.api.get<DocDetail>(`/documents/${id}`), [host, id]);
  const [sent, setSent] = useState<DocDetail | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState<"delete" | "cancel" | null>(null);
  const [cancelReason, setCancelReason] = useState("");

  if (doc.error) return <Card><ErrorState error={doc.error} onRetry={() => void doc.reload()} /></Card>;
  if (!doc.data || !cfg.data) return <Skeleton className="h-96" />;
  const d = doc.data;

  async function download(version: "original" | "signed", open = false) {
    try {
      const f = await host.api.get<{ fileName: string; contentType: string; data: string }>(`/documents/${id}/file`, { version });
      if (open) openBase64(f.contentType, f.data); else downloadBase64(f.fileName, f.contentType, f.data);
    } catch (e) { toast.error(errorMessage(e)); }
  }
  async function act(fn: () => Promise<DocDetail>, msg: string) {
    try { doc.set(await fn()); toast.success(msg); } catch (e) { toast.error(errorMessage(e)); }
  }

  const back = <Button variant="ghost" size="sm" onClick={() => host.navigate("/docs")}><ArrowLeft /> Docs</Button>;
  return (
    <>
      <div className="mb-2">{back}</div>
      <PageHeader
        title={d.title}
        description={<span className="flex flex-wrap items-center gap-2"><StatusBadge status={d.status} />{d.folder && <span>in {d.folder}</span>}<span>· {d.fileName}</span></span>}
        actions={
          <div className="flex flex-wrap gap-2">
            {d.status === "completed" && <Button onClick={() => void download("signed")}><Download /> Download signed copy</Button>}
            {d.can.toRequest && (
              <Button onClick={() => void act(() => host.api.post<DocDetail>(`/documents/${id}/request`), "Ready to prepare: add signers and boxes")}><Signature /> Send for signature</Button>
            )}
            <Button variant="outline" onClick={() => void download("original")}><Download /> {d.status === "file" ? "Download" : "Original"}</Button>
            {!d.isPdf && <Button variant="outline" onClick={() => void download("original", true)}><ExternalLink /> Open</Button>}
            {d.can.edit && <Button variant="outline" onClick={() => setEditing(true)}><Pencil /> Details</Button>}
            {d.can.cancel && <Button variant="outline" onClick={() => setConfirm("cancel")}><Ban /> Cancel request</Button>}
            {d.can.delete && <Button variant="ghost" aria-label="Delete document" onClick={() => setConfirm("delete")}><Trash2 /></Button>}
          </div>
        }
      />

      {d.can.setup ? (
        <RequestEditor key={d.updatedAt} doc={d} cfg={cfg.data} onChanged={doc.set} onSent={(x) => { doc.set(x); setSent(x); }} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div>
            {d.isPdf ? <Preview doc={d} /> : (
              <Card><EmptyState title={d.fileName} description={`${fmtSize(d.sizeBytes)} · Added ${fmtDate(d.createdAt)}${d.createdByName ? ` by ${d.createdByName}` : ""}`}
                action={<Button onClick={() => void download("original", true)}><ExternalLink /> Open</Button>} /></Card>
            )}
          </div>
          <div className="grid content-start gap-4">
            {d.status !== "file" && <SignersCard doc={d} onChange={doc.set} />}
            <Card className="grid gap-2 p-4 text-sm">
              <h2 className="font-semibold">Details</h2>
              <dl className="grid grid-cols-[8rem_1fr] gap-x-2 gap-y-1">
                <dt className="text-muted-foreground">Added</dt><dd>{fmtDate(d.createdAt)}{d.createdByName ? ` by ${d.createdByName}` : ""}</dd>
                <dt className="text-muted-foreground">Who can see it</dt><dd>{d.visibility === "team" ? "Everyone in the team" : "Only people involved, and managers"}</dd>
                {d.templateName && <><dt className="text-muted-foreground">Template</dt><dd>{d.templateName}</dd></>}
                {d.sentAt && <><dt className="text-muted-foreground">Sent</dt><dd>{fmtDateTime(d.sentAt)}</dd></>}
                {d.status === "sent" && <><dt className="text-muted-foreground">Expires</dt><dd>{d.expiresOn ? fmtDate(d.expiresOn) : "Never"}</dd></>}
                {d.status === "sent" && <><dt className="text-muted-foreground">Reminders</dt><dd>{d.remindEveryDays ? `Every ${d.remindEveryDays} day${d.remindEveryDays === 1 ? "" : "s"}` : "Off"}</dd></>}
                {d.completedAt && <><dt className="text-muted-foreground">Completed</dt><dd>{fmtDateTime(d.completedAt)}</dd></>}
                {d.employeeName && <><dt className="text-muted-foreground">Team member</dt><dd>{d.employeeName}</dd></>}
                {d.ordered && <><dt className="text-muted-foreground">Signing order</dt><dd>One after another</dd></>}
                <dt className="text-muted-foreground">Size</dt><dd>{fmtSize(d.sizeBytes)}{d.pageCount ? ` · ${d.pageCount} page${d.pageCount === 1 ? "" : "s"}` : ""}</dd>
              </dl>
              {d.signedSha256 && <p className="break-all text-xs text-muted-foreground">Fingerprint of the signed copy (SHA-256): {d.signedSha256}</p>}
            </Card>
            {d.activity.length > 0 && (
              <Card className="grid gap-2 p-4 text-sm">
                <h2 className="font-semibold">History</h2>
                <ol aria-label="History" className="grid gap-1.5">
                  {d.activity.map((a) => (
                    <li key={a.id}>
                      <span className="font-medium">{ACTIVITY[a.action] ?? a.action}</span>
                      {a.actorName && <span> · {a.actorName}</span>}
                      {a.action === "declined" && a.detail && <span className="block text-muted-foreground">“{a.detail}”</span>}
                      <span className="block text-xs text-muted-foreground">{fmtDateTime(a.at)}</span>
                    </li>
                  ))}
                </ol>
              </Card>
            )}
          </div>
        </div>
      )}

      {sent && <SentDialog doc={sent} onClose={() => setSent(null)} />}
      {editing && <DetailsDialog doc={d} onClose={() => setEditing(false)} onSaved={(x) => { doc.set(x); setEditing(false); }} />}
      <ConfirmDialog open={confirm === "delete"} onOpenChange={(o) => { if (!o) setConfirm(null); }} destructive confirmLabel="Delete"
        title={`Delete “${d.title}”?`} description={d.status === "sent" ? "The signing links stop working and the document is removed for good." : "The document and its history are removed for good."}
        onConfirm={async () => {
          try { await host.api.del(`/documents/${id}`); toast.success("Document deleted"); host.navigate("/docs"); }
          catch (e) { toast.error(errorMessage(e)); throw e; }
        }} />
      <Dialog open={confirm === "cancel"} onOpenChange={(o) => { if (!o) setConfirm(null); }}>
        <DialogContent title="Cancel this signature request?" description="The signing links stop working. Signatures already given are kept in the history.">
          <Field label="Reason (optional)">{(a) => <Input {...a} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} maxLength={500} />}</Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)}>Keep it</Button>
            <Button variant="destructive" onClick={() => { setConfirm(null); void act(() => host.api.post<DocDetail>(`/documents/${id}/cancel`, { reason: cancelReason.trim() || undefined }), "Request cancelled"); }}>Cancel request</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** The PDF (signed copy once complete) with the boxes shown while it's out for signature. */
function Preview({ doc }: { doc: DocDetail }) {
  const host = useModuleHost();
  const version = doc.status === "completed" ? "signed" : "original";
  const file = useLoad(() => host.api.get<{ data: string }>(`/documents/${doc.id}/file`, { version }).then((f) => b64ToBytes(f.data)), [host, doc.id, version]);
  const idx = new Map(doc.signers.map((s, i) => [s.id, i]));
  if (file.error) return <Card><ErrorState error={file.error} onRetry={() => void file.reload()} /></Card>;
  if (!file.data) return <Skeleton className="aspect-[1/1.414] w-full" />;
  return (
    <PdfPages data={file.data} label={doc.title}
      overlay={version === "signed" ? undefined : (page) => doc.fields.filter((f) => f.page === page).map((f) => {
        const i = idx.get(f.signerId) ?? 0;
        const c = SIGNER_COLORS[i % SIGNER_COLORS.length]!;
        const s = doc.signers[i];
        return (
          <div key={f.id} className="absolute overflow-hidden rounded-sm px-1 text-[10px] leading-tight" title={`${FIELD_LABEL[f.kind]} · ${s?.name ?? ""}`}
            style={{ left: `${f.x * 100}%`, top: `${f.y * 100}%`, width: `${f.w * 100}%`, height: `${f.h * 100}%`, border: `1px dashed ${c}`, background: `${c}14`, color: c }}>
            {s?.status === "signed" ? "✓ " : ""}{f.kind === "text" && f.label ? f.label : FIELD_LABEL[f.kind]}
          </div>
        );
      })} />
  );
}

function signerState(s: SignerInfo, ordered: boolean, docStatus: string) {
  if (s.status === "signed") return <Badge variant="success">Signed {fmtDate(s.signedAt)}</Badge>;
  if (s.status === "declined") return <Badge variant="destructive">Declined</Badge>;
  if (docStatus !== "sent") return <Badge variant="neutral">Didn't sign</Badge>;
  if (!s.canSignNow && ordered) return <Badge variant="neutral">Waiting for their turn</Badge>;
  return s.viewedAt ? <Badge variant="warning">Opened, not signed</Badge> : <Badge variant="warning">Waiting</Badge>;
}

function SignersCard({ doc, onChange }: { doc: DocDetail; onChange: (d: DocDetail) => void }) {
  const host = useModuleHost();
  const [busy, setBusy] = useState<string | null>(null);
  const [replace, setReplace] = useState<SignerInfo | null>(null);
  async function remind(s: SignerInfo) {
    setBusy(s.id);
    try { onChange(await host.api.post<DocDetail>(`/signers/${s.id}/remind`)); toast.success(`Email sent to ${s.email}`); }
    catch (e) { toast.error(errorMessage(e)); } finally { setBusy(null); }
  }
  async function sign() {
    try { const r = await host.api.post<{ path: string }>(`/documents/${doc.id}/my-link`); window.location.assign(r.path); }
    catch (e) { toast.error(errorMessage(e)); }
  }
  const mine = doc.signers.find((s) => s.isMe && s.canSignNow);
  return (
    <Card className="grid gap-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold">Signers</h2>
        <span className="text-sm text-muted-foreground">{doc.signers.filter((s) => s.status === "signed").length} of {doc.signers.length} signed</span>
      </div>
      {mine && doc.status === "sent" && <Button onClick={() => void sign()}><Signature /> Sign now</Button>}
      <ol aria-label="Signers" className="grid gap-3">
        {doc.signers.map((s, i) => (
          <li key={s.id} aria-label={s.name} className="grid gap-1.5 border-l-4 pl-3" style={{ borderColor: SIGNER_COLORS[i % SIGNER_COLORS.length] }}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="min-w-0"><span className="block truncate font-medium">{doc.ordered ? `${i + 1}. ` : ""}{s.name}{s.isMe ? " (you)" : ""}</span>
                <span className="block truncate text-xs text-muted-foreground">{s.email}</span></span>
              {signerState(s, doc.ordered, doc.status)}
            </div>
            {s.declineReason && <p className="text-xs text-muted-foreground">“{s.declineReason}”</p>}
            {s.mailError && s.status === "pending" && <p className="text-xs text-destructive">Email failed: {s.mailError}</p>}
            {s.status === "pending" && doc.status === "sent" && s.notifiedAt && <p className="text-xs text-muted-foreground">Emailed {fmtDateTime(s.lastRemindedAt ?? s.notifiedAt)}{s.remindersSent ? ` · ${s.remindersSent} reminder${s.remindersSent === 1 ? "" : "s"}` : ""}</p>}
            {s.link && (s.canSignNow || !doc.ordered) && (
              <div className="grid gap-1.5">
                <CopyField value={s.link} label={`Copy signing link for ${s.name}`} />
                <div className="flex flex-wrap gap-1">
                  {doc.can.remind && <Button size="sm" variant="outline" loading={busy === s.id} onClick={() => void remind(s)}><Bell /> {s.notifiedAt ? "Send reminder" : "Email link"}</Button>}
                  <Button size="sm" variant="ghost" onClick={() => setReplace(s)}><Link2 /> New link</Button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ol>
      <ConfirmDialog open={!!replace} onOpenChange={(o) => { if (!o) setReplace(null); }} confirmLabel="Make a new link"
        title={`New signing link for ${replace?.name}?`} description="The old link stops working. Use this if the link was sent to the wrong person."
        onConfirm={async () => {
          try { onChange(await host.api.post<DocDetail>(`/signers/${replace!.id}/new-link`)); toast.success("New link ready"); }
          catch (e) { toast.error(errorMessage(e)); throw e; }
        }} />
    </Card>
  );
}

function SentDialog({ doc, onClose }: { doc: DocDetail; onClose: () => void }) {
  const delivery = doc.delivery ?? {};
  const now = doc.signers.filter((s) => s.canSignNow);
  const emailed = now.filter((s) => delivery[s.id]?.emailed);
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent title="Sent for signature" description={emailed.length === now.length && now.length ? "Everyone who can sign now got an email with their private link." : "Send these private links to the signers yourself, e.g. by email or chat."}>
        <ul aria-label="Signing links" className="grid gap-3">
          {now.map((s) => (
            <li key={s.id} className="grid gap-1">
              <span className="text-sm font-medium">{s.name} <span className="font-normal text-muted-foreground">{s.email}</span></span>
              {delivery[s.id]?.emailed ? <span className="text-xs text-success">Email sent</span>
                : delivery[s.id]?.error ? <span className="text-xs text-destructive">Email failed: {delivery[s.id]!.error}</span> : null}
              {s.link && <CopyField value={s.link} label={`Copy signing link for ${s.name}`} />}
            </li>
          ))}
        </ul>
        {doc.ordered && doc.signers.length > now.length && <p className="text-sm text-muted-foreground">The next signers get their email when it's their turn.</p>}
        <DialogFooter><Button onClick={onClose}>Done</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DetailsDialog({ doc, onClose, onSaved }: { doc: DocDetail; onClose: () => void; onSaved: (d: DocDetail) => void }) {
  const host = useModuleHost();
  const [v, setV] = useState({ title: doc.title, folder: doc.folder, visibility: doc.visibility, expiresOn: doc.expiresOn ?? "", remindEveryDays: doc.remindEveryDays });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const open = doc.status === "sent";
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!v.title.trim()) { setErr("Give the document a name"); return; }
    setBusy(true);
    try {
      onSaved(await host.api.patch<DocDetail>(`/documents/${doc.id}`, {
        title: v.title.trim(), folder: v.folder, visibility: v.visibility,
        ...(open ? { expiresOn: v.expiresOn || null, remindEveryDays: Number(v.remindEveryDays) || 0 } : {}),
      }));
      toast.success("Saved");
    } catch (x) { toast.error(errorMessage(x)); } finally { setBusy(false); }
  }
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent title="Document details">
        <form onSubmit={(e) => void submit(e)} className="grid gap-3">
          <Field label="Name" required error={err}>{(a) => <Input {...a} value={v.title} maxLength={200} onChange={(e) => { setV({ ...v, title: e.target.value }); setErr(null); }} />}</Field>
          <Field label="Folder" hint="Use / for sub-folders, e.g. Contracts/2026. Leave empty for the top level.">{(a) => <Input {...a} value={v.folder} maxLength={200} onChange={(e) => setV({ ...v, folder: e.target.value })} />}</Field>
          <Field label="Who can see it">{(a) => (
            <Select {...a} value={v.visibility} onChange={(e) => setV({ ...v, visibility: e.target.value as "team" | "private" })}>
              <option value="team">Everyone in the team</option>
              <option value="private">Only people involved, and managers</option>
            </Select>
          )}</Field>
          {open && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Expires on">{(a) => <DatePicker {...a} value={v.expiresOn} onChange={(iso) => setV({ ...v, expiresOn: iso })} />}</Field>
              <Field label="Remind every (days)">{(a) => <Input {...a} type="number" min={0} max={30} value={v.remindEveryDays} onChange={(e) => setV({ ...v, remindEveryDays: Number(e.target.value) })} />}</Field>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" loading={busy}>Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

