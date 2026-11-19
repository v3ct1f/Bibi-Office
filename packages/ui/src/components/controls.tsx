import { useState, type ComponentPropsWithoutRef } from "react";
import * as S from "@radix-ui/react-switch";
import * as C from "@radix-ui/react-checkbox";
import * as T from "@radix-ui/react-tabs";
import { Check, Copy } from "lucide-react";
import { cn } from "../lib.ts";
import { Button } from "./button.tsx";

export const Switch = ({ className, ...p }: ComponentPropsWithoutRef<typeof S.Root>) => (
  <S.Root
    className={cn(
      "peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors",
      "bg-input data-[state=checked]:bg-primary disabled:cursor-not-allowed disabled:opacity-50", className,
    )}
    {...p}
  >
    <S.Thumb className="pointer-events-none block size-4 rounded-full bg-white shadow-sm transition-transform data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0" />
  </S.Root>
);

export const Checkbox = ({ className, ...p }: ComponentPropsWithoutRef<typeof C.Root>) => (
  <C.Root
    className={cn(
      "peer size-4 shrink-0 cursor-pointer rounded-sm border border-input bg-surface",
      "data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground",
      "disabled:cursor-not-allowed disabled:opacity-50", className,
    )}
    {...p}
  >
    <C.Indicator className="flex items-center justify-center"><Check className="size-3.5" strokeWidth={3} /></C.Indicator>
  </C.Root>
);

export const Tabs = T.Root;
export const TabsList = ({ className, ...p }: ComponentPropsWithoutRef<typeof T.List>) =>
  <T.List className={cn("inline-flex h-9 items-center gap-1 rounded-md bg-muted p-1 text-muted-foreground", className)} {...p} />;
export const TabsTrigger = ({ className, ...p }: ComponentPropsWithoutRef<typeof T.Trigger>) => (
  <T.Trigger
    className={cn(
      "inline-flex cursor-pointer items-center rounded-sm px-3 py-1 text-sm font-medium transition-colors",
      "data-[state=active]:bg-surface data-[state=active]:text-foreground data-[state=active]:shadow-xs", className,
    )}
    {...p}
  />
);
export const TabsContent = ({ className, ...p }: ComponentPropsWithoutRef<typeof T.Content>) =>
  <T.Content className={cn("mt-4 outline-none", className)} {...p} />;

/** Read-only value with copy button, for one-time secrets (API keys, webhook secrets). */
export function CopyField({ value, label = "Copy" }: { value: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="flex items-stretch gap-2">
      <code className="flex-1 select-all break-all rounded-md border bg-muted px-3 py-2 font-mono text-xs">{value}</code>
      <Button
        variant="outline" size="icon" aria-label={label}
        onClick={async () => {
          await navigator.clipboard?.writeText(value).catch(() => {});
          setDone(true); setTimeout(() => setDone(false), 1500);
        }}
      >{done ? <Check /> : <Copy />}</Button>
    </div>
  );
}
