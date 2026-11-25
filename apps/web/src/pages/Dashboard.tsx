import { Link } from "@tanstack/react-router";
import { ArrowRight, Blocks, Building2, CheckCircle2, Circle, Contact, ListTodo, Users, Workflow } from "lucide-react";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Skeleton } from "@office/ui";
import type { Contact as ContactT, Page, Task } from "../api/types.ts";
import { useTQuery } from "../api/hooks.ts";
import { useAuth } from "../auth/auth.tsx";
import { useTenant } from "../lib/tenant.tsx";
import { contactName, fmtDate, fmtRelative } from "../lib/format.ts";
import { SlotComponent, useSlotEntries } from "../modules/SlotHost.tsx";
import { STATUS } from "./data/entities.tsx";
import { t } from "../i18n/core.ts";

function ListCard<T extends { id: string }>({ title, icon: Icon, to, q, render, empty }: {
  title: string; icon: typeof Contact; to: string; q: { isPending: boolean; data?: Page<T> | undefined }; render: (r: T) => React.ReactNode; empty: string;
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2 text-sm"><Icon className="size-4 text-muted-foreground" />{title}</CardTitle>
        <Link to={to} className="inline-flex items-center gap-1 text-xs text-primary hover:underline">{t("dash.viewAll")} <ArrowRight className="size-3" /></Link>
      </CardHeader>
      <CardContent>
        {q.isPending ? <div className="grid gap-2"><Skeleton className="h-6" /><Skeleton className="h-6" /></div>
          : !q.data?.data.length ? <p className="py-4 text-center text-sm text-muted-foreground">{empty}</p>
          : <ul className="divide-y">{q.data.data.map((r) => <li key={r.id} className="py-2 text-sm">{render(r)}</li>)}</ul>}
      </CardContent>
    </Card>
  );
}

export function Dashboard() {
  const { tenant, can, access } = useTenant();
  const { user } = useAuth();
  const base = `/t/${tenant.slug}`;
  const contacts = useTQuery<Page<ContactT>>(["contacts", "list", "recent"], "/contacts", { limit: 5 }, { enabled: can("core:contacts.read") });
  const tasks = useTQuery<Page<Task>>(["tasks", "list", "recent"], "/tasks", { limit: 5 }, { enabled: can("core:tasks.read") });
  const members = useTQuery<unknown[]>(["members"], "/members", undefined, { enabled: can("core:members.read") });
  const workflows = useTQuery<unknown[]>(["workflows"], "/workflows", undefined, { enabled: can("core:workflows.read") });
  const widgets = useSlotEntries("dashboard.widget").filter((w) => w.Component);
  const first = ((user?.profile.name as string | undefined) ?? "").split(" ")[0];

  const setup = [
    { done: access.modules.length > 0, label: t("dash.stepFeature"), to: `${base}/features`, icon: Blocks, perm: "core:modules.manage" },
    { done: (members.data?.length ?? 0) > 1, label: t("dash.stepTeammate"), to: `${base}/settings/members`, icon: Users, perm: "core:members.manage" },
    { done: (contacts.data?.data.length ?? 0) > 0, label: t("dash.stepContact"), to: `${base}/contacts`, icon: Contact, perm: "core:contacts.write" },
    { done: (workflows.data?.length ?? 0) > 0, label: t("dash.stepAutomate"), to: `${base}/workflows/new`, icon: Workflow, perm: "core:workflows.manage" },
  ].filter((s) => can(s.perm));
  const remaining = setup.filter((s) => !s.done).length;

  return (
    <>
      <div className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">{first ? t("dash.welcomeBack", { name: first }) : t("dash.welcome")}</h1>
        <p className="text-sm text-muted-foreground">{t("dash.happening", { name: tenant.name })}</p>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        {setup.length > 0 && remaining > 0 && (
          <Card className="lg:col-span-3">
            <CardHeader><CardTitle className="text-sm">{t("dash.getSetUp")}</CardTitle><CardDescription>{t("dash.stepsLeft", { remaining, total: setup.length })}</CardDescription></CardHeader>
            <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {setup.map((s) => (
                <Link key={s.label} to={s.to} className="flex items-center gap-2.5 rounded-md border p-3 text-sm transition-colors hover:bg-accent">
                  {s.done ? <CheckCircle2 className="size-4 text-success" /> : <Circle className="size-4 text-muted-foreground" />}
                  <span className={s.done ? "text-muted-foreground line-through" : "font-medium"}>{s.label}</span>
                </Link>
              ))}
            </CardContent>
          </Card>
        )}
        {can("core:tasks.read") && (
          <ListCard title={t("dash.recentTasks")} icon={ListTodo} to={`${base}/tasks`} q={tasks} empty={t("dash.noTasks")}
            render={(t) => <div className="flex items-center justify-between gap-2"><span className="truncate">{t.title}</span><Badge variant={STATUS[t.status].variant}>{STATUS[t.status].label}</Badge></div>} />
        )}
        {can("core:contacts.read") && (
          <ListCard title={t("dash.newContacts")} icon={Contact} to={`${base}/contacts`} q={contacts} empty={t("dash.noContacts")}
            render={(c) => <Link to={`${base}/contacts/${c.id}`} className="flex items-center justify-between gap-2 hover:underline"><span className="truncate">{contactName(c)}</span><span className="text-xs text-muted-foreground">{fmtRelative(c.createdAt)}</span></Link>} />
        )}
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2 text-sm"><Building2 className="size-4 text-muted-foreground" />{t("dash.workspace")}</CardTitle></CardHeader>
          <CardContent className="grid gap-2 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">{t("dash.featuresAdded")}</span><span>{access.modules.length}</span></div>
            {members.data && <div className="flex justify-between"><span className="text-muted-foreground">{t("dash.members")}</span><span>{members.data.length}</span></div>}
            {workflows.data && <div className="flex justify-between"><span className="text-muted-foreground">{t("dash.workflows")}</span><span>{workflows.data.length}</span></div>}
            <div className="flex justify-between"><span className="text-muted-foreground">{t("dash.created")}</span><span>{fmtDate(tenant.createdAt)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">{t("dash.displayCurrency")}</span><span data-testid="display-currency">{tenant.displayCurrency}</span></div>
          </CardContent>
        </Card>
        {widgets.map((w) => <div key={`${w.module}:${w.label}`}><SlotComponent entry={w} /></div>)}
      </div>
    </>
  );
}
