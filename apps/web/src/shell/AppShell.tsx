import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Building2, Check, ChevronsUpDown, Contact, LayoutDashboard, ListTodo, LogOut, Menu, Monitor, Moon, PackagePlus, Plus, Settings, Sun, Workflow, X,
} from "lucide-react";
import {
  Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger, cn,
} from "@office/ui";
import { useAuth } from "../auth/auth.tsx";
import { request } from "../api/client.ts";
import type { Me } from "../api/types.ts";
import { useTenant } from "../lib/tenant.tsx";
import { useTheme, type Theme } from "../lib/theme.tsx";
import { initials } from "../lib/format.ts";
import { moduleIcon } from "./icons.tsx";

export const useMe = () => useQuery({ queryKey: ["me"], queryFn: () => request<Me>("GET", "/me"), staleTime: 60_000 });

export const SETTINGS_PERMS = ["core:members.read", "core:roles.read", "core:modules.read", "core:apikeys.manage", "core:webhooks.manage", "core:audit.read"];

function NavItem({ to, icon: Icon, children, exact, onNavigate }: { to: string; icon: React.ComponentType<{ className?: string }>; children: ReactNode; exact?: boolean; onNavigate?: () => void }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const active = exact ? path === to || path === `${to}/` : path === to || path.startsWith(`${to}/`);
  return (
    <Link
      to={to} onClick={onNavigate} aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors",
        active ? "bg-surface font-medium text-foreground shadow-xs ring-1 ring-border" : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      <Icon className="size-4 shrink-0" />{children}
    </Link>
  );
}

const Group = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="grid gap-0.5">
    <p className="px-2.5 pb-1 pt-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/80">{label}</p>
    {children}
  </div>
);

