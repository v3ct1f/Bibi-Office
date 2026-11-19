import { useEffect, useState } from "react";
import { ArrowLeft, Check, CircleDollarSign, Download, Pencil, Send, Trash2, X } from "lucide-react";
import {
  Button, Card, CardContent, CardHeader, CardTitle, ConfirmDialog, Dialog, DialogContent, DialogFooter, ErrorState, Field,
  PageHeader, Skeleton, Table, TBody, TD, TH, THead, TR, Textarea, toast,
} from "@office/ui";
import { useModuleHost, type PageProps } from "@office/ui/module-ui";
import { StatusBadge, errorMessage, fmtDate, fmtDateTime, fmtMoney, useLoad, type ExpenseDetail as Detail } from "./shared.tsx";

const ACTION_LABEL: Record<string, string> = {
  created: "Created", edited: "Edited", submitted: "Submitted for approval", approved: "Approved", rejected: "Rejected", paid: "Marked as paid",
};

export function ExpenseDetail({ params }: PageProps) {
  const host = useModuleHost();
  const id = params.id!;
  const exp = useLoad(() => host.api.get<Detail>(`/expenses/${id}`), [id]);
  const [busy, setBusy] = useState<string | null>(null);
  const [decide, setDecide] = useState<"approve" | "reject" | null>(null);
  const [comment, setComment] = useState("");
  const [deleting, setDeleting] = useState(false);

  if (exp.error) return <Card><ErrorState error={exp.error} onRetry={() => void exp.reload()} /></Card>;
  if (!exp.data) return <div className="grid gap-4"><Skeleton className="h-10 w-64" /><Skeleton className="h-64" /></div>;
  const x = exp.data;

  const act = async (what: string, path: string, body: unknown, ok: string) => {
    setBusy(what);
    try { exp.set(await host.api.post<Detail>(`/expenses/${x.id}/${path}`, body)); toast.success(ok); setDecide(null); setComment(""); }
    catch (e) { toast.error(errorMessage(e)); } finally { setBusy(null); }
  };

  return (
    <div className="grid gap-4">
      <a href={host.href("/expenses")} onClick={(e) => { e.preventDefault(); host.navigate("/expenses"); }} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Expenses
      </a>
      <PageHeader title={<span className="flex flex-wrap items-center gap-2">{x.vendor} <StatusBadge status={x.status} /></span>}
        description={`${x.kind === "invoice" ? "Supplier invoice" : "Receipt"} · ${fmtDate(x.docDate)} · ${x.employeeName ?? ""}`}
        actions={<>
          {x.can.submit && <Button loading={busy === "submit"} onClick={() => void act("submit", "submit", {}, "Sent for approval")}><Send /> Submit for approval</Button>}
          {x.can.approve && <Button onClick={() => setDecide("approve")}><Check /> Approve</Button>}
          {x.can.reject && <Button variant="outline" onClick={() => setDecide("reject")}><X /> Reject</Button>}
          {x.can.pay && <Button loading={busy === "pay"} onClick={() => void act("pay", "pay", {}, "Marked as paid")}><CircleDollarSign /> Mark as paid</Button>}
          {x.can.edit && <Button variant="outline" onClick={() => host.navigate(`/expenses/${x.id}/edit`)}><Pencil /> Edit</Button>}
          {x.can.delete && <Button variant="ghost" aria-label="Delete expense" onClick={() => setDeleting(true)}><Trash2 /></Button>}
        </>} />

      {x.status === "rejected" && (
        <div className="rounded-md border border-destructive/40 bg-danger-soft px-4 py-3 text-sm" role="status" data-testid="rejected-callout">
          <strong>Rejected{x.decidedByName ? ` by ${x.decidedByName}` : ""}:</strong> {x.decisionComment}
          {x.can.edit && <span className="block text-muted-foreground">Fix it with Edit, then submit it again.</span>}
        </div>
      )}
      {x.status === "submitted" && !x.can.approve && <p className="text-sm text-muted-foreground">Waiting for a manager to approve it.</p>}

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="grid content-start gap-4">
          <Card>
            <CardHeader><CardTitle>Amounts</CardTitle></CardHeader>
            <CardContent className="grid gap-3">
              {x.lines.length > 0 && (
                <div className="overflow-x-auto">
                  <Table aria-label="Line items">
                    <THead><TR><TH>Item</TH><TH className="text-right">Qty</TH><TH className="text-right">Amount</TH></TR></THead>
                    <TBody>{x.lines.map((l, i) => (
                      <TR key={i}><TD>{l.description}</TD><TD className="text-right tabular-nums">{l.quantity}</TD><TD className="text-right tabular-nums">{fmtMoney(l.amountCents, x.currency)}</TD></TR>
                    ))}</TBody>
                  </Table>
                </div>
              )}
              <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-sm">
                <dt className="text-muted-foreground">Before tax</dt><dd className="text-right tabular-nums">{fmtMoney(x.subtotalCents, x.currency)}</dd>
                <dt className="text-muted-foreground">Tax</dt><dd className="text-right tabular-nums">{fmtMoney(x.taxCents, x.currency)}</dd>
                <dt className="font-semibold">Total</dt><dd className="text-right font-semibold tabular-nums" data-testid="expense-total">{fmtMoney(x.totalCents, x.currency)}</dd>
              </dl>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Details</CardTitle></CardHeader>
            <CardContent>
              <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[10rem_1fr]">
                <dt className="text-muted-foreground">Category</dt><dd>{x.category ?? "—"}</dd>
                <dt className="text-muted-foreground">{x.kind === "invoice" ? "Invoice number" : "Receipt number"}</dt><dd>{x.invoiceNumber ?? "—"}</dd>
                {x.kind === "invoice" && <><dt className="text-muted-foreground">Due date</dt><dd>{fmtDate(x.dueDate)}</dd></>}
                <dt className="text-muted-foreground">What for</dt><dd className="whitespace-pre-wrap">{x.description ?? "—"}</dd>
                <dt className="text-muted-foreground">Paid by</dt><dd>{x.employeeName ?? "—"}</dd>
                {x.paidAt && <><dt className="text-muted-foreground">Paid back</dt><dd>{fmtDateTime(x.paidAt)}</dd></>}
              </dl>
            </CardContent>
          </Card>
        </div>
        <div className="grid content-start gap-4">
          <Card>
            <CardHeader><CardTitle>Receipt</CardTitle></CardHeader>
            <CardContent>{x.file ? <Attachment file={x.file} /> : <p className="text-sm text-muted-foreground">No receipt attached.</p>}</CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>History</CardTitle></CardHeader>
            <CardContent>
              <ol className="grid gap-3 text-sm" aria-label="History">
                {x.history.map((h, i) => (
                  <li key={i} className="border-l-2 pl-3">
                    <p><span className="font-medium">{ACTION_LABEL[h.action] ?? h.action}</span>{h.actorName ? ` by ${h.actorName}` : ""}</p>
                    {h.comment && <p className="text-muted-foreground">“{h.comment}”</p>}
                    <p className="text-xs text-muted-foreground">{fmtDateTime(h.at)}</p>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={!!decide} onOpenChange={(o) => { if (!o) { setDecide(null); setComment(""); } }}>
        {decide && (
          <DialogContent title={decide === "approve" ? `Approve ${fmtMoney(x.totalCents, x.currency)}?` : "Reject this expense?"}
            description={decide === "approve" ? `${x.employeeName ?? "They"} will see it's approved. You can mark it paid afterwards.` : "They'll see your comment and can fix and resubmit it."}>
            <form className="grid gap-4" onSubmit={(e) => {
              e.preventDefault();
              if (decide === "reject" && !comment.trim()) { toast.error("Say why it is rejected"); return; }
              void act(decide, decide, comment.trim() ? { comment: comment.trim() } : {}, decide === "approve" ? "Approved" : "Rejected");
            }}>
              <Field label={decide === "approve" ? "Comment (optional)" : "Reason"} required={decide === "reject"}>
                {(a) => <Textarea {...a} rows={3} value={comment} onChange={(e) => setComment(e.target.value)} maxLength={1000} autoFocus
                  placeholder={decide === "reject" ? "e.g. Please attach the receipt" : ""} />}
              </Field>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setDecide(null)}>Cancel</Button>
                <Button type="submit" variant={decide === "reject" ? "destructive" : "default"} loading={busy === decide}>{decide === "approve" ? "Approve" : "Reject"}</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        )}
      </Dialog>

      <ConfirmDialog open={deleting} onOpenChange={setDeleting} destructive confirmLabel="Delete" title="Delete this expense?"
        description="The expense and its receipt are removed for good."
        onConfirm={async () => {
          try { await host.api.del(`/expenses/${x.id}`); toast.success("Expense deleted"); host.navigate("/expenses"); }
          catch (e) { toast.error(errorMessage(e)); }
        }} />
    </div>
  );
}

function Attachment({ file }: { file: NonNullable<Detail["file"]> }) {
  const host = useModuleHost();
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    host.api.get<{ contentType: string; data: string }>(`/files/${file.id}`)
      .then((f) => { if (live) setUrl(`data:${f.contentType};base64,${f.data}`); })
      .catch((e) => { if (live) setError(errorMessage(e)); });
    return () => { live = false; };
  }, [file.id, host.api]);
  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!url) return <Skeleton className="h-48" />;
  return (
    <div className="grid gap-2">
      {file.contentType.startsWith("image/")
        ? <a href={url} target="_blank" rel="noreferrer"><img src={url} alt="Receipt" className="w-full rounded-md border object-contain" /></a>
        : <p className="text-sm">{file.name}</p>}
      <Button asChild variant="outline" size="sm"><a href={url} download={file.name}><Download /> Download</a></Button>
    </div>
  );
}
