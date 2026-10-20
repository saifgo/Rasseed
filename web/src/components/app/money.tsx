import { formatDinars, formatDt } from "@/lib/money";
import { cn } from "@/lib/utils";

/** Renders an amount in dinars from millimes with Latin digits. `compact` drops ",000" on whole dinars (seller pages). */
export function Dt({ millimes, className, unit = true, compact = false }: { millimes: number | null | undefined; className?: string; unit?: boolean; compact?: boolean }) {
  if (millimes == null) return <span className={className}>—</span>;
  return (
    <span className={cn("tabular whitespace-nowrap", className)} dir="ltr">
      {compact ? formatDt(millimes) : formatDinars(millimes)}
      {unit && <span className="ms-1 text-[0.85em] text-muted-foreground">DT</span>}
    </span>
  );
}
