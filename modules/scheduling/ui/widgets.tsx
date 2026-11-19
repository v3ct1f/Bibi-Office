import { Button, Card, Skeleton } from "@office/ui";
import { useModuleHost } from "@office/ui/module-ui";
import { fmtDay, shiftTime, useLoad, type Shift } from "./shared.tsx";

interface Summary {
  nextShift: Shift | null; clockedInSince: string | null;
  pendingTimeOff?: number; pendingSwaps?: number; clockedInNow?: (string | null)[];
}

/** Dashboard: your next shift and clock status; managers also see requests to approve and who is working. */
export function ScheduleWidget() {
  const host = useModuleHost();
  const s = useLoad(() => host.api.get<Summary>("/summary"), [host]);
  const d = s.data;
  const pending = (d?.pendingTimeOff ?? 0) + (d?.pendingSwaps ?? 0);
  return (
    <Card className="p-5" data-testid="schedule-widget">
      <div className="mb-3 flex items-center justify-between">
        <p className="font-semibold">Schedule</p>
        <Button variant="link" size="sm" onClick={() => host.navigate("/schedule")}>Open</Button>
      </div>
      {s.loading && !d ? <Skeleton className="h-12" />
        : s.error || !d ? <p className="text-sm text-muted-foreground">Could not load the schedule.</p>
        : (
          <ul className="grid gap-1.5 text-sm">
            <li>
              <span className="text-muted-foreground">Your next shift: </span>
              {d.nextShift ? <span className="font-medium">{fmtDay(d.nextShift.day)}, {shiftTime(d.nextShift)}</span> : <span>none planned</span>}
            </li>
            {d.clockedInSince && (
              <li className="text-green-700 dark:text-green-400">
                Clocked in since {new Intl.DateTimeFormat(undefined, { timeStyle: "short" }).format(new Date(d.clockedInSince))}
              </li>
            )}
            {d.pendingTimeOff !== undefined && (
              <>
                <li>
                  {pending > 0
                    ? <button type="button" className="font-medium text-primary hover:underline" onClick={() => host.navigate("/requests")}>{pending} request{pending === 1 ? "" : "s"} to approve</button>
                    : <span className="text-muted-foreground">No requests to approve</span>}
                </li>
                <li className="text-muted-foreground">
                  Working now: {d.clockedInNow?.length ? d.clockedInNow.join(", ") : "nobody"}
                </li>
              </>
            )}
          </ul>
        )}
    </Card>
  );
}
