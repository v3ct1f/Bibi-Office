import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Card, CardContent, CardHeader, CardTitle, Spinner } from "@office/ui";
import type { SlotProps } from "@office/sdk/ui";
import { money, ROOT } from "./common.tsx";
import type { Summary } from "./types.ts";

/** dashboard.widget: your open claims; for approvers/finance also the team queue. */
export function ExpensesWidget({ api, tenantId, navigate, errorMessage }: SlotProps) {
  const q = useQuery({ queryKey: ["tenant", tenantId, "expenses", "summary"], queryFn: () => api.get<Summary>("/summary") });
  return (
    <Card>
      <CardHeader><CardTitle>Expenses</CardTitle></CardHeader>
      <CardContent className="grid gap-3 text-sm">
        {q.isPending ? <Spinner /> : q.isError ? <Alert>{errorMessage(q.error)}</Alert> : q.data.data.length === 0 ? <p className="text-muted">No expenses yet.</p> : q.data.data.map((r) => (
          <dl key={r.currency} className="grid grid-cols-2 gap-y-1">
            {r.myDraft > 0 && <><dt className="text-muted">Your drafts to finish</dt><dd className="text-right">{r.myDraft}</dd></>}
            <dt className="text-muted">Awaiting approval</dt><dd className="text-right tabular-nums">{money(r.myPending, r.currency)}</dd>
            <dt className="text-muted">To be paid back to you</dt><dd className="text-right tabular-nums">{money(r.myToBePaid, r.currency)}</dd>
            {r.toApproveCount !== undefined && <><dt className="text-muted">To approve ({r.toApproveCount})</dt><dd className="text-right font-medium tabular-nums">{money(r.toApprove ?? 0, r.currency)}</dd></>}
            {r.toReimburseCount !== undefined && <><dt className="text-muted">To reimburse ({r.toReimburseCount})</dt><dd className="text-right tabular-nums">{money(r.toReimburse ?? 0, r.currency)}</dd></>}
            {r.approvedThisMonth !== undefined && <><dt className="text-muted">Approved this month</dt><dd className="text-right tabular-nums">{money(r.approvedThisMonth, r.currency)}</dd></>}
          </dl>
        ))}
        <Button variant="outline" size="sm" onClick={() => navigate(ROOT)}>Open expenses</Button>
      </CardContent>
    </Card>
  );
}
