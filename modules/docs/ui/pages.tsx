import { useEffect, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle, Dialog, EmptyState, Field, Input, PageHeader, Select, Spinner, Switch, Table, TBody, TD, TH, THead, TR, Textarea,
} from "@office/ui";
import type { SlotProps } from "@office/sdk/ui";
import { DocBadge, DocBody, fmtDate, fmtWhen, P, ROOT, SignerBadge, STATUS_OPTIONS } from "./common.tsx";
import type { Doc, DocRow, Template } from "./types.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const key = (tenantId: string, ...rest: unknown[]) => ["tenant", tenantId, "docs", ...rest];
const useInvalidate = (tenantId: string) => { const qc = useQueryClient(); return () => void qc.invalidateQueries({ queryKey: key(tenantId) }); };
const AUTO = new Set(["contact.name", "contact.first_name", "contact.last_name", "contact.email", "company.name", "org.name", "today"]);
interface ContactLite { id: string; firstName: string | null; lastName: string | null; email: string | null }
const contactName = (c: ContactLite) => [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email || "Unnamed";

/** /m/docs/documents[/<document id>] */
export function DocsPage(props: SlotProps) {
  const seg = (props.subPath ?? "").split("/").filter(Boolean);
  if (seg[0] && UUID.test(seg[0])) return <DocPage {...props} id={seg[0]} />;
  if (seg.length) return <EmptyState title="Page not found" />;
  return <Overview {...props} />;
}

function Overview(props: SlotProps) {
  const [tab, setTab] = useState<"documents" | "templates">("documents");
  return (
    <>
      <PageHeader title="E-sign" description="Send documents for signature and keep the signed copies." />
      <div role="tablist" aria-label="E-sign view" className="mb-4 flex gap-1">
        {([["documents", "Documents"], ["templates", "Templates"]] as const).map(([k, l]) => (
          <Button key={k} role="tab" aria-selected={tab === k} size="sm" variant={tab === k ? "secondary" : "ghost"} onClick={() => setTab(k)}>{l}</Button>
        ))}
      </div>
      {tab === "documents" ? <Documents {...props} /> : <Templates {...props} />}
    </>
  );
}

// ───────────────────────── documents list ─────────────────────────
function Documents(props: SlotProps) {
  const { api, tenantId, can, navigate, errorMessage } = props;
  const [search, setSearch] = useState(""), [q, setQ] = useState(""), [status, setStatus] = useState(""), [adding, setAdding] = useState(false);
  useEffect(() => { const t = setTimeout(() => setQ(search.trim()), 250); return () => clearTimeout(t); }, [search]);
  const qs = new URLSearchParams({ ...(q ? { q } : {}), ...(status ? { status } : {}) }).toString();
  const list = useInfiniteQuery({
    queryKey: key(tenantId, "documents", qs), initialPageParam: "",
    queryFn: ({ pageParam }) => api.get<{ data: DocRow[]; nextCursor: string | null }>(`/documents?${qs}${pageParam ? `&cursor=${pageParam}` : ""}`),
    getNextPageParam: (p) => p.nextCursor ?? undefined,
  });
  const rows = list.data?.pages.flatMap((p) => p.data) ?? [];
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input type="search" aria-label="Search documents" placeholder="Search title, signer or number" className="w-full sm:w-72" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select aria-label="Status" className="w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>{STATUS_OPTIONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
        <span className="flex-1" />
        {can(P.send) && <Button onClick={() => setAdding(true)}>New document</Button>}
      </div>
      {list.isPending ? <Spinner /> : list.isError ? <Alert>{errorMessage(list.error)}</Alert> : rows.length === 0 ? (
        <EmptyState title={q || status ? "No documents match" : "No documents yet"}>{!q && !status && can(P.send) ? "Start from a template, fill in the details, and send it. Signers get a link by email." : null}</EmptyState>
      ) : (
        <>
          <Card className="overflow-x-auto"><Table aria-label="Documents">
            <THead><TR><TH>#</TH><TH>Title</TH><TH>Signers</TH><TH>Status</TH><TH>Date</TH></TR></THead>
            <TBody>{rows.map((d) => (
              <TR key={d.id} className="cursor-pointer" onClick={() => navigate(`${ROOT}/${d.id}`)}>
                <TD className="tabular-nums text-muted">{d.number}</TD>
                <TD className="font-medium">{d.title}</TD>
                <TD className="text-muted">{d.signers.map((s) => s.name).join(", ") || "—"} {d.status === "sent" && <span className="tabular-nums">({d.signers.filter((s) => s.status === "signed").length}/{d.signers.length})</span>}</TD>
                <TD><DocBadge s={d.status} /></TD>
                <TD className="whitespace-nowrap text-muted">{fmtDate(d.completedAt ?? d.sentAt ?? d.createdAt)}</TD>
              </TR>
            ))}</TBody>
          </Table></Card>
          {list.hasNextPage && <div className="mt-3 flex justify-center"><Button variant="outline" disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>Load more</Button></div>}
        </>
      )}
      {adding && <NewDocDialog {...props} onClose={() => setAdding(false)} />}
    </>
  );
}

