import { FileText, Plus } from "lucide-react";
import { Button, Card, EmptyState, ErrorState, Skeleton } from "@office/ui";
import { useModuleHost, type SlotProps } from "@office/ui/module-ui";
import { DocTable } from "./Library.tsx";
import { ModLink, useLoad, type DocRow, type Summary } from "./shared.tsx";

export function DocsWidget(_: SlotProps) {
  const host = useModuleHost();
  const s = useLoad(() => host.api.get<Summary>("/summary"), [host]);
  const rows: { n: number; label: (n: number) => string; to: string }[] = s.data ? [
    { n: s.data.waitingForMe, label: (n) => `${n} document${n === 1 ? "" : "s"} waiting for your signature`, to: "/docs/waiting" },
    { n: s.data.outForSignature, label: (n) => `${n} you sent, not signed yet`, to: "/docs/waiting" },
    { n: s.data.drafts, label: (n) => `${n} draft${n === 1 ? "" : "s"} to finish`, to: "/docs" },
    { n: s.data.completedThisMonth, label: (n) => `${n} signed this month`, to: "/docs" },
  ] : [];
  return (
    <Card className="grid gap-2 p-4" data-testid="docs-widget">
      <div className="flex items-center gap-2 font-semibold"><FileText className="size-4" /> Documents</div>
      {s.error ? <p className="text-sm text-destructive">Couldn't load documents</p> : !s.data ? <Skeleton className="h-16" /> : (
        rows.some((r) => r.n) ? (
          <ul className="grid gap-1 text-sm">
            {rows.filter((r) => r.n).map((r) => <li key={r.to + r.n + r.label(r.n)}><ModLink to={r.to}>{r.label(r.n)}</ModLink></li>)}
          </ul>
        ) : <p className="text-sm text-muted-foreground">Nothing waiting for signatures.</p>
      )}
    </Card>
  );
}

/** Tab on contact pages: documents sent to or about this contact. */
export function ContactDocsTab({ entityId }: SlotProps) {
  const host = useModuleHost();
  const list = useLoad(() => host.api.get<{ data: DocRow[] }>("/documents", { contactId: entityId }), [host, entityId]);
  const create = host.can("docs:library.send") && (
    <Button size="sm" onClick={() => host.navigate(`/docs/new?contact=${entityId}`)}><Plus /> New document for signature</Button>
  );
  if (list.error) return <Card><ErrorState error={list.error} onRetry={() => void list.reload()} /></Card>;
  if (!list.data) return <Card className="p-4"><Skeleton className="h-16" /></Card>;
  if (!list.data.data.length) return <Card><EmptyState icon={<FileText />} title="No documents yet" action={create} /></Card>;
  return (
    <div className="grid gap-2">
      {create && <div>{create}</div>}
      <DocTable rows={list.data.data} showFolder />
    </div>
  );
}
