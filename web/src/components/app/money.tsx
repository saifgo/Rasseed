import { formatDinars } from "@/lib/money";
import { cn } from "@/lib/utils";

/** Renders an amount in dinars from millimes, always with Latin digits and 3 decimals. */
export function Dt({ millimes, className, unit = true }: { millimes: number | null | undefined; className?: string; unit?: boolean }) {
  if (millimes == null) return <span className={className}>—</span>;
  return (
    <span className={cn("tabular whitespace-nowrap", className)} dir="ltr">
      {formatDinars(millimes)}
      {unit && <span className="ms-1 text-[0.85em] text-muted-foreground">DT</span>}
    </span>
  );
}
