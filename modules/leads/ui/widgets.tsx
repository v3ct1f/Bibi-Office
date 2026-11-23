import { Button, Card, Skeleton } from "@office/ui";
import { useModuleHost } from "@office/ui/module-ui";
import { useLoad, type Summary } from "./shared.tsx";

/** Dashboard widget: leads waiting for you and follow-ups due. */
export function LeadsWidget() {
  const host = useModuleHost();
  const s = useLoad(() => host.api.get<Summary>("/summary"), [host]);
  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center justify-between">
        <p className="font-semibold">Leads</p>
        <Button variant="link" size="sm" onClick={() => host.navigate("/leads")}>Open leads</Button>
      </div>
      {s.loading && !s.data ? <Skeleton className="h-12" />
        : s.error || !s.data ? <p className="text-sm text-muted-foreground">Could not load leads.</p>
        : !s.data.open && !s.data.addedThisWeek ? <p className="text-sm text-muted-foreground">No leads to work on.</p>
        : (
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div><p className="text-xs text-muted-foreground">New</p><p className="text-lg font-semibold tabular-nums" data-testid="leads-new">{s.data.byStatus.new}</p></div>
              <div><p className="text-xs text-muted-foreground">Added this week</p><p className="text-lg font-semibold tabular-nums">{s.data.addedThisWeek}</p></div>
            </div>
            {s.data.followUpsDue > 0 && (
              <p className="text-sm text-destructive">{s.data.followUpsDue} follow-up{s.data.followUpsDue === 1 ? " is" : "s are"} due</p>
            )}
          </div>
        )}
    </Card>
  );
}
