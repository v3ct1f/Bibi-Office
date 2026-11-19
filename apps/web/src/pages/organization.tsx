import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Card, CardContent, Field, Input, PageHeader, Select } from "@office/ui";
import { errorMessage, patch } from "../lib/api.ts";
import { useSession } from "../lib/session.tsx";

const zones = (): string[] => {
  try { return (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf("timeZone"); }
  catch { return ["UTC", "Europe/London", "Europe/Berlin", "America/New_York", "America/Los_Angeles", "Asia/Tokyo"]; }
};

/** Organization name and time zone (owner only; others see them read-only). */
export function OrganizationPage() {
  const s = useSession();
  const qc = useQueryClient();
  const t = s.tenant!;
  const canEdit = s.can("core:tenant.manage");
  const [name, setName] = useState(t.name), [tz, setTz] = useState(t.timeZone);
  const all = useMemo(() => { const z = zones(); return z.includes(tz) ? z : [tz, ...z]; }, [tz]);
  const browser = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const save = useMutation({ mutationFn: () => patch("/tenant", { name, timeZone: tz }), onSuccess: () => void qc.invalidateQueries() });
  const now = (() => { try { return new Date().toLocaleString(undefined, { timeZone: tz, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); } catch { return ""; } })();
  return (
    <>
      <PageHeader title="Organization" description="Name and calendar settings used across all modules." />
      <Card className="max-w-xl"><CardContent className="pt-5">
        <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
          {save.error && <Alert>{errorMessage(save.error)}</Alert>}
          {save.isSuccess && !save.isPending && <Alert tone="success">Saved.</Alert>}
          <Field label="Name">{(a) => <Input {...a} required maxLength={200} disabled={!canEdit} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
          <Field label="Time zone" hint={`Decides what "today" is: due and overdue dates, KPI periods, the {{today}} field. Now there: ${now}.`}>
            {(a) => <Select {...a} disabled={!canEdit} value={tz} onChange={(e) => setTz(e.target.value)}>{all.map((z) => <option key={z} value={z}>{z.replaceAll("_", " ")}</option>)}</Select>}
          </Field>
          {canEdit && tz !== browser && <Button type="button" variant="ghost" className="justify-self-start" onClick={() => setTz(browser)}>Use my time zone ({browser.replaceAll("_", " ")})</Button>}
          {canEdit ? <Button type="submit" className="justify-self-start" disabled={save.isPending || !name.trim()}>Save</Button>
            : <p className="text-sm text-muted">Only the owner can change these.</p>}
        </form>
      </CardContent></Card>
    </>
  );
}
