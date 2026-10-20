import { cn } from "@/lib/utils";

// Official logos live in /public/operators. Each tile mimics the operator's own app icon
// so sellers recognise their network at a glance.
const logos: Record<string, { src: string; tile: string; img: string }> = {
  ooredoo: { src: "/operators/ooredoo-white.svg", tile: "bg-[#ed1c24]", img: "w-[82%]" },
  orange: { src: "/operators/orange.svg", tile: "bg-[#ff7900]", img: "size-full" },
  tt: { src: "/operators/tt.svg", tile: "bg-white ring-1 ring-black/8 ring-inset", img: "w-[80%]" },
};

export function hasOperatorLogo(code: string | undefined) {
  return !!code && code in logos;
}

/** Square logo tile. Falls back to the operator's color with its first letter. */
export function OperatorLogo({ code, name, color, className }: { code: string; name: string; color: string; className?: string }) {
  const logo = logos[code];
  if (!logo) {
    return (
      <span
        aria-hidden="true"
        className={cn("inline-flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-xl font-bold text-white", className)}
        style={{ backgroundColor: color }}
      >
        {name.charAt(0).toUpperCase()}
      </span>
    );
  }
  return (
    <span aria-hidden="true" className={cn("inline-flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-xl", logo.tile, className)}>
      {/* eslint-disable-next-line @next/next/no-img-element -- tiny static SVGs */}
      <img src={logo.src} alt="" className={cn("object-contain", logo.img)} draggable={false} />
    </span>
  );
}

export function OperatorDot({ color, className }: { color: string; className?: string }) {
  return <span aria-hidden="true" className={cn("inline-block size-2.5 shrink-0 rounded-full", className)} style={{ backgroundColor: color }} />;
}

/** Operator name with its logo (when `code` is given) or a colored dot. */
export function OperatorName({ name, color, code, className }: { name: string; color: string; code?: string; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      {code ? <OperatorLogo code={code} name={name} color={color} className="size-7 rounded-lg" /> : <OperatorDot color={color} />}
      <span className="font-medium">{name}</span>
    </span>
  );
}
