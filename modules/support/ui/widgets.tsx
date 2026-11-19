import { Button, Card, Skeleton } from "@office/ui";
import { useModuleHost } from "@office/ui/module-ui";
import { useLoad } from "./shared.tsx";

interface Summary { mine: number; unassigned: number; open: number; pending: number; overdue: number; failedSends: number; mailError: string | null }

/** Dashboard: open, unassigned and overdue tickets. */
export function SupportWidget() {
  const host = useModuleHost();
  const s = useLoad(() => host.api.get<Summary>("/summary"), [host]);
  const d = s.data;
  const row = (label: string, n: number, danger = false) => (
    <li className="flex justify-between gap-2">
      <span>{label}</span>
      <span className={`tabular-nums ${danger && n ? "font-semibold text-destructive" : "text-muted-foreground"}`}>{n}</span>
    </li>
  );
  return (
    <Card className="p-5" data-testid="support-widget">
      <div className="mb-3 flex items-center justify-between">
        <p className="font-semibold">Support tickets</p>
        <Button variant="link" size="sm" onClick={() => host.navigate("/support")}>Open</Button>
      </div>
      {s.loading && !d ? <Skeleton className="h-12" />
        : s.error || !d ? <p className="text-sm text-muted-foreground">Could not load support tickets.</p>
        : (
          <div className="grid gap-2 text-sm">
            {d.overdue > 0 && <p className="font-medium text-destructive">{d.overdue} overdue ticket{d.overdue === 1 ? "" : "s"}</p>}
            <ul className="grid gap-1">
              {row("Open", d.open)}
              {row("Assigned to me", d.mine)}
              {row("Unassigned", d.unassigned)}
              {row("Overdue", d.overdue, true)}
            </ul>
            {d.failedSends > 0 && <p className="text-destructive">{d.failedSends} repl{d.failedSends === 1 ? "y" : "ies"} not sent</p>}
            {d.mailError && <p className="text-destructive">Mailbox problem: {d.mailError}</p>}
          </div>
        )}
    </Card>
  );
}
