import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { FilePlus, FileText, Folder, FolderOpen, Pencil, Plus, Search, Signature, Trash2, Upload } from "lucide-react";
import {
  Badge, Button, Card, ConfirmDialog, Dialog, DialogContent, DialogFooter, EmptyState, ErrorState, Field, Input, PageHeader, Select, Skeleton,
  Table, TBody, TD, TH, THead, TR, Textarea, toast,
} from "@office/ui";
import { useModuleHost, type PageProps } from "@office/ui/module-ui";
import { SignerList, cleanSigners, contactName, signerProblem, type SignerDraft } from "./Editor.tsx";
import {
  KNOWN_FILLINS, ModLink, SectionTabs, StatusBadge, errorMessage, fileTitle, fmtDate, folderLabel, readBase64, today, useDebounced, useLoad,
  type Config, type DocDetail, type DocRow, type TeamPerson, type Template, type Waiting,
} from "./shared.tsx";

const ACCEPT = ".pdf,.jpg,.jpeg,.png,.webp,.docx,.xlsx,.pptx,.txt,.csv";
const MIME_BY_EXT: Record<string, string> = {
  pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", txt: "text/plain", csv: "text/csv",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};
const mimeOf = (f: File) => MIME_BY_EXT[f.name.split(".").pop()?.toLowerCase() ?? ""] ?? f.type;
const MAX = 7 * 1024 * 1024;
const query = () => new URLSearchParams(window.location.search);

function NoEmailNote({ cfg }: { cfg: Config }) {
  if (cfg.emailReady || !cfg.canManage) return null;
  return (
    <p className="mb-4 rounded-md border border-warning/30 bg-warning-soft p-3 text-sm text-warning">
      Signing emails are off: fill in the email settings under <strong>Add features → Docs &amp; e-sign → Settings</strong>. Until then you get a link for each signer to send yourself.
    </p>
  );
}

// ── Library ──────────────────────────────────────────────────────────────────
const KINDS = [
  { v: "all", label: "Everything" }, { v: "files", label: "Files" }, { v: "requests", label: "Signature requests" },
  { v: "out", label: "Out for signature" }, { v: "completed", label: "Signed" },
] as const;

export function Library(_: PageProps) {
  const host = useModuleHost();
  const cfg = useLoad(() => host.api.get<Config>("/config"), [host]);
  const [folder, setFolder] = useState(() => query().get("folder") ?? "");
  const [kind, setKind] = useState<(typeof KINDS)[number]["v"]>("all");
  const [q, setQ] = useState("");
  const dq = useDebounced(q.trim());
  const list = useLoad(() => host.api.get<{ data: DocRow[]; folders: string[] }>("/documents", { folder: dq ? undefined : folder, q: dq || undefined, kind }), [host, folder, kind, dq]);
  const [uploading, setUploading] = useState(false);
  const [extraFolders, setExtraFolders] = useState<string[]>([]);
  const folders = useMemo(() => {
    const all = new Set([...(list.data?.folders ?? []), ...extraFolders]);
    for (const f of [...all]) { const parts = f.split("/"); for (let i = 1; i < parts.length; i++) all.add(parts.slice(0, i).join("/")); }
    return [...all].sort((a, b) => a.localeCompare(b));
  }, [list.data?.folders, extraFolders]);
  const send = cfg.data?.canSend;

  return (
    <>
      <PageHeader title="Docs" description="Your company's documents, and documents sent for signature."
        actions={send && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setUploading(true)}><Upload /> Upload file</Button>
            <Button onClick={() => host.navigate(`/docs/new${folder ? `?folder=${encodeURIComponent(folder)}` : ""}`)}><Signature /> New signature request</Button>
          </div>
        )} />
      <SectionTabs current="/docs" />
      {cfg.data && <NoEmailNote cfg={cfg.data} />}
      <div className="grid gap-4 md:grid-cols-[14rem_minmax(0,1fr)]">
        <Card className="h-fit p-2">
          <nav aria-label="Folders">
            <ul className="grid gap-0.5 text-sm">
              {["", ...folders].map((f) => {
                const depth = f ? f.split("/").length - 1 : 0;
                const current = !dq && f === folder;
                return (
                  <li key={f || "(top)"}>
                    <button type="button" aria-current={current ? "true" : undefined} onClick={() => { setFolder(f); setQ(""); }}
                      className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left ${current ? "bg-accent font-medium" : "hover:bg-accent/60"}`}
                      style={{ paddingLeft: `${0.5 + depth * 0.9}rem` }}>
                      {current ? <FolderOpen className="size-4 shrink-0" /> : <Folder className="size-4 shrink-0" />}
                      <span className="truncate">{f ? f.split("/").at(-1) : "Top level"}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {send && <NewFolder parent={folder} onAdd={(f) => { setExtraFolders((x) => [...x, f]); setFolder(f); }} />}
          </nav>
        </Card>
        <div className="grid content-start gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-56 flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
              <Input aria-label="Search documents" className="pl-8" placeholder="Search all folders…" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <Select aria-label="Show" className="w-48" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
              {KINDS.map((k) => <option key={k.v} value={k.v}>{k.label}</option>)}
            </Select>
          </div>
          <h2 className="text-sm font-medium text-muted-foreground">{dq ? `Results for “${dq}”` : folder ? folder.split("/").join(" / ") : "Top level"}</h2>
          {list.error ? <Card><ErrorState error={list.error} onRetry={() => void list.reload()} /></Card>
            : !list.data ? <Skeleton className="h-48" />
            : !list.data.data.length ? (
              <Card><EmptyState icon={<FileText />} title={dq ? `Nothing matches “${dq}”` : "No documents here yet"}
                description={send && !dq ? "Upload a file, or send a PDF for signature." : undefined}
                action={send && !dq ? <Button variant="outline" onClick={() => setUploading(true)}><Upload /> Upload file</Button> : undefined} /></Card>
            ) : <DocTable rows={list.data.data} showFolder={!!dq} />}
        </div>
      </div>
      {uploading && cfg.data && (
        <UploadDialog folder={folder} folders={folders} onClose={() => setUploading(false)}
          onSaved={(d) => { setUploading(false); toast.success("File uploaded"); host.navigate(`/docs/${d.id}`); }} />
      )}
    </>
  );
}

function NewFolder({ parent, onAdd }: { parent: string; onAdd: (f: string) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  if (!open) return <Button size="sm" variant="ghost" className="mt-1 w-full justify-start" onClick={() => setOpen(true)}><Plus /> New folder</Button>;
  const add = (e: FormEvent) => {
    e.preventDefault();
    const n = name.replace(/\//g, " ").trim();
    if (!n) return;
    onAdd(parent ? `${parent}/${n}` : n); setOpen(false); setName("");
  };
  return (
    <form onSubmit={add} className="mt-1 grid gap-1 p-1">
      <Input aria-label="Folder name" autoFocus placeholder={parent ? `In ${parent}` : "Folder name"} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
      <p className="text-xs text-muted-foreground">The folder is kept once you put a document in it.</p>
      <div className="flex gap-1"><Button size="sm" type="submit">Add</Button><Button size="sm" variant="ghost" type="button" onClick={() => setOpen(false)}>Cancel</Button></div>
    </form>
  );
}

export function DocTable({ rows, showFolder }: { rows: DocRow[]; showFolder?: boolean }) {
  return (
    <Card className="overflow-x-auto">
      <Table aria-label="Documents">
        <THead><TR><TH>Name</TH><TH>Status</TH>{showFolder && <TH>Folder</TH>}<TH>Updated</TH><TH>Added by</TH></TR></THead>
        <TBody>
          {rows.map((d) => (
            <TR key={d.id}>
              <TD>
                <ModLink to={`/docs/${d.id}`} className="font-medium hover:underline">{d.title}</ModLink>
                <span className="block text-xs text-muted-foreground">{d.fileName}</span>
              </TD>
              <TD className="whitespace-nowrap">
                <StatusBadge status={d.status} />
                {d.status !== "file" && d.signers.length > 0 && <span className="ml-2 text-xs text-muted-foreground">{d.signedCount} of {d.signers.length} signed</span>}
              </TD>
              {showFolder && <TD className="text-muted-foreground">{folderLabel(d.folder) === "All documents" ? "Top level" : d.folder}</TD>}
              <TD className="whitespace-nowrap text-muted-foreground">{fmtDate(d.updatedAt)}</TD>
              <TD className="whitespace-nowrap text-muted-foreground">{d.createdByName ?? "—"}{d.visibility === "private" && <Badge variant="outline" className="ml-2">Private</Badge>}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </Card>
  );
}

function FolderInput({ id, value, onChange, folders }: { id: string; value: string; onChange: (v: string) => void; folders: string[] }) {
  return (
    <>
      <Input id={id} list={`${id}-list`} value={value} maxLength={200} placeholder="Top level" onChange={(e) => onChange(e.target.value)} />
      <datalist id={`${id}-list`}>{folders.map((f) => <option key={f} value={f} />)}</datalist>
    </>
  );
}

function UploadDialog({ folder, folders, onClose, onSaved }: { folder: string; folders: string[]; onClose: () => void; onSaved: (d: DocDetail) => void }) {
  const host = useModuleHost();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [v, setV] = useState({ title: "", folder, visibility: "team" as "team" | "private" });
  const [err, setErr] = useState<{ file?: string; title?: string }>({});
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    const errs: typeof err = {};
    if (!file) errs.file = "Pick a file";
    else if (file.size > MAX) errs.file = "Files can be at most 7 MB";
    else if (!MIME_BY_EXT[file.name.split(".").pop()?.toLowerCase() ?? ""]) errs.file = "Upload a PDF, photo, Word, Excel, PowerPoint, text or CSV file";
    if (!v.title.trim()) errs.title = "Give the document a name";
    setErr(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      onSaved(await host.api.post<DocDetail>("/documents", {
        title: v.title.trim(), folder: v.folder, visibility: v.visibility, fileName: file!.name, contentType: mimeOf(file!), data: await readBase64(file!),
      }));
    } catch (x) { toast.error(errorMessage(x)); } finally { setBusy(false); }
  }
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent title="Upload file" description="At most 7 MB. PDFs can be sent for signature later.">
        <form onSubmit={(e) => void submit(e)} className="grid gap-3" noValidate>
          <Field label="File" required error={err.file}>{(a) => (
            <Input {...a} ref={input} type="file" accept={ACCEPT} onChange={(e) => {
              const f = e.target.files?.[0] ?? null; setFile(f); setErr({});
              if (f && !v.title) setV((x) => ({ ...x, title: fileTitle(f.name) }));
            }} />
          )}</Field>
          <Field label="Name" required error={err.title}>{(a) => <Input {...a} value={v.title} maxLength={200} onChange={(e) => setV({ ...v, title: e.target.value })} />}</Field>
          <Field label="Folder" hint="Use / for sub-folders, e.g. Contracts/2026.">{(a) => <FolderInput id={a.id} value={v.folder} onChange={(f) => setV({ ...v, folder: f })} folders={folders} />}</Field>
          <Field label="Who can see it">{(a) => (
            <Select {...a} value={v.visibility} onChange={(e) => setV({ ...v, visibility: e.target.value as "team" | "private" })}>
              <option value="team">Everyone in the team</option>
              <option value="private">Only me and managers</option>
            </Select>
          )}</Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" loading={busy}><Upload /> Upload</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Waiting for my signature ─────────────────────────────────────────────────
export function WaitingPage(_: PageProps) {
  const host = useModuleHost();
  const list = useLoad(() => host.api.get<Waiting[]>("/waiting"), [host]);
  const out = useLoad(() => host.api.get<{ data: DocRow[] }>("/documents", { kind: "out" }), [host]);
  const cfg = useLoad(() => host.api.get<Config>("/config"), [host]);
  async function sign(w: Waiting) {
    try { const r = await host.api.post<{ path: string }>(`/documents/${w.id}/my-link`); window.location.assign(r.path); }
    catch (e) { toast.error(errorMessage(e)); }
  }
  const mineOut = (out.data?.data ?? []).filter((d) => d.createdBy === cfg.data?.me);
  return (
    <>
      <PageHeader title="Docs" description="Documents waiting for you, and documents you sent that aren't signed yet." />
      <SectionTabs current="/docs/waiting" />
      <div className="grid gap-6">
        <section className="grid gap-2">
          <h2 className="font-semibold">Waiting for your signature</h2>
          {list.error ? <Card><ErrorState error={list.error} onRetry={() => void list.reload()} /></Card> : !list.data ? <Skeleton className="h-24" />
            : !list.data.length ? <Card><EmptyState icon={<Signature />} title="Nothing to sign" description="Documents sent to you for signature show up here." /></Card> : (
              <ul aria-label="Waiting for your signature" className="grid gap-2">
                {list.data.map((w) => (
                  <li key={w.id}>
                    <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
                      <span><ModLink to={`/docs/${w.id}`} className="font-medium hover:underline">{w.title}</ModLink>
                        <span className="block text-sm text-muted-foreground">From {w.createdByName ?? "a colleague"} · sent {fmtDate(w.sentAt)}{w.expiresOn ? ` · sign by ${fmtDate(w.expiresOn)}` : ""}</span></span>
                      <Button onClick={() => void sign(w)}><Signature /> Sign now</Button>
                    </Card>
                  </li>
                ))}
              </ul>
            )}
        </section>
        {cfg.data?.canSend && (
          <section className="grid gap-2">
            <h2 className="font-semibold">You sent, not signed yet</h2>
            {!out.data ? <Skeleton className="h-24" /> : !mineOut.length ? <p className="text-sm text-muted-foreground">Nothing out for signature.</p> : <DocTable rows={mineOut} />}
          </section>
        )}
      </div>
    </>
  );
}

// ── Templates ────────────────────────────────────────────────────────────────
const SAMPLE = `# Agreement

This agreement is between {{workspace.name}} and {{contact.name}} ({{contact.email}}).

## What we agreed
- Start date: {{start_date}}
- Price: {{price}}

Signed on {{today}}.`;

export function TemplatesPage(_: PageProps) {
  const host = useModuleHost();
  const cfg = useLoad(() => host.api.get<Config>("/config"), [host]);
  const list = useLoad(() => host.api.get<Template[]>("/templates"), [host]);
  const [editing, setEditing] = useState<Template | "new" | null>(null);
  const [deleting, setDeleting] = useState<Template | null>(null);
  const manage = cfg.data?.canManage;
  return (
    <>
      <PageHeader title="Docs" description="Reusable texts with fill-ins, turned into a PDF for signature."
        actions={manage && <Button onClick={() => setEditing("new")}><Plus /> New template</Button>} />
      <SectionTabs current="/docs/templates" />
      {list.error ? <Card><ErrorState error={list.error} onRetry={() => void list.reload()} /></Card> : !list.data ? <Skeleton className="h-40" />
        : !list.data.length ? <Card><EmptyState icon={<FileText />} title="No templates yet" description={manage ? "Write a contract once and fill in the details each time." : "A documents manager can add templates."}
          action={manage ? <Button onClick={() => setEditing("new")}><Plus /> New template</Button> : undefined} /></Card> : (
          <ul aria-label="Templates" className="grid gap-3 md:grid-cols-2">
            {list.data.map((t) => (
              <li key={t.id}>
                <Card className="grid h-full gap-2 p-4" aria-label={t.name} role="group">
                  <div className="flex items-start justify-between gap-2">
                    <span><span className="block font-medium">{t.name}</span>{t.folder && <span className="text-xs text-muted-foreground">Saved to {t.folder}</span>}</span>
                    {manage && (
                      <span className="flex">
                        <Button size="icon" variant="ghost" aria-label={`Edit ${t.name}`} onClick={() => setEditing(t)}><Pencil /></Button>
                        <Button size="icon" variant="ghost" aria-label={`Delete ${t.name}`} onClick={() => setDeleting(t)}><Trash2 /></Button>
                      </span>
                    )}
                  </div>
                  <p className="line-clamp-3 whitespace-pre-line text-sm text-muted-foreground">{t.body}</p>
                  {t.placeholders.length > 0 && <div className="flex flex-wrap gap-1">{t.placeholders.map((p) => <Badge key={p} variant="outline">{p}</Badge>)}</div>}
                  <div className="mt-auto"><Button size="sm" onClick={() => host.navigate(`/docs/new?template=${t.id}`)}><FilePlus /> Use template</Button></div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      {editing && <TemplateDialog template={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void list.reload(); }} />}
      <ConfirmDialog open={!!deleting} onOpenChange={(o) => { if (!o) setDeleting(null); }} destructive confirmLabel="Delete" title={`Delete “${deleting?.name}”?`}
        description="Documents already made from it are kept."
        onConfirm={async () => { await host.api.del(`/templates/${deleting!.id}`); toast.success("Template deleted"); await list.reload(); }} />
    </>
  );
}

function TemplateDialog({ template, onClose, onSaved }: { template: Template | null; onClose: () => void; onSaved: () => void }) {
  const host = useModuleHost();
  const [v, setV] = useState({ name: template?.name ?? "", folder: template?.folder ?? "", body: template?.body ?? SAMPLE });
  const [err, setErr] = useState<{ name?: string; body?: string }>({});
  const [busy, setBusy] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const insert = (k: string) => {
    const el = area.current;
    const at = el?.selectionStart ?? v.body.length;
    const body = `${v.body.slice(0, at)}{{${k}}}${v.body.slice(el?.selectionEnd ?? at)}`;
    setV({ ...v, body });
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(at + k.length + 4, at + k.length + 4); });
  };
  async function submit(e: FormEvent) {
    e.preventDefault();
    const errs: typeof err = {};
    if (!v.name.trim()) errs.name = "Name the template";
    if (!v.body.trim()) errs.body = "Write the text of the template";
    setErr(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      const body = { name: v.name.trim(), folder: v.folder, body: v.body };
      if (template) await host.api.put(`/templates/${template.id}`, body); else await host.api.post("/templates", body);
      toast.success("Template saved"); onSaved();
    } catch (x) { toast.error(errorMessage(x)); } finally { setBusy(false); }
  }
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent wide title={template ? "Edit template" : "New template"}
        description="Lines starting with # are headings, lines starting with - are bullet points. Fill-ins look like {{price}}; you fill them in each time. Signature boxes are added at the end.">
        <form onSubmit={(e) => void submit(e)} className="grid gap-3" noValidate>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name" required error={err.name}>{(a) => <Input {...a} value={v.name} maxLength={120} onChange={(e) => setV({ ...v, name: e.target.value })} />}</Field>
            <Field label="Save documents to folder">{(a) => <Input {...a} value={v.folder} maxLength={200} placeholder="Top level" onChange={(e) => setV({ ...v, folder: e.target.value })} />}</Field>
          </div>
          <Field label="Text" required error={err.body}>{(a) => (
            <Textarea {...a} ref={area} rows={14} className="font-mono text-sm" value={v.body} maxLength={50000} onChange={(e) => setV({ ...v, body: e.target.value })} />
          )}</Field>
          <div className="flex flex-wrap items-center gap-1">
            <span className="mr-1 text-xs text-muted-foreground">Insert:</span>
            {Object.entries(KNOWN_FILLINS).map(([k, label]) => <Button key={k} type="button" size="sm" variant="outline" className="h-7 text-xs" title={`Inserts {{${k}}}`} onClick={() => insert(k)}>{label}</Button>)}
            <Button type="button" size="sm" variant="outline" className="h-7 text-xs" title="A fill-in you name yourself" onClick={() => insert("your_field")}>Your own…</Button>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" loading={busy}>Save template</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── New signature request ────────────────────────────────────────────────────
interface ContactFull { id: string; firstName: string | null; lastName: string | null; email: string | null; phone: string | null; companyId: string | null }

export function NewRequest(_: PageProps) {
  const host = useModuleHost();
  const qs = useMemo(query, []);
  const [mode, setMode] = useState<"upload" | "template">(qs.get("template") ? "template" : "upload");
  const folder = qs.get("folder") ?? "";
  return (
    <>
      <PageHeader title="New signature request" description="Start from a PDF, or fill in one of your templates. Next you add signers and signature boxes." />
      <div role="radiogroup" aria-label="Start from" className="mb-4 flex gap-2">
        {([["upload", "Upload a PDF"], ["template", "Use a template"]] as const).map(([m, label]) => (
          <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => setMode(m)}
            className={`rounded-md border px-3 py-1.5 text-sm font-medium ${mode === m ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent"}`}>{label}</button>
        ))}
      </div>
      {mode === "upload" ? <FromPdf folder={folder} /> : <FromTemplate folder={folder} templateId={qs.get("template")} contactId={qs.get("contact")} />}
    </>
  );
}

function FromPdf({ folder }: { folder: string }) {
  const host = useModuleHost();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [f, setF] = useState(folder);
  const [err, setErr] = useState<{ file?: string; title?: string }>({});
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    const errs: typeof err = {};
    if (!file) errs.file = "Pick a PDF";
    else if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") errs.file = "Only PDF files can be signed";
    else if (file.size > MAX) errs.file = "Files can be at most 7 MB";
    if (!title.trim()) errs.title = "Give the document a name";
    setErr(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      const d = await host.api.post<DocDetail>("/requests", { title: title.trim(), folder: f, fileName: file!.name, data: await readBase64(file!) });
      host.navigate(`/docs/${d.id}`);
    } catch (x) { toast.error(errorMessage(x)); } finally { setBusy(false); }
  }
  return (
    <Card className="max-w-xl p-5">
      <form onSubmit={(e) => void submit(e)} className="grid gap-3" noValidate>
        <Field label="PDF" required error={err.file}>{(a) => (
          <Input {...a} type="file" accept=".pdf,application/pdf" onChange={(e) => { const x = e.target.files?.[0] ?? null; setFile(x); setErr({}); if (x && !title) setTitle(fileTitle(x.name)); }} />
        )}</Field>
        <Field label="Name" required error={err.title}>{(a) => <Input {...a} value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />}</Field>
        <Field label="Folder" hint="Use / for sub-folders.">{(a) => <Input {...a} value={f} maxLength={200} placeholder="Top level" onChange={(e) => setF(e.target.value)} />}</Field>
        <div><Button type="submit" loading={busy}>Continue</Button></div>
      </form>
    </Card>
  );
}

