import { Fragment, useState } from "react";
import { useInfiniteQuery, useMutation } from "@tanstack/react-query";
import { ChevronRight, ShieldAlert, ShieldCheck, ScrollText } from "lucide-react";
import { Badge, Button, Card, EmptyState, ErrorState, Input, PageHeader, Skeleton, Table, TBody, TD, TH, THead, TR, cn } from "@office/ui";
import type { AuditEntry } from "../../api/types.ts";
import { useTenant } from "../../lib/tenant.tsx";
import { fmtDateTime, fmtRelative } from "../../lib/format.ts";
import { errorMessage } from "../../api/client.ts";

const ACTOR: Record<string, string> = { user: "User", api_key: "API key", system: "System", module: "Module" };

export function AuditTable({ entityId, entityType, compact }: { entityId?: string; entityType?: string; compact?: boolean }) {
  const { api, tenant } = useTenant();
  const [open, setOpen] = useState<string | null>(null);
  const q = useInfiniteQuery({
    queryKey: ["t", tenant.id, "audit", entityId ?? "", entityType ?? ""],
    queryFn: ({ pageParam }) => api.get<{ data: AuditEntry[]; nextBefore: number | null }>("/audit", { limit: 50, before: pageParam, entityId, entityType: entityType || undefined }),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (p) => p.nextBefore ?? undefined,
  });
  const rows = q.data?.pages.flatMap((p) => p.data) ?? [];
  if (q.isPending) return <div className="grid gap-2 p-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-8" />)}</div>;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!rows.length) return <EmptyState icon={<ScrollText />} title="No activity yet" />;
  return (
    <>
      <Table>
        <THead><TR><TH className="w-8" /><TH>When</TH><TH>Action</TH>{!compact && <TH className="hidden md:table-cell">Entity</TH>}<TH className="hidden sm:table-cell">Actor</TH>{!compact && <TH className="hidden lg:table-cell text-right">#</TH>}</TR></THead>
        <TBody>
          {rows.map((r) => (
            <Fragment key={r.id}>
              <TR className="cursor-pointer" onClick={() => setOpen(open === r.id ? null : r.id)} aria-expanded={open === r.id}>
                <TD><ChevronRight className={cn("size-4 text-muted-foreground transition-transform", open === r.id && "rotate-90")} /></TD>
                <TD className="whitespace-nowrap" title={fmtDateTime(r.at)}>{fmtRelative(r.at)}</TD>
                <TD><code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{r.action}</code></TD>
                {!compact && <TD className="hidden md:table-cell text-muted-foreground">{r.entityType ?? "—"}</TD>}
                <TD className="hidden sm:table-cell"><Badge variant="neutral">{ACTOR[r.actorType] ?? r.actorType}</Badge></TD>
                {!compact && <TD className="hidden lg:table-cell text-right font-mono text-xs text-muted-foreground">{r.seq}</TD>}
              </TR>
              {open === r.id && (
                <TR className="hover:bg-transparent">
                  <TD colSpan={6} className="bg-muted/40">
                    <dl className="grid gap-x-6 gap-y-2 py-1 text-xs sm:grid-cols-[8rem_1fr]">
                      <dt className="text-muted-foreground">Time</dt><dd>{fmtDateTime(r.at)}</dd>
                      <dt className="text-muted-foreground">Actor</dt><dd className="font-mono break-all">{r.actorType}:{r.actorId ?? "—"}</dd>
                      {r.entityId && <><dt className="text-muted-foreground">Entity</dt><dd className="font-mono break-all">{r.entityType}:{r.entityId}</dd></>}
                      {r.ip && <><dt className="text-muted-foreground">IP</dt><dd className="font-mono">{r.ip}</dd></>}
                      {r.requestId && <><dt className="text-muted-foreground">Request</dt><dd className="font-mono break-all">{r.requestId}</dd></>}
                      <dt className="text-muted-foreground">Hash</dt><dd className="font-mono break-all">{r.hash}</dd>
                      {r.diff != null && <><dt className="text-muted-foreground">Changes</dt><dd><pre className="max-h-64 overflow-auto rounded border bg-surface p-2 font-mono">{JSON.stringify(r.diff, null, 2)}</pre></dd></>}
                    </dl>
                  </TD>
                </TR>
              )}
            </Fragment>
          ))}
        </TBody>
      </Table>
      {q.hasNextPage && <div className="border-t p-3 text-center"><Button variant="ghost" size="sm" loading={q.isFetchingNextPage} onClick={() => q.fetchNextPage()}>Load older</Button></div>}
    </>
  );
}

export function AuditPage() {
  const { api } = useTenant();
  const [type, setType] = useState("");
  const verify = useMutation({ mutationFn: () => api.get<{ intact: boolean; firstBrokenSeq: number | null }>("/audit/verify") });
  return (
    <>
      <PageHeader
        title="Audit log"
        description="Append-only, hash-chained record of every change in this workspace."
        actions={<>
          {verify.data && (verify.data.intact
            ? <Badge variant="success"><ShieldCheck className="size-3.5" /> Chain intact</Badge>
            : <Badge variant="destructive"><ShieldAlert className="size-3.5" /> Broken at #{verify.data.firstBrokenSeq}</Badge>)}
          {verify.isError && <Badge variant="destructive">{errorMessage(verify.error)}</Badge>}
          <Button variant="outline" loading={verify.isPending} onClick={() => verify.mutate()}><ShieldCheck /> Verify integrity</Button>
        </>}
      />
      <div className="mb-3 flex items-center gap-2">
        <Input aria-label="Filter by entity type" placeholder="Filter by entity type (e.g. contact, workflow)" className="max-w-xs" value={type} onChange={(e) => setType(e.target.value.trim())} />
      </div>
      <Card><AuditTable entityType={type} /></Card>
    </>
  );
}
