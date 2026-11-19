import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { ArrowLeft, Pencil, Plus, Search, Trash2 } from "lucide-react";
import {
  Button, Card, Checkbox, ConfirmDialog, Dialog, DialogContent, DialogFooter, EmptyState, ErrorState, Input, PageHeader,
  SchemaForm, Skeleton, Table, TBody, TD, TH, THead, TR, Tabs, TabsContent, TabsList, TabsTrigger, schemaDefaults,
} from "@office/ui";
import type { Page, Task } from "../../api/types.ts";
import { useTMutation } from "../../api/hooks.ts";
import { useTenant } from "../../lib/tenant.tsx";
import { SlotComponent, useSlotEntries } from "../../modules/SlotHost.tsx";
import { AuditTable } from "../settings/Audit.tsx";
import type { EntityConfig } from "./entities.tsx";

type AnyRow = { id: string } & Record<string, unknown>;
type Cfg = EntityConfig<AnyRow>;

function useDebounced<T>(v: T, ms = 250) {
  const [d, setD] = useState(v);
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return d;
}

export function EntityFormDialog({ cfg, open, onOpenChange, row, onSaved }: {
  cfg: Cfg; open: boolean; onOpenChange: (o: boolean) => void; row?: AnyRow | undefined; onSaved?: (r: AnyRow) => void;
}) {
  const { api } = useTenant();
  const [values, setValues] = useState<Record<string, unknown>>({});
  useEffect(() => { if (open) setValues(row ? cfg.toForm(row) : schemaDefaults(cfg.schema)); }, [open, row, cfg]);
  const save = useTMutation(
    (v: Record<string, unknown>) => row ? api.patch<AnyRow>(`/${cfg.key}/${row.id}`, cfg.fromForm(v)) : api.post<AnyRow>(`/${cfg.key}`, cfg.fromForm(v)),
    { invalidate: [[cfg.key]], success: row ? "Saved" : `${cfg.singular[0]!.toUpperCase()}${cfg.singular.slice(1)} created`, onSuccess: (r) => { onOpenChange(false); onSaved?.(r); } },
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={row ? `Edit ${cfg.singular}` : `New ${cfg.singular}`}>
        <form className="grid gap-5" onSubmit={(e) => { e.preventDefault(); save.mutate(values); }}>
          <SchemaForm schema={cfg.schema} value={values} onChange={setValues} />
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" loading={save.isPending}>{row ? "Save" : "Create"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function EntityList({ cfg }: { cfg: Cfg }) {
  const { api, tenant, can } = useTenant();
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { new?: boolean };
  const [q, setQ] = useState("");
  const dq = useDebounced(q.trim());
  const [editing, setEditing] = useState<AnyRow | undefined>();
  const [formOpen, setFormOpen] = useState(false);
  const writable = can(`core:${cfg.key}.write`);

  useEffect(() => {
    if (search.new && writable) { setEditing(undefined); setFormOpen(true); void navigate({ to: ".", search: {}, replace: true }); }
  }, [search.new, writable, navigate]);

  const list = useInfiniteQuery({
    queryKey: ["t", tenant.id, cfg.key, "list", dq],
    queryFn: ({ pageParam }) => api.get<Page<AnyRow>>(`/${cfg.key}`, { limit: 50, cursor: pageParam, q: dq || undefined }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (p) => p.nextCursor ?? undefined,
  });
  const rows = list.data?.pages.flatMap((p) => p.data) ?? [];
  const toggleDone = useTMutation((t: Task) => api.patch(`/tasks/${t.id}`, { status: t.status === "done" ? "open" : "done" }), { invalidate: [["tasks"]] });

  const open = (r: AnyRow) => {
    if (cfg.hasDetail) void navigate({ to: `/t/${tenant.slug}/${cfg.key}/${r.id}` });
    else if (writable) { setEditing(r); setFormOpen(true); }
  };

  return (
    <>
      <PageHeader
        title={cfg.plural}
        actions={<>
          {cfg.searchable && (
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
              <Input aria-label={`Search ${cfg.plural.toLowerCase()}`} placeholder="Search…" className="w-56 pl-8" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
          )}
          {writable && <Button onClick={() => { setEditing(undefined); setFormOpen(true); }}><Plus /> New {cfg.singular}</Button>}
        </>}
      />
      <Card>
        {list.isPending ? <div className="grid gap-2 p-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-9" />)}</div>
          : list.isError ? <ErrorState error={list.error} onRetry={() => list.refetch()} />
          : rows.length === 0 ? (
            <EmptyState
              icon={<cfg.icon />} title={dq ? "No matches" : `No ${cfg.plural.toLowerCase()} yet`}
              description={dq ? `Nothing matches “${dq}”.` : writable ? `Create your first ${cfg.singular} to get started.` : undefined}
              action={!dq && writable && <Button variant="outline" onClick={() => setFormOpen(true)}><Plus /> New {cfg.singular}</Button>}
            />
          ) : (
            <Table>
              <THead><TR>{cfg.key === "tasks" && <TH className="w-10"><span className="sr-only">Done</span></TH>}{cfg.columns.map((c) => <TH key={c.header} className={c.className}>{c.header}</TH>)}</TR></THead>
              <TBody>
                {rows.map((r) => (
                  <TR key={r.id} className="cursor-pointer" onClick={() => open(r)}>
                    {cfg.key === "tasks" && (
                      <TD onClick={(e) => e.stopPropagation()}>
                        <Checkbox aria-label="Done" disabled={!writable} checked={(r as unknown as Task).status === "done"} onCheckedChange={() => toggleDone.mutate(r as unknown as Task)} />
                      </TD>
                    )}
                    {cfg.columns.map((c) => <TD key={c.header} className={c.className}>{c.cell(r)}</TD>)}
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        {list.hasNextPage && <div className="border-t p-3 text-center"><Button variant="ghost" size="sm" loading={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>Load more</Button></div>}
      </Card>
      <EntityFormDialog cfg={cfg} open={formOpen} onOpenChange={setFormOpen} row={editing}
        onSaved={(r) => { if (!editing && cfg.hasDetail) open(r); }} />
    </>
  );
}

export function EntityDetail({ cfg }: { cfg: Cfg }) {
  const { id } = useParams({ strict: false }) as { id: string };
  const { api, tenant, can } = useTenant();
  const navigate = useNavigate();
  const [edit, setEdit] = useState(false);
  const [del, setDel] = useState(false);
  const row = useQuery({ queryKey: ["t", tenant.id, cfg.key, "one", id], queryFn: () => api.get<AnyRow>(`/${cfg.key}/${id}`) });
  const remove = useTMutation(() => api.del(`/${cfg.key}/${id}`), {
    invalidate: [[cfg.key]], success: "Deleted", onSuccess: () => navigate({ to: `/t/${tenant.slug}/${cfg.key}` }),
  });
  const tabs = useSlotEntries(`entity.tab:${cfg.type}`);
  const writable = can(`core:${cfg.key}.write`);
  const back = <Link to={`/t/${tenant.slug}/${cfg.key}`} className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> {cfg.plural}</Link>;

  if (row.isPending) return <>{back}<Skeleton className="h-8 w-64" /><Skeleton className="mt-6 h-48" /></>;
  if (row.isError) return <>{back}<Card><ErrorState error={row.error} onRetry={() => row.refetch()} /></Card></>;
  const r = row.data;
  return (
    <>
      {back}
      <PageHeader
        title={cfg.title(r)}
        actions={writable && <>
          <Button variant="outline" onClick={() => setEdit(true)}><Pencil /> Edit</Button>
          <Button variant="outline" className="text-destructive" onClick={() => setDel(true)}><Trash2 /> Delete</Button>
        </>}
      />
      <Tabs defaultValue="details">
        <TabsList>
          <TabsTrigger value="details">Details</TabsTrigger>
          {can("core:audit.read") && <TabsTrigger value="activity">Activity</TabsTrigger>}
          {tabs.map((t) => <TabsTrigger key={`${t.module}:${t.label}`} value={`m:${t.module}:${t.label}`}>{t.label}</TabsTrigger>)}
        </TabsList>
        <TabsContent value="details">
          <Card>
            <dl className="grid gap-x-6 gap-y-4 p-5 sm:grid-cols-2">
              {cfg.fields.map((f) => <div key={f.label} className="grid gap-1"><dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{f.label}</dt><dd className="text-sm">{f.value(r)}</dd></div>)}
            </dl>
          </Card>
        </TabsContent>
        {can("core:audit.read") && <TabsContent value="activity"><Card><AuditTable entityId={id} compact /></Card></TabsContent>}
        {tabs.map((t) => (
          <TabsContent key={`${t.module}:${t.label}`} value={`m:${t.module}:${t.label}`}>
            <SlotComponent entry={t} props={{ entityType: cfg.type, entityId: id, entity: r }} />
          </TabsContent>
        ))}
      </Tabs>
      <EntityFormDialog cfg={cfg} open={edit} onOpenChange={setEdit} row={r} onSaved={() => void row.refetch()} />
      <ConfirmDialog open={del} onOpenChange={setDel} destructive confirmLabel="Delete" title={`Delete this ${cfg.singular}?`}
        description="It will be removed from lists. The audit log keeps a record." onConfirm={() => remove.mutateAsync()} />
    </>
  );
}
