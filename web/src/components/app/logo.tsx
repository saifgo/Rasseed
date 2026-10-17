import { brand } from "@/config/brand";
import { cn } from "@/lib/utils";

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={cn("size-7", className)}>
      <rect width="32" height="32" rx="8" className="fill-primary" />
      <path d="M9 12.5h11.5l-3-3" className="stroke-primary-foreground" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M23 19.5H11.5l3 3" className="stroke-primary-foreground" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" opacity=".7" />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-heading font-semibold text-lg tracking-tight", className)}>
      <LogoMark />
      {brand.name}
    </span>
  );
}
