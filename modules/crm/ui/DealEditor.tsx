import { useEffect, useState, type ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { Button, Card, ErrorState, DatePicker, Field, Input, PageHeader, Select, Skeleton, Textarea, toast } from "@office/ui";
import { useModuleHost, type PageProps } from "@office/ui/module-ui";
import {
  centsToInput, CURRENCIES, CustomerPicker, errorMessage, parseMoney, useLoad, type Customer, type DealDetail, type Pipeline,
} from "./shared.tsx";

function Section({ n, title, description, children }: { n: number; title: string; description: string; children: ReactNode }) {
  return (
    <Card className="grid gap-4 p-5">
      <div className="flex items-start gap-3">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">{n}</span>
        <div className="grid gap-0.5"><h2 className="font-semibold leading-6">{title}</h2><p className="text-sm text-muted-foreground">{description}</p></div>
      </div>
      {children}
    </Card>
  );
}

export function DealEditor({ params }: PageProps) {
  const host = useModuleHost();
  const id = params.id;
  const data = useLoad(async () => {
    const [pipelines, config, deal] = await Promise.all([
      host.api.get<Pipeline[]>("/pipelines"),
      host.api.get<{ currency: string }>("/config"),
      id ? host.api.get<DealDetail>(`/deals/${id}`) : Promise.resolve(null),
    ]);
    return { pipelines, config, deal };
  }, [host, id]);

  const [title, setTitle] = useState("");
  const [value, setValue] = useState("");
  const [currency, setCurrency] = useState("EUR");
  const [company, setCompany] = useState<Customer | null>(null);
  const [contact, setContact] = useState<Customer | null>(null);
  const [pipelineId, setPipelineId] = useState("");
  const [stageId, setStageId] = useState("");
  const [expectedClose, setExpectedClose] = useState("");
  const [nextStep, setNextStep] = useState("");
  const [nextStepDate, setNextStepDate] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!data.data) return;
    const { deal, config, pipelines } = data.data;
    if (deal) {
      setTitle(deal.title); setValue(deal.valueCents ? centsToInput(deal.valueCents) : ""); setCurrency(deal.currency);
      setCompany(deal.companyId ? { kind: "company", id: deal.companyId, label: deal.companyName ?? "Company" } : null);
      setContact(deal.contactId ? { kind: "contact", id: deal.contactId, label: deal.contactName ?? "Contact" } : null);
      setPipelineId(deal.pipelineId); setStageId(deal.stageId);
      setExpectedClose(deal.expectedClose ?? ""); setNextStep(deal.nextStep ?? ""); setNextStepDate(deal.nextStepDate ?? ""); setNotes(deal.notes ?? "");
      return;
    }
    setCurrency(config.currency);
    const sp = new URLSearchParams(window.location.search);
    const p = pipelines.find((x) => x.id === sp.get("pipeline")) ?? pipelines[0];
    if (p) { setPipelineId(p.id); setStageId(p.stages.find((s) => s.kind === "open")?.id ?? ""); }
    // Prefill from a company / contact page ("New deal" on their Deals tab).
    const companyId = sp.get("companyId"), contactId = sp.get("contactId");
    if (companyId) void host.core.get<{ id: string; name: string }>(`/companies/${companyId}`).then((c) => setCompany({ kind: "company", id: c.id, label: c.name })).catch(() => {});
    if (contactId) {
      void host.core.get<{ id: string; firstName: string | null; lastName: string | null; email: string | null }>(`/contacts/${contactId}`)
        .then((c) => setContact({ kind: "contact", id: c.id, label: [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email || "Contact" })).catch(() => {});
    }
  }, [data.data, host]);

  if (data.loading && !data.data) return <><Skeleton className="h-8 w-56" /><Skeleton className="mt-6 h-96" /></>;
  if (data.error || !data.data) return <ErrorState error={data.error} onRetry={() => void data.reload()} />;
  const { pipelines, deal } = data.data;
  const pipeline = pipelines.find((p) => p.id === pipelineId);
  const cents = parseMoney(value);

  const pickContact = async (c: Customer | null) => {
    setContact(c);
    // A contact that works at a company: fill in the company too.
    if (c?.companyId && !company) {
      try { const co = await host.core.get<{ id: string; name: string }>(`/companies/${c.companyId}`); setCompany({ kind: "company", id: co.id, label: co.name }); } catch { /* no access */ }
    }
  };

  const save = async () => {
    if (!title.trim()) return toast.error("Give the deal a name");
    if (cents === null) return toast.error("Value must be an amount like 1500 or 1500.00");
    const body: Record<string, unknown> = {
      title: title.trim(), valueCents: cents, currency, companyId: company?.id ?? null, contactId: contact?.id ?? null,
      expectedClose: expectedClose || null, nextStep: nextStep.trim() || null, nextStepDate: nextStepDate || null, notes: notes.trim() || null,
    };
    setSaving(true);
    try {
      if (deal) {
        await host.api.patch(`/deals/${deal.id}`, body);
        toast.success("Deal saved");
        host.navigate(`/deals/${deal.id}`);
      } else {
        const r = await host.api.post<DealDetail>("/deals", { ...body, pipelineId, stageId });
        toast.success("Deal added");
        host.navigate(`/deals/${r.id}`);
      }
    } catch (e) { toast.error(errorMessage(e)); } finally { setSaving(false); }
  };
  const back = deal ? `/deals/${deal.id}` : "/deals";

  return (
    <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <a href={host.href(back)} onClick={(e) => { e.preventDefault(); host.navigate(back); }} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> {deal ? deal.title : "Deals"}
      </a>
      <PageHeader className="mb-2" title={deal ? "Edit deal" : "New deal"}
        description={deal ? undefined : "A deal is a sale you're working on. Only the name is required; fill in the rest as you learn more."}
        actions={<Button type="submit" loading={saving}>{deal ? "Save deal" : "Add deal"}</Button>} />

      <Section n={1} title="What are you selling, and to whom?" description="Link a company and/or a person so the deal shows up on their page.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Deal name" className="sm:col-span-2" hint="e.g. “Website redesign” or “Annual support contract”">
            {(a) => <Input {...a} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} required autoFocus={!deal} />}
          </Field>
          <Field label="Company">{() => <CustomerPicker kind="company" label="Company search" value={company} onChange={setCompany} />}</Field>
          <Field label="Contact person">{() => <CustomerPicker kind="contact" label="Contact search" value={contact} onChange={(c) => void pickContact(c)} />}</Field>
        </div>
      </Section>

      <Section n={2} title="Value and stage" description="Rough numbers are fine. The value feeds your pipeline totals and forecast.">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Value" error={cents === null ? "Enter an amount like 1500.00" : undefined}>
            {(a) => <Input {...a} inputMode="decimal" placeholder="0.00" value={value} onChange={(e) => setValue(e.target.value)} />}
          </Field>
          <Field label="Currency">{(a) => (
            <Select {...a} value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {[...new Set([currency, ...CURRENCIES])].map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          )}</Field>
          {!deal && pipelines.length > 1 && (
            <Field label="Pipeline">{(a) => (
              <Select {...a} value={pipelineId} onChange={(e) => {
                setPipelineId(e.target.value);
                setStageId(pipelines.find((p) => p.id === e.target.value)?.stages.find((s) => s.kind === "open")?.id ?? "");
              }}>
                {pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            )}</Field>
          )}
          {!deal && pipeline && (
            <Field label="Stage">{(a) => (
              <Select {...a} value={stageId} onChange={(e) => setStageId(e.target.value)}>
                {pipeline.stages.filter((s) => s.kind === "open").map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            )}</Field>
          )}
          <Field label="Expected close date" hint="When you hope to win it.">
            {(a) => <DatePicker {...a} value={expectedClose} onChange={(iso) => setExpectedClose(iso)} />}
          </Field>
        </div>
      </Section>

      <Section n={3} title="What happens next?" description="Every open deal should have a next step, so nothing goes quiet. Overdue next steps are shown in red on the board.">
        <div className="grid gap-4 sm:grid-cols-[1fr_12rem]">
          <Field label="Next step" hint="e.g. “Send proposal” or “Follow-up call”">
            {(a) => <Input {...a} value={nextStep} onChange={(e) => setNextStep(e.target.value)} maxLength={300} />}
          </Field>
          <Field label="Next step date">{(a) => <DatePicker {...a} value={nextStepDate} onChange={(iso) => setNextStepDate(iso)} />}</Field>
          <Field label="Notes" className="sm:col-span-2" hint="Background, requirements, who decides. Log calls and meetings on the deal page.">
            {(a) => <Textarea {...a} rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={10_000} />}
          </Field>
        </div>
      </Section>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => host.navigate(back)}>Cancel</Button>
        <Button type="submit" loading={saving}>{deal ? "Save deal" : "Add deal"}</Button>
      </div>
    </form>
  );
}
