import { useState, type ComponentPropsWithoutRef, type ReactNode } from "react";
import * as D from "@radix-ui/react-dialog";
import * as M from "@radix-ui/react-dropdown-menu";
import { X } from "lucide-react";
import { cn } from "../lib.ts";
import { Button } from "./button.tsx";

// ───────── Dialog ─────────
export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

export function DialogContent({ className, children, title, description, wide, ...p }:
  Omit<ComponentPropsWithoutRef<typeof D.Content>, "title"> & { title: ReactNode; description?: ReactNode; wide?: boolean }) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[1px]" />
      <D.Content
        className={cn(
          "fixed left-1/2 top-1/2 z-50 grid max-h-[90vh] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto",
          "rounded-lg border bg-surface p-5 shadow-lg", wide ? "max-w-3xl" : "max-w-lg", className,
        )}
        {...(description ? {} : { "aria-describedby": undefined })}
        {...p}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="grid gap-1">
            <D.Title className="text-base font-semibold">{title}</D.Title>
            {description && <D.Description className="text-sm text-muted-foreground">{description}</D.Description>}
          </div>
          <D.Close asChild><Button variant="ghost" size="icon" className="-m-1.5 size-8" aria-label="Close"><X /></Button></D.Close>
        </div>
        {children}
      </D.Content>
    </D.Portal>
  );
}

export const DialogFooter = ({ className, ...p }: ComponentPropsWithoutRef<"div">) =>
  <div className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)} {...p} />;

/** Controlled confirm dialog; onConfirm may be async (button shows spinner until it settles). */
export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel = "Confirm", destructive, onConfirm }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: ReactNode; description?: ReactNode;
  confirmLabel?: string; destructive?: boolean; onConfirm: () => unknown | Promise<unknown>;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={title} description={description}>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant={destructive ? "destructive" : "default"} loading={busy}
            onClick={async () => {
              setBusy(true);
              try { await onConfirm(); onOpenChange(false); } catch { /* caller shows error */ } finally { setBusy(false); }
            }}
          >{confirmLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ───────── Dropdown menu ─────────
export const DropdownMenu = M.Root;
export const DropdownMenuTrigger = M.Trigger;
export const DropdownMenuGroup = M.Group;

export const DropdownMenuContent = ({ className, sideOffset = 6, ...p }: ComponentPropsWithoutRef<typeof M.Content>) => (
  <M.Portal>
    <M.Content
      sideOffset={sideOffset}
      className={cn("z-50 min-w-48 overflow-hidden rounded-md border bg-surface p-1 shadow-md", className)}
      {...p}
    />
  </M.Portal>
);
export const DropdownMenuItem = ({ className, destructive, ...p }: ComponentPropsWithoutRef<typeof M.Item> & { destructive?: boolean }) => (
  <M.Item
    className={cn(
      "relative flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none",
      "data-[highlighted]:bg-accent data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:size-4",
      destructive && "text-destructive", className,
    )}
    {...p}
  />
);
export const DropdownMenuLabel = ({ className, ...p }: ComponentPropsWithoutRef<typeof M.Label>) =>
  <M.Label className={cn("px-2 py-1.5 text-xs font-medium text-muted-foreground", className)} {...p} />;
export const DropdownMenuSeparator = ({ className, ...p }: ComponentPropsWithoutRef<typeof M.Separator>) =>
  <M.Separator className={cn("-mx-1 my-1 h-px bg-border", className)} {...p} />;
