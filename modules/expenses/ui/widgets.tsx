import { Button, Card, Skeleton } from "@office/ui";
import { useModuleHost } from "@office/ui/module-ui";
import { fmtTotals, useLoad, type Totals } from "./shared.tsx";

interface Bucket { count: number; totals: Totals[] }
interface Summary { mine: { draft: Bucket; rejected: Bucket; submitted: Bucket }; toReview?: Bucket; toPay?: Bucket }

/** Dashboard: managers see what waits for approval / payment; everyone sees their own drafts and rejections. */
export function ExpensesWidget() {
  const host = useModuleHost();
  const s = useLoad(() => host.api.get<Summary>("/summary"), [host]);
  const d = s.data;
  return (
    <Card className="p-5" data-testid="expenses-widget">
      <div className="mb-3 flex items-center justify-between">
        <p className="font-semibold">Expenses</p>
        <Button variant="link" size="sm" onClick={() => host.navigate("/expenses")}>Open</Button>
      </div>
      {s.loading && !d ? <Skeleton className="h-12" />
        : s.error || !d ? <p className="text-sm text-muted-foreground">Could not load expenses.</p>
        : (
          <div className="grid gap-3">
            {d.toReview && (
              <div className="grid grid-cols-2 gap-3">
                <div><p className="text-xs text-muted-foreground">Waiting for approval ({d.toReview.count})</p><p className="text-lg font-semibold tabular-nums">{fmtTotals(d.toReview.totals)}</p></div>
                <div><p className="text-xs text-muted-foreground">Approved, not paid ({d.toPay!.count})</p><p className="text-lg font-semibold tabular-nums">{fmtTotals(d.toPay!.totals)}</p></div>
              </div>
            )}
            <ul className="grid gap-1 text-sm">
              {d.mine.rejected.count > 0 && <li className="text-destructive">{d.mine.rejected.count} of yours rejected: fix and resubmit</li>}
              {d.mine.draft.count > 0 && <li>{d.mine.draft.count} draft{d.mine.draft.count === 1 ? "" : "s"} not submitted yet</li>}
              {d.mine.submitted.count > 0 && <li className="text-muted-foreground">{d.mine.submitted.count} of yours waiting for approval</li>}
              {!d.toReview && !d.mine.rejected.count && !d.mine.draft.count && !d.mine.submitted.count && <li className="text-muted-foreground">Nothing to do.</li>}
            </ul>
          </div>
        )}
    </Card>
  );
}
