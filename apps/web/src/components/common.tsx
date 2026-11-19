import { useState, type ReactNode } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { Alert, Button, Dialog, Input, Spinner } from "@office/ui";
import { Check, Copy } from "lucide-react";
import { errorMessage } from "../lib/api.ts";

/** Renders loading / error / data for a query. */
export function QueryView<T>({ q, children }: { q: UseQueryResult<T>; children: (d: T) => ReactNode }) {
  if (q.isPending) return <Spinner />;
  if (q.isError) return <Alert>{errorMessage(q.error)}</Alert>;
  return <>{children(q.data)}</>;
}

export function ConfirmButton({ label, title, body, onConfirm, variant = "danger", size = "sm" }: {
  label: ReactNode; title: string; body: string; onConfirm(): Promise<unknown>; variant?: "danger" | "outline"; size?: "sm" | "md";
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  return (
    <>
      <Button variant={variant === "danger" ? "ghost" : variant} size={size} onClick={() => { setErr(undefined); setOpen(true); }}>{label}</Button>
      <Dialog open={open} onOpenChange={setOpen} title={title} description={body} footer={<>
        <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
        <Button variant={variant === "danger" ? "danger" : "primary"} disabled={busy} onClick={async () => {
          setBusy(true);
          try { await onConfirm(); setOpen(false); } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
        }}>Confirm</Button>
      </>}>
        {err && <Alert>{err}</Alert>}
      </Dialog>
    </>
  );
}

/** One-time secret display (API tokens, webhook secrets). */
export function SecretReveal({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="grid gap-2">
      <Alert tone="warning">Copy this {label} now. It will not be shown again.</Alert>
      <div className="flex gap-2">
        <Input readOnly value={value} aria-label={label} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
        <Button variant="outline" size="icon" aria-label={`Copy ${label}`} onClick={async () => {
          await navigator.clipboard?.writeText(value).catch(() => {}); setCopied(true);
        }}>{copied ? <Check size={16} /> : <Copy size={16} />}</Button>
      </div>
    </div>
  );
}

export const fmtDate = (s: string | null | undefined) => (s ? new Date(s).toLocaleString() : "—");
export const fullName = (c: { firstName: string | null; lastName: string | null; email: string | null }) =>
  [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email || "—";
