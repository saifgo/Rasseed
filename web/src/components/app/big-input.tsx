"use client";

import type * as React from "react";
import { cn } from "@/lib/utils";

type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, "size" | "prefix"> & {
  /** Fixed label shown inside the box, e.g. "DT". */
  suffix?: React.ReactNode;
  prefix?: React.ReactNode;
  invalid?: boolean;
};

/** Large, finger-friendly input used on the seller pages. */
export function BigInput({ suffix, prefix, invalid, className, ...props }: Props) {
  return (
    <div
      dir="ltr"
      className={cn(
        "flex h-16 w-full items-center gap-3 rounded-2xl border-2 bg-background px-4 transition-colors focus-within:border-foreground/60 focus-within:ring-4 focus-within:ring-ring/16",
        invalid && "border-destructive/70 focus-within:border-destructive focus-within:ring-destructive/16",
        className,
      )}
    >
      {prefix}
      <input
        {...props}
        aria-invalid={invalid || undefined}
        className="h-full min-w-0 flex-1 bg-transparent font-semibold text-3xl tabular-nums tracking-wide outline-none placeholder:font-normal placeholder:text-muted-foreground/50"
      />
      {suffix && <span className="shrink-0 rounded-lg bg-muted px-2.5 py-1 font-bold text-foreground text-xl">{suffix}</span>}
    </div>
  );
}