function FromTemplate({ folder, templateId, contactId }: { folder: string; templateId: string | null; contactId: string | null }) {
  const host = useModuleHost();
  const templates = useLoad(() => host.api.get<Template[]>("/templates"), [host]);
  const team = useLoad(() => host.api.get<TeamPerson[]>("/people"), [host]);
  const canContacts = host.can("core:contacts.read");
  const [tid, setTid] = useState(templateId ?? "");
  const [title, setTitle] = useState("");
  const [f, setF] = useState(folder);
  const [values, setValues] = useState<Record<string, string>>({ today: today(), "workspace.name": host.tenant.name });
  const [contact, setContact] = useState<ContactFull | null>(null);
  const [contactQ, setContactQ] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [signers, setSigners] = useState<SignerDraft[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const t = templates.data?.find((x) => x.id === tid) ?? null;

  useEffect(() => { if (t) { setTitle((x) => x || t.name); setF((x) => x || t.folder); } }, [t]);
  useEffect(() => {
    if (!templates.data || tid || templates.data.length !== 1) return;
    setTid(templates.data[0]!.id);
  }, [templates.data, tid]);

  // Pre-fill from a contact
  const found = useLoad(() => (canContacts && contactQ.trim() ? host.core.get<{ data: ContactFull[] }>("/contacts", { q: contactQ.trim(), limit: 6 }).then((r) => r.data) : Promise.resolve([] as ContactFull[])), [host, contactQ, canContacts]);
  async function pickContact(c: ContactFull) {
    setContact(c); setContactQ("");
    let company = "";
    if (c.companyId) company = await host.core.get<{ name: string }>(`/companies/${c.companyId}`).then((x) => x.name, () => "");
    setValues((v) => ({ ...v, "contact.name": contactName(c), "contact.firstName": c.firstName ?? "", "contact.lastName": c.lastName ?? "", "contact.email": c.email ?? "", "contact.phone": c.phone ?? "", "contact.company": company }));
    if (c.email && !signers.some((s) => s.email === c.email)) setSigners((s) => [...s, { name: contactName(c), email: c.email!, userId: null, contactId: c.id }]);
  }
  useEffect(() => {
    if (!contactId || !canContacts) return;
    void host.core.get<ContactFull>(`/contacts/${contactId}`).then(pickContact, () => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contactId]);
  function pickEmployee(id: string) {
    setEmployeeId(id);
    const p = team.data?.find((x) => x.userId === id);
    if (!p) return;
    setValues((v) => ({ ...v, "employee.name": p.name, "employee.email": p.email }));
    if (!signers.some((s) => s.email === p.email)) setSigners((s) => [...s, { name: p.name, email: p.email, userId: p.userId, contactId: null }]);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!t) { setErr("Pick a template"); return; }
    if (!title.trim()) { setErr("Give the document a name"); return; }
    const problem = signerProblem(signers);
    if (problem) { setErr(problem); return; }
    setErr(null); setBusy(true);
    try {
      const d = await host.api.post<DocDetail>("/requests/from-template", {
        templateId: t.id, title: title.trim(), folder: f, values: Object.fromEntries(t.placeholders.map((k) => [k, values[k] ?? ""])),
        signers: cleanSigners(signers), employeeId: employeeId || null, contactId: contact?.id ?? null,
      });
      host.navigate(`/docs/${d.id}`);
    } catch (x) { toast.error(errorMessage(x)); } finally { setBusy(false); }
  }

  if (templates.error) return <Card><ErrorState error={templates.error} onRetry={() => void templates.reload()} /></Card>;
  if (!templates.data) return <Skeleton className="h-48" />;
  if (!templates.data.length) return <Card><EmptyState icon={<FileText />} title="No templates yet" description="A documents manager can add templates under Docs → Templates." /></Card>;
  return (
    <form onSubmit={(e) => void submit(e)} className="grid max-w-3xl gap-4" noValidate>
      <Card className="grid gap-3 p-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Template" required>{(a) => (
            <Select {...a} value={tid} onChange={(e) => setTid(e.target.value)}>
              <option value="">Pick a template…</option>
              {templates.data!.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </Select>
          )}</Field>
          <Field label="Name" required>{(a) => <Input {...a} value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />}</Field>
          {canContacts && (
            <Field label="Contact" hint="Fills in the contact's details and adds them as a signer.">{(a) => (
              <div className="relative">
                <Input {...a} placeholder={contact ? contactName(contact) : "Search contacts…"} value={contactQ} onChange={(e) => setContactQ(e.target.value)} />
                {!!found.data?.length && (
                  <ul aria-label="Contacts found" className="absolute z-10 mt-1 grid w-full rounded-md border bg-surface p-1 shadow">
                    {found.data.map((c) => <li key={c.id}><button type="button" className="w-full rounded px-2 py-1.5 text-left text-sm hover:bg-accent" onClick={() => void pickContact(c)}>{contactName(c)} <span className="text-muted-foreground">{c.email}</span></button></li>)}
                  </ul>
                )}
              </div>
            )}</Field>
          )}
          <Field label="About a team member" hint="Fills in their details; the signed copy goes to their HR documents.">{(a) => (
            <Select {...a} value={employeeId} onChange={(e) => pickEmployee(e.target.value)}>
              <option value="">Nobody</option>
              {team.data?.map((p) => <option key={p.userId} value={p.userId}>{p.name}</option>)}
            </Select>
          )}</Field>
          <Field label="Folder">{(a) => <Input {...a} value={f} maxLength={200} placeholder="Top level" onChange={(e) => setF(e.target.value)} />}</Field>
        </div>
      </Card>
      {t && t.placeholders.length > 0 && (
        <Card className="grid gap-3 p-5" role="group" aria-label="Fill-ins">
          <h2 className="font-semibold">Fill-ins</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {t.placeholders.map((k) => (
              <Field key={k} label={KNOWN_FILLINS[k] ?? k.replace(/[_.]+/g, " ").replace(/^./, (c) => c.toUpperCase())}>{(a) => (
                <Input {...a} value={values[k] ?? ""} maxLength={2000} onChange={(e) => setValues({ ...values, [k]: e.target.value })} />
              )}</Field>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">Empty fill-ins become a blank line to write on.</p>
        </Card>
      )}
      <Card className="grid gap-3 p-5">
        <h2 className="font-semibold">Signers</h2>
        <p className="text-sm text-muted-foreground">Each signer gets a signature, name and date box at the end. You can move boxes and add more next.</p>
        <SignerList value={signers} onChange={setSigners} />
      </Card>
      {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
      <div><Button type="submit" loading={busy}>Create document</Button></div>
    </form>
  );
}


