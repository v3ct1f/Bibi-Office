import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Button, Card, ErrorState, DatePicker, Field, Input, PageHeader, Select, Skeleton, Textarea, toast } from "@office/ui";
import { useModuleHost, type PageProps } from "@office/ui/module-ui";
import { CURRENCIES, errorMessage, parseMoney, SOURCES, useLoad, type LeadDetail, type Person, type Source } from "./shared.tsx";

export function LeadEditor({ params }: PageProps) {
  const host = useModuleHost();
  const id = params.id;
  const data = useLoad(async () => {
    const [config, people, lead] = await Promise.all([
      host.api.get<{ currency: string }>("/config"),
      host.api.get<Person[]>("/people").catch(() => [] as Person[]),
      id ? host.api.get<LeadDetail>(`/leads/${id}`) : Promise.resolve(null),
    ]);
    return { config, people, lead };
  }, [host, id]);

  const [f, setF] = useState({
    firstName: "", lastName: "", email: "", phone: "", companyName: "", jobTitle: "", source: "manual" as Source,
    ownerId: "", value: "", currency: "EUR", followUpOn: "", notes: "",
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!data.data) return;
    const { lead, config } = data.data;
    if (lead) {
      setF({
        firstName: lead.firstName ?? "", lastName: lead.lastName ?? "", email: lead.email ?? "", phone: lead.phone ?? "",
        companyName: lead.companyName ?? "", jobTitle: lead.jobTitle ?? "", source: lead.source, ownerId: lead.ownerId ?? "",
        value: lead.valueCents ? (lead.valueCents / 100).toFixed(2) : "", currency: lead.currency, followUpOn: lead.followUpOn ?? "", notes: lead.notes ?? "",
      });
    } else setF((x) => ({ ...x, currency: config.currency }));
  }, [data.data]);

  if (data.loading && !data.data) return <><Skeleton className="h-8 w-56" /><Skeleton className="mt-6 h-96" /></>;
  if (data.error || !data.data) return <ErrorState error={data.error} onRetry={() => void data.reload()} />;
  const { lead, people } = data.data;
  const cents = parseMoney(f.value);
  const back = lead ? `/leads/${lead.id}` : "/leads";

  const save = async () => {
    if (![f.firstName, f.lastName, f.email, f.phone, f.companyName].some((v) => v.trim())) return toast.error("Add at least a name, an email, a phone number or a company");
    if (cents === null) return toast.error("Value must be an amount like 1500 or 1500.00");
    const body: Record<string, unknown> = {
      firstName: f.firstName.trim() || null, lastName: f.lastName.trim() || null, email: f.email.trim() || null, phone: f.phone.trim() || null,
      companyName: f.companyName.trim() || null, jobTitle: f.jobTitle.trim() || null, source: f.source,
      valueCents: cents, currency: f.currency, followUpOn: f.followUpOn || null, notes: f.notes.trim() || null,
      ...(lead || f.ownerId ? { ownerId: f.ownerId || null } : {}),
    };
    setSaving(true);
    try {
      if (lead) {
        await host.api.patch(`/leads/${lead.id}`, body);
        toast.success("Lead saved");
        host.navigate(`/leads/${lead.id}`);
      } else {
        const r = await host.api.post<LeadDetail>("/leads", body);
        toast.success("Lead added");
        host.navigate(`/leads/${r.id}`);
      }
    } catch (e) { toast.error(errorMessage(e)); } finally { setSaving(false); }
  };

  return (
    <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <a href={host.href(back)} onClick={(e) => { e.preventDefault(); host.navigate(back); }} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> {lead ? lead.name : "Leads"}
      </a>
      <PageHeader className="mb-2" title={lead ? "Edit lead" : "New lead"}
        description={lead ? undefined : "Someone who might buy from you. A name, an email, a phone number or a company is enough to start."}
        actions={<Button type="submit" loading={saving}>{lead ? "Save lead" : "Add lead"}</Button>} />

      <Card className="grid gap-4 p-5">
        <h2 className="font-semibold">Who is it?</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="First name">{(a) => <Input {...a} value={f.firstName} onChange={set("firstName")} maxLength={200} autoFocus={!lead} />}</Field>
          <Field label="Last name">{(a) => <Input {...a} value={f.lastName} onChange={set("lastName")} maxLength={200} />}</Field>
          <Field label="Email">{(a) => <Input {...a} type="email" value={f.email} onChange={set("email")} maxLength={320} />}</Field>
          <Field label="Phone">{(a) => <Input {...a} type="tel" value={f.phone} onChange={set("phone")} maxLength={50} />}</Field>
          <Field label="Company" hint="Becomes a company when you convert the lead.">{(a) => <Input {...a} value={f.companyName} onChange={set("companyName")} maxLength={300} />}</Field>
          <Field label="Job title">{(a) => <Input {...a} value={f.jobTitle} onChange={set("jobTitle")} maxLength={200} />}</Field>
        </div>
      </Card>

      <Card className="grid gap-4 p-5">
        <h2 className="font-semibold">Follow-up</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Where they came from">{(a) => (
            <Select {...a} value={f.source} onChange={set("source")}>
              {SOURCES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          )}</Field>
          <Field label="Owner" hint="Who follows up.">{(a) => (
            <Select {...a} value={f.ownerId} onChange={set("ownerId")}>
              <option value="">{lead ? "Unassigned" : "Me"}</option>
              {people.map((p) => <option key={p.userId} value={p.userId}>{p.name}</option>)}
            </Select>
          )}</Field>
          <Field label="Follow up on">{(a) => <DatePicker {...a} value={f.followUpOn} onChange={(iso) => setF((x) => ({ ...x, followUpOn: iso }))} />}</Field>
          <div className="grid grid-cols-[1fr_6rem] gap-2">
            <Field label="Possible value" error={cents === null ? "Enter an amount like 1500.00" : undefined}>
              {(a) => <Input {...a} inputMode="decimal" placeholder="0.00" value={f.value} onChange={set("value")} />}
            </Field>
            <Field label="Currency">{(a) => (
              <Select {...a} value={f.currency} onChange={set("currency")}>
                {[...new Set([f.currency, ...CURRENCIES])].map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
            )}</Field>
          </div>
          <Field label="Notes" className="sm:col-span-2 lg:col-span-4" hint="What they need, how you met. Log calls and emails on the lead page.">
            {(a) => <Textarea {...a} rows={4} value={f.notes} onChange={set("notes")} maxLength={10_000} />}
          </Field>
        </div>
      </Card>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => host.navigate(back)}>Cancel</Button>
        <Button type="submit" loading={saving}>{lead ? "Save lead" : "Add lead"}</Button>
      </div>
    </form>
  );
}