function TenantSwitcher() {
  const { tenant } = useTenant();
  const me = useMe();
  const navigate = useNavigate();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex w-full cursor-pointer items-center gap-2.5 rounded-md p-1.5 text-left hover:bg-accent" aria-label="Switch workspace">
          <span className="grid size-8 shrink-0 place-items-center rounded-md bg-primary text-xs font-semibold text-primary-foreground">{initials(tenant.name)}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold">{tenant.name}</span>
            <span className="block truncate text-xs text-muted-foreground">{tenant.slug} · {tenant.region.toUpperCase()}</span>
          </span>
          <ChevronsUpDown className="size-4 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
        {(me.data?.tenants ?? []).map((t) => (
          <DropdownMenuItem key={t.id} onSelect={() => navigate({ to: "/t/$slug", params: { slug: t.slug } })}>
            <span className="grid size-6 place-items-center rounded bg-muted text-[10px] font-semibold">{initials(t.name)}</span>
            <span className="flex-1 truncate">{t.name}</span>
            {t.id === tenant.id && <Check className="text-primary" />}
          </DropdownMenuItem>
        ))}
        {(me.data?.selfSignup || me.data?.platformAdmin) && <DropdownMenuSeparator />}
        {me.data?.platformAdmin ? <DropdownMenuItem onSelect={() => navigate({ to: "/admin" })}><Plus /> New business</DropdownMenuItem>
          : me.data?.selfSignup && <DropdownMenuItem onSelect={() => navigate({ to: "/onboarding" })}><Plus /> Create workspace</DropdownMenuItem>}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function UserMenu() {
  const { user, signOut } = useAuth();
  const { theme, setTheme } = useTheme();
  const me = useMe();
  const navigate = useNavigate();
  const email = (user?.profile.email as string | undefined) ?? "";
  const name = (user?.profile.name as string | undefined) ?? email;
  const themes: [Theme, typeof Sun, string][] = [["light", Sun, "Light"], ["dark", Moon, "Dark"], ["system", Monitor, "System"]];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex w-full cursor-pointer items-center gap-2.5 rounded-md p-1.5 text-left hover:bg-accent" aria-label="Account menu">
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground">{initials(name)}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{name}</span>
            <span className="block truncate text-xs text-muted-foreground">{email}</span>
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-60">
        <DropdownMenuLabel>Theme</DropdownMenuLabel>
        {themes.map(([t, Icon, label]) => (
          <DropdownMenuItem key={t} onSelect={() => setTheme(t)}><Icon /> <span className="flex-1">{label}</span>{theme === t && <Check className="text-primary" />}</DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        {me.data?.platformAdmin && <DropdownMenuItem onSelect={() => navigate({ to: "/admin" })}><Building2 /> Program admin</DropdownMenuItem>}
        <DropdownMenuItem onSelect={() => void signOut()}><LogOut /> Sign out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function NewMenu() {
  const { tenant, can, slots } = useTenant();
  const navigate = useNavigate();
  const base = `/t/${tenant.slug}`;
  const core = [
    { label: "Contact", to: `${base}/contacts`, perm: "core:contacts.write", icon: Contact },
    { label: "Company", to: `${base}/companies`, perm: "core:companies.write", icon: Building2 },
    { label: "Task", to: `${base}/tasks`, perm: "core:tasks.write", icon: ListTodo },
  ].filter((x) => can(x.perm));
  const mods = slots("global.create").filter((s) => s.slot.route);
  if (!core.length && !mods.length) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild><Button size="sm"><Plus /> New</Button></DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {core.map((c) => <DropdownMenuItem key={c.label} onSelect={() => navigate({ to: c.to, search: { new: true } })}><c.icon /> {c.label}</DropdownMenuItem>)}
        {mods.length > 0 && <DropdownMenuSeparator />}
        {mods.map((m) => {
          const Icon = moduleIcon(m.slot.icon);
          return <DropdownMenuItem key={`${m.module}${m.slot.route}`} onSelect={() => navigate({ to: `${base}/m/${m.module}${m.slot.route}` })}><Icon /> {m.slot.label ?? m.moduleName}</DropdownMenuItem>;
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { tenant, can, slots } = useTenant();
  const base = `/t/${tenant.slug}`;
  const p = onNavigate ? { onNavigate } : {};
  const moduleNav = slots("nav.main").filter((s) => s.slot.route);
  const data = [
    { to: `${base}/contacts`, label: "Contacts", icon: Contact, perm: "core:contacts.read" },
    { to: `${base}/companies`, label: "Companies", icon: Building2, perm: "core:companies.read" },
    { to: `${base}/tasks`, label: "Tasks", icon: ListTodo, perm: "core:tasks.read" },
  ].filter((d) => can(d.perm));
  return (
    <div className="flex h-full flex-col gap-2 p-3">
      <TenantSwitcher />
      <nav className="flex-1 overflow-y-auto" aria-label="Main">
        <div className="grid gap-0.5 pt-2">
          <NavItem to={base} icon={LayoutDashboard} exact {...p}>Dashboard</NavItem>
        </div>
        {data.length > 0 && <Group label="Data">{data.map((d) => <NavItem key={d.to} to={d.to} icon={d.icon} {...p}>{d.label}</NavItem>)}</Group>}
        {(moduleNav.length > 0 || can("core:modules.manage")) && (
          <Group label="Features">
            {moduleNav.map((m) => <NavItem key={`${m.module}${m.slot.route}`} to={`${base}/m/${m.module}${m.slot.route}`} icon={moduleIcon(m.slot.icon)} {...p}>{m.slot.label ?? m.moduleName}</NavItem>)}
            {can("core:modules.manage") && <NavItem to={`${base}/features`} icon={PackagePlus} {...p}>Add features</NavItem>}
          </Group>
        )}
        {(can("core:workflows.read") || SETTINGS_PERMS.some(can)) && (
          <Group label="Admin">
            {can("core:workflows.read") && <NavItem to={`${base}/workflows`} icon={Workflow} {...p}>Workflows</NavItem>}
            {SETTINGS_PERMS.some(can) && <NavItem to={`${base}/settings`} icon={Settings} {...p}>Settings</NavItem>}
          </Group>
        )}
      </nav>
      <UserMenu />
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const path = useRouterState({ select: (s) => s.location.pathname });
  useEffect(() => setOpen(false), [path]);
  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 border-r bg-sidebar lg:block"><Sidebar /></aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] border-r bg-sidebar shadow-xl">
            <Button variant="ghost" size="icon" className="absolute right-2 top-3" aria-label="Close navigation" onClick={() => setOpen(false)}><X /></Button>
            <Sidebar onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/85 px-4 backdrop-blur lg:px-8">
          <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open navigation" onClick={() => setOpen(true)}><Menu /></Button>
          <div className="flex-1" />
          <NewMenu />
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
