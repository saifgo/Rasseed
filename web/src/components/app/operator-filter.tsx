import Link from "next/link";
import { OperatorLogo } from "@/components/app/operator-badge";
import { segmentedControlRootClassName } from "@/lib/segmented-control";
import { cn } from "@/lib/utils";

type Op = { code: string; name: string; color: string };

/**
 * Operator switch for lists (sellers, the market). Each operator gets an equal share of the width;
 * on phones the logo sits above the name so long names ("Tunisie Telecom") wrap instead of overflowing.
 */
export function OperatorFilter({
  operators,
  current,
  hrefFor,
  label,
  scroll = true,
}: {
  operators: Op[];
  current: string | undefined;
  hrefFor: (code: string) => string;
  label: string;
  scroll?: boolean;
}) {
  if (operators.length < 2) return null;
  return (
    <nav className={cn(segmentedControlRootClassName, "grid w-full auto-cols-fr grid-flow-col")} aria-label={label}>
      {operators.map((o) => {
        const active = o.code === current;
        return (
          <Link
            key={o.code}
            href={hrefFor(o.code)}
            scroll={scroll}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex min-w-0 flex-col items-center justify-center gap-1 rounded-md px-1.5 py-2 text-center font-medium text-muted-foreground text-xs leading-tight transition-[color,background-color,scale] duration-150 ease-out",
              "hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring active:scale-[0.97] sm:flex-row sm:gap-2 sm:py-2 sm:text-sm",
              "aria-[current=page]:bg-background aria-[current=page]:text-foreground aria-[current=page]:shadow-sm/5 dark:aria-[current=page]:bg-input",
            )}
          >
            <OperatorLogo code={o.code} name={o.name} color={o.color} className="size-6 shrink-0 rounded-md sm:size-5" />
            <span className="text-balance">{o.name}</span>
          </Link>
        );
      })}
    </nav>
  );
}
