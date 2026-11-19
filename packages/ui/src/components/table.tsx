import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from "react";
import { cn } from "../cn.ts";

export const Table = ({ className, ...p }: HTMLAttributes<HTMLTableElement>) => (
  <div className="w-full overflow-x-auto"><table className={cn("w-full text-sm", className)} {...p} /></div>
);
export const THead = (p: HTMLAttributes<HTMLTableSectionElement>) => <thead className="border-b bg-surface-2 text-left text-xs uppercase tracking-wide text-muted" {...p} />;
export const TBody = (p: HTMLAttributes<HTMLTableSectionElement>) => <tbody className="divide-y" {...p} />;
export const TR = ({ className, ...p }: HTMLAttributes<HTMLTableRowElement>) => <tr className={cn("hover:bg-surface-2/60", className)} {...p} />;
export const TH = ({ className, ...p }: ThHTMLAttributes<HTMLTableCellElement>) => <th className={cn("px-4 py-2 font-medium", className)} {...p} />;
export const TD = ({ className, ...p }: TdHTMLAttributes<HTMLTableCellElement>) => <td className={cn("px-4 py-2 align-middle", className)} {...p} />;
