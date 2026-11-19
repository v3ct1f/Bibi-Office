// Single-series charts for KPI tiles: inline SVG, the theme's primary hue, recessive grid, hover/focus tooltip, and a table for screen readers.
import { useId, useState } from "react";
import { fmtBucket } from "./format.ts";

interface Point { t: string; v: number }
interface ChartProps { points: Point[]; bucket: "day" | "week" | "month"; format(v: number): string; label: string; target?: number | null | undefined }

const W = 320, H = 120, PAD = { l: 4, r: 4, t: 8, b: 18 };

/** Sparkline under a stat value: thin, de-emphasised, last point in the accent. */
export function Sparkline({ points }: { points: Point[] }) {
  if (points.length < 2) return null;
  const max = Math.max(...points.map((p) => p.v), 0), min = Math.min(...points.map((p) => p.v), 0), span = max - min || 1;
  const xy = points.map((p, i) => [(i / (points.length - 1)) * 100, 28 - ((p.v - min) / span) * 26] as const);
  const last = xy.at(-1)!;
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="h-8 w-full overflow-visible" aria-hidden="true">
      <polyline points={xy.map(([x, y]) => `${x},${y}`).join(" ")} fill="none" stroke="var(--muted)" strokeOpacity={0.6} strokeWidth={1.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r={2.5} fill="var(--primary)" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** Line or bar chart with one hover/focus readout and an off-screen data table. */
export function TrendChart({ points, bucket, format, label, target, kind }: ChartProps & { kind: "line" | "bar" }) {
  const [hover, setHover] = useState<number | null>(null);
  const tableId = useId();
  if (!points.length) return null;
  const max = Math.max(...points.map((p) => p.v), target ?? 0, 0) || 1;
  const iw = W - PAD.l - PAD.r, ih = H - PAD.t - PAD.b, n = points.length;
  const band = iw / n;
  const x = (i: number) => (kind === "bar" ? PAD.l + band * i + band / 2 : PAD.l + (n === 1 ? iw / 2 : (i / (n - 1)) * iw));
  const y = (v: number) => PAD.t + ih - (Math.max(v, 0) / max) * ih;
  const ticks = [0, Math.floor((n - 1) / 2), n - 1].filter((v, i, a) => a.indexOf(v) === i);
  const barW = Math.max(2, Math.min(24, band - 2));
  const h = hover !== null ? points[hover]! : null;
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-32 w-full overflow-visible" role="img" aria-label={`${label}, ${n} points`} aria-describedby={tableId}
        tabIndex={0} onBlur={() => setHover(null)}
        onKeyDown={(e) => { if (e.key === "ArrowRight") setHover((p) => Math.min(n - 1, (p ?? -1) + 1)); if (e.key === "ArrowLeft") setHover((p) => Math.max(0, (p ?? n) - 1)); }}
        onPointerLeave={() => setHover(null)}
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect(), px = ((e.clientX - r.left) / r.width) * W;
          const i = kind === "bar" ? Math.floor((px - PAD.l) / band) : Math.round(((px - PAD.l) / iw) * (n - 1));
          setHover(Math.max(0, Math.min(n - 1, i)));
        }}>
        <line x1={PAD.l} x2={W - PAD.r} y1={PAD.t + ih} y2={PAD.t + ih} stroke="var(--border)" strokeWidth={1} />
        <line x1={PAD.l} x2={W - PAD.r} y1={PAD.t} y2={PAD.t} stroke="var(--border)" strokeWidth={1} strokeDasharray="2 3" />
        {target != null && target > 0 && (
          <line x1={PAD.l} x2={W - PAD.r} y1={y(target)} y2={y(target)} stroke="var(--fg)" strokeOpacity={0.5} strokeWidth={1} strokeDasharray="4 3" />
        )}
        {kind === "bar"
          ? points.map((p, i) => {
            const top = y(p.v), hgt = PAD.t + ih - top;
            if (hgt <= 0) return null;
            const r = Math.min(4, barW / 2, hgt);
            const x0 = x(i) - barW / 2, x1 = x0 + barW, base = PAD.t + ih;
            return <path key={p.t} d={`M${x0},${base} V${top + r} Q${x0},${top} ${x0 + r},${top} H${x1 - r} Q${x1},${top} ${x1},${top + r} V${base} Z`}
              fill="var(--primary)" fillOpacity={hover === null || hover === i ? 1 : 0.45} />;
          })
          : <>
            <polyline points={points.map((p, i) => `${x(i)},${y(p.v)}`).join(" ")} fill="none" stroke="var(--primary)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {h && <line x1={x(hover!)} x2={x(hover!)} y1={PAD.t} y2={PAD.t + ih} stroke="var(--muted)" strokeWidth={1} />}
            {h && <circle cx={x(hover!)} cy={y(h.v)} r={4} fill="var(--primary)" stroke="var(--surface)" strokeWidth={2} />}
          </>}
        {ticks.map((i) => (
          <text key={i} x={x(i)} y={H - 4} fontSize={10} fill="var(--muted)" textAnchor={i === 0 && kind === "line" ? "start" : i === n - 1 && kind === "line" ? "end" : "middle"}>{fmtBucket(points[i]!.t, bucket)}</text>
        ))}
      </svg>
      {h && (
        <div role="status" className="pointer-events-none absolute -top-2 rounded-md border bg-surface px-2 py-1 text-xs shadow-sm"
          style={{ left: `${(x(hover!) / W) * 100}%`, transform: `translate(${x(hover!) / W > 0.6 ? "-100%" : "0"}, -100%)` }}>
          <div className="font-semibold tabular-nums">{format(h.v)}</div>
          <div className="text-muted">{fmtBucket(h.t, bucket, true)}</div>
        </div>
      )}
      <table id={tableId} className="sr-only">
        <caption>{label}</caption>
        <thead><tr><th>Period</th><th>Value</th></tr></thead>
        <tbody>{points.map((p) => <tr key={p.t}><td>{fmtBucket(p.t, bucket, true)}</td><td>{format(p.v)}</td></tr>)}</tbody>
      </table>
    </div>
  );
}
