import { useEffect, useState } from "react";
import { LogIn, LogOut } from "lucide-react";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, ErrorState, Field, Input, PageHeader, Skeleton, Table, TBody, TD, TH, THead, TR, toast } from "@office/ui";
import { useModuleHost, type PageProps } from "@office/ui/module-ui";
import { errorMessage, fmtDay, fmtHours, shiftTime, useLoad, type Entry, type Shift } from "./shared.tsx";

interface Status {
  now: string; today: string; timezone: string;
  open: { id: string; since: string } | null;
  todayShifts: Shift[];
  week: { start: string; minutes: number; entries: Entry[] };
}

const elapsed = (since: string, now: number) => {
  const s = Math.max(0, Math.floor((now - Date.parse(since)) / 1000));
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

export function Clock(_: PageProps) {
  const host = useModuleHost();
  const st = useLoad(() => host.api.get<Status>("/clock"), []);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [now, setNow] = useState(Date.now());
  const open = st.data?.open;
  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [open]);

  async function punch(dir: "in" | "out") {
    setBusy(true);
    try {
      await host.api.post(`/clock/${dir}`, note.trim() ? { note: note.trim() } : {});
      setNote("");
      toast.success(dir === "in" ? "Clocked in" : "Clocked out");
      setNow(Date.now());
      await st.reload();
    } catch (e) { toast.error(errorMessage(e)); await st.reload(); } finally { setBusy(false); }
  }

  if (st.error) return <Card><ErrorState error={st.error} onRetry={() => void st.reload()} /></Card>;
  const d = st.data;
  if (!d) return <div className="grid gap-4"><Skeleton className="h-10 w-64" /><Skeleton className="h-48" /></div>;
  const openMinutes = open ? Math.floor((now - Date.parse(open.since)) / 60000) : 0;
  const weekMinutes = d.week.entries.reduce((a, e) => a + (e.open ? openMinutes : e.minutes), 0);

  return (
    <>
      <PageHeader title="Time clock" description={`Clock in when you start and out when you finish. Times in ${d.timezone}.`} />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_1fr]">
        <Card className="grid gap-4 p-5" data-testid="clock-card">
          <div className="grid gap-1 text-center">
            {open ? (
              <>
                <Badge variant="success" className="mx-auto">Clocked in</Badge>
                <p className="text-4xl font-semibold tabular-nums" aria-label="Time worked so far">{elapsed(open.since, now)}</p>
                <p className="text-sm text-muted-foreground">since {new Intl.DateTimeFormat(undefined, { timeStyle: "short", timeZone: d.timezone }).format(new Date(open.since))}</p>
              </>
            ) : (
              <>
                <Badge variant="neutral" className="mx-auto">Not clocked in</Badge>
                <p className="text-4xl font-semibold tabular-nums">{d.now}</p>
                <p className="text-sm text-muted-foreground">{fmtDay(d.today)}</p>
              </>
            )}
          </div>
          <Field label="Note (optional)">{(a) => <Input {...a} value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder={open ? "e.g. Closed the bar" : "e.g. Came in early for a delivery"} />}</Field>
          {open
            ? <Button size="lg" variant="destructive" loading={busy} onClick={() => void punch("out")}><LogOut /> Clock out</Button>
            : <Button size="lg" loading={busy} onClick={() => void punch("in")}><LogIn /> Clock in</Button>}
          <div className="border-t pt-3 text-sm">
            <p className="font-medium">Today's shift</p>
            {d.todayShifts.length
              ? d.todayShifts.map((s) => <p key={s.id} className="text-muted-foreground tabular-nums">{shiftTime(s)}{s.breakMinutes ? `, ${s.breakMinutes} min break` : ""}</p>)
              : <p className="text-muted-foreground">No shift planned today.</p>}
          </div>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>This week</CardTitle>
            <p className="text-sm"><span className="text-muted-foreground">Total </span><span className="font-semibold tabular-nums" data-testid="week-total">{fmtHours(weekMinutes)}</span></p>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {!d.week.entries.length ? <p className="text-sm text-muted-foreground">No time recorded this week yet.</p> : (
              <Table aria-label="This week's time">
                <THead><TR><TH>Day</TH><TH>In</TH><TH>Out</TH><TH className="text-right">Hours</TH><TH>Note</TH></TR></THead>
                <TBody>
                  {d.week.entries.map((e) => (
                    <TR key={e.id}>
                      <TD className="whitespace-nowrap">{fmtDay(e.date)}</TD>
                      <TD className="tabular-nums">{e.in}</TD>
                      <TD className="tabular-nums">{e.open ? <Badge variant="success">Working</Badge> : `${e.out}${e.overnight ? " (+1)" : ""}`}</TD>
                      <TD className="text-right tabular-nums">{fmtHours(e.open ? openMinutes : e.minutes)}</TD>
                      <TD className="max-w-48 truncate text-muted-foreground">{e.note}{e.edited && <span className="ml-1 text-xs">(edited by manager)</span>}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
