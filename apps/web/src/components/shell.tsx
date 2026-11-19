import { useEffect, useState, type ReactNode } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { Button, Select, cn } from "@office/ui";
import {
  Blocks, Building2, FileClock, Home, KeyRound, LogOut, Menu, Moon, Shield, Sun, SunMoon, Users, Webhook, Workflow, X, Contact,
} from "lucide-react";
import { auth } from "../lib/auth.ts";
import { useSession } from "../lib/session.tsx";
import { applyTheme, getTheme, type Theme } from "../lib/theme.ts";
import { moduleNav } from "../modules/slot.tsx";

const CORE_NAV = [
  { to: "/", label: "Home", icon: Home },
  { to: "/contacts", label: "Contacts", icon: Contact, perm: "core:contacts.read" },
] as const;
const ADMIN_NAV = [
  { to: "/admin/modules", label: "Modules", icon: Blocks, perm: "core:modules.read" },
  { to: "/admin/members", label: "Members", icon: Users, perm: "core:members.read" },
  { to: "/admin/roles", label: "Roles", icon: Shield, perm: "core:roles.read" },
  { to: "/admin/workflows", label: "Workflows", icon: Workflow, perm: "core:workflows.read" },
  { to: "/admin/webhooks", label: "Webhooks", icon: Webhook, perm: "core:webhooks.manage" },
  { to: "/admin/api-keys", label: "API keys", icon: KeyRound, perm: "core:apikeys.manage" },
  { to: "/admin/audit", label: "Audit log", icon: FileClock, perm: "core:audit.read" },
] as const;

function NavLink({ to, children }: { to: string; children: ReactNode }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const active = to === "/" ? path === "/" : path === to || path.startsWith(`${to}/`);
  return (
    <Link to={to} aria-current={active ? "page" : undefined}
      className={cn("flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm", active ? "bg-primary/12 font-medium text-primary" : "text-fg hover:bg-surface-2")}>
      {children}
    </Link>
  );
}

function ThemeToggle() {
  const [t, setT] = useState<Theme>(getTheme());
  useEffect(() => applyTheme(t), [t]);
  const next: Record<Theme, Theme> = { system: "light", light: "dark", dark: "system" };
  const Icon = t === "light" ? Sun : t === "dark" ? Moon : SunMoon;
  return <Button variant="ghost" size="icon" aria-label={`Theme: ${t}`} title={`Theme: ${t}`} onClick={() => setT(next[t])}><Icon size={16} /></Button>;
}

export function Shell({ children }: { children: ReactNode }) {
  const s = useSession();
  const [open, setOpen] = useState(false);
  const path = useRouterState({ select: (r) => r.location.pathname });
  useEffect(() => setOpen(false), [path]);
  const mods = moduleNav(s.modules, s.permissions);
  const admin = ADMIN_NAV.filter((n) => s.can(n.perm));

  const nav = (
    <nav aria-label="Main" className="grid gap-4">
      <div className="grid gap-0.5">
        {CORE_NAV.filter((n) => !("perm" in n) || s.can(n.perm)).map((n) => <NavLink key={n.to} to={n.to}><n.icon size={16} />{n.label}</NavLink>)}
      </div>
      {mods.length > 0 && (
        <div className="grid gap-0.5">
          <p className="px-2.5 text-xs font-medium uppercase tracking-wide text-muted">Modules</p>
          {mods.map((m) => <NavLink key={m.to} to={m.to}><Blocks size={16} />{m.label}</NavLink>)}
        </div>
      )}
      {admin.length > 0 && (
        <div className="grid gap-0.5">
          <p className="px-2.5 text-xs font-medium uppercase tracking-wide text-muted">Admin</p>
          {admin.map((n) => <NavLink key={n.to} to={n.to}><n.icon size={16} />{n.label}</NavLink>)}
        </div>
      )}
    </nav>
  );

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[15rem_1fr]">
      <aside className={cn("fixed inset-y-0 left-0 z-30 w-64 overflow-y-auto border-r bg-surface p-3 transition-transform md:static md:w-auto md:translate-x-0",
        open ? "translate-x-0" : "-translate-x-full")}>
        <div className="mb-4 flex items-center justify-between px-1">
          <span className="flex items-center gap-2 font-semibold"><Building2 size={18} className="text-primary" />Office</span>
          <Button variant="ghost" size="icon" className="md:hidden" aria-label="Close menu" onClick={() => setOpen(false)}><X size={16} /></Button>
        </div>
        {nav}
      </aside>
      {open && <div className="fixed inset-0 z-20 bg-black/30 md:hidden" onClick={() => setOpen(false)} aria-hidden />}
      <div className="min-w-0">
        <header className="sticky top-0 z-10 flex h-14 items-center gap-2 border-b bg-surface/90 px-4 backdrop-blur">
          <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open menu" onClick={() => setOpen(true)}><Menu size={18} /></Button>
          <label className="sr-only" htmlFor="tenant-switch">Organization</label>
          <Select id="tenant-switch" className="w-auto max-w-[50vw]" value={s.tenantId ?? ""} onChange={(e) => {
            if (e.target.value === "__new") window.location.assign("/new-organization"); else s.switchTenant(e.target.value);
          }}>
            {s.me.tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            <option value="__new">+ New organization</option>
          </Select>
          <div className="ml-auto flex items-center gap-1">
            <span className="hidden text-sm text-muted sm:inline">{s.me.email}</span>
            <ThemeToggle />
            <Button variant="ghost" size="icon" aria-label="Sign out" title="Sign out" onClick={() => auth.logout()}><LogOut size={16} /></Button>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6 md:px-8">{children}</main>
      </div>
    </div>
  );
}
