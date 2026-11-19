import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, ImageUp, Trash2 } from "lucide-react";
import { Button, Card, ErrorState, Field, Input, PageHeader, Select, Skeleton, Textarea, toast } from "@office/ui";
import { useModuleHost } from "@office/ui/module-ui";
import { formatNumber, validateNumberFormat } from "../src/money.ts";
import { CURRENCIES, errorMessage, useLoad } from "./shared.tsx";

type Values = Record<string, string | number | undefined>;
interface ModuleInfo { key: string; settings: Values }

const MAX_LOGO_CHARS = 400_000;

/** Downscale an uploaded image to fit 600x240 and return a PNG/JPEG data URL small enough for settings. */
export async function resizeLogo(file: File): Promise<string> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error("Use a PNG, JPG or WebP image");
  if (file.size > 10 * 1024 * 1024) throw new Error("Image is larger than 10 MB");
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("Could not read this image")); i.src = url;
    });
    const scale = Math.min(1, 600 / img.naturalWidth, 240 / img.naturalHeight);
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(img.naturalWidth * scale));
    c.height = Math.max(1, Math.round(img.naturalHeight * scale));
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    let out = c.toDataURL("image/png");
    for (const q of [0.92, 0.8, 0.6]) {
      if (out.length <= MAX_LOGO_CHARS) break;
      out = c.toDataURL("image/jpeg", q);
    }
    if (out.length > MAX_LOGO_CHARS) throw new Error("Logo is still too large after resizing; try a simpler image");
    return out;
  } finally { URL.revokeObjectURL(url); }
}

function Section({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <Card className="grid gap-5 p-5 md:grid-cols-[14rem_1fr]">
      <div className="grid content-start gap-1">
        <h2 className="font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </Card>
  );
}

