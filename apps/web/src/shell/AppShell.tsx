import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Building2, Check, ChevronsUpDown, Contact, Globe, UsersRound, LayoutDashboard, ListTodo, LogOut, Menu, Monitor, Moon, PackagePlus, Plus, Settings, Sun, Workflow, X,
} from "lucide-react";
import {
  Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger, cn,
} from "@office/ui";
import { useAuth } from "../auth/auth.tsx";
import { request } from "../api/client.ts";
import type { Me } from "../api/types.ts";
import { useTenant } from "../lib/tenant.tsx";
import { planIcon } from "../lib/brand.ts";
import { useTheme, type Theme } from "../lib/theme.tsx";
import { initials } from "../lib/format.ts";
import { moduleIcon } from "./icons.tsx";
import { t } from "../i18n/core.ts";
import { PreferencesButton, PreferencesDialog } from "./Preferences.tsx";

export const useMe = () => useQuery({ queryKey: ["me"], queryFn: () => request<Me>("GET", "/me"), staleTime: 60_000 });

export const SETTINGS_PERMS = ["core:members.read", "core:roles.read", "core:modules.read", "core:apikeys.manage", "core:webhooks.manage", "core:audit.read"];

function NavItem({ to, icon: Icon, children, exact, onNavigate, badge }: { to: string; icon: React.ComponentType<{ className?: string }>; children: ReactNode; exact?: boolean; onNavigate?: () => void; badge?: ReactNode }) {
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
      <Icon className="size-4 shrink-0" /><span className="min-w-0 flex-1 truncate">{children}</span>{badge}
    </Link>
  );
}

/**
 * Count next to a feature in the menu (manifest slot `badge`, e.g. unread messages). Refreshed every 10 seconds,
 * when the window regains focus, and when a page fires `window.dispatchEvent(new Event("office:refresh-badges"))`.
 */
