import { brand } from "@/config/brand";
import { cn } from "@/lib/utils";

// Coin with a SIM-shaped hole; keep in sync with scripts/generate-pwa-icons.mjs.
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="-40 -40 80 80" aria-hidden="true" className={cn("size-7", className)}>
      <path
        d="M0-39.6a39.6 39.6 0 1 1 0 79.2a39.6 39.6 0 1 1 0-79.2ZM-16.66-10.72A3 3 0 0 1-14.35-14.28L0.12-17.36A3 3 0 0 1 2.38-16.94L10.33-11.78A3 3 0 0 1 11.63-9.89L16.26 11.92A3 3 0 0 1 13.95 15.48L-7.08 19.95A3 3 0 0 1-10.63 17.64Z"
        fill="#e3a93b"
        fillRule="evenodd"
      />
      <circle r="34.1" fill="none" stroke="#ca922b" strokeWidth="1.6" />
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
