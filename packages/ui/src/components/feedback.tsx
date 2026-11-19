import type { ReactNode } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Toaster as Sonner, toast } from "sonner";
import { cn } from "../lib.ts";
import { Button } from "./button.tsx";

export { toast };

export const Toaster = ({ theme }: { theme?: "light" | "dark" | "system" }) => (
  <Sonner
    theme={theme ?? "system"} position="bottom-right" closeButton
    toastOptions={{ classNames: { toast: "!bg-surface !text-foreground !border-border !shadow-lg", description: "!text-muted-foreground" } }}
  />
);

export const Skeleton = ({ className }: { className?: string }) =>
  <div className={cn("animate-pulse rounded-md bg-muted", className)} aria-hidden />;

export const Spinner = ({ className, label = "Loading" }: { className?: string; label?: string }) =>
  <Loader2 className={cn("size-5 animate-spin text-muted-foreground", className)} role="status" aria-label={label} />;

export function PageHeader({ title, description, actions, className }: {
  title: ReactNode; description?: ReactNode; actions?: ReactNode; className?: string;
}) {
  return (
    <div className={cn("mb-6 flex flex-wrap items-end justify-between gap-4", className)}>
      <div className="grid gap-1">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ icon, title, description, action, className }: {
  icon?: ReactNode; title: ReactNode; description?: ReactNode; action?: ReactNode; className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 px-6 py-14 text-center", className)}>
      {icon && <div className="mb-1 rounded-full bg-muted p-3 text-muted-foreground [&_svg]:size-5">{icon}</div>}
      <p className="font-medium">{title}</p>
      {description && <p className="max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function ErrorState({ title = "Something went wrong", error, onRetry }: { title?: string; error?: unknown; onRetry?: () => void }) {
  const msg = error instanceof Error ? error.message : typeof error === "string" ? error : undefined;
  return (
    <EmptyState
      icon={<AlertTriangle />} title={title} description={msg}
      action={onRetry && <Button variant="outline" size="sm" onClick={onRetry}>Try again</Button>}
    />
  );
}
