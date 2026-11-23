import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { MailCheck, MessageSquare } from "lucide-react";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, ErrorState, Field, Input } from "@office/ui";
import { request } from "../api/client.ts";
import { COMPANY } from "../legal/company.ts";
import { FullPage } from "./auth.tsx";

/** Public contact form: messages go to the operator's email address; the sender's address is the reply-to. */
export function ContactPage() {
  const cfg = useQuery({ queryKey: ["contact-config"], queryFn: () => request<{ open: boolean }>("GET", "/contact/config", { anonymous: true }) });
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [website, setWebsite] = useState(""); // hidden; only bots fill it in
  const send = useMutation({
    mutationFn: () => request<{ ok: true }>("POST", "/contact", { body: { name, email, message, ...(website ? { website } : {}) }, anonymous: true }),
  });
  const closed = cfg.data && !cfg.data.open;
  return (
    <FullPage>
      <Card className="w-full max-w-md">
        <CardHeader className="items-center text-center">
          {send.isSuccess ? <MailCheck className="mb-2 size-10 text-primary" /> : <MessageSquare className="mb-2 size-10 text-primary" />}
          <CardTitle className="text-lg">{send.isSuccess ? "Message sent" : "Contact us"}</CardTitle>
          <CardDescription>
            {send.isSuccess ? "Thank you. We'll reply to the email address you gave."
              : closed ? `The form isn't available right now. Please email ${COMPANY.email}.`
              : `Questions, support or privacy requests. You can also email ${COMPANY.email}.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!send.isSuccess && !closed && (
            <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); send.mutate(); }}>
              <Field label="Your name">{(a) => <Input {...a} required maxLength={200} autoFocus value={name} onChange={(e) => setName(e.target.value)} />}</Field>
              <Field label="Your email">{(a) => <Input {...a} type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
              <Field label="Message">
                {(a) => <textarea {...a} required minLength={5} maxLength={5000} rows={5} value={message} onChange={(e) => setMessage(e.target.value)}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm" />}
              </Field>
              <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
                <label>Leave this empty<input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} /></label>
              </div>
              {send.isError && <ErrorState error={send.error} />}
              <Button className="w-full" type="submit" loading={send.isPending}>Send message</Button>
            </form>
          )}
          <Button asChild variant="ghost" className="w-full"><Link to="/">Back to sign in</Link></Button>
        </CardContent>
      </Card>
    </FullPage>
  );
}
