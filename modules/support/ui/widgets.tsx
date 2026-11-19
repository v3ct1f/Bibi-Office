import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Card, CardContent, CardHeader, CardTitle, Spinner } from "@office/ui";
import type { SlotProps } from "@office/sdk/ui";
import { ago, ROOT, StatusBadge, who } from "./common.tsx";
import type { Counts, Page, Ticket } from "./types.ts";

/** dashboard.widget: the support queue at a glance. */
export function QueueWidget({ api, tenantId, navigate, errorMessage }: SlotProps) {
  const q = useQuery({ queryKey: ["tenant", tenantId, "support", "summary"], queryFn: () => api.get<Counts & { oldestUnassigned: Ticket[] }>("/summary") });
  return (
    <Card>
      <CardHeader><CardTitle>Support</CardTitle></CardHeader>
      <CardContent className="grid gap-3 text-sm">
        {q.isPending ? <Spinner /> : q.isError ? <Alert>{errorMessage(q.error)}</Alert> : (
          <>
            <dl className="grid grid-cols-3 gap-2 text-center">
              {([["Open", q.data.open], ["Unassigned", q.data.unassigned], ["Overdue", q.data.breached]] as const).map(([l, n]) => (
                <div key={l} className="rounded-md bg-surface-2 px-2 py-2">
                  <dd className={`text-xl font-semibold tabular-nums ${l === "Overdue" && n ? "text-danger" : ""}`}>{n}</dd>
                  <dt className="text-xs text-muted">{l}</dt>
                </div>
              ))}
            </dl>
            {q.data.oldestUnassigned.length > 0 && (
              <ul className="grid gap-1.5" aria-label="Waiting longest">
                {q.data.oldestUnassigned.slice(0, 3).map((t) => (
                  <li key={t.id} className="truncate">
                    <a className="hover:underline" href={`${ROOT}/${t.id}`} onClick={(e) => { e.preventDefault(); navigate(`${ROOT}/${t.id}`); }}>
                      <span className="text-muted tabular-nums">{t.reference}</span> {t.subject}
                    </a> <span className="text-muted">· {ago(t.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
        <Button variant="outline" size="sm" onClick={() => navigate(ROOT)}>Open inbox</Button>
      </CardContent>
    </Card>
  );
}

/** entity.tab:contact: this contact's tickets. */
export function TicketsTab({ api, tenantId, entity, navigate, errorMessage }: SlotProps) {
  const q = useQuery({
    queryKey: ["tenant", tenantId, "support", "list", "contact", entity!.id],
    queryFn: () => api.get<Page<Ticket>>(`/tickets?contactId=${entity!.id}&limit=100`),
  });
  if (q.isPending) return <Spinner />;
  if (q.isError) return <Alert>{errorMessage(q.error)}</Alert>;
  if (!q.data.data.length) return <p className="text-sm text-muted">No support tickets.</p>;
  return (
    <ul className="grid gap-2 text-sm">
      {q.data.data.map((t) => (
        <li key={t.id}>
          <a href={`${ROOT}/${t.id}`} onClick={(e) => { e.preventDefault(); navigate(`${ROOT}/${t.id}`); }}
            className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 hover:bg-surface-2">
            <span className="min-w-0 truncate"><span className="text-muted tabular-nums">{t.reference}</span> <span className="font-medium">{t.subject}</span> <span className="text-muted">· {who(t)} · {ago(t.lastMessageAt)}</span></span>
            <StatusBadge s={t.status} />
          </a>
        </li>
      ))}
    </ul>
  );
}
