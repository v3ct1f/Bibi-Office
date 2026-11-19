import { useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Card, CardContent, CardHeader, CardTitle, Dialog, EmptyState, Field, Input, PageHeader, Spinner, Table, TBody, TD, TH, THead, TR } from "@office/ui";
import { Plus, Search, Trash2 } from "lucide-react";
import { del, errorMessage, get, post } from "../lib/api.ts";
import { useSession } from "../lib/session.tsx";
import type { Company, Contact, Page } from "../lib/types.ts";
import { ConfirmButton, QueryView, fmtDate, fullName } from "../components/common.tsx";
import { EntityTabs } from "../modules/entity-tabs.tsx";

export const addressText = (a: Company["address"]) =>
  a ? ["line1", "line2", "postalCode", "city", "country"].map((k) => a[k]).filter((v) => typeof v === "string" && v).join(", ") : "";

export function CompaniesPage() {
  const s = useSession();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const list = useInfiniteQuery({
    queryKey: ["tenant", s.tenantId, "companies", q],
    initialPageParam: "" as string,
    queryFn: ({ pageParam }) => get<Page<Company>>(`/companies?limit=25${pageParam ? `&cursor=${pageParam}` : ""}${q ? `&q=${encodeURIComponent(q)}` : ""}`),
    getNextPageParam: (p) => p.nextCursor ?? undefined,
  });
  const rows = list.data?.pages.flatMap((p) => p.data) ?? [];
  return (
    <>
      <PageHeader title="Companies" description="Organizations you work with, shared across all modules."
        actions={s.can("core:companies.write") && <Button onClick={() => setOpen(true)}><Plus size={16} />New company</Button>} />
      <div className="relative mb-4 max-w-sm">
        <Search size={16} className="pointer-events-none absolute left-3 top-2.5 text-muted" />
        <Input aria-label="Search companies" placeholder="Search name or domain" className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {list.isPending ? <Spinner /> : list.isError ? <Alert>{errorMessage(list.error)}</Alert> : rows.length === 0 ? (
        <EmptyState title={q ? "No matches" : "No companies yet"}>{!q && "Add the organizations you sell to or buy from."}</EmptyState>
      ) : (
        <Card>
          <Table>
            <THead><TR><TH>Name</TH><TH className="hidden sm:table-cell">Domain</TH><TH className="hidden md:table-cell">Tax ID</TH><TH /></TR></THead>
            <TBody>
              {rows.map((c) => (
                <TR key={c.id}>
                  <TD><Link to="/companies/$id" params={{ id: c.id }} className="font-medium text-primary hover:underline">{c.name}</Link></TD>
                  <TD className="hidden sm:table-cell">{c.domain ?? "—"}</TD>
                  <TD className="hidden md:table-cell">{c.taxId ?? "—"}</TD>
                  <TD className="text-right">
                    {s.can("core:companies.write") && <ConfirmButton label={<Trash2 size={16} aria-label={`Delete ${c.name}`} />} title="Delete company?"
                      body={`${c.name} will be removed.`} onConfirm={async () => { await del(`/companies/${c.id}`); await qc.invalidateQueries({ queryKey: ["tenant", s.tenantId, "companies"] }); }} />}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
          {list.hasNextPage && <div className="border-t p-3 text-center"><Button variant="outline" size="sm" disabled={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>Load more</Button></div>}
        </Card>
      )}
      <NewCompanyDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

function NewCompanyDialog({ open, onOpenChange }: { open: boolean; onOpenChange(o: boolean): void }) {
  const s = useSession();
  const qc = useQueryClient();
  const blank = { name: "", domain: "", taxId: "", line1: "", postalCode: "", city: "", country: "" };
  const [f, setF] = useState(blank);
  const m = useMutation({
    mutationFn: () => {
      const address = Object.fromEntries((["line1", "postalCode", "city", "country"] as const).filter((k) => f[k].trim()).map((k) => [k, f[k].trim()]));
      return post<Company>("/companies", {
        name: f.name, ...(f.domain.trim() ? { domain: f.domain } : {}), ...(f.taxId.trim() ? { taxId: f.taxId } : {}),
        ...(Object.keys(address).length ? { address } : {}),
      });
    },
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ["tenant", s.tenantId, "companies"] }); setF(blank); onOpenChange(false); },
  });
  const field = (k: keyof typeof f, label: string) => (
    <Field label={label}>{(a) => <Input {...a} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />}</Field>
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="New company">
      <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        {m.error && <Alert>{errorMessage(m.error)}</Alert>}
        {field("name", "Name")}
        <div className="grid gap-3 sm:grid-cols-2">{field("domain", "Domain")}{field("taxId", "VAT / tax ID")}</div>
        {field("line1", "Street")}
        <div className="grid gap-3 sm:grid-cols-3">{field("postalCode", "Postal code")}{field("city", "City")}{field("country", "Country")}</div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" disabled={m.isPending || !f.name.trim()}>Create</Button>
        </div>
      </form>
    </Dialog>
  );
}

export function CompanyDetailPage() {
  const { id } = useParams({ strict: false }) as { id: string };
  const s = useSession();
  const q = useQuery({ queryKey: ["tenant", s.tenantId, "companies", "one", id], queryFn: () => get<Company>(`/companies/${id}`) });
  const people = useQuery({
    queryKey: ["tenant", s.tenantId, "contacts", "byCompany", id], enabled: s.can("core:contacts.read"),
    queryFn: () => get<Page<Contact>>("/contacts?limit=100"),
  });
  return (
    <QueryView q={q}>{(c) => (
      <>
        <PageHeader title={c.name} description={<Link to="/companies" className="hover:underline">← Companies</Link>} />
        <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
          <div className="grid content-start gap-4">
            <Card><CardHeader><CardTitle>Details</CardTitle></CardHeader>
              <CardContent>
                <dl className="grid gap-2 text-sm">
                  {([["Domain", c.domain], ["Tax ID", c.taxId], ["Address", addressText(c.address)], ["Created", fmtDate(c.createdAt)]] as const).map(([k, v]) => (
                    <div key={k}><dt className="text-muted">{k}</dt><dd>{v || "—"}</dd></div>
                  ))}
                </dl>
              </CardContent>
            </Card>
            <Card><CardHeader><CardTitle>People</CardTitle></CardHeader>
              <CardContent className="grid gap-1 text-sm">
                {(people.data?.data ?? []).filter((p) => p.companyId === c.id).map((p) => (
                  <Link key={p.id} to="/contacts/$id" params={{ id: p.id }} className="text-primary hover:underline">{fullName(p)}</Link>
                ))}
                {people.data && !people.data.data.some((p) => p.companyId === c.id) && <p className="text-muted">No contacts linked.</p>}
              </CardContent>
            </Card>
          </div>
          <EntityTabs type="company" id={c.id} data={c as never} empty="Modules can add tabs here (for example deals or invoices for this company)." />
        </div>
      </>
    )}</QueryView>
  );
}
