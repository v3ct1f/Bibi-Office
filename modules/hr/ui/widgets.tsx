import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Card, CardContent, CardHeader, CardTitle, Spinner } from "@office/ui";
import type { SlotProps } from "@office/sdk/ui";
import { Avatar, fmtRange, ROOT } from "./common.tsx";
import type { Away, Balance } from "./types.ts";

interface Summary { today: string; offToday: Away[]; holidayToday: { day: string; name: string } | null; approvals: number; balance: Balance | null }

/** dashboard.widget: who's away today, my balance, approvals waiting. */
export function AwayWidget({ api, tenantId, navigate, errorMessage }: SlotProps) {
  const q = useQuery({ queryKey: ["tenant", tenantId, "hr", "summary"], queryFn: () => api.get<Summary>("/summary") });
  return (
    <Card>
      <CardHeader><CardTitle>Who's away</CardTitle></CardHeader>
      <CardContent className="grid gap-3 text-sm">
        {q.isPending ? <Spinner /> : q.isError ? <Alert>{errorMessage(q.error)}</Alert> : (
          <>
            {q.data.holidayToday ? <p className="font-medium">Today is a company holiday: {q.data.holidayToday.name}</p>
              : q.data.offToday.length === 0 ? <p className="text-muted">Everyone's in today.</p> : (
                <ul className="grid gap-1.5" aria-label="Away today">
                  {q.data.offToday.map((a) => (
                    <li key={a.id} className="flex items-center gap-2"><Avatar name={a.employeeName} size="sm" /><span className="truncate">{a.employeeName}</span>
                      <span className="ml-auto shrink-0 text-muted">{a.startDate === a.endDate ? (a.halfDay ? "half day" : "today") : `until ${fmtRange(a.endDate, a.endDate)}`}</span></li>
                  ))}
                </ul>
              )}
            {q.data.balance && <p className="text-muted">You have <span className="font-medium text-fg tabular-nums">{q.data.balance.remaining}</span> days off left in {q.data.balance.year}.</p>}
            {q.data.approvals > 0 && <p className="font-medium">{q.data.approvals} request{q.data.approvals === 1 ? "" : "s"} waiting for your approval</p>}
          </>
        )}
        <Button variant="outline" size="sm" onClick={() => navigate(ROOT)}>Open People</Button>
      </CardContent>
    </Card>
  );
}
