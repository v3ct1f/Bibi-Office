import * as D from "@radix-ui/react-dialog";
import * as S from "@radix-ui/react-switch";
import type { ReactNode } from "react";
import { cn } from "../cn.ts";

export function Dialog({ open, onOpenChange, title, description, children, footer }: {
  open: boolean; onOpenChange(o: boolean): void; title: string; description?: string; children: ReactNode; footer?: ReactNode;
}) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <D.Content className="fixed left-1/2 top-1/2 z-50 grid max-h-[90vh] w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-md border bg-surface p-5 shadow-xl">
          <div>
            <D.Title className="text-lg font-semibold">{title}</D.Title>
            {description ? <D.Description className="mt-1 text-sm text-muted">{description}</D.Description> : <D.Description className="sr-only">{title}</D.Description>}
          </div>
          {children}
          {footer && <div className="flex justify-end gap-2">{footer}</div>}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

export function Switch({ checked, onCheckedChange, disabled, label }: { checked: boolean; onCheckedChange(v: boolean): void; disabled?: boolean; label: string }) {
  return (
    <S.Root
      checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} aria-label={label}
      className={cn("relative h-5 w-9 shrink-0 cursor-pointer rounded-full bg-border transition-colors data-[state=checked]:bg-primary disabled:opacity-50")}
    >
      <S.Thumb className="block h-4 w-4 translate-x-0.5 rounded-full bg-surface shadow transition-transform data-[state=checked]:translate-x-[18px]" />
    </S.Root>
  );
}
