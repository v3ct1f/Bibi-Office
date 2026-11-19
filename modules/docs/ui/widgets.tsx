import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Card, CardContent, CardHeader, CardTitle, Spinner } from "@office/ui";
import type { SlotProps } from "@office/sdk/ui";
import { ROOT } from "./common.tsx";
import type { DocRow } from "./types.ts";

/** dashboard.widget: documents waiting for signatures. */
export function SignaturesWidget({ api, tenantId, navigate, errorMessage }: SlotProps) {
  const q = useQuery({ queryKey: ["tenant", tenantId, "docs", "documents", "status=sent&limit=5"], queryFn: () => api.get<{ data: DocRow[]; nextCursor: string | null }>("/documents?status=sent&limit=5") });
  return (
    <Card>
      <CardHeader><CardTitle>Waiting for signatures</CardTitle></CardHeader>
      <CardContent className="grid gap-3 text-sm">
        {q.isPending ? <Spinner /> : q.isError ? <Alert>{errorMessage(q.error)}</Alert> : q.data.data.length === 0 ? <p className="text-muted">Nothing is waiting.</p> : (
          <ul className="grid gap-1.5" aria-label="Waiting for signatures">
            {q.data.data.map((d) => {
              const done = d.signers.filter((s) => s.status === "signed").length;
              return <li key={d.id}><button type="button" className="flex w-full gap-2 text-left hover:text-primary" onClick={() => navigate(`${ROOT}/${d.id}`)}>
                <span className="truncate">{d.title}</span><span className="ml-auto shrink-0 tabular-nums text-muted">{done}/{d.signers.length} signed</span></button></li>;
            })}
          </ul>
        )}
        <Button variant="outline" size="sm" onClick={() => navigate(ROOT)}>Open E-sign</Button>
      </CardContent>
    </Card>
  );
}
