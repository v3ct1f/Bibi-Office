export type Unit = "count" | "money" | "percent" | "hours";
export type View = "number" | "line" | "bar";
export interface Tile { id: string; metric: string; view: View; target: number | null }
export interface Dashboard { id: string; name: string; position: number; tiles: Tile[]; createdBy: string; createdAt: string; updatedAt: string }
export interface MetricInfo { key: string; module: string; moduleName: string; label: string; description: string | null; unit: Unit; kind: "flow" | "stock"; lowerIsBetter: boolean }
export type MetricResult =
  | (MetricInfo & { ok: true; value: number | null; previous: number | null; currency: string | null; excluded: number; series: { t: string; v: number }[] | null })
  | { key: string; ok: false; error: "unavailable" | "failed"; message: string };
export interface Values { range: { from: string; to: string; bucket: "day" | "week" | "month" }; previous: { from: string; to: string }; data: MetricResult[] }
