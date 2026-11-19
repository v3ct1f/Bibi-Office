import { useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Card, CardContent, CardHeader, CardTitle, Dialog, EmptyState, Field, Input, PageHeader, Spinner, Table, TBody, TD, TH, THead, TR, cn } from "@office/ui";
import { Plus, Search, Trash2 } from "lucide-react";
import { del, errorMessage, get, post } from "../lib/api.ts";
import { useSession } from "../lib/session.tsx";
import type { Contact, Page } from "../lib/types.ts";
import { ConfirmButton, QueryView, fmtDate, fullName } from "../components/common.tsx";
import { EntityTabs } from "../modules/entity-tabs.tsx";

export function ContactsPage() {
  const s = useSession();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const list = useInfiniteQuery({
    queryKey: ["tenant", s.tenantId, "contacts", q],
    initialPageParam: "" as string,
    queryFn: ({ pageParam }) => get<Page<Contact>>(`/contacts?limit=25${pageParam ? `&cursor=${pageParam}` : ""}${q ? `&q=${encodeURIComponent(q)}` : ""}`),
    getNextPageParam: (p) => p.nextCursor ?? undefined,
  });
  const rows = list.data?.pages.flatMap((p) => p.data) ?? [];
  return (
    <>
      <PageHeader title="Contacts" description="People shared across all modules."
        actions={s.can("core:contacts.write") && <Button onClick={() => setOpen(true)}><Plus size={16} />New contact</Button>} />
      <div className="relative mb-4 max-w-sm">
        <Search size={16} className="pointer-events-none absolute left-3 top-2.5 text-muted" />
        <Input aria-label="Search contacts" placeholder="Search name or email" className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {list.isPending ? <Spinner /> : list.isError ? <Alert>{errorMessage(list.error)}</Alert> : rows.length === 0 ? (
        <EmptyState title={q ? "No matches" : "No contacts yet"}>{!q && "Create your first contact to get started."}</EmptyState>
      ) : (
        <Card>
          <Table>
            <THead><TR><TH>Name</TH><TH>Email</TH><TH className="hidden sm:table-cell">Phone</TH><TH className="hidden md:table-cell">Created</TH><TH /></TR></THead>
            <TBody>
              {rows.map((c) => (
                <TR key={c.id}>
                  <TD><Link to="/contacts/$id" params={{ id: c.id }} className="font-medium text-primary hover:underline">{fullName(c)}</Link></TD>
                  <TD>{c.email ?? "—"}</TD>
                  <TD className="hidden sm:table-cell">{c.phone ?? "—"}</TD>
                  <TD className="hidden md:table-cell text-muted">{fmtDate(c.createdAt)}</TD>
                  <TD className="text-right">
                    {s.can("core:contacts.write") && <ConfirmButton label={<Trash2 size={16} aria-label={`Delete ${fullName(c)}`} />} title="Delete contact?"
                      body={`${fullName(c)} will be removed.`} onConfirm={async () => { await del(`/contacts/${c.id}`); await qc.invalidateQueries({ queryKey: ["tenant", s.tenantId, "contacts"] }); }} />}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
          {list.hasNextPage && <div className="border-t p-3 text-center"><Button variant="outline" size="sm" disabled={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>Load more</Button></div>}
        </Card>
      )}
      <NewContactDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

function NewContactDialog({ open, onOpenChange }: { open: boolean; onOpenChange(o: boolean): void }) {
  const s = useSession();
  const qc = useQueryClient();
  const [f, setF] = useState({ firstName: "", lastName: "", email: "", phone: "" });
  const m = useMutation({
    mutationFn: () => post<Contact>("/contacts", Object.fromEntries(Object.entries(f).filter(([, v]) => v.trim()))),
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ["tenant", s.tenantId, "contacts"] }); setF({ firstName: "", lastName: "", email: "", phone: "" }); onOpenChange(false); },
  });
  const field = (k: keyof typeof f, label: string, type = "text") => (
    <Field label={label}>{(a) => <Input {...a} type={type} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />}</Field>
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="New contact">
      <form id="new-contact" className="grid gap-3" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        {m.error && <Alert>{errorMessage(m.error)}</Alert>}
        <div className="grid gap-3 sm:grid-cols-2">{field("firstName", "First name")}{field("lastName", "Last name")}</div>
        {field("email", "Email", "email")}{field("phone", "Phone", "tel")}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" disabled={m.isPending}>Create</Button>
        </div>
      </form>
    </Dialog>
  );
}

export function ContactDetailPage() {
  const { id } = useParams({ strict: false }) as { id: string };
  const s = useSession();
  const q = useQuery({ queryKey: ["tenant", s.tenantId, "contacts", "one", id], queryFn: () => get<Contact>(`/contacts/${id}`) });
  return (
    <QueryView q={q}>{(c) => (
      <>
        <PageHeader title={fullName(c)} description={<Link to="/contacts" className="hover:underline">← Contacts</Link>} />
        <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
          <Card><CardHeader><CardTitle>Details</CardTitle></CardHeader>
            <CardContent>
              <dl className="grid gap-2 text-sm">
                {([["Email", c.email], ["Phone", c.phone], ["Created", fmtDate(c.createdAt)], ["Updated", fmtDate(c.updatedAt)]] as const).map(([k, v]) => (
                  <div key={k}><dt className="text-muted">{k}</dt><dd>{v || "—"}</dd></div>
                ))}
                {c.companyId && <div><dt className="text-muted">Company</dt><dd><Link to="/companies/$id" params={{ id: c.companyId }} className="text-primary hover:underline">Open company</Link></dd></div>}
              </dl>
            </CardContent>
          </Card>
          <EntityTabs type="contact" id={c.id} data={c as never} empty="Modules can add tabs here (for example invoices or deals for this contact)." />
        </div>
      </>
    )}</QueryView>
  );
}
