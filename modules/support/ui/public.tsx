import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Alert, Button, Card, CardContent, Field, Input, Spinner, Textarea } from "@office/ui";
import type { PublicPageProps } from "@office/sdk/ui";

function Frame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="min-h-dvh bg-bg">
      <div className="mx-auto grid max-w-xl gap-5 px-4 py-8 sm:py-12">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {children}
      </div>
    </main>
  );
}

/** /p/<tenant>/support/contact */
export function ContactPage({ api, tenantSlug, errorMessage }: PublicPageProps) {
  const info = useQuery({ queryKey: ["public", tenantSlug, "support", "form"], queryFn: () => api.get<{ title: string | null; teamName: string }>("/form"), retry: false });
  const [f, setF] = useState({ name: "", email: "", subject: "", message: "", website: "" });
  const send = useMutation({
    mutationFn: () => api.post<{ number: number; reference: string }>("/form", { name: f.name, email: f.email, subject: f.subject, message: f.message, ...(f.website ? { website: f.website } : {}) }),
  });
  if (info.isPending) return <Frame title="Contact us"><Spinner /></Frame>;
  if (info.isError) return <Frame title="Contact form unavailable"><Alert tone="warning">This contact form is not available.</Alert></Frame>;
  const title = info.data.title || `Contact ${info.data.teamName}`;
  if (send.isSuccess) {
    return (
      <Frame title="Thanks, we got your message">
        <Card><CardContent className="grid gap-2 pt-5">
          <p>Your reference is <span className="font-semibold tabular-nums">{send.data.reference}</span>.</p>
          <p className="text-sm text-muted">We sent a confirmation to {f.email}. Reply to that email to add anything.</p>
        </CardContent></Card>
      </Frame>
    );
  }
  return (
    <Frame title={title}>
      <p className="-mt-3 text-sm text-muted">Tell us what you need and we'll reply by email.</p>
      <Card><CardContent className="pt-5">
        <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); send.mutate(); }}>
          {send.error && <Alert>{errorMessage(send.error)}</Alert>}
          <Field label="Your name">{(a) => <Input {...a} required maxLength={200} autoComplete="name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
          <Field label="Email">{(a) => <Input {...a} type="email" required autoComplete="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />}</Field>
          <Field label="Subject">{(a) => <Input {...a} required maxLength={300} value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} />}</Field>
          <Field label="Message">{(a) => <Textarea {...a} required rows={6} maxLength={10000} value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} />}</Field>
          <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
            <label>Website<input tabIndex={-1} autoComplete="off" value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} /></label>
          </div>
          <Button type="submit" disabled={send.isPending}>{send.isPending ? "Sending…" : "Send message"}</Button>
        </form>
      </CardContent></Card>
    </Frame>
  );
}
