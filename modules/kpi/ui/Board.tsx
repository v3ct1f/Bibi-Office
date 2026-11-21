import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChartBar, ChevronLeft, ChevronRight, ExternalLink, Mail, Pencil, Plus, Trash2 } from "lucide-react";
import {
  Button, Card, Checkbox, ConfirmDialog, Dialog, DialogContent, DialogFooter, EmptyState, ErrorState, Field, Input, PageHeader, Select, Skeleton,
  Table, TBody, TD, TH, THead, TR, Textarea, toast,
} from "@office/ui";
import { useModuleHost } from "@office/ui/module-ui";
import { TrendChart } from "./Chart.tsx";
import {
  COMPARE_LABEL, EACH_PERIOD, errorMessage, fmtDateTime, fmtValue, GROUP_LABEL, PERIOD_LABEL, SectionTabs, STATUS_LABEL, useLoad, WEEKDAYS,
  type Board, type BoardRow, type Chart, type Compare, type Config, type Metric, type PeriodKind, type Target, type TileValue, type Values,
} from "./shared.tsx";

const PERIODS: PeriodKind[] = ["week", "month", "quarter", "year"];
const boardFromUrl = () => { try { return new URLSearchParams(window.location.search).get("board"); } catch { return null; } };

export function BoardPage() {
  const host = useModuleHost();
  const cfg = useLoad(() => host.api.get<Config>("/config"), [host]);
  const list = useLoad(() => host.api.get<BoardRow[]>("/boards"), [host]);
  const [picked, setPicked] = useState<string | null>(boardFromUrl);
  const [creating, setCreating] = useState(false);
  const boards = list.data ?? [];
  const current = boards.find((b) => b.id === picked) ?? boards[0] ?? null;
  const manage = !!cfg.data?.canManage;

  return (
    <>
      <PageHeader title="KPIs" description="Your key numbers, worked out live from your other features."
        actions={manage ? <Button onClick={() => setCreating(true)}><Plus className="size-4" />New board</Button> : undefined} />
      <SectionTabs current="/kpi" />
      {list.error || cfg.error ? <ErrorState title="Couldn't load the boards" error={list.error ?? cfg.error} onRetry={() => { void list.reload(); void cfg.reload(); }} />
        : !list.data || !cfg.data ? <Skeleton className="h-64" />
        : !current ? (
          <EmptyState icon={<ChartBar className="size-6" />} title="No boards yet"
            description={manage ? "A board is a set of numbers you want to watch together, like a monthly review." : "Ask a manager to make the first board."}
            action={manage ? <Button onClick={() => setCreating(true)}><Plus className="size-4" />Create a board</Button> : undefined} />
        ) : <BoardView key={current.id} boardId={current.id} boards={boards} cfg={cfg.data} onPick={setPicked} onChanged={() => void list.reload()} />}
      {creating && cfg.data && (
        <NewBoardDialog onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); setPicked(id); void list.reload(); }} />
      )}
    </>
  );
}

function NewBoardDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const host = useModuleHost();
  const [name, setName] = useState(""), [description, setDescription] = useState(""), [suggested, setSuggested] = useState(true), [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try { const b = await host.api.post<Board>("/boards", { name, description, suggested }); toast.success("Board created"); onCreated(b.id); }
    catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="New board">
        <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <Field label="Name" required>{(a) => <Input {...a} value={name} maxLength={80} placeholder="Monthly review" onChange={(e) => setName(e.target.value)} />}</Field>
          <Field label="What it's for">{(a) => <Textarea {...a} rows={2} value={description} maxLength={300} onChange={(e) => setDescription(e.target.value)} />}</Field>
          <label className="flex items-start gap-2 text-sm">
            <Checkbox checked={suggested} onCheckedChange={(v) => setSuggested(v === true)} aria-label="Start with suggested numbers" />
            <span>Start with suggested numbers<span className="block text-muted-foreground">Revenue, payments, expenses, deals, hours and support, from the features you use. You can change them later.</span></span>
          </label>
          <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" loading={busy} disabled={!name.trim()}>Create board</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── One board ────────────────────────────────────────────────────────────────
function BoardView({ boardId, boards, cfg, onPick, onChanged }: {
  boardId: string; boards: BoardRow[]; cfg: Config; onPick: (id: string) => void; onChanged: () => void;
}) {
  const host = useModuleHost();
  const board = useLoad(() => host.api.get<Board>(`/boards/${boardId}`), [host, boardId]);
  const [period, setPeriod] = useState<PeriodKind | null>(null);
  const [compare, setCompare] = useState<Compare | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const q = { ...(period ? { period } : {}), ...(compare ? { compare } : {}), ...(date ? { date } : {}) };
  const values = useLoad(() => host.api.get<Values>(`/boards/${boardId}/values`, q), [host, boardId, period, compare, date]);
  const targets = useLoad(() => host.api.get<Target[]>("/targets"), [host]);
  const [editing, setEditing] = useState(false), [mailing, setMailing] = useState(false), [open, setOpen] = useState<TileValue | null>(null);
  const v = values.data;
  const kind = period ?? v?.period.kind ?? board.data?.period ?? "month";

  return (
    <section aria-label={board.data?.name ?? "Board"}>
      <div className="mb-3 flex flex-wrap items-end gap-2">
        {boards.length > 1 ? (
          <Field label="Board" className="min-w-48">{(a) => (
            <Select {...a} value={boardId} onChange={(e) => onPick(e.target.value)}>
              {boards.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
          )}</Field>
        ) : <h2 className="text-lg font-semibold">{board.data?.name}</h2>}
        {cfg.canManage && board.data && (
          <div className="ml-auto flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setMailing(true)}><Mail className="size-4" />Weekly email</Button>
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}><Pencil className="size-4" />Edit board</Button>
          </div>
        )}
      </div>
      {board.data?.description && <p className="mb-3 max-w-prose text-sm text-muted-foreground">{board.data.description}</p>}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Period length" className="inline-flex rounded-md border p-0.5">
          {PERIODS.map((p) => (
            <button key={p} type="button" aria-pressed={kind === p} onClick={() => { setPeriod(p); }}
              className={`rounded px-2.5 py-1 text-sm ${kind === p ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}>{PERIOD_LABEL[p]}</button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" aria-label="Earlier period" disabled={!v || values.loading} onClick={() => v && setDate(v.previous)}><ChevronLeft className="size-4" /></Button>
          <p className="min-w-40 text-center text-sm font-medium" role="status" aria-label="Period shown" aria-live="polite">
            {v ? <>{v.period.label}{v.period.current && <span className="font-normal text-muted-foreground"> · day {v.period.daysElapsed} of {v.period.days}</span>}</> : "…"}
          </p>
          <Button variant="ghost" size="icon" aria-label="Later period" disabled={!v?.next || values.loading} onClick={() => v?.next && setDate(v.next)}><ChevronRight className="size-4" /></Button>
          {date && <Button variant="link" size="sm" onClick={() => setDate(null)}>Back to now</Button>}
        </div>
        <Select aria-label="Compare with" className="ml-auto w-auto" value={compare ?? v?.compare ?? "previous"} onChange={(e) => setCompare(e.target.value as Compare)}>
          {(Object.keys(COMPARE_LABEL) as Compare[]).map((c) => <option key={c} value={c}>{COMPARE_LABEL[c]}</option>)}
        </Select>
      </div>

      {values.error ? <ErrorState title="Couldn't work out the numbers" error={values.error} onRetry={() => void values.reload()} />
        : !v ? <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-44" />)}</div>
        : !v.tiles.length ? (
          <EmptyState icon={<ChartBar className="size-6" />} title="This board has no numbers yet"
            description={cfg.canManage ? "Add the numbers you want to watch." : "A manager can add numbers to it."}
            action={cfg.canManage ? <Button onClick={() => setEditing(true)}><Plus className="size-4" />Add numbers</Button> : undefined} />
        ) : (
          <ul aria-label="Numbers" className={`grid gap-3 sm:grid-cols-2 lg:grid-cols-3 ${values.loading ? "opacity-60" : ""}`}>
            {v.tiles.map((t) => <li key={t.id}><Tile t={t} periodKind={v.period.kind} onOpen={() => setOpen(t)} /></li>)}
          </ul>
        )}

      {editing && board.data && (
        <EditBoardDialog board={board.data} cfg={cfg} onClose={() => setEditing(false)}
          onSaved={() => { setEditing(false); void board.reload(); void values.reload(); onChanged(); }}
          onDeleted={() => { setEditing(false); onPick(""); onChanged(); }} />
      )}
      {mailing && board.data && <EmailDialog board={board.data} cfg={cfg} onClose={() => setMailing(false)} onSaved={() => void board.reload()} />}
      {open && v && (
        <TileDialog t={open} periodKind={v.period.kind} canManage={cfg.canManage} targets={targets.data ?? []}
          onClose={() => setOpen(null)} onTargetSaved={() => { void targets.reload(); void values.reload(); setOpen(null); }} />
      )}
    </section>
  );
}

// ── A tile ───────────────────────────────────────────────────────────────────
const statusTone = (s: string | null | undefined) =>
  s === "met" || s === "on_track" ? "text-success" : s === "behind" ? "text-warning" : s === "missed" ? "text-destructive" : "text-muted-foreground";

function Change({ c, compact }: { c: NonNullable<TileValue["compare"]>; compact?: boolean }) {
  if (c.change == null) return <p className="text-xs text-muted-foreground">{c.value == null ? "Nothing to compare with" : `Was ${c.value === 0 ? "0" : "—"}`} {compact ? "" : `· ${c.label}`}</p>;
  const tone = c.good == null ? "text-muted-foreground" : c.good ? "text-success" : "text-destructive";
  const Icon = c.change > 0 ? ArrowUp : ArrowDown;
  return (
    <p className="flex items-center gap-1 text-xs">
      <span className={`inline-flex items-center gap-0.5 font-medium ${tone}`}>
        {c.change !== 0 && <Icon className="size-3" aria-hidden />}
        <span className="sr-only">{c.change > 0 ? "Up" : c.change < 0 ? "Down" : "No change"}{c.good != null ? (c.good ? " (good)" : " (worse)") : ""}</span>
        {Math.abs(c.change)}%
      </span>
      <span className="text-muted-foreground">vs {c.label}</span>
    </p>
  );
}

export function Tile({ t, periodKind, onOpen, compact }: { t: TileValue; periodKind: PeriodKind; onOpen?: () => void; compact?: boolean }) {
  const host = useModuleHost();
  const m = t.metric;
  return (
    <Card role="group" aria-label={t.label} className={`flex h-full flex-col gap-2 ${compact ? "p-3" : "p-4"}`}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium leading-snug">{t.label}</p>
        {m?.link && !compact && (
          <a href={`/t/${host.tenant.slug}${m.link}`} className="shrink-0 text-muted-foreground hover:text-foreground" aria-label={`Open ${t.label} details in its feature`}>
            <ExternalLink className="size-3.5" />
          </a>
        )}
      </div>
      {!m ? <p className="text-sm text-muted-foreground">{t.unavailable}</p> : (
        <>
          <p className={`${compact ? "text-xl" : "text-3xl"} font-semibold tracking-tight tabular-nums`}>{fmtValue(t.value, m.unit, t.currency)}</p>
          {t.error && <p className="text-xs text-destructive">{t.error}</p>}
          {t.value == null && !t.error && <p className="text-xs text-muted-foreground">No figure for this period yet.</p>}
          {t.compare && <Change c={t.compare} compact={compact} />}
          {t.target && (
            <div className="grid gap-1">
              {t.target.progress != null && (
                <div className="relative h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                  <div className={`h-full rounded-full ${t.target.status === "met" || t.target.status === "on_track" ? "bg-success" : t.target.status === "behind" ? "bg-warning" : "bg-destructive"}`}
                    style={{ width: `${Math.max(0, Math.min(100, t.target.progress))}%` }} />
                  {t.target.pace != null && <div className="absolute inset-y-0 w-px bg-foreground/70" style={{ left: `${Math.min(100, (t.target.pace / t.target.value) * 100)}%` }} />}
                </div>
              )}
              <p className="text-xs">
                <span className={`font-medium ${statusTone(t.target.status)}`}>{t.target.status ? STATUS_LABEL[t.target.status] : "Target"}</span>
                <span className="text-muted-foreground">
                  {" "}· {t.target.progress != null ? `${Math.round(t.target.progress)}% of ` : ""}{fmtValue(t.target.value, m.unit, t.currency, true)}
                  {t.target.pace != null && ` (expected by now: ${fmtValue(t.target.pace, m.unit, t.currency, true)})`}
                </span>
              </p>
            </div>
          )}
          {!compact && t.chart !== "none" && t.series && t.series.length > 0 && (
            <div className="mt-auto pt-1">
              <TrendChart points={t.series} unit={m.unit} currency={t.currency} target={t.target?.value ?? null} kind={t.chart === "line" ? "line" : "bar"} label={t.label} better={m.better} />
            </div>
          )}
          {onOpen && !compact && <Button variant="link" size="sm" className="-ml-2 self-start" onClick={onOpen}>Details{m && periodKind ? "" : ""}</Button>}
        </>
      )}
    </Card>
  );
}

// ── Tile details: history and target ─────────────────────────────────────────
function TileDialog({ t, periodKind, canManage, targets, onClose, onTargetSaved }: {
  t: TileValue; periodKind: PeriodKind; canManage: boolean; targets: Target[]; onClose: () => void; onTargetSaved: () => void;
}) {
  const host = useModuleHost();
  const m = t.metric!;
  const existing = targets.find((x) => x.metricKey === t.metricKey && x.period === periodKind);
  const [goal, setGoal] = useState(existing ? String(existing.value) : "");
  const [busy, setBusy] = useState(false);
  const save = async (value: number | null) => {
    setBusy(true);
    try { await host.api.put("/targets", { metricKey: t.metricKey, period: periodKind, value }); toast.success(value == null ? "Target removed" : "Target saved"); onTargetSaved(); }
    catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };
  const n = Number(goal.replace(",", "."));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={t.label} description={m.description} wide>
        <div className="grid gap-4">
          {t.series && t.series.length > 0 && (
            <>
              <TrendChart points={t.series} unit={m.unit} currency={t.currency} target={t.target?.value ?? null} kind={t.chart === "line" ? "line" : "bar"} height={140} label={t.label} better={m.better} />
              <div className="max-h-56 overflow-auto rounded-md border">
                <Table>
                  <THead><TR><TH>Period</TH><TH className="text-right">Value</TH></TR></THead>
                  <TBody>{[...t.series].reverse().map((p) => <TR key={p.from}><TD>{p.label}</TD><TD className="text-right tabular-nums">{fmtValue(p.value, m.unit, t.currency)}</TD></TR>)}</TBody>
                </Table>
              </div>
            </>
          )}
          <p className="text-sm text-muted-foreground">
            {m.kind === "total" ? "Adds up over the period." : "The value at the end of the period."} {m.better === "up" ? "Higher is better." : "Lower is better."}
          </p>
          {canManage && (
            <form className="grid gap-2 rounded-md border p-3" onSubmit={(e) => { e.preventDefault(); if (goal.trim() && Number.isFinite(n)) void save(n); }}>
              <Field label={`Target for ${EACH_PERIOD[periodKind]}`} hint={m.better === "up" ? "The number to reach." : "The most it should be, like a budget."}>
                {(a) => <Input {...a} inputMode="decimal" value={goal} onChange={(e) => setGoal(e.target.value)} placeholder={m.unit === "money" ? "20000" : "100"} />}
              </Field>
              <div className="flex gap-2">
                <Button type="submit" size="sm" loading={busy} disabled={!goal.trim() || !Number.isFinite(n)}>Save target</Button>
                {existing && <Button type="button" size="sm" variant="outline" onClick={() => void save(null)}>Remove target</Button>}
              </div>
            </form>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Edit board ───────────────────────────────────────────────────────────────
interface Draft { metricKey: string; label: string; chart: Chart }

function EditBoardDialog({ board, cfg, onClose, onSaved, onDeleted }: { board: Board; cfg: Config; onClose: () => void; onSaved: () => void; onDeleted: () => void }) {
  const host = useModuleHost();
  const [name, setName] = useState(board.name), [description, setDescription] = useState(board.description ?? "");
  const [period, setPeriod] = useState(board.period), [compare, setCompare] = useState(board.compare);
  const [tiles, setTiles] = useState<Draft[]>(board.tiles.map((t) => ({ metricKey: t.metricKey, label: t.label ?? "", chart: t.chart })));
  const [busy, setBusy] = useState(false), [confirm, setConfirm] = useState(false);
  const byKey = useMemo(() => new Map(cfg.catalogue.map((m) => [m.key, m])), [cfg.catalogue]);
  const free = cfg.catalogue.filter((m) => !tiles.some((t) => t.metricKey === m.key));
  const groups = [...new Set(free.map((m) => m.group))];
  const move = (i: number, d: number) => setTiles((ts) => { const n = [...ts]; const [x] = n.splice(i, 1); n.splice(i + d, 0, x!); return n; });
  const patch = (i: number, p: Partial<Draft>) => setTiles((ts) => ts.map((t, j) => (j === i ? { ...t, ...p } : t)));

  const save = async () => {
    setBusy(true);
    try {
      await host.api.patch(`/boards/${board.id}`, { name, description, period, compare, tiles: tiles.map((t) => ({ metricKey: t.metricKey, label: t.label || null, chart: t.chart })) });
      toast.success("Board saved"); onSaved();
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Edit board" wide>
        <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name" required>{(a) => <Input {...a} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />}</Field>
            <Field label="Shows by default">{(a) => (
              <Select {...a} value={period} onChange={(e) => setPeriod(e.target.value as PeriodKind)}>{PERIODS.map((p) => <option key={p} value={p}>{PERIOD_LABEL[p]}</option>)}</Select>
            )}</Field>
          </div>
          <Field label="What it's for">{(a) => <Textarea {...a} rows={2} value={description} maxLength={300} onChange={(e) => setDescription(e.target.value)} />}</Field>
          <Field label="Comparison">{(a) => (
            <Select {...a} value={compare} onChange={(e) => setCompare(e.target.value as Compare)}>{(Object.keys(COMPARE_LABEL) as Compare[]).map((c) => <option key={c} value={c}>{COMPARE_LABEL[c]}</option>)}</Select>
          )}</Field>

          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">Numbers on this board</legend>
            {!tiles.length && <p className="text-sm text-muted-foreground">None yet. Add one below.</p>}
            <ol className="grid gap-2" aria-label="Numbers on this board">
              {tiles.map((t, i) => {
                const m = byKey.get(t.metricKey);
                return (
                  <li key={t.metricKey} className="grid gap-2 rounded-md border p-2 sm:grid-cols-[1fr_9rem_auto] sm:items-center" aria-label={m?.label ?? t.metricKey}>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{m?.label ?? "Not available"}</p>
                      <Input aria-label={`Name on the board for ${m?.label ?? t.metricKey}`} className="mt-1 h-8" placeholder="Name on the board (optional)" value={t.label} maxLength={80} onChange={(e) => patch(i, { label: e.target.value })} />
                    </div>
                    <Select aria-label={`Chart for ${m?.label ?? t.metricKey}`} value={t.chart} onChange={(e) => patch(i, { chart: e.target.value as Chart })}>
                      <option value="bar">Bar chart</option><option value="line">Line chart</option><option value="none">Number only</option>
                    </Select>
                    <div className="flex gap-1">
                      <Button type="button" variant="ghost" size="icon" aria-label={`Move ${m?.label ?? "number"} up`} disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp className="size-4" /></Button>
                      <Button type="button" variant="ghost" size="icon" aria-label={`Move ${m?.label ?? "number"} down`} disabled={i === tiles.length - 1} onClick={() => move(i, 1)}><ArrowDown className="size-4" /></Button>
                      <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${m?.label ?? "number"}`} onClick={() => setTiles((ts) => ts.filter((_, j) => j !== i))}><Trash2 className="size-4" /></Button>
                    </div>
                  </li>
                );
              })}
            </ol>
            {free.length > 0 && tiles.length < 24 && (
              <Field label="Add a number">{(a) => (
                <Select {...a} value="" onChange={(e) => e.target.value && setTiles((ts) => [...ts, { metricKey: e.target.value, label: "", chart: "bar" }])}>
                  <option value="">Choose…</option>
                  {groups.map((g) => (
                    <optgroup key={g} label={GROUP_LABEL[g] ?? g}>
                      {free.filter((m) => m.group === g).map((m: Metric) => <option key={m.key} value={m.key}>{m.label}</option>)}
                    </optgroup>
                  ))}
                </Select>
              )}</Field>
            )}
          </fieldset>
          <DialogFooter className="sm:justify-between">
            <Button type="button" variant="ghost" className="text-destructive" onClick={() => setConfirm(true)}><Trash2 className="size-4" />Delete board</Button>
            <div className="flex gap-2"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" loading={busy} disabled={!name.trim()}>Save board</Button></div>
          </DialogFooter>
        </form>
        <ConfirmDialog open={confirm} onOpenChange={setConfirm} title={`Delete “${board.name}”?`} destructive confirmLabel="Delete board"
          description="The board and its weekly email go away. Targets and your own numbers stay."
          onConfirm={async () => { await host.api.del(`/boards/${board.id}`); toast.success("Board deleted"); onDeleted(); }} />
      </DialogContent>
    </Dialog>
  );
}

