import { cn } from "@/lib/utils";

export function OperatorDot({ color, className }: { color: string; className?: string }) {
  return <span aria-hidden="true" className={cn("inline-block size-2.5 shrink-0 rounded-full", className)} style={{ backgroundColor: color }} />;
}

export function OperatorName({ name, color, className }: { name: string; color: string; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <OperatorDot color={color} />
      {name}
    </span>
  );
}
