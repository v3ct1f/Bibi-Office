import { fmtValue, type Point, type Unit } from "./shared.tsx";

/**
 * A small trend chart: one bar (or point) per period, the last one highlighted, and the target as a dashed line.
 * Gaps (no value) are left empty. The numbers are also given as a text description for screen readers.
 */
export function TrendChart({ points, unit, currency, target, kind = "bar", height = 64, label, better = "up" }: {
  points: Point[]; unit: Unit; currency?: string | null; target?: number | null; kind?: "bar" | "line"; height?: number; label: string;
  better?: "up" | "down";
}) {
  const vals = points.map((p) => p.value).filter((v): v is number => v != null);
  if (!vals.length) return <p className="text-xs text-muted-foreground">No history to show.</p>;
  const W = 300, H = height, pad = 2;
  const top = Math.max(0, ...vals, target ?? 0), bottom = Math.min(0, ...vals);
  const span = top - bottom || 1;
  const y = (v: number) => pad + (H - 2 * pad) * (1 - (v - bottom) / span);
  const step = W / points.length;
  const last = points.length - 1;
  const desc = points.map((p) => `${p.label}: ${fmtValue(p.value, unit, currency)}`).join(", ");
  const goodTone = (v: number) => target == null ? "fill-primary" : (better === "up" ? v >= target : v <= target) ? "fill-success" : "fill-warning";

  return (
    <figure className="m-0">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block h-auto w-full overflow-visible" style={{ height }} role="img"
        aria-label={`${label}, last ${points.length} periods: ${desc}${target != null ? `. Target ${fmtValue(target, unit, currency)}` : ""}`}>
        <line x1={0} x2={W} y1={y(0)} y2={y(0)} className="stroke-border" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        {kind === "bar" ? points.map((p, i) => p.value == null ? null : (
          <rect key={p.from} x={i * step + step * 0.18} width={step * 0.64} y={Math.min(y(p.value), y(0))} height={Math.max(1, Math.abs(y(0) - y(p.value)))} rx={1.5}
            className={i === last ? goodTone(p.value) : "fill-muted-foreground/25"}>
            <title>{`${p.label}: ${fmtValue(p.value, unit, currency)}`}</title>
          </rect>
        )) : (
          <>
            <polyline fill="none" className="stroke-primary" strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round"
              points={points.map((p, i) => (p.value == null ? null : `${i * step + step / 2},${y(p.value)}`)).filter(Boolean).join(" ")} />
            {points.map((p, i) => p.value == null ? null : (
              <circle key={p.from} cx={i * step + step / 2} cy={y(p.value)} r={i === last ? 3.5 : 2} className={i === last ? goodTone(p.value) : "fill-primary"} vectorEffect="non-scaling-stroke">
                <title>{`${p.label}: ${fmtValue(p.value, unit, currency)}`}</title>
              </circle>
            ))}
          </>
        )}
        {target != null && (
          <line x1={0} x2={W} y1={y(target)} y2={y(target)} className="stroke-foreground/60" strokeWidth={1} strokeDasharray="4 3" vectorEffect="non-scaling-stroke">
            <title>{`Target ${fmtValue(target, unit, currency)}`}</title>
          </line>
        )}
      </svg>
      <figcaption className="mt-1 flex justify-between text-[11px] text-muted-foreground" aria-hidden>
        <span>{points[0]!.label}</span><span>{points[last]!.label}</span>
      </figcaption>
    </figure>
  );
}
