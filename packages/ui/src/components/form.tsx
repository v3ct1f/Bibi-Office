import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes, type LabelHTMLAttributes } from "react";
import { cn } from "../cn.ts";

const control = "w-full rounded-md border bg-surface px-3 text-sm text-fg placeholder:text-muted disabled:opacity-50 aria-[invalid=true]:border-danger";

export const Input = ({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) =>
  <input className={cn(control, "h-9", className)} {...p} />;

export const Textarea = ({ className, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) =>
  <textarea className={cn(control, "min-h-24 py-2 font-mono", className)} {...p} />;

export const Select = ({ className, ...p }: SelectHTMLAttributes<HTMLSelectElement>) =>
  <select className={cn(control, "h-9", className)} {...p} />;

export const Label = ({ className, ...p }: LabelHTMLAttributes<HTMLLabelElement>) =>
  <label className={cn("text-sm font-medium", className)} {...p} />;

/** Label + control + hint/error, wired with ids for a11y. Pass a render fn to receive the id. */
export function Field({ label, hint, error, children }: {
  label: string; hint?: ReactNode; error?: string | undefined;
  children: (a: { id: string; "aria-invalid": boolean; "aria-describedby"?: string }) => ReactNode;
}) {
  const id = useId();
  const descId = hint || error ? `${id}-desc` : undefined;
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children({ id, "aria-invalid": !!error, ...(descId ? { "aria-describedby": descId } : {}) })}
      {(error || hint) && <p id={descId} className={cn("text-xs", error ? "text-danger" : "text-muted")}>{error ?? hint}</p>}
    </div>
  );
}
