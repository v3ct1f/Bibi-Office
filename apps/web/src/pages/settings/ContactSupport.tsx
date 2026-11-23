import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { MailCheck } from "lucide-react";
import { Button, Card, CardContent, ErrorState, Field, Input, PageHeader } from "@office/ui";
import { request } from "../../api/client.ts";
import { useTenant } from "../../lib/tenant.tsx";

/** Owners and admins write to the operator here. Other people in the business ask their owner. */
export function ContactSupportPage() {
  const { tenant } = useTenant();
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const send = useMutation({
    mutationFn: () => request<{ ok: true }>("POST", "/contact", { body: { ...(subject.trim() ? { subject: subject.trim() } : {}), message }, tenantId: tenant.id }),
    onSuccess: () => { setSubject(""); setMessage(""); },
  });
  return (
    <>
      <PageHeader title="Contact support" description="Questions about Office, billing or your data. Only owners and admins can write here; your colleagues ask you, and you ask us. We reply by email." />
      <Card>
        <CardContent className="space-y-4 py-5">
          {send.isSuccess && (
            <p role="status" className="flex items-center gap-2 rounded-md border bg-muted/40 p-3 text-sm"><MailCheck className="size-4 text-primary" /> Message sent. We'll reply to your email address.</p>
          )}
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); send.mutate(); }}>
            <Field label="Subject (optional)">{(a) => <Input {...a} maxLength={150} value={subject} onChange={(e) => setSubject(e.target.value)} />}</Field>
            <Field label="Message">
              {(a) => <textarea {...a} required minLength={5} maxLength={5000} rows={6} value={message} onChange={(e) => setMessage(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm" />}
            </Field>
            {send.isError && <ErrorState error={send.error} />}
            <Button type="submit" loading={send.isPending}>Send message</Button>
          </form>
        </CardContent>
      </Card>
    </>
  );
}