// ── Weekly email ─────────────────────────────────────────────────────────────
function EmailDialog({ board, cfg, onClose, onSaved }: { board: Board; cfg: Config; onClose: () => void; onSaved: () => void }) {
  const host = useModuleHost();
  const d = board.digest!;
  const [enabled, setEnabled] = useState(d.enabled || !d.recipients.length);
  const [weekday, setWeekday] = useState(d.weekday), [hour, setHour] = useState(d.hour);
  const [who, setWho] = useState<string[]>(d.recipients.map((r) => r.userId));
  const [busy, setBusy] = useState<"save" | "send" | null>(null);
  useEffect(() => { if (!d.recipients.length && host) setWho([]); }, [d.recipients.length, host]);
  const appUrl = `${window.location.origin}/t/${host.tenant.slug}/m/kpi/kpi`;
  const save = async () => {
    setBusy("save");
    try { await host.api.patch(`/boards/${board.id}`, { digest: { enabled, weekday, hour, recipients: who, appUrl } }); toast.success("Email settings saved"); onSaved(); onClose(); }
    catch (e) { toast.error(errorMessage(e)); } finally { setBusy(null); }
  };
  const sendNow = async () => {
    setBusy("send");
    try {
      await host.api.patch(`/boards/${board.id}`, { digest: { enabled, weekday, hour, recipients: who, appUrl } });
      const r = await host.api.post<{ sent: string[]; skipped: string[]; failed: { name: string; error: string }[] }>(`/boards/${board.id}/email`, {});
      if (r.failed.length) toast.error(`Not sent to ${r.failed.map((f) => `${f.name}: ${f.error}`).join("; ")}`);
      else toast.success(`Sent to ${r.sent.join(", ") || "nobody"}${r.skipped.length ? ` (skipped ${r.skipped.join(", ")}: no access)` : ""}`);
      onSaved();
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(null); }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Weekly email" description={`A summary of “${board.name}”. Each person only gets the numbers they're allowed to see.`}>
        <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          {!cfg.mail.ready && (
            <p role="status" className="rounded-md border border-warning/50 bg-warning/5 p-3 text-sm">
              Email isn't set up yet (missing: {cfg.mail.missing.join(", ")}). An owner or admin can add it under{" "}
              <a className="underline" href={`/t/${host.tenant.slug}/features`}>Add features → KPI dashboard → Settings</a>.
            </p>
          )}
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={enabled} onCheckedChange={(v) => setEnabled(v === true)} aria-label="Send this email every week" />Send this email every week
          </label>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Day">{(a) => <Select {...a} value={weekday} onChange={(e) => setWeekday(Number(e.target.value))}>{WEEKDAYS.map((w, i) => <option key={w} value={i + 1}>{w}</option>)}</Select>}</Field>
            <Field label="From" hint={cfg.timeZone}>{(a) => <Select {...a} value={hour} onChange={(e) => setHour(Number(e.target.value))}>{Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{`${String(h).padStart(2, "0")}:00`}</option>)}</Select>}</Field>
          </div>
          <fieldset>
            <legend className="mb-1 text-sm font-medium">Send to</legend>
            <ul className="grid max-h-48 gap-1 overflow-auto rounded-md border p-2" aria-label="Send to">
              {cfg.people.map((p) => (
                <li key={p.userId}>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={who.includes(p.userId)} aria-label={p.name}
                      onCheckedChange={(v) => setWho((w) => (v === true ? [...w, p.userId] : w.filter((x) => x !== p.userId)))} />
                    <span>{p.name} <span className="text-muted-foreground">{p.email}</span></span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
          {d.lastSentAt && (
            <p className={`text-sm ${d.lastError ? "text-destructive" : "text-muted-foreground"}`}>
              Last sent {fmtDateTime(d.lastSentAt)}{d.lastError ? `. ${d.lastError}` : "."}
            </p>
          )}
          <DialogFooter className="sm:justify-between">
            <Button type="button" variant="outline" disabled={!cfg.mail.ready || !who.length} loading={busy === "send"} onClick={() => void sendNow()}><Mail className="size-4" />Send now</Button>
            <div className="flex gap-2"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" loading={busy === "save"}>Save</Button></div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
