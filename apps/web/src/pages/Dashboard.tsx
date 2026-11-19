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

function ListCard<T extends { id: string }>({ title, icon: Icon, to, q, render, empty }: {
  title: string; icon: typeof Contact; to: string; q: { isPending: boolean; data?: Page<T> | undefined }; render: (r: T) => React.ReactNode; empty: string;
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2 text-sm"><Icon className="size-4 text-muted-foreground" />{title}</CardTitle>
        <Link to={to} className="inline-flex items-center gap-1 text-xs text-primary hover:underline">View all <ArrowRight className="size-3" /></Link>
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
    { done: access.modules.length > 0, label: "Add your first feature", to: `${base}/features`, icon: Blocks, perm: "core:modules.manage" },
    { done: (members.data?.length ?? 0) > 1, label: "Add a teammate", to: `${base}/settings/members`, icon: Users, perm: "core:members.manage" },
    { done: (contacts.data?.data.length ?? 0) > 0, label: "Add a contact", to: `${base}/contacts`, icon: Contact, perm: "core:contacts.write" },
    { done: (workflows.data?.length ?? 0) > 0, label: "Automate something", to: `${base}/workflows/new`, icon: Workflow, perm: "core:workflows.manage" },
  ].filter((s) => can(s.perm));
  const remaining = setup.filter((s) => !s.done).length;

  return (
    <>
      <div className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">{first ? `Welcome back, ${first}` : "Welcome"}</h1>
        <p className="text-sm text-muted-foreground">Here’s what’s happening in {tenant.name}.</p>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        {setup.length > 0 && remaining > 0 && (
          <Card className="lg:col-span-3">
            <CardHeader><CardTitle className="text-sm">Get set up</CardTitle><CardDescription>{remaining} of {setup.length} steps left</CardDescription></CardHeader>
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
          <ListCard title="Recent tasks" icon={ListTodo} to={`${base}/tasks`} q={tasks} empty="No tasks yet."
            render={(t) => <div className="flex items-center justify-between gap-2"><span className="truncate">{t.title}</span><Badge variant={STATUS[t.status].variant}>{STATUS[t.status].label}</Badge></div>} />
        )}
        {can("core:contacts.read") && (
          <ListCard title="New contacts" icon={Contact} to={`${base}/contacts`} q={contacts} empty="No contacts yet."
            render={(c) => <Link to={`${base}/contacts/${c.id}`} className="flex items-center justify-between gap-2 hover:underline"><span className="truncate">{contactName(c)}</span><span className="text-xs text-muted-foreground">{fmtRelative(c.createdAt)}</span></Link>} />
        )}
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2 text-sm"><Building2 className="size-4 text-muted-foreground" />Workspace</CardTitle></CardHeader>
          <CardContent className="grid gap-2 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Features added</span><span>{access.modules.length}</span></div>
            {members.data && <div className="flex justify-between"><span className="text-muted-foreground">Members</span><span>{members.data.length}</span></div>}
            {workflows.data && <div className="flex justify-between"><span className="text-muted-foreground">Workflows</span><span>{workflows.data.length}</span></div>}
            <div className="flex justify-between"><span className="text-muted-foreground">Created</span><span>{fmtDate(tenant.createdAt)}</span></div>
          </CardContent>
        </Card>
        {widgets.map((w) => <div key={`${w.module}:${w.label}`}><SlotComponent entry={w} /></div>)}
      </div>
    </>
  );
}
