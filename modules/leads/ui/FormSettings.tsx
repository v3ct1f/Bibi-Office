import { useEffect, useState } from "react";
import { ExternalLink, Globe, RefreshCw } from "lucide-react";
import { Button, Card, Checkbox, ConfirmDialog, CopyField, ErrorState, Field, Input, PageHeader, Skeleton, Switch, Textarea, toast } from "@office/ui";
import { useModuleHost, type PageProps } from "@office/ui/module-ui";
import { errorMessage, useLoad } from "./shared.tsx";

interface Form { enabled: boolean; token: string; heading: string; intro: string | null; thanks: string; askPhone: boolean; askCompany: boolean; path: string }

/** Settings → Web form: a public "contact us" page whose submissions become leads. */
export function FormSettings(_: PageProps) {
  const host = useModuleHost();
  const canManage = host.can("leads:form.manage");
  const form = useLoad(() => host.api.get<Form>("/form"), [host]);
  const [d, setD] = useState({ heading: "", intro: "", thanks: "", askPhone: true, askCompany: true });
  const [saving, setSaving] = useState(false);
  const [replacing, setReplacing] = useState(false);
  useEffect(() => {
    const f = form.data;
    if (f) setD({ heading: f.heading, intro: f.intro ?? "", thanks: f.thanks, askPhone: f.askPhone, askCompany: f.askCompany });
  }, [form.data]);

  if (form.loading && !form.data) return <><Skeleton className="h-8 w-56" /><Skeleton className="mt-6 h-72" /></>;
  if (form.error || !form.data) return <ErrorState error={form.error} onRetry={() => void form.reload()} />;
  const f = form.data;
  const url = `${window.location.origin}${f.path}`;

  const patch = async (body: Partial<Form>, msg: string) => {
    try { form.set(await host.api.patch<Form>("/form", body)); toast.success(msg); }
    catch (e) { toast.error(errorMessage(e)); }
  };

  return (
    <>
      <PageHeader title="Web form" description="A simple page where people can leave their details. Each message becomes a new lead (or a note on their open lead)." />
      <Card className="mb-4 grid gap-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Globe className="size-5 text-primary" />
            <div>
              <p className="font-semibold">{f.enabled ? "The form is on" : "The form is off"}</p>
              <p className="text-sm text-muted-foreground">{f.enabled ? "Anyone with the link can send you their details." : "Turn it on to get a link you can put on your website or share."}</p>
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={f.enabled} disabled={!canManage} aria-label="Form on" onCheckedChange={(v) => void patch({ enabled: v }, v ? "The form is on" : "The form is off")} />
            {f.enabled ? "On" : "Off"}
          </label>
        </div>
        {f.enabled && (
          <div className="grid gap-2">
            <p className="text-sm font-medium">Link to the form</p>
            <CopyField value={url} label="Copy link" />
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline" size="sm"><a href={url} target="_blank" rel="noreferrer"><ExternalLink /> Open the form</a></Button>
              {canManage && <Button variant="ghost" size="sm" onClick={() => setReplacing(true)}><RefreshCw /> Get a new link</Button>}
            </div>
          </div>
        )}
      </Card>

      <Card className="grid gap-4 p-5">
        <h2 className="font-semibold">What the form says</h2>
        <form className="grid gap-4" onSubmit={async (e) => {
          e.preventDefault(); setSaving(true);
          await patch({ heading: d.heading.trim(), intro: d.intro.trim() || null, thanks: d.thanks.trim(), askPhone: d.askPhone, askCompany: d.askCompany }, "Form saved");
          setSaving(false);
        }}>
          <Field label="Heading">{(a) => <Input {...a} required maxLength={200} disabled={!canManage} value={d.heading} onChange={(e) => setD({ ...d, heading: e.target.value })} />}</Field>
          <Field label="Intro" hint="Shown under the heading.">{(a) => <Textarea {...a} rows={2} maxLength={1000} disabled={!canManage} value={d.intro} onChange={(e) => setD({ ...d, intro: e.target.value })} />}</Field>
          <Field label="Thank-you message" hint="Shown after someone sends the form.">{(a) => <Textarea {...a} rows={2} required maxLength={1000} disabled={!canManage} value={d.thanks} onChange={(e) => setD({ ...d, thanks: e.target.value })} />}</Field>
          <div className="grid gap-2 text-sm">
            <p className="font-medium">Fields</p>
            <p className="text-muted-foreground">Name, email and message are always asked.</p>
            <label className="flex items-center gap-2"><Checkbox disabled={!canManage} checked={d.askPhone} onCheckedChange={(v) => setD({ ...d, askPhone: v === true })} /> Ask for a phone number</label>
            <label className="flex items-center gap-2"><Checkbox disabled={!canManage} checked={d.askCompany} onCheckedChange={(v) => setD({ ...d, askCompany: v === true })} /> Ask for a company</label>
          </div>
          {canManage && <Button type="submit" className="justify-self-end" loading={saving}>Save form</Button>}
        </form>
      </Card>

      <ConfirmDialog open={replacing} onOpenChange={setReplacing} confirmLabel="Get a new link"
        title="Replace the form link?" description="The current link stops working right away, so update it wherever you've put it (for example on your website). Useful if the form gets spam."
        onConfirm={async () => {
          try { form.set(await host.api.post<Form>("/form/replace-link", {})); toast.success("New link ready"); }
          catch (e) { toast.error(errorMessage(e)); throw e; }
        }} />
    </>
  );
}