function NavBadge({ module, path }: { module: string; path: string }) {
  const { tenant } = useTenant();
  const q = useQuery({
    queryKey: ["nav-badge", tenant.id, module, path],
    queryFn: () => request<{ count: number }>("GET", `/m/${module}${path}`, { tenantId: tenant.id }),
    refetchInterval: 10_000, refetchOnWindowFocus: true, retry: false,
  });
  const { refetch } = q;
  useEffect(() => {
    const on = () => void refetch();
    window.addEventListener("office:refresh-badges", on);
    return () => window.removeEventListener("office:refresh-badges", on);
  }, [refetch]);
  const n = q.data?.count ?? 0;
  if (!n) return null;
  return <span className="ml-auto rounded-full bg-primary px-1.5 py-px text-[11px] font-semibold tabular-nums text-primary-foreground" aria-label={`${n} unread`}>{n > 99 ? "99+" : n}</span>;
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
        <button className="flex w-full cursor-pointer items-center gap-2.5 rounded-md p-1.5 text-left hover:bg-accent" aria-label={t("ws.switch")}>
          <span className="grid size-8 shrink-0 place-items-center rounded-md bg-primary text-xs font-semibold text-primary-foreground">{initials(tenant.name)}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold">{tenant.name}</span>
            <span className="block truncate text-xs text-muted-foreground">{tenant.slug} · {tenant.region.toUpperCase()}</span>
          </span>
          <ChevronsUpDown className="size-4 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>{t("ws.workspaces")}</DropdownMenuLabel>
        {(me.data?.tenants ?? []).map((t) => (
          <DropdownMenuItem key={t.id} onSelect={() => navigate({ to: "/t/$slug", params: { slug: t.slug } })}>
            <span className="grid size-6 place-items-center rounded bg-muted text-[10px] font-semibold">{initials(t.name)}</span>
            <span className="flex-1 truncate">{t.name}</span>
            {t.id === tenant.id && <Check className="text-primary" />}
          </DropdownMenuItem>
        ))}
        {(me.data?.selfSignup || me.data?.platformAdmin || me.data?.pendingBusiness) && <DropdownMenuSeparator />}
        {me.data?.pendingBusiness ? <DropdownMenuItem onSelect={() => navigate({ to: "/new-business" })}><Plus /> {t("ws.createBusiness")}</DropdownMenuItem>
          : me.data?.platformAdmin ? <DropdownMenuItem onSelect={() => navigate({ to: "/admin" })}><Plus /> {t("ws.inviteOwner")}</DropdownMenuItem>
          : me.data?.selfSignup && <DropdownMenuItem onSelect={() => navigate({ to: "/onboarding" })}><Plus /> {t("ws.create")}</DropdownMenuItem>}
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
  const themes: [Theme, typeof Sun, string][] = [["light", Sun, t("user.light")], ["dark", Moon, t("user.dark")], ["system", Monitor, t("user.system")]];
  const [prefs, setPrefs] = useState(false);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex w-full cursor-pointer items-center gap-2.5 rounded-md p-1.5 text-left hover:bg-accent" aria-label={t("user.account")}>
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground">{initials(name)}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{name}</span>
            <span className="block truncate text-xs text-muted-foreground">{email}</span>
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-60">
        <DropdownMenuLabel>{t("user.theme")}</DropdownMenuLabel>
        {themes.map(([key, Icon, label]) => (
          <DropdownMenuItem key={key} onSelect={() => setTheme(key)}><Icon /> <span className="flex-1">{label}</span>{theme === key && <Check className="text-primary" />}</DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => setPrefs(true)}><Globe /> {t("lang.label")} · {t("curr.label")}</DropdownMenuItem>
        {me.data?.platformAdmin && <DropdownMenuItem onSelect={() => navigate({ to: "/admin" })}><Building2 /> {t("user.programAdmin")}</DropdownMenuItem>}
        <DropdownMenuItem onSelect={() => void signOut()}><LogOut /> {t("common.signOut")}</DropdownMenuItem>
      </DropdownMenuContent>
      <PreferencesDialog open={prefs} onOpenChange={setPrefs} />
    </DropdownMenu>
  );
}

function NewMenu() {
  const { tenant, can, slots } = useTenant();
  const navigate = useNavigate();
  const base = `/t/${tenant.slug}`;
  const core = [
    { label: t("new.contact"), to: `${base}/contacts`, perm: "core:contacts.write", icon: Contact },
    { label: t("new.company"), to: `${base}/companies`, perm: "core:companies.write", icon: Building2 },
    { label: t("new.task"), to: `${base}/tasks`, perm: "core:tasks.write", icon: ListTodo },
  ].filter((x) => can(x.perm));
  const mods = slots("global.create").filter((s) => s.slot.route);
  if (!core.length && !mods.length) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild><Button size="sm"><Plus /> {t("new.button")}</Button></DropdownMenuTrigger>
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
  // Work email is built in: it lives under Admin (above Workflows), not in the feature list.
  const workEmail = slots("nav.main").find((s) => s.module === "workmail" && s.slot.route);
  const moduleNav = slots("nav.main").filter((s) => s.slot.route && s.module !== "workmail");
  const data = [
    { to: `${base}/contacts`, label: t("nav.contacts"), icon: Contact, perm: "core:contacts.read" },
    { to: `${base}/companies`, label: t("nav.companies"), icon: Building2, perm: "core:companies.read" },
    { to: `${base}/tasks`, label: t("nav.tasks"), icon: ListTodo, perm: "core:tasks.read" },
    { to: `${base}/colleagues`, label: t("nav.colleagues"), icon: UsersRound, perm: "core:members.read" },
  ].filter((d) => can(d.perm));
  return (
    <div className="flex h-full flex-col gap-2 p-3">
      <Link to={base} aria-label="Bibi Office" className="flex items-center gap-2 px-2 pt-1 text-[0.95rem] font-semibold tracking-tight">
        <img src={planIcon(tenant.plan)} alt="" className="size-6" /> Bibi Office
      </Link>
      <TenantSwitcher />
      <nav className="flex-1 overflow-y-auto" aria-label={t("nav.main")}>
        <div className="grid gap-0.5 pt-2">
          <NavItem to={base} icon={LayoutDashboard} exact {...p}>{t("nav.dashboard")}</NavItem>
        </div>
        {data.length > 0 && <Group label={t("nav.data")}>{data.map((d) => <NavItem key={d.to} to={d.to} icon={d.icon} {...p}>{d.label}</NavItem>)}</Group>}
        {(moduleNav.length > 0 || can("core:modules.manage")) && (
          <Group label={t("nav.features")}>
            {moduleNav.map((m) => (
              <NavItem key={`${m.module}${m.slot.route}`} to={`${base}/m/${m.module}${m.slot.route}`} icon={moduleIcon(m.slot.icon)} {...p}
                badge={m.slot.badge ? <NavBadge module={m.module} path={m.slot.badge} /> : undefined}>{m.slot.label ?? m.moduleName}</NavItem>
            ))}
            {can("core:modules.manage") && <NavItem to={`${base}/features`} icon={PackagePlus} {...p}>{t("nav.addFeatures")}</NavItem>}
          </Group>
        )}
        {(workEmail || can("core:workflows.read") || SETTINGS_PERMS.some(can)) && (
          <Group label={t("nav.admin")}>
            {workEmail && <NavItem to={`${base}/m/workmail${workEmail.slot.route}`} icon={moduleIcon(workEmail.slot.icon)} {...p}>{workEmail.slot.label ?? workEmail.moduleName}</NavItem>}
            {can("core:workflows.read") && <NavItem to={`${base}/workflows`} icon={Workflow} {...p}>{t("nav.workflows")}</NavItem>}
            {SETTINGS_PERMS.some(can) && <NavItem to={`${base}/settings`} icon={Settings} {...p}>{t("nav.settings")}</NavItem>}
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
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label={t("nav.main")}>
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] border-r bg-sidebar shadow-xl">
            <Button variant="ghost" size="icon" className="absolute right-2 top-3" aria-label={t("nav.closeMenu")} onClick={() => setOpen(false)}><X /></Button>
            <Sidebar onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/85 px-4 backdrop-blur lg:px-8">
          <Button variant="ghost" size="icon" className="lg:hidden" aria-label={t("nav.openMenu")} onClick={() => setOpen(true)}><Menu /></Button>
          <div className="flex-1" />
          <PreferencesButton />
          <NewMenu />
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
