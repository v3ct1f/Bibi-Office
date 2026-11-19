import { Button, Card, Skeleton } from "@office/ui";
import { useModuleHost } from "@office/ui/module-ui";
import { fmtQty, useLoad } from "./shared.tsx";

interface Summary {
  lowCount: number; notOrdered: number; drafts: number; sent: number;
  low: { id: string; name: string; unit: string; stock: number; minStock: number; onOrder: number }[];
}

/** Dashboard: what's running low and which orders are open. */
export function LowStockWidget() {
  const host = useModuleHost();
  const s = useLoad(() => host.api.get<Summary>("/summary"), [host]);
  const d = s.data;
  return (
    <Card className="p-5" data-testid="low-stock-widget">
      <div className="mb-3 flex items-center justify-between">
        <p className="font-semibold">Low stock</p>
        <Button variant="link" size="sm" onClick={() => host.navigate("/inventory")}>Open</Button>
      </div>
      {s.loading && !d ? <Skeleton className="h-12" />
        : s.error || !d ? <p className="text-sm text-muted-foreground">Could not load inventory.</p>
        : (
          <div className="grid gap-3 text-sm">
            {!d.lowCount ? <p className="text-muted-foreground">Everything is above its minimum.</p> : (
              <>
                <p className="font-medium text-destructive">{d.lowCount} item{d.lowCount === 1 ? "" : "s"} low{d.notOrdered < d.lowCount ? `, ${d.lowCount - d.notOrdered} already on order` : ""}</p>
                <ul className="grid gap-1">
                  {d.low.map((i) => (
                    <li key={i.id} className="flex justify-between gap-2">
                      <button type="button" className="truncate hover:underline" onClick={() => host.navigate(`/inventory/${i.id}`)}>{i.name}</button>
                      <span className="shrink-0 tabular-nums text-muted-foreground">{fmtQty(i.stock)} / {fmtQty(i.minStock)} {i.unit}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {(d.drafts > 0 || d.sent > 0) && (
              <button type="button" className="text-left text-primary hover:underline" onClick={() => host.navigate("/purchase-orders")}>
                {[d.drafts ? `${d.drafts} draft order${d.drafts === 1 ? "" : "s"}` : null, d.sent ? `${d.sent} waiting for delivery` : null].filter(Boolean).join(", ")}
              </button>
            )}
          </div>
        )}
    </Card>
  );
}
