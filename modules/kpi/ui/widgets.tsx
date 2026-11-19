import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Card, CardContent, CardHeader, CardTitle, Spinner } from "@office/ui";
import type { SlotProps } from "@office/sdk/ui";
import { delta, fmtValue, presetRange } from "./format.ts";
import { useMetricValues } from "./pages.tsx";
import type { Dashboard } from "./types.ts";

/** dashboard.widget: the first four available numbers of the first dashboard, this month. */
export function KpiWidget(props: SlotProps) {
  const { api, tenantId, navigate, errorMessage } = props;
  const list = useQuery({ queryKey: ["tenant", tenantId, "kpi", "dashboards"], queryFn: () => api.get<{ data: Dashboard[] }>("/dashboards") });
  const first = list.data?.data[0];
  const values = useMetricValues(props, first?.tiles.map((t) => t.metric) ?? [], presetRange("this_month", props.timeZone));
  const ok = (values.data?.data ?? []).filter((r) => r.ok);
  const order = first?.tiles.map((t) => t.metric) ?? [];
  const top = ok.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key)).slice(0, 4);
  return (
    <Card>
      <CardHeader><CardTitle>KPIs this month</CardTitle></CardHeader>
      <CardContent className="grid gap-3 text-sm">
        {list.isError ? <Alert>{errorMessage(list.error)}</Alert> : list.isPending || (first && values.isPending && first.tiles.length > 0) ? <Spinner /> : top.length === 0 ? <p className="text-muted">No numbers yet.</p> : (
          <dl className="grid grid-cols-2 gap-3">
            {top.map((r) => {
              if (!r.ok) return null;
              const d = delta(r.value, r.previous, r.unit, r.lowerIsBetter);
              return (
                <div key={r.key} className="grid gap-0.5">
                  <dt className="truncate text-xs text-muted">{r.label}</dt>
                  <dd className="text-lg font-semibold tabular-nums">{fmtValue(r.value, r.unit, r.currency)}
                    {d && d.good !== null && <span className={`ml-1 text-xs font-medium ${d.good ? "text-success" : "text-danger"}`}>{d.dir === "up" ? "▲" : "▼"} {d.text}</span>}</dd>
                </div>
              );
            })}
          </dl>
        )}
        <Button variant="outline" size="sm" onClick={() => navigate("/m/kpi/dashboards")}>Open KPIs</Button>
      </CardContent>
    </Card>
  );
}
