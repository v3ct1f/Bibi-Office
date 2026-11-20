import { Button, Card, Skeleton } from "@office/ui";
import { useModuleHost } from "@office/ui/module-ui";
import { LEAVE, ModLink, fmtDate, useLoad, type LeaveKind } from "./shared.tsx";

interface Summary {
  celebrations: { userId: string; name: string; kind: "birthday" | "anniversary"; date: string; years?: number }[];
  awayToday: { userId: string; name: string; kind: LeaveKind; until: string | null }[];
  myOpenTasks: number; expiringDocuments: number | null; activeChecklists: number | null;
}

/** Dashboard: birthdays, work anniversaries, who's away, open onboarding tasks and expiring documents. */
export function PeopleWidget() {
  const host = useModuleHost();
  const s = useLoad(() => host.api.get<Summary>("/summary"), [host]);
  const d = s.data;
  return (
    <Card className="p-5" data-testid="people-widget">
      <div className="mb-3 flex items-center justify-between">
        <p className="font-semibold">People</p>
        <Button variant="link" size="sm" onClick={() => host.navigate("/people")}>Open</Button>
      </div>
      {s.loading && !d ? <Skeleton className="h-12" />
        : s.error || !d ? <p className="text-sm text-muted-foreground">Could not load people.</p>
        : (
          <div className="grid gap-3 text-sm">
            {d.awayToday.length > 0 && (
              <p><span className="font-medium">Away today:</span> {d.awayToday.map((a) => `${a.name} (${LEAVE[a.kind].toLowerCase()})`).join(", ")}</p>
            )}
            {d.celebrations.length ? (
              <ul className="grid gap-1" aria-label="Coming up">
                {d.celebrations.slice(0, 5).map((c) => (
                  <li key={`${c.userId}-${c.kind}`} className="flex justify-between gap-2">
                    <ModLink to={`/people/${c.userId}`} className="truncate hover:underline">
                      {c.kind === "birthday" ? `🎂 ${c.name}'s birthday` : `🎉 ${c.name}: ${c.years} year${c.years === 1 ? "" : "s"}`}
                    </ModLink>
                    <span className="shrink-0 text-muted-foreground">{fmtDate(c.date)}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="text-muted-foreground">No birthdays or anniversaries in the next two weeks.</p>}
            {d.myOpenTasks > 0 && <ModLink to="/people/checklists" className="text-primary hover:underline">{d.myOpenTasks} onboarding task{d.myOpenTasks === 1 ? "" : "s"} for you</ModLink>}
            {!!d.expiringDocuments && <p className="text-destructive">{d.expiringDocuments} document{d.expiringDocuments === 1 ? "" : "s"} expiring soon</p>}
          </div>
        )}
    </Card>
  );
}
