import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Card, CardContent, CardHeader, CardTitle, Spinner } from "@office/ui";
import type { SlotProps } from "@office/sdk/ui";
import { fmtMoney, fmtQty, ROOT } from "./common.tsx";
import type { Summary } from "./types.ts";

/** dashboard.widget: items at or below their reorder point, and stock value. */
export function LowStockWidget({ api, tenantId, navigate, errorMessage }: SlotProps) {
  const q = useQuery({ queryKey: ["tenant", tenantId, "inventory", "summary"], queryFn: () => api.get<Summary>("/summary") });
  return (
    <Card>
      <CardHeader><CardTitle>Low stock</CardTitle></CardHeader>
      <CardContent className="grid gap-3 text-sm">
        {q.isPending ? <Spinner /> : q.isError ? <Alert>{errorMessage(q.error)}</Alert> : (
          <>
            {q.data.lowCount === 0 ? <p className="text-muted">Nothing needs reordering.</p> : (
              <ul className="grid gap-1.5" aria-label="Low stock items">
                {q.data.low.map((r) => (
                  <li key={r.id} className="flex items-center gap-2"><span className="truncate">{r.name}</span>
                    <span className={`ml-auto shrink-0 tabular-nums ${r.onHand <= 0 ? "text-danger" : "text-muted"}`}>{fmtQty(r.onHand, r.unit)} left</span></li>
                ))}
                {q.data.lowCount > q.data.low.length && <li className="text-muted">and {q.data.lowCount - q.data.low.length} more</li>}
              </ul>
            )}
            <p className="text-muted">Stock value <span className="font-medium text-fg tabular-nums">{fmtMoney(q.data.stockValue, q.data.currency)}</span> across {q.data.items} item{q.data.items === 1 ? "" : "s"}.</p>
          </>
        )}
        <Button variant="outline" size="sm" onClick={() => navigate(ROOT)}>Open Inventory</Button>
      </CardContent>
    </Card>
  );
}
