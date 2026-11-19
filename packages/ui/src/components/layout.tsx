import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../cn.ts";

export const Card = ({ className, ...p }: HTMLAttributes<HTMLDivElement>) =>
  <div className={cn("rounded-md border bg-surface", className)} {...p} />;
export const CardHeader = ({ className, ...p }: HTMLAttributes<HTMLDivElement>) =>
  <div className={cn("flex items-start justify-between gap-4 border-b px-4 py-3", className)} {...p} />;
export const CardTitle = ({ className, ...p }: HTMLAttributes<HTMLHeadingElement>) =>
  <h2 className={cn("text-base font-semibold", className)} {...p} />;
export const CardContent = ({ className, ...p }: HTMLAttributes<HTMLDivElement>) =>
  <div className={cn("p-4", className)} {...p} />;

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  );
}

const tone = {
  neutral: "bg-surface-2 text-fg",
  success: "bg-success/15 text-success",
  warning: "bg-warning/20 text-fg",
  danger: "bg-danger/15 text-danger",
  primary: "bg-primary/15 text-primary",
} as const;
export const Badge = ({ tone: t = "neutral", className, ...p }: HTMLAttributes<HTMLSpanElement> & { tone?: keyof typeof tone }) =>
  <span className={cn("inline-flex items-center rounded px-2 py-0.5 text-xs font-medium", tone[t], className)} {...p} />;

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="grid place-items-center gap-2 rounded-md border border-dashed px-6 py-12 text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="text-sm text-muted">{children}</div>}
    </div>
  );
}

export const Spinner = ({ label = "Loading" }: { label?: string }) => (
  <div role="status" className="flex items-center gap-2 text-sm text-muted">
    <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />
    {label}…
  </div>
);

export function Alert({ tone: t = "danger", children }: { tone?: "danger" | "success" | "warning"; children: ReactNode }) {
  return <div role={t === "danger" ? "alert" : "status"} className={cn("rounded-md px-3 py-2 text-sm", tone[t])}>{children}</div>;
}