export function SettingsPage() {
  const host = useModuleHost();
  const canManage = host.can("core:modules.manage");
  const mod = useLoad(async () => (await host.core.get<ModuleInfo[]>("/modules")).find((m) => m.key === host.moduleKey)!, [host]);
  const [v, setV] = useState<Values>({});
  const initial = useRef<Values>({});
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!mod.data) return;
    const s = { ...mod.data.settings };
    // Move the old free-text address into line 1 once.
    if (s.sellerAddress && !s.sellerAddressLine1) { s.sellerAddressLine1 = String(s.sellerAddress).replace(/\s*\n\s*/g, ", "); }
    initial.current = { ...mod.data.settings };
    setV(s);
  }, [mod.data]);

  if (mod.loading && !mod.data) return <><Skeleton className="h-8 w-56" /><Skeleton className="mt-6 h-96" /></>;
  if (mod.error || !mod.data) return <ErrorState error={mod.error ?? "Invoicing settings are not available"} onRetry={() => void mod.reload()} />;

  const str = (k: string) => (v[k] === undefined || v[k] === null ? "" : String(v[k]));
  const set = (k: string) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: e.target.value }));
  const fmt = str("numberFormat") || "INV-{YYYY}-{seq:5}";
  const fmtError = validateNumberFormat(fmt);
  const ro = !canManage;

  const text = (k: string, label: string, props: { type?: string; placeholder?: string; maxLength?: number; className?: string } = {}) => (
    <Field label={label} className={props.className}>
      {(a) => <Input {...a} type={props.type ?? "text"} value={str(k)} onChange={set(k)} placeholder={props.placeholder} maxLength={props.maxLength ?? 200} disabled={ro} />}
    </Field>
  );

  const save = async () => {
    if (fmtError) return toast.error(fmtError);
    const patch: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) {
      const before = initial.current[k];
      const now = typeof val === "string" ? val.trim() : val;
      if (now === before || (now === "" && before === undefined)) continue;
      patch[k] = now === "" ? null : now;
    }
    if (v.sellerAddressLine1 && initial.current.sellerAddress) patch.sellerAddress = null; // legacy field migrated
    for (const k of ["paymentTermDays", "defaultTaxRate"]) {
      if (k in patch && patch[k] !== null) patch[k] = Number(String(patch[k]).replace(",", "."));
    }
    if (!Object.keys(patch).length) return toast.success("Nothing changed");
    setSaving(true);
    try {
      const r = await host.core.patch<ModuleInfo>(`/modules/${host.moduleKey}/settings`, patch);
      initial.current = { ...r.settings }; setV({ ...r.settings });
      toast.success("Invoice settings saved");
    } catch (e) { toast.error(errorMessage(e)); } finally { setSaving(false); }
  };

  const pickLogo = async (f: File | undefined) => {
    if (!f) return;
    try { const logo = await resizeLogo(f); setV((x) => ({ ...x, logo })); toast.success("Logo ready. Save to apply it."); }
    catch (e) { toast.error(errorMessage(e)); }
    finally { if (fileRef.current) fileRef.current.value = ""; }
  };

  return (
    <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <a href={host.href("/invoices")} onClick={(e) => { e.preventDefault(); host.navigate("/invoices"); }} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Invoices
      </a>
      <PageHeader
        className="mb-2"
        title="Invoice settings"
        description="Your details as they appear on every invoice. Finalized invoices keep the details they were issued with."
        actions={canManage && <Button type="submit" loading={saving}>Save settings</Button>}
      />
      {ro && <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">Only admins can change these settings.</p>}

      <Section title="Logo" description="Shown at the top of your invoices. PNG, JPG or WebP; we resize it for you.">
        <div className="flex flex-wrap items-center gap-4 sm:col-span-2">
          <div className="flex h-24 w-60 items-center justify-center rounded-md border border-dashed bg-muted/40 p-2">
            {v.logo ? <img src={String(v.logo)} alt="Your logo" className="max-h-full max-w-full object-contain" />
              : <span className="text-sm text-muted-foreground">No logo yet</span>}
          </div>
          {!ro && (
            <div className="flex gap-2">
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" aria-label="Upload logo"
                onChange={(e) => void pickLogo(e.target.files?.[0])} />
              <Button type="button" variant="outline" onClick={() => fileRef.current?.click()}><ImageUp /> {v.logo ? "Replace logo" : "Upload logo"}</Button>
              {v.logo && <Button type="button" variant="ghost" className="text-destructive" onClick={() => setV((x) => ({ ...x, logo: "" }))}><Trash2 /> Remove</Button>}
            </div>
          )}
        </div>
      </Section>

      <Section title="Your business" description="Who the invoice is from.">
        {text("sellerName", "Business name", { className: "sm:col-span-2", placeholder: host.tenant.name })}
        {text("sellerEmail", "Email", { type: "email" })}
        {text("sellerPhone", "Phone", { type: "tel", maxLength: 50 })}
        {text("sellerWebsite", "Website", { placeholder: "https://" })}
        {text("sellerTaxId", "VAT / tax ID", { maxLength: 50 })}
        {text("sellerRegistrationNumber", "Company registration no.", { maxLength: 50 })}
      </Section>

      <Section title="Address" description="Printed under your business name.">
        {text("sellerAddressLine1", "Address line 1", { className: "sm:col-span-2" })}
        {text("sellerAddressLine2", "Address line 2", { className: "sm:col-span-2" })}
        {text("sellerPostalCode", "Postal code", { maxLength: 20 })}
        {text("sellerCity", "City", { maxLength: 100 })}
        {text("sellerCountry", "Country", { maxLength: 100 })}
      </Section>

      <Section title="Getting paid" description="Where customers send the money. Shown in the payment box on each invoice.">
        {text("bankName", "Bank name", { maxLength: 100 })}
        {text("iban", "IBAN / account number", { maxLength: 50 })}
        {text("bic", "BIC / SWIFT", { maxLength: 20 })}
        <Field label="Payment instructions" className="sm:col-span-2" hint="Optional, e.g. “Please mention the invoice number with your payment.”">
          {(a) => <Textarea {...a} rows={2} value={str("paymentInstructions")} onChange={set("paymentInstructions")} maxLength={500} disabled={ro} />}
        </Field>
      </Section>

      <Section title="Defaults for new invoices" description="You can still change these on each invoice.">
        <Field label="Currency">{(a) => (
          <Select {...a} value={str("currency") || "EUR"} onChange={set("currency")} disabled={ro}>
            {[...new Set([str("currency") || "EUR", ...CURRENCIES])].map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
        )}</Field>
        <Field label="Payment terms (days)" hint="Due date = issue date + this many days.">
          {(a) => <Input {...a} type="number" min={0} max={365} value={str("paymentTermDays") || "30"} onChange={set("paymentTermDays")} disabled={ro} />}
        </Field>
        <Field label="Default tax rate (%)">
          {(a) => <Input {...a} type="number" min={0} max={100} step="any" value={str("defaultTaxRate") || "0"} onChange={set("defaultTaxRate")} disabled={ro} />}
        </Field>
        <Field label="Invoice number format" error={fmtError ?? undefined}
          hint={fmtError ? undefined : <>Next numbers look like <span className="font-mono">{formatNumber(fmt, new Date(), 1)}</span>. Tokens: {"{YYYY} {YY} {MM} {seq:5}"}</>}>
          {(a) => <Input {...a} className="font-mono" value={fmt} onChange={set("numberFormat")} maxLength={40} disabled={ro} />}
        </Field>
      </Section>

      <Section title="Footer" description="Small print at the bottom of every invoice, e.g. late-payment terms or a thank-you.">
        <Field label="Footer text" className="sm:col-span-2">
          {(a) => <Textarea {...a} rows={3} value={str("footer")} onChange={set("footer")} maxLength={500} disabled={ro} />}
        </Field>
      </Section>

      {canManage && <div className="flex justify-end"><Button type="submit" loading={saving}>Save settings</Button></div>}
    </form>
  );
}
