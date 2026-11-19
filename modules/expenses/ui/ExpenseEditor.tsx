import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Camera, FileText, Plus, ScanText, Trash2, Upload, X } from "lucide-react";
import { Button, Card, ErrorState, Field, Input, PageHeader, Select, Skeleton, Textarea, toast } from "@office/ui";
import { useModuleHost, type PageProps } from "@office/ui/module-ui";
import { parseReceipt } from "../src/receipt.ts";
import { prepareFile, readText } from "./ocr.ts";
import {
  CURRENCIES, Section, centsToInput, errorMessage, fmtMoney, parseMoney, today, useLoad,
  type Config, type ExpenseDetail, type Kind,
} from "./shared.tsx";

interface LineRow { description: string; quantity: string; amount: string }
interface Attached { id: string; name: string; contentType: string; previewUrl: string | null }
type Scan = { state: "idle" } | { state: "uploading" } | { state: "reading"; progress: number } | { state: "done"; found: string[] } | { state: "failed"; message: string };

const emptyLine = (): LineRow => ({ description: "", quantity: "1", amount: "" });

export function ExpenseEditor({ params }: PageProps) {
  const host = useModuleHost();
  const id = params.id;
  const cfg = useLoad(() => host.api.get<Config>("/config"), []);
  const existing = useLoad(() => (id ? host.api.get<ExpenseDetail>(`/expenses/${id}`) : Promise.resolve(null)), [id]);
  if (cfg.error || existing.error) return <Card><ErrorState error={cfg.error ?? existing.error} onRetry={() => { void cfg.reload(); void existing.reload(); }} /></Card>;
  if (cfg.loading || existing.loading || !cfg.data) return <div className="grid gap-4"><Skeleton className="h-10 w-64" /><Skeleton className="h-64" /></div>;
  return <Form key={id ?? "new"} cfg={cfg.data} expense={existing.data ?? null} />;
}

