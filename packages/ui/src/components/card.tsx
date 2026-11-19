import type { HTMLAttributes } from "react";
import { cn } from "../lib.ts";

type P = HTMLAttributes<HTMLDivElement>;
export const Card = ({ className, ...p }: P) => <div className={cn("rounded-lg border bg-surface text-surface-foreground shadow-xs", className)} {...p} />;
export const CardHeader = ({ className, ...p }: P) => <div className={cn("flex flex-col gap-1 p-5 pb-3", className)} {...p} />;
export const CardTitle = ({ className, ...p }: HTMLAttributes<HTMLHeadingElement>) => <h3 className={cn("font-semibold leading-tight", className)} {...p} />;
export const CardDescription = ({ className, ...p }: HTMLAttributes<HTMLParagraphElement>) => <p className={cn("text-sm text-muted-foreground", className)} {...p} />;
export const CardContent = ({ className, ...p }: P) => <div className={cn("p-5 pt-0", className)} {...p} />;
export const CardFooter = ({ className, ...p }: P) => <div className={cn("flex items-center gap-2 border-t px-5 py-3", className)} {...p} />;
