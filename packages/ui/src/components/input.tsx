import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import * as LabelPrimitive from "@radix-ui/react-label";
import { cn } from "../lib.ts";

export const fieldClass =
  "w-full rounded-md border border-input bg-surface px-3 text-sm shadow-xs transition-colors " +
  "placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 " +
  "focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-60 aria-[invalid=true]:border-destructive";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...p }, ref) => <input ref={ref} className={cn(fieldClass, "h-9", className)} {...p} />,
);
Input.displayName = "Input";

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...p }, ref) => <textarea ref={ref} className={cn(fieldClass, "min-h-20 py-2", className)} {...p} />,
);
Textarea.displayName = "Textarea";

/** Native select: accessible, keyboard-friendly, works on mobile. */
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, ...p }, ref) => (
    <select
      ref={ref}
      className={cn(fieldClass, "h-9 appearance-none bg-[length:16px] bg-[right_8px_center] bg-no-repeat pr-8", className)}
      style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2371717a' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")" }}
      {...p}
    />
  ),
);
Select.displayName = "Select";

export const Label = forwardRef<HTMLLabelElement, LabelPrimitive.LabelProps>(
  ({ className, ...p }, ref) => <LabelPrimitive.Root ref={ref} className={cn("text-sm font-medium leading-none", className)} {...p} />,
);
Label.displayName = "Label";

/** Label + control + hint/error, wired with ids for a11y. Child receives id via render prop. */
export function Field({ label, hint, error, required, children, className }: {
  label: ReactNode; hint?: ReactNode; error?: ReactNode; required?: boolean; className?: string;
  children: (a: { id: string; "aria-invalid"?: boolean; "aria-describedby"?: string }) => ReactNode;
}) {
  const id = useId();
  const desc = error ? `${id}-err` : hint ? `${id}-hint` : undefined;
  return (
    <div className={cn("grid gap-1.5", className)}>
      <Label htmlFor={id}>{label}{required && <span className="text-destructive"> *</span>}</Label>
      {children({ id, ...(error ? { "aria-invalid": true } : {}), ...(desc ? { "aria-describedby": desc } : {}) })}
      {error ? <p id={`${id}-err`} className="text-xs text-destructive">{error}</p>
        : hint ? <p id={`${id}-hint`} className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
