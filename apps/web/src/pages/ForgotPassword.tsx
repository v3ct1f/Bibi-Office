import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { KeyRound, MailCheck } from "lucide-react";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, ErrorState, Field, Input } from "@office/ui";
import { request } from "../api/client.ts";
import { FullPage } from "./auth.tsx";

/** Public: asks for a one-time "set your password" link by email (forgotten password, or never set one). */
export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const send = useMutation({
    mutationFn: () => request<{ ok: true; available: boolean }>("POST", "/auth/forgot-password", { body: { email }, anonymous: true }),
  });
  return (
    <FullPage>
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          {send.isSuccess ? <MailCheck className="mb-2 size-10 text-primary" /> : <KeyRound className="mb-2 size-10 text-primary" />}
          <CardTitle className="text-lg">{send.isSuccess ? "Check your email" : "Set or reset your password"}</CardTitle>
          <CardDescription>
            {send.isSuccess
              ? send.data.available
                ? `If ${email} has access to Office, a link to set your password is on its way. It works once, for 7 days.`
                : "Email isn't set up on this server, so no link could be sent. Ask the person who runs Office."
              : "Enter your email address and we'll send you a link to choose a password."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!send.isSuccess && (
            <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); send.mutate(); }}>
              <Field label="Email">
                {(a) => <Input {...a} type="email" required autoComplete="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />}
              </Field>
              {send.isError && <ErrorState error={send.error} />}
              <Button className="w-full" type="submit" loading={send.isPending}>Send me a link</Button>
            </form>
          )}
          <Button asChild variant="ghost" className="w-full"><Link to="/">Back to sign in</Link></Button>
        </CardContent>
      </Card>
    </FullPage>
  );
}
