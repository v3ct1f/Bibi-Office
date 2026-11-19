import { Card, CardContent } from "@office/ui";
import { Sparkline, TrendChart } from "./charts.tsx";
import { delta, fmtValue } from "./format.ts";
import type { MetricResult, Tile, Values } from "./types.ts";

type Ok = Extract<MetricResult, { ok: true }>;

function Delta({ r, prevLabel }: { r: Ok; prevLabel: string }) {
  const d = delta(r.value, r.previous, r.unit, r.lowerIsBetter);
  if (!d) return null;
  const icon = d.dir === "up" ? "▲" : d.dir === "down" ? "▼" : "–";
  const tone = d.good === null ? "text-muted" : d.good ? "text-success" : "text-danger";
  return (
    <p className="flex flex-wrap items-center gap-1 text-xs">
      <span className={`inline-flex items-center gap-0.5 font-medium ${tone}`}><span aria-hidden="true" className="text-[0.65rem]">{icon}</span>{d.text}</span>
      <span className="text-muted">vs {prevLabel} ({fmtValue(r.previous, r.unit, r.currency)})</span>
    </p>
  );
}

function Target({ r, target }: { r: Ok; target: number }) {
  if (r.value === null) return null;
  const goal = r.unit === "money" ? target * 100 : target;
  const met = r.lowerIsBetter ? r.value <= goal : r.value >= goal;
  const pct = goal > 0 ? Math.min(100, Math.round((r.value / goal) * 100)) : 0;
  return (
    <div className="grid gap-1 text-xs">
      <div className="flex justify-between gap-2">
        <span className="text-muted">Target {r.lowerIsBetter ? "at most " : ""}{fmtValue(goal, r.unit, r.currency)}</span>
        <span className={met ? "font-medium text-success" : "font-medium text-fg"}>{met ? "✓ Met" : r.lowerIsBetter ? "Above target" : `${pct}%`}</span>
      </div>
      {!r.lowerIsBetter && (
        <div className="h-1.5 overflow-hidden rounded-full bg-primary/15" role="meter" aria-label={`${r.label} towards target`} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className={`h-full rounded-full ${met ? "bg-success" : "bg-primary"}`} style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}

/** One KPI: label, compact value, change vs the previous period, then a sparkline, line or bar chart. */
export function TileCard({ tile, r, values, editing, children }: {
  tile: Tile; r: MetricResult | undefined; values: Values | undefined; editing?: boolean; children?: React.ReactNode;
}) {
  if (!r) return <Card aria-busy="true"><CardContent className="h-36 pt-5" /></Card>;
  if (!r.ok) {
    return (
      <Card className="h-full border-dashed">
        <CardContent className="grid gap-2 pt-5 text-sm">
          <p className="font-medium text-muted">{tile.metric}</p>
          <p className="text-muted">{r.message === "The module is turned off" || r.message === "Unknown metric" ? "Turn on the module this number comes from to see it." : r.message}</p>
          {children}
        </CardContent>
      </Card>
    );
  }
  const prevLabel = values ? "previous period" : "";
  const fmt = (v: number) => fmtValue(v, r.unit, r.currency, false);
  return (
    <Card className="h-full">
      <CardContent className="grid content-start gap-2 pt-5">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-sm font-medium text-muted" title={r.description ?? undefined}>{r.label}</h3>
          <span className="shrink-0 text-xs text-muted">{r.kind === "stock" ? "Now" : r.moduleName}</span>
        </div>
        <p className="text-3xl font-semibold tracking-tight tabular-nums" title={r.value === null ? undefined : fmt(r.value)}>{fmtValue(r.value, r.unit, r.currency)}</p>
        {r.kind === "flow" && <Delta r={r} prevLabel={prevLabel} />}
        {r.excluded > 0 && <p className="text-xs text-muted">{r.excluded} in other currencies not included</p>}
        {tile.target !== null && <Target r={r} target={tile.target} />}
        {r.series && values && (tile.view === "number"
          ? <Sparkline points={r.series} />
          : <TrendChart kind={tile.view} points={r.series} bucket={values.range.bucket} format={fmt} label={r.label} target={tile.target !== null && r.unit === "money" ? tile.target * 100 : tile.target} />)}
        {editing && children}
      </CardContent>
    </Card>
  );
}
