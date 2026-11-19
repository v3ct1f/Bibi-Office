import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "../cn.ts";

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 cursor-pointer",
  {
    variants: {
      variant: {
        primary: "bg-primary text-primary-fg hover:opacity-90",
        secondary: "bg-surface-2 text-fg hover:bg-border",
        outline: "border bg-surface hover:bg-surface-2",
        ghost: "hover:bg-surface-2",
        danger: "bg-danger text-danger-fg hover:opacity-90",
      },
      size: { sm: "h-8 px-3", md: "h-9 px-4", icon: "h-9 w-9" },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function Button({ className, variant, size, asChild, type, ...props }: ButtonProps) {
  const C = asChild ? Slot : "button";
  return <C className={cn(buttonVariants({ variant, size }), className)} {...(asChild ? {} : { type: type ?? "button" })} {...props} />;
}
