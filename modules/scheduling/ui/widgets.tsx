import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Card, CardContent, CardHeader, CardTitle, Spinner } from "@office/ui";
import type { SlotProps } from "@office/sdk/ui";
import { fmtTime, fmtWhen, P, ROOT, StatusBadge } from "./common.tsx";
import { NewBookingDialog } from "./pages.tsx";
import type { Booking } from "./types.ts";

interface Summary { timezone: string; today: Booking[]; next7Days: number; mine: Booking[] }

/** dashboard.widget: today's appointments. */
export function TodayWidget({ api, tenantId, navigate, errorMessage }: SlotProps) {
  const q = useQuery({ queryKey: ["tenant", tenantId, "scheduling", "summary"], queryFn: () => api.get<Summary>("/summary") });
  return (
    <Card>
      <CardHeader><CardTitle>Today</CardTitle></CardHeader>
      <CardContent className="grid gap-3 text-sm">
        {q.isPending ? <Spinner /> : q.isError ? <Alert>{errorMessage(q.error)}</Alert> : (
          <>
            {q.data.today.length === 0 ? <p className="text-muted">No appointments today.</p> : (
              <ul className="grid gap-1.5">
                {q.data.today.map((b) => (
                  <li key={b.id} className="grid grid-cols-[3.5rem_1fr] gap-2">
                    <span className="tabular-nums font-medium">{fmtTime(b.startsAt, q.data.timezone)}</span>
                    <span className="truncate">{b.customerName} <span className="text-muted">· {b.serviceName} · {b.hostName}</span></span>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-muted">{q.data.next7Days} booking{q.data.next7Days === 1 ? "" : "s"} in the next 7 days</p>
          </>
        )}
        <Button variant="outline" size="sm" onClick={() => navigate(ROOT)}>Open calendar</Button>
      </CardContent>
    </Card>
  );
}

/** entity.tab:contact: this contact's bookings. */
export function BookingsTab(props: SlotProps) {
  const { api, tenantId, entity, can, errorMessage } = props;
  const [creating, setCreating] = useState(false);
  const q = useQuery({
    queryKey: ["tenant", tenantId, "scheduling", "bookings", "contact", entity!.id],
    queryFn: () => api.get<{ data: Booking[] }>(`/bookings?contactId=${entity!.id}&limit=100`),
  });
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return (
    <div className="grid gap-3">
      {can(P.write) && <div><Button size="sm" onClick={() => setCreating(true)}>New booking</Button></div>}
      {q.isPending ? <Spinner /> : q.isError ? <Alert>{errorMessage(q.error)}</Alert> : q.data.data.length === 0 ? <p className="text-sm text-muted">No bookings yet.</p> : (
        <ul className="grid gap-2 text-sm">
          {[...q.data.data].reverse().map((b) => (
            <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2">
              <span><span className="font-medium">{b.serviceName}</span> <span className="text-muted">· {fmtWhen(b.startsAt, tz)} · {b.hostName}</span></span>
              <StatusBadge s={b.status} />
            </li>
          ))}
        </ul>
      )}
      {creating && <NewBookingDialog {...props} contactId={entity!.id} onClose={() => setCreating(false)} />}
    </div>
  );
}
