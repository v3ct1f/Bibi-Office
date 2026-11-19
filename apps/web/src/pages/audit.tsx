import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Alert, Badge, Button, Card, PageHeader, Spinner, Table, TBody, TD, TH, THead, TR } from "@office/ui";
import { ShieldCheck, ShieldAlert } from "lucide-react";
import { errorMessage, get } from "../lib/api.ts";
import { useSession } from "../lib/session.tsx";
import type { AuditEntry } from "../lib/types.ts";
import { fmtDate } from "../components/common.tsx";

export function AuditPage() {
  const s = useSession();
  const verify = useQuery({ queryKey: ["tenant", s.tenantId, "audit-verify"], queryFn: () => get<{ intact: boolean; firstBrokenSeq: number | null }>("/audit/verify") });
  const log = useInfiniteQuery({
    queryKey: ["tenant", s.tenantId, "audit"], initialPageParam: 0,
    queryFn: ({ pageParam }) => get<{ data: AuditEntry[]; nextBefore: number | null }>(`/audit?limit=50${pageParam ? `&before=${pageParam}` : ""}`),
    getNextPageParam: (p) => p.nextBefore ?? undefined,
  });
  const rows = log.data?.pages.flatMap((p) => p.data) ?? [];
  return (
    <>
      <PageHeader title="Audit log" description="Every change, append-only and hash-chained."
        actions={verify.data && (verify.data.intact
          ? <Badge tone="success" className="gap-1 py-1"><ShieldCheck size={14} />Chain intact</Badge>
          : <Badge tone="danger" className="gap-1 py-1"><ShieldAlert size={14} />Tampering at #{verify.data.firstBrokenSeq}</Badge>)} />
      {log.isPending ? <Spinner /> : log.isError ? <Alert>{errorMessage(log.error)}</Alert> : (
        <Card>
          <Table>
            <THead><TR><TH>#</TH><TH>When</TH><TH>Action</TH><TH className="hidden md:table-cell">Actor</TH><TH className="hidden lg:table-cell">Details</TH></TR></THead>
            <TBody>{rows.map((a) => (
              <TR key={a.id}>
                <TD className="text-muted">{a.seq}</TD>
                <TD className="whitespace-nowrap">{fmtDate(a.at)}</TD>
                <TD><code className="text-xs">{a.action}</code></TD>
                <TD className="hidden md:table-cell text-xs">{a.actorType}{a.actorId ? `: ${a.actorId.slice(0, 18)}` : ""}</TD>
                <TD className="hidden max-w-md truncate lg:table-cell text-xs text-muted" title={JSON.stringify(a.diff)}>{a.diff ? JSON.stringify(a.diff) : "—"}</TD>
              </TR>))}
            </TBody>
          </Table>
          {log.hasNextPage && <div className="border-t p-3 text-center"><Button variant="outline" size="sm" onClick={() => log.fetchNextPage()} disabled={log.isFetchingNextPage}>Load more</Button></div>}
        </Card>
      )}
    </>
  );
}
