import { useNavigate, useParams } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, MailWarning, UserPlus } from "lucide-react";
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, ErrorState } from "@office/ui";
import { errorMessage, request } from "../api/client.ts";
import { useAuth } from "../auth/auth.tsx";
import { FullPage, Loading, rememberTenant } from "./auth.tsx";

interface InvitationView {
  tenant: { id: string; name: string; slug: string };
  invitedBy: string | null; email: string; roles: string[]; expiresAt: string;
  status: "open" | "accepted" | "withdrawn" | "expired";
  yourEmail: string; emailMatches: boolean; alreadyMember: boolean;
}

const CLOSED: Record<Exclude<InvitationView["status"], "open">, string> = {
  accepted: "This invitation has already been used.",
  withdrawn: "This invitation was withdrawn. Ask the person who invited you for a new one.",
  expired: "This invitation has expired. Ask the person who invited you for a new one.",
};

/** /invite/:tenantId/:token — the invited person (signed in) looks at an invitation and accepts it. */
export function InvitePage() {
  const { tenantId, token } = useParams({ strict: false }) as { tenantId: string; token: string };
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const ref = { tenantId, token };
  const view = useQuery({
    queryKey: ["invitation", tenantId, token], retry: false,
    queryFn: () => request<InvitationView>("POST", "/invitations/view", { body: ref }),
  });
  const accept = useMutation({
    mutationFn: () => request<{ slug: string }>("POST", "/invitations/accept", { body: ref }),
    onSuccess: async (r) => { await qc.invalidateQueries({ queryKey: ["me"] }); rememberTenant(r.slug); navigate({ to: "/t/$slug", params: { slug: r.slug }, replace: true }); },
  });
  const go = (slug: string) => navigate({ to: "/t/$slug", params: { slug } });

  if (view.isPending) return <Loading />;
  if (view.isError) {
    return (
      <FullPage><Card className="w-full max-w-md">
        <ErrorState title="This invitation link doesn't work" error={view.error} onRetry={() => view.refetch()} />
      </Card></FullPage>
    );
  }
  const v = view.data;
  const done = v.alreadyMember;
  return (
    <FullPage>
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="mb-2 grid size-10 place-items-center rounded-lg bg-secondary text-secondary-foreground"><UserPlus className="size-5" /></div>
          <CardTitle className="text-lg">Join {v.tenant.name}</CardTitle>
          <CardDescription>
            {v.invitedBy ? `${v.invitedBy} invited ${v.email}` : `${v.email} was invited`} to this workspace.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {!!v.roles.length && (
            <div className="flex flex-wrap items-center gap-1.5 text-sm"><span className="text-muted-foreground">Role:</span>{v.roles.map((r) => <Badge key={r} variant="neutral">{r}</Badge>)}</div>
          )}
          {done ? (
            <>
              <p className="flex items-center gap-2 text-sm"><Check className="size-4 text-success" /> You're a member of {v.tenant.name}.</p>
              <Button onClick={() => go(v.tenant.slug)}>Open {v.tenant.name}</Button>
            </>
          ) : v.status !== "open" ? (
            <p role="status" className="text-sm text-muted-foreground">{CLOSED[v.status]}</p>
          ) : !v.emailMatches ? (
            <>
              <div role="alert" className="flex gap-2 rounded-md border border-warning/50 bg-warning/10 p-3 text-sm">
                <MailWarning className="mt-0.5 size-4 shrink-0" />
                <span>This invitation is for <strong>{v.email}</strong>, but you're signed in as <strong>{v.yourEmail}</strong>. Sign out, then open the link again and sign in with {v.email}.</span>
              </div>
              <Button variant="outline" onClick={() => void signOut()}>Sign out</Button>
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">You'll be able to see and work with this company's data, as far as your role allows.</p>
              {accept.isError && <p role="alert" className="text-sm text-destructive">{errorMessage(accept.error)}</p>}
              <Button size="lg" loading={accept.isPending} onClick={() => accept.mutate()}>Accept and join</Button>
            </>
          )}
        </CardContent>
      </Card>
    </FullPage>
  );
}
