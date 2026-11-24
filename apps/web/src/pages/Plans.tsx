import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { FlaskConical } from "lucide-react";
import { Button, Card, CardContent, ErrorState, Skeleton } from "@office/ui";
import { request } from "../api/client.ts";
import { COMPANY } from "../legal/company.ts";
import { IntervalToggle, PlanCards, type Interval, type PlanInfo } from "./PlanCards.tsx";

export interface PlansResponse { testMode: boolean; plans: PlanInfo[] }
export const usePublicPlans = () => useQuery({ queryKey: ["public-plans"], queryFn: () => request<PlansResponse>("GET", "/plans", { anonymous: true }) });

/** Public landing page: what each plan costs and includes. Anyone can open it; choosing a plan starts the sign-up. */
export function PlansPage() {
  const q = usePublicPlans();
  const [interval, setInterval] = useState<Interval>("monthly");
  const navigate = useNavigate();
  const allFeatures = q.data?.plans.at(-1)?.features ?? [];
  const minPlan = (key: string) => q.data?.plans.find((p) => p.features.some((f) => f.key === key))?.name;

  return (
    <div className="min-h-screen bg-muted/40">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
        <Link to="/plans" className="flex items-center gap-2 font-semibold"><img src="/favicon.svg" alt="" className="size-7" /> Bibi Office</Link>
        <Button asChild variant="ghost" size="sm"><Link to="/">Sign in</Link></Button>
      </header>

      <main className="mx-auto grid max-w-6xl gap-10 px-4 pb-16 pt-6">
        <section className="mx-auto grid max-w-2xl gap-3 text-center">
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Your whole back office, in one place</h1>
          <p className="text-muted-foreground">
            Invoices, sales, expenses, staff schedules, stock, documents to sign and more, all working together. Pick the plan that fits your team and start today.
          </p>
          <div className="pt-2"><IntervalToggle value={interval} onChange={setInterval} /></div>
        </section>

        {q.data?.testMode && (
          <p role="note" className="mx-auto flex max-w-2xl items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
            <FlaskConical className="size-4 shrink-0 text-primary" />
            <span><strong>Free to try.</strong> Choose a plan, no card needed and nothing is charged. We'll email you the link to open your account.</span>
          </p>
        )}

        {q.isPending ? <div className="grid gap-4 lg:grid-cols-3"><Skeleton className="h-96" /><Skeleton className="h-96" /><Skeleton className="h-96" /></div>
          : q.isError ? <Card><ErrorState error={q.error} onRetry={() => void q.refetch()} /></Card>
          : (
            <PlanCards
              plans={q.data.plans} interval={interval} highlight="business"
              action={(p) => (
                <Button className="w-full" size="lg" variant={p.key === "business" ? "default" : "outline"}
                  onClick={() => void navigate({ to: "/start", search: { plan: p.key, interval } })}>
                  Start with {p.name}
                </Button>
              )}
            />
          )}

        {allFeatures.length > 0 && (
          <section className="grid gap-4" aria-labelledby="what-is-inside">
            <h2 id="what-is-inside" className="text-center text-xl font-semibold">What's inside</h2>
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {allFeatures.map((f) => (
                <Card key={f.key}>
                  <CardContent className="grid gap-1 pt-5">
                    <p className="font-medium">{f.name}</p>
                    <p className="line-clamp-4 text-sm text-muted-foreground">{f.description}</p>
                    <p className="pt-1 text-xs text-muted-foreground">From the {minPlan(f.key)} plan</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>
        )}

        <p className="text-center text-xs text-muted-foreground">
          Need more than 60 people, or have a question? Write to {COMPANY.email}. <a className="underline" href="/terms">Terms</a> · <a className="underline" href="/privacy">Privacy Policy</a>
        </p>
      </main>
    </div>
  );
}
