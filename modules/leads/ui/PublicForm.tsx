import { useEffect, useState } from "react";
import { CircleCheck, MessageSquare } from "lucide-react";
import { Button, Card, EmptyState, Field, Input, Skeleton, Textarea } from "@office/ui";
import type { PublicPageProps } from "@office/ui/module-ui";
import { errorMessage } from "./shared.tsx";

interface View { heading: string; intro: string | null; askPhone: boolean; askCompany: boolean }

/** The public "contact us" page (no sign-in). What people send becomes a lead. */
export function PublicForm({ params, api }: PublicPageProps) {
  const token = params.token!;
  const [view, setView] = useState<View | null>(null);
  const [missing, setMissing] = useState(false);
  const [v, setV] = useState({ name: "", email: "", phone: "", company: "", message: "", website: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [thanks, setThanks] = useState<string | null>(null);
  useEffect(() => { api.get<View>(`/form/${token}`).then(setView, () => setMissing(true)); }, [api, token]);
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: e.target.value }));

  return (
    <div className="grid min-h-screen place-items-center bg-muted/40 p-4">
      <Card className="w-full max-w-lg p-6">
        {missing ? <EmptyState title="This form isn't available" description="The link may have changed. Please contact the business another way." />
          : !view ? <Skeleton className="h-80" />
          : thanks ? (
            <div role="status" className="grid justify-items-center gap-3 py-6 text-center">
              <CircleCheck className="size-10 text-success" />
              <p className="whitespace-pre-wrap text-lg font-medium">{thanks}</p>
            </div>
          ) : (
            <form className="grid gap-4" onSubmit={async (e) => {
              e.preventDefault(); setBusy(true); setError(null);
              try {
                const r = await api.post<{ thanks: string }>(`/form/${token}`, {
                  name: v.name.trim(), email: v.email.trim(), message: v.message.trim() || undefined,
                  ...(view.askPhone && v.phone.trim() ? { phone: v.phone.trim() } : {}),
                  ...(view.askCompany && v.company.trim() ? { company: v.company.trim() } : {}),
                  ...(v.website ? { website: v.website } : {}),
                });
                setThanks(r.thanks);
              } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
            }}>
              <div className="flex items-start gap-3">
                <MessageSquare className="mt-1 size-6 shrink-0 text-primary" />
                <div><h1 className="text-xl font-semibold">{view.heading}</h1>{view.intro && <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{view.intro}</p>}</div>
              </div>
              <Field label="Your name">{(a) => <Input {...a} required maxLength={200} autoComplete="name" value={v.name} onChange={set("name")} />}</Field>
              <Field label="Email">{(a) => <Input {...a} type="email" required maxLength={320} autoComplete="email" value={v.email} onChange={set("email")} />}</Field>
              {view.askPhone && <Field label="Phone (optional)">{(a) => <Input {...a} type="tel" maxLength={50} autoComplete="tel" value={v.phone} onChange={set("phone")} />}</Field>}
              {view.askCompany && <Field label="Company (optional)">{(a) => <Input {...a} maxLength={300} autoComplete="organization" value={v.company} onChange={set("company")} />}</Field>}
              <Field label="How can we help?">{(a) => <Textarea {...a} rows={4} maxLength={5000} value={v.message} onChange={set("message")} />}</Field>
              {/* Honeypot: people never see it; bots fill it in. */}
              <div aria-hidden="true" className="absolute -left-[9999px] h-0 overflow-hidden">
                <label>Website <input tabIndex={-1} autoComplete="off" name="website" value={v.website} onChange={set("website")} /></label>
              </div>
              {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
              <Button type="submit" loading={busy}>Send</Button>
              <p className="text-xs text-muted-foreground">Your details are only used to get back to you.</p>
            </form>
          )}
      </Card>
    </div>
  );
}