function Form({ cfg, expense }: { cfg: Config; expense: ExpenseDetail | null }) {
  const host = useModuleHost();
  const [kind, setKind] = useState<Kind>(expense?.kind ?? "receipt");
  const [vendor, setVendor] = useState(expense?.vendor ?? "");
  const [docDate, setDocDate] = useState(expense?.docDate ?? today());
  const [dueDate, setDueDate] = useState(expense?.dueDate ?? "");
  const [invoiceNumber, setInvoiceNumber] = useState(expense?.invoiceNumber ?? "");
  const [category, setCategory] = useState(expense?.category ?? "");
  const [description, setDescription] = useState(expense?.description ?? "");
  const [currency, setCurrency] = useState(expense?.currency ?? cfg.currency);
  const [tax, setTax] = useState(expense ? centsToInput(expense.taxCents) : "");
  const [total, setTotal] = useState(expense ? centsToInput(expense.totalCents) : "");
  const [lines, setLines] = useState<LineRow[]>(expense?.lines.map((l) => ({ description: l.description, quantity: String(l.quantity), amount: centsToInput(l.amountCents) })) ?? []);
  const [file, setFile] = useState<Attached | null>(expense?.file ? { ...expense.file, previewUrl: null } : null);
  const [ocrText, setOcrText] = useState<string | null>(expense?.ocrText ?? null);
  const [scan, setScan] = useState<Scan>({ state: "idle" });
  const [saving, setSaving] = useState<"draft" | "submit" | null>(null);
  const [touched, setTouched] = useState(false);
  const photoRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Show the existing attachment.
  useEffect(() => {
    if (!expense?.file || !expense.file.contentType.startsWith("image/")) return;
    let live = true;
    host.api.get<{ contentType: string; data: string }>(`/files/${expense.file.id}`)
      .then((f) => { if (live) setFile((cur) => (cur && cur.id === expense.file!.id ? { ...cur, previewUrl: `data:${f.contentType};base64,${f.data}` } : cur)); })
      .catch(() => {});
    return () => { live = false; };
  }, [expense?.file, host.api]);

  const totalCents = parseMoney(total);
  const taxCents = parseMoney(tax);
  const lineCents = lines.map((l) => parseMoney(l.amount));
  const qty = lines.map((l) => Number(l.quantity.replace(",", ".")));
  const lineSum = lineCents.reduce<number>((a, c) => a + (c ?? 0), 0);
  const subtotal = totalCents !== null && taxCents !== null ? totalCents - taxCents : null;
  const linesOk = !lines.length || totalCents === null || taxCents === null || lineSum === totalCents || lineSum === subtotal;
  const errors = {
    vendor: !vendor.trim() ? "Enter who you paid" : undefined,
    docDate: !docDate ? "Enter the date on the receipt" : undefined,
    total: total.trim() === "" ? "Enter the total you paid" : totalCents === null ? "Enter an amount like 12.50" : undefined,
    tax: taxCents === null ? "Enter an amount like 2.10, or 0" : totalCents !== null && taxCents > totalCents ? "Tax can't be more than the total" : undefined,
    lines: !linesOk ? `The lines add up to ${fmtMoney(lineSum, currency)}, but the total is ${fmtMoney(totalCents ?? 0, currency)}${subtotal !== null && subtotal !== totalCents ? ` (${fmtMoney(subtotal, currency)} before tax)` : ""}. Fix a line or the total.` : undefined,
    line: lines.map((l, i) => (!l.description.trim() ? "Describe the item" : lineCents[i] === null ? "Enter an amount" : !(qty[i]! > 0) ? "Quantity must be more than 0" : undefined)),
  };
  const valid = !errors.vendor && !errors.docDate && !errors.total && !errors.tax && !errors.lines && errors.line.every((e) => !e);

  async function onFile(f: File | undefined) {
    if (!f) return;
    if (f.size > 25 * 1024 * 1024) { toast.error("That file is too big (over 25 MB)"); return; }
    setScan({ state: "uploading" });
    try {
      const prepared = await prepareFile(f);
      if (prepared.bytes > cfg.maxFileBytes) throw new Error("The file is over 5 MB even after shrinking. Try a smaller photo or PDF.");
      const up = await host.api.post<{ id: string; name: string; contentType: string }>("/files", { name: prepared.name, contentType: prepared.contentType, data: prepared.base64 });
      setFile({ ...up, previewUrl: prepared.isImage ? prepared.previewUrl : null });
      if (!prepared.isImage) {
        setScan({ state: "failed", message: "PDF attached. Text can only be read from photos and images, so please type the details below." });
        return;
      }
      setScan({ state: "reading", progress: 0 });
      const text = await readText(prepared.previewUrl, (p) => setScan({ state: "reading", progress: p }));
      setOcrText(text);
      const r = parseReceipt(text);
      const found: string[] = [];
      if (r.vendor) { setVendor(r.vendor); found.push("vendor"); }
      if (r.date) { setDocDate(r.date); found.push("date"); }
      if (r.invoiceNumber) { setInvoiceNumber(r.invoiceNumber); found.push("number"); }
      if (r.currency && CURRENCIES.includes(r.currency)) setCurrency(r.currency);
      if (r.totalCents !== null) { setTotal(centsToInput(r.totalCents)); found.push("total"); }
      if (r.taxCents !== null) { setTax(centsToInput(r.taxCents)); found.push("tax"); }
      if (r.lines.length) {
        setLines(r.lines.map((l) => ({ description: l.description, quantity: String(l.quantity), amount: centsToInput(l.amountCents) })));
        found.push(`${r.lines.length} line item${r.lines.length === 1 ? "" : "s"}`);
      }
      setScan(found.length ? { state: "done", found } : { state: "failed", message: "We couldn't read the details from this photo. Please type them in; the photo is attached." });
    } catch (e) {
      setScan({ state: "failed", message: errorMessage(e) });
    } finally {
      if (photoRef.current) photoRef.current.value = "";
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function save(andSubmit: boolean) {
    setTouched(true);
    if (!valid) { toast.error("Check the highlighted fields"); return; }
    setSaving(andSubmit ? "submit" : "draft");
    const body = {
      kind, vendor: vendor.trim(), docDate, dueDate: kind === "invoice" && dueDate ? dueDate : null,
      invoiceNumber: invoiceNumber.trim() || null, category: category || null, description: description.trim() || null, currency,
      taxCents: taxCents ?? 0, totalCents: totalCents ?? 0,
      lines: lines.map((l, i) => ({ description: l.description.trim(), quantity: qty[i]!, amountCents: lineCents[i] ?? 0 })),
      fileId: file?.id ?? null, ocrText,
    };
    try {
      const saved = expense
        ? await host.api.patch<ExpenseDetail>(`/expenses/${expense.id}`, body)
        : await host.api.post<ExpenseDetail>("/expenses", body);
      if (andSubmit) await host.api.post(`/expenses/${saved.id}/submit`, {});
      toast.success(andSubmit ? "Sent for approval" : "Saved as draft");
      host.navigate(`/expenses/${saved.id}`);
    } catch (e) { toast.error(errorMessage(e)); } finally { setSaving(null); }
  }

  const back = expense ? `/expenses/${expense.id}` : "/expenses";
  const canSubmitNow = cfg.canSubmit && (!expense || ((expense.status === "draft" || expense.status === "rejected") && expense.employeeId === cfg.me));
  const busy = scan.state === "uploading" || scan.state === "reading";
  const err = (e: string | undefined) => (touched ? e : undefined);

  return (
    <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); void save(false); }}>
      <a href={host.href(back)} onClick={(e) => { e.preventDefault(); host.navigate(back); }} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> {expense ? expense.vendor : "Expenses"}
      </a>
      <PageHeader className="mb-2" title={expense ? "Edit expense" : "New expense"}
        description={expense ? undefined : "Snap or upload the receipt and we fill in what we can read. You check everything before it's saved."} />

      <Section n={1} title="Receipt or invoice" description="A photo of a paper receipt, or the PDF a supplier sent you. Optional, but it helps whoever approves it.">
        <input ref={photoRef} type="file" accept="image/*" capture="environment" className="sr-only" aria-label="Take a photo of the receipt" tabIndex={-1}
          onChange={(e) => void onFile(e.target.files?.[0])} />
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="sr-only" aria-label="Upload receipt file" tabIndex={-1}
          onChange={(e) => void onFile(e.target.files?.[0])} />
        {file ? (
          <div className="flex flex-wrap items-start gap-4">
            {file.previewUrl
              ? <img src={file.previewUrl} alt="Receipt" className="max-h-72 w-auto max-w-full rounded-md border object-contain sm:max-w-xs" />
              : <div className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm"><FileText className="size-4" /> {file.name}</div>}
            <div className="grid gap-2">
              <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => fileRef.current?.click()}><Upload /> Replace</Button>
              <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => { setFile(null); setScan({ state: "idle" }); }}><X /> Remove</Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={busy} onClick={() => photoRef.current?.click()}><Camera /> Take a photo</Button>
            <Button type="button" variant="outline" disabled={busy} onClick={() => fileRef.current?.click()}><Upload /> Upload a file</Button>
          </div>
        )}
        {scan.state === "uploading" && <p className="text-sm text-muted-foreground" role="status">Uploading…</p>}
        {scan.state === "reading" && (
          <div className="grid gap-1.5" role="status" aria-label="Reading the receipt">
            <p className="flex items-center gap-2 text-sm"><ScanText className="size-4" /> Reading the receipt… {Math.round(scan.progress * 100)}%</p>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary transition-all" style={{ width: `${Math.round(scan.progress * 100)}%` }} /></div>
            <p className="text-xs text-muted-foreground">The first time takes a little longer while the reader loads.</p>
          </div>
        )}
        {scan.state === "done" && (
          <p className="rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-sm" role="status" data-testid="ocr-result">
            We filled in the {scan.found.join(", ")} from the photo. <strong>Please check every field</strong> before saving: photos can be misread.
          </p>
        )}
        {scan.state === "failed" && <p className="rounded-md border bg-muted px-3 py-2 text-sm" role="status" data-testid="ocr-result">{scan.message}</p>}
      </Section>

      <Section n={2} title="Details" description="Who you paid, when, and what for.">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Type">{(a) => (
            <Select {...a} value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
              <option value="receipt">Receipt (already paid)</option>
              <option value="invoice">Supplier invoice (to pay)</option>
            </Select>
          )}</Field>
          <Field label="Vendor" required error={err(errors.vendor)} hint="The shop, supplier or company on the receipt.">
            {(a) => <Input {...a} value={vendor} onChange={(e) => setVendor(e.target.value)} maxLength={200} />}
          </Field>
          <Field label="Date" required error={err(errors.docDate)}>
            {(a) => <Input {...a} type="date" value={docDate} onChange={(e) => setDocDate(e.target.value)} />}
          </Field>
          <Field label={kind === "invoice" ? "Invoice number" : "Receipt number"}>
            {(a) => <Input {...a} value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} maxLength={80} />}
          </Field>
          {kind === "invoice" && (
            <Field label="Due date">{(a) => <Input {...a} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />}</Field>
          )}
          <Field label="Category">{(a) => (
            <Select {...a} value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">Choose…</option>
              {[...new Set([...(category ? [category] : []), ...cfg.categories])].map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          )}</Field>
          <Field label="What was it for?" className="sm:col-span-2 lg:col-span-3">
            {(a) => <Textarea {...a} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} placeholder="e.g. Lemons and ice for Saturday's event" />}
          </Field>
        </div>
      </Section>

      <Section n={3} title="Amounts" description="Line items are optional. If you add them, they must add up to the total (with or without tax).">
        <div className="grid gap-2" role="group" aria-label="Line items">
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-[1fr_4.5rem_7rem_auto] items-start gap-2">
              <Input aria-label={`Line ${i + 1} description`} placeholder="Item" value={l.description} aria-invalid={touched && !!errors.line[i] && !l.description.trim()}
                onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} />
              <Input aria-label={`Line ${i + 1} quantity`} inputMode="decimal" value={l.quantity}
                onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))} />
              <Input aria-label={`Line ${i + 1} amount`} inputMode="decimal" placeholder="0.00" value={l.amount} aria-invalid={touched && lineCents[i] === null}
                onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} />
              <Button type="button" variant="ghost" size="icon" aria-label={`Remove line ${i + 1}`} onClick={() => setLines(lines.filter((_, j) => j !== i))}><Trash2 /></Button>
              {touched && errors.line[i] && <p className="col-span-4 -mt-1 text-xs text-destructive">Line {i + 1}: {errors.line[i]}</p>}
            </div>
          ))}
          <div><Button type="button" variant="outline" size="sm" onClick={() => setLines([...lines, emptyLine()])}><Plus /> Add line</Button></div>
          {lines.length > 0 && <p className="text-xs text-muted-foreground">Lines add up to {fmtMoney(lineSum, currency)}</p>}
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Tax" error={err(errors.tax)} hint="VAT / IVA on the receipt. 0 if none.">
            {(a) => <Input {...a} inputMode="decimal" placeholder="0.00" value={tax} onChange={(e) => setTax(e.target.value)} />}
          </Field>
          <Field label="Total" required error={err(errors.total)} hint="What you paid, tax included.">
            {(a) => <Input {...a} inputMode="decimal" placeholder="0.00" value={total} onChange={(e) => setTotal(e.target.value)} />}
          </Field>
          <Field label="Currency">{(a) => (
            <Select {...a} value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {[...new Set([currency, ...CURRENCIES])].map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          )}</Field>
        </div>
        {errors.lines && <p className="text-sm text-destructive" role="alert">{errors.lines}</p>}
        {subtotal !== null && totalCents !== null && !errors.tax && (
          <p className="text-sm text-muted-foreground">Before tax {fmtMoney(subtotal, currency)} · Tax {fmtMoney(taxCents ?? 0, currency)} · <strong className="text-foreground">Total {fmtMoney(totalCents, currency)}</strong></p>
        )}
      </Section>

      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" onClick={() => host.navigate(back)}>Cancel</Button>
        <Button type="submit" variant={canSubmitNow ? "outline" : "default"} loading={saving === "draft"} disabled={busy || !!saving}>{!expense || expense.status === "draft" ? "Save draft" : "Save changes"}</Button>
        {canSubmitNow && <Button type="button" loading={saving === "submit"} disabled={busy || !!saving} onClick={() => void save(true)}>Save and submit</Button>}
      </div>
    </form>
  );
}
