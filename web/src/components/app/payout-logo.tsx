import { BanknoteIcon, MailIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const logos: Record<string, { src: string; tile: string; img: string }> = {
  d17: { src: "/payout/d17.png", tile: "bg-[#0b2447]", img: "w-[84%]" },
  flouci: { src: "/payout/flouci.svg", tile: "bg-white", img: "size-full" },
};

/** Square logo tile for a withdrawal method (D17, Flouci, postal money order…). */
export function PayoutLogo({ code, className }: { code: string; className?: string }) {
  const logo = logos[code];
  const base = "inline-flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-xl";
  if (code === "mandat") {
    return (
      <span aria-hidden="true" className={cn(base, "bg-[#ffcc00] text-[#1d3c8f]", className)}>
        <MailIcon className="size-[55%]" strokeWidth={2.2} />
      </span>
    );
  }
  if (!logo) {
    return (
      <span aria-hidden="true" className={cn(base, "bg-muted text-foreground", className)}>
        <BanknoteIcon className="size-[55%]" />
      </span>
    );
  }
  return (
    <span aria-hidden="true" className={cn(base, logo.tile, className)}>
      {/* eslint-disable-next-line @next/next/no-img-element -- tiny static logos */}
      <img src={logo.src} alt="" className={cn("object-contain", logo.img)} draggable={false} />
    </span>
  );
}