function NewDocDialog(props: SlotProps & { onClose(): void }) {
  const { api, tenantId, navigate, errorMessage, onClose } = props;
  const inval = useInvalidate(tenantId);
  const tpls = useQuery({ queryKey: key(tenantId, "templates"), queryFn: () => api.get<{ data: Template[] }>("/templates") });
  const [templateId, setTemplateId] = useState<string>(""), [contactQ, setContactQ] = useState(""), [contactId, setContactId] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const contacts = useQuery({
    queryKey: ["tenant", tenantId, "contacts", "picker", contactQ],
    queryFn: () => api.core<{ data: ContactLite[] }>(`/contacts?limit=20${contactQ ? `&q=${encodeURIComponent(contactQ)}` : ""}`),
  });
  const tplId = templateId || tpls.data?.data[0]?.id || "";
  const tpl = tpls.data?.data.find((t) => t.id === tplId);
  const extra = tpl?.fields.filter((f) => !AUTO.has(f)) ?? [];
  const save = useMutation({
    mutationFn: () => api.post<Doc>("/documents", tpl
      ? { templateId: tpl.id, ...(contactId ? { contactId } : {}), values: Object.fromEntries(Object.entries(values).filter(([k, v]) => v && extra.includes(k))) }
      : { title: "Untitled document", body: "Write your document here.", ...(contactId ? { contactId } : {}) }),
    onSuccess: (d) => { inval(); onClose(); navigate(`${ROOT}/${d.id}`); },
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="New document" description="You can review and edit it before sending.">
      <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        {save.error && <Alert>{errorMessage(save.error)}</Alert>}
        <Field label="Template">{(a) => (
          <Select {...a} value={tplId || "blank"} onChange={(e) => setTemplateId(e.target.value === "blank" ? "blank" : e.target.value)}>
            {tpls.data?.data.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}<option value="blank">Blank document</option>
          </Select>
        )}</Field>
        <Field label="Find a contact (optional)" hint="Their details fill the template and they become the signer">{(a) => <Input {...a} type="search" value={contactQ} onChange={(e) => setContactQ(e.target.value)} />}</Field>
        <Field label="Contact">{(a) => (
          <Select {...a} value={contactId} onChange={(e) => setContactId(e.target.value)}>
            <option value="">No contact</option>
            {contacts.data?.data.map((c) => <option key={c.id} value={c.id}>{contactName(c)}{c.email ? ` (${c.email})` : ""}</option>)}
          </Select>
        )}</Field>
        {templateId !== "blank" && extra.map((f) => (
          <Field key={f} label={`Field: ${f}`}>{(a) => <Textarea {...a} rows={2} maxLength={2000} value={values[f] ?? ""} onChange={(e) => setValues({ ...values, [f]: e.target.value })} />}</Field>
        ))}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={save.isPending}>{save.isPending ? "Creating…" : "Create draft"}</Button>
        </div>
      </form>
    </Dialog>
  );
}

// ───────────────────────── document page ─────────────────────────
function DocPage(props: SlotProps & { id: string }) {
  const { api, tenantId, can, navigate, errorMessage, id } = props;
  const q = useQuery({ queryKey: key(tenantId, "document", id), queryFn: () => api.get<Doc>(`/documents/${id}`) });
  const inval = useInvalidate(tenantId);
  const [editing, setEditing] = useState(false), [voiding, setVoiding] = useState(false), [pdfErr, setPdfErr] = useState<string>();
  const send = useMutation({ mutationFn: () => api.post(`/documents/${id}/send`, {}), onSuccess: inval });
  const remind = useMutation({ mutationFn: () => api.post(`/documents/${id}/remind`, {}), onSuccess: inval });
  if (q.isPending) return <Spinner />;
  if (q.isError) return <Alert>{errorMessage(q.error)}</Alert>;
  const d = q.data;
  const download = async () => {
    setPdfErr(undefined);
    try {
      const url = URL.createObjectURL(await api.blob(`/documents/${id}/pdf`));
      const a = document.createElement("a"); a.href = url; a.download = `${d.status === "completed" ? "signed-" : ""}${d.number}.pdf`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { setPdfErr(errorMessage(e)); }
  };
  const err = send.error ?? remind.error;
  return (
    <>
      <PageHeader title={d.title} description={<span className="flex flex-wrap items-center gap-2"><span className="tabular-nums">#{d.number}</span><DocBadge s={d.status} />{d.createdByName && <span>by {d.createdByName}</span>}</span>}
        actions={<Button variant="ghost" onClick={() => navigate(ROOT)}>All documents</Button>} />
      {err && <Alert>{errorMessage(err)}</Alert>}
      {pdfErr && <Alert>{pdfErr}</Alert>}
      {d.status === "voided" && <Alert tone="warning">Cancelled: {d.voidReason}</Alert>}
      <div className="mb-4 flex flex-wrap gap-2">
        {d.status === "draft" && can(P.send) && <>
          <Button disabled={send.isPending || d.unresolved.length > 0 || d.signers.length === 0} onClick={() => send.mutate()}>{send.isPending ? "Sending…" : "Send for signature"}</Button>
          <Button variant="outline" onClick={() => setEditing(true)}>Edit</Button>
        </>}
        {d.status === "sent" && can(P.send) && <Button variant="outline" disabled={remind.isPending} onClick={() => remind.mutate()}>Send reminder</Button>}
        <Button variant="outline" onClick={() => void download()}>{d.status === "completed" ? "Download signed PDF" : "Download PDF"}</Button>
        <span className="flex-1" />
        {(d.status === "draft" || d.status === "sent") && can(P.send) && <Button variant="ghost" onClick={() => setVoiding(true)}>Cancel document</Button>}
      </div>
      {d.status === "draft" && d.unresolved.length > 0 && <Alert tone="warning">Fill in these fields before sending: {d.unresolved.join(", ")}. Click Edit to change the text.</Alert>}
      {d.status === "draft" && d.signers.length === 0 && <Alert tone="warning">Add at least one signer before sending.</Alert>}
      <div className="mt-2 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2"><CardContent className="pt-5"><DocBody body={d.body} /></CardContent></Card>
        <div className="grid content-start gap-4">
          <Card>
            <CardHeader><CardTitle>Signers{d.inOrder ? " (in order)" : ""}</CardTitle></CardHeader>
            <CardContent>
              <ol className="grid gap-3 text-sm" aria-label="Signers">
                {d.signers.map((s) => (
                  <li key={s.id} className="grid gap-0.5">
                    <span className="flex items-center gap-2"><span className="font-medium">{s.name}</span><SignerBadge s={s.status} /></span>
                    <span className="text-muted">{s.email}</span>
                    {s.signedAt && <span className="text-muted">Signed as “{s.signedName}” · {fmtWhen(s.signedAt)}</span>}
                    {s.declineReason && <span className="text-danger">Declined: {s.declineReason}</span>}
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
          {d.status !== "draft" && (
            <Card>
              <CardHeader><CardTitle>Evidence trail</CardTitle></CardHeader>
              <CardContent className="grid gap-2 text-sm">
                <ol className="grid gap-1.5" aria-label="Evidence trail">
                  {d.trail.map((e) => <li key={e.id} className="flex flex-wrap gap-x-2"><span className="font-medium capitalize">{e.kind}</span><span className="text-muted">{fmtWhen(e.at)}{e.who ? ` · ${e.who}` : ""}{e.ip ? ` · ${e.ip}` : ""}</span></li>)}
                </ol>
                {d.contentHash && <p className="break-all text-xs text-muted">SHA-256 {d.contentHash}</p>}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
      {editing && <EditDialog {...props} doc={d} onClose={() => setEditing(false)} />}
      {voiding && <VoidDialog {...props} onClose={() => setVoiding(false)} />}
    </>
  );
}

function EditDialog(props: SlotProps & { doc: Doc; onClose(): void }) {
  const { api, tenantId, errorMessage, doc, onClose } = props;
  const inval = useInvalidate(tenantId);
  const [f, setF] = useState({ title: doc.title, body: doc.body, message: doc.message ?? "", inOrder: doc.inOrder });
  const [ss, setSs] = useState(doc.signers.length ? doc.signers.map((s) => ({ name: s.name, email: s.email })) : [{ name: "", email: "" }]);
  const save = useMutation({
    mutationFn: () => api.patch(`/documents/${doc.id}`, { ...f, message: f.message || null, signers: ss.filter((s) => s.name || s.email) }),
    onSuccess: () => { inval(); onClose(); },
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Edit draft">
      <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        {save.error && <Alert>{errorMessage(save.error)}</Alert>}
        <Field label="Title">{(a) => <Input {...a} required maxLength={200} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />}</Field>
        <Field label="Text" hint="# Heading, ## Subheading, - bullet, blank line for a new paragraph">{(a) => <Textarea {...a} required rows={12} maxLength={100000} className="font-mono text-sm" value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />}</Field>
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-medium">Signers</legend>
          {ss.map((s, i) => (
            <div key={i} className="flex flex-wrap gap-2">
              <Input aria-label={`Signer ${i + 1} name`} placeholder="Name" className="min-w-36 flex-1" maxLength={200} value={s.name} onChange={(e) => setSs(ss.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
              <Input aria-label={`Signer ${i + 1} email`} placeholder="Email" type="email" className="min-w-48 flex-1" value={s.email} onChange={(e) => setSs(ss.map((x, j) => (j === i ? { ...x, email: e.target.value } : x)))} />
              {ss.length > 1 && <Button type="button" variant="ghost" size="sm" onClick={() => setSs(ss.filter((_, j) => j !== i))}>Remove</Button>}
            </div>
          ))}
          {ss.length < 10 && <Button type="button" variant="outline" size="sm" className="justify-self-start" onClick={() => setSs([...ss, { name: "", email: "" }])}>Add signer</Button>}
          {ss.length > 1 && <label className="flex items-center gap-2 text-sm"><Switch checked={f.inOrder} onCheckedChange={(v) => setF({ ...f, inOrder: v })} label="Sign in this order" />Sign in this order</label>}
        </fieldset>
        <Field label="Message to signers (optional)">{(a) => <Textarea {...a} rows={2} maxLength={2000} value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} />}</Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={save.isPending}>{save.isPending ? "Saving…" : "Save"}</Button>
        </div>
      </form>
    </Dialog>
  );
}

function VoidDialog({ api, tenantId, errorMessage, id, onClose }: SlotProps & { id: string; onClose(): void }) {
  const inval = useInvalidate(tenantId);
  const [reason, setReason] = useState("");
  const save = useMutation({ mutationFn: () => api.post(`/documents/${id}/void`, { reason }), onSuccess: () => { inval(); onClose(); } });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Cancel document" description="Signing links stop working. Signers who got a link are told by email.">
      <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        {save.error && <Alert>{errorMessage(save.error)}</Alert>}
        <Field label="Reason">{(a) => <Textarea {...a} required rows={2} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>Keep it</Button>
          <Button type="submit" variant="danger" disabled={save.isPending}>Cancel document</Button>
        </div>
      </form>
    </Dialog>
  );
}

// ───────────────────────── templates ─────────────────────────
function Templates(props: SlotProps) {
  const { api, tenantId, can, errorMessage } = props;
  const list = useQuery({ queryKey: key(tenantId, "templates"), queryFn: () => api.get<{ data: Template[] }>("/templates") });
  const [editing, setEditing] = useState<Template | "new" | null>(null);
  if (list.isPending) return <Spinner />;
  if (list.isError) return <Alert>{errorMessage(list.error)}</Alert>;
  return (
    <>
      <div className="mb-3 flex items-center gap-2">
        <p className="text-sm text-muted">Use {"{{contact.name}}"}, {"{{company.name}}"}, {"{{org.name}}"}, {"{{today}}"} or your own {"{{fields}}"}.</p>
        <span className="flex-1" />
        {can(P.manage) && <Button onClick={() => setEditing("new")}>New template</Button>}
      </div>
      {list.data.data.length === 0 ? <EmptyState title="No templates yet" /> : (
        <ul className="grid gap-3 sm:grid-cols-2" aria-label="Templates">
          {list.data.data.map((t) => (
            <li key={t.id} className="grid gap-2 rounded-md border bg-surface p-4">
              <span className="flex items-center gap-2"><span className="font-medium">{t.name}</span><span className="flex-1" />
                {can(P.manage) && <Button size="sm" variant="ghost" onClick={() => setEditing(t)}>Edit</Button>}</span>
              <span className="text-sm text-muted">{t.title}</span>
              {t.fields.length > 0 && <span className="flex flex-wrap gap-1">{t.fields.map((f) => <Badge key={f}>{f}</Badge>)}</span>}
            </li>
          ))}
        </ul>
      )}
      {editing && <TemplateDialog {...props} template={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function TemplateDialog({ api, tenantId, errorMessage, template, onClose }: SlotProps & { template?: Template; onClose(): void }) {
  const inval = useInvalidate(tenantId);
  const [f, setF] = useState({ name: template?.name ?? "", title: template?.title ?? "", body: template?.body ?? "" });
  const save = useMutation({
    mutationFn: () => (template ? api.patch(`/templates/${template.id}`, f) : api.post("/templates", f)),
    onSuccess: () => { inval(); onClose(); },
  });
  const archive = useMutation({ mutationFn: () => api.patch(`/templates/${template!.id}`, { archived: true }), onSuccess: () => { inval(); onClose(); } });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={template ? `Edit ${template.name}` : "New template"}>
      <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        {(save.error || archive.error) && <Alert>{errorMessage(save.error ?? archive.error)}</Alert>}
        <Field label="Template name">{(a) => <Input {...a} required maxLength={120} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
        <Field label="Document title">{(a) => <Input {...a} required maxLength={200} placeholder="e.g. Agreement with {{contact.name}}" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />}</Field>
        <Field label="Text" hint="# Heading, ## Subheading, - bullet, blank line for a new paragraph">{(a) => <Textarea {...a} required rows={12} maxLength={100000} className="font-mono text-sm" value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />}</Field>
        <div className="flex flex-wrap justify-end gap-2">
          {template && <Button type="button" variant="ghost" className="mr-auto" onClick={() => archive.mutate()}>Archive</Button>}
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={save.isPending}>{save.isPending ? "Saving…" : "Save template"}</Button>
        </div>
      </form>
    </Dialog>
  );
}
