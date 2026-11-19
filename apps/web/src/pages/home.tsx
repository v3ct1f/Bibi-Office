import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Card, CardContent, Field, Input, PageHeader, Spinner } from "@office/ui";
import { auth } from "../lib/auth.ts";
import { errorMessage, post, tenantStore } from "../lib/api.ts";
import { useSession } from "../lib/session.tsx";
import { resolveSlots } from "../modules/slot.tsx";
import { Hosted } from "../modules/host.tsx";
import { Link } from "@tanstack/react-router";

export function HomePage() {
  const s = useSession();
  const widgets = resolveSlots("dashboard.widget", s.modules, s.permissions);
  const enabled = s.modules.filter((m) => m.enabled);
  return (
    <>
      <PageHeader title={s.tenant?.name ?? "Office"} description="Your workspace at a glance." />
      {widgets.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {widgets.map((w, i) => <Hosted key={i} module={w.module} Component={w.Component} />)}
        </div>
      ) : (
        <Card><CardContent className="grid gap-2 text-sm">
          <p>{enabled.length ? `${enabled.length} module(s) enabled.` : "No modules enabled yet."}</p>
          {s.can("core:modules.manage") && <p><Link className="text-primary underline" to="/admin/modules">Choose modules</Link> to add invoicing, CRM, scheduling and more.</p>}
        </CardContent></Card>
      )}
    </>
  );
}

const slugify = (v: string) => v.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

export function CreateTenantPage({ first }: { first?: boolean }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [touched, setTouched] = useState(false);
  const [err, setErr] = useState<string>();
  const [busy, setBusy] = useState(false);
  return (
    <div className="mx-auto grid max-w-md gap-6 px-4 py-16">
      <PageHeader title={first ? "Create your organization" : "New organization"} description="Each organization has its own data, members and modules." />
      <form className="grid gap-4" onSubmit={async (e) => {
        e.preventDefault(); setBusy(true); setErr(undefined);
        try {
          const t = await post<{ id: string }>("/tenants", { name, slug });
          tenantStore.set(t.id);
          await qc.invalidateQueries();
          window.location.assign("/");
        } catch (x) { setErr(errorMessage(x)); } finally { setBusy(false); }
      }}>
        {err && <Alert>{err}</Alert>}
        <Field label="Name">{(a) => <Input {...a} required value={name} onChange={(e) => { setName(e.target.value); if (!touched) setSlug(slugify(e.target.value)); }} />}</Field>
        <Field label="URL name" hint="Lowercase letters, numbers and dashes.">
          {(a) => <Input {...a} required pattern="[a-z0-9][a-z0-9\-]{1,38}[a-z0-9]" value={slug} onChange={(e) => { setTouched(true); setSlug(e.target.value); }} />}
        </Field>
        <Button type="submit" disabled={busy}>Create</Button>
      </form>
    </div>
  );
}

export function AuthCallbackPage() {
  const nav = useNavigate();
  const [err, setErr] = useState<string>();
  useEffect(() => { auth.callback().then((to) => nav({ to, replace: true }), (e) => setErr(errorMessage(e))); }, [nav]);
  return <div className="p-8">{err ? <Alert>Sign-in failed: {err}</Alert> : <Spinner label="Signing in" />}</div>;
}
