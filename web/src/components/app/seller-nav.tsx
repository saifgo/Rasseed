"use client";

import { HandCoinsIcon, type LucideIcon, ReceiptTextIcon, ShoppingCartIcon, StoreIcon, WalletIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

type Side = "buy" | "sell";
type Item = { href: string; key: string; icon: LucideIcon; side: Side; match: string[] };

/** Menu without marketplace access: selling to Sarfli only (unchanged). */
const plainItems: Item[] = [
  { href: "/sell", key: "sell", icon: HandCoinsIcon, side: "sell", match: ["/sell"] },
  { href: "/sales", key: "mySales", icon: ReceiptTextIcon, side: "sell", match: ["/sales"] },
  { href: "/wallet", key: "wallet", icon: WalletIcon, side: "sell", match: ["/wallet"] },
];

/** Marketplace menu: a Buy section, then the Sell section (seller home, sales, wallet). */
const marketItems: Item[] = [
  { href: "/buy", key: "buy", icon: ShoppingCartIcon, side: "buy", match: ["/buy"] },
  { href: "/selling", key: "sellSection", icon: StoreIcon, side: "sell", match: ["/selling", "/sell"] },
  { href: "/sales", key: "mySales", icon: ReceiptTextIcon, side: "sell", match: ["/sales"] },
  { href: "/wallet", key: "wallet", icon: WalletIcon, side: "sell", match: ["/wallet"] },
];

const under = (path: string, href: string) => path === href || path.startsWith(`${href}/`);

function useNav(market: boolean) {
  const path = usePathname();
  const items = market ? marketItems : plainItems;
  const isActive = (it: Item) => it.match.some((m) => under(path, m));
  return { items, isActive };
}

/** Top menu for larger screens. With the marketplace, a thin divider separates Buy from the Sell tabs. */
export function SellerTopNav({ market = false }: { market?: boolean }) {
  const t = useTranslations("nav");
  const { items, isActive } = useNav(market);
  return (
    <nav className="hidden items-center gap-1 sm:flex">
      {items.map((it, i) => (
        <span key={it.href} className="contents">
          {market && it.side === "sell" && items[i - 1]?.side === "buy" && <span aria-hidden="true" className="mx-1.5 h-5 w-px bg-border" />}
          <Link
            href={it.href}
            aria-current={isActive(it) ? "page" : undefined}
            className={cn(
              "inline-flex h-9 items-center gap-2 rounded-lg px-3 font-medium text-muted-foreground text-sm transition-[color,background-color,scale] duration-150 ease-out hover:bg-accent hover:text-foreground active:scale-[0.97]",
              "aria-[current=page]:bg-accent aria-[current=page]:text-foreground",
            )}
          >
            <it.icon aria-hidden="true" className="size-4" />
            {t(it.key)}
          </Link>
        </span>
      ))}
    </nav>
  );
}

/** Big icon tabs fixed to the bottom of the screen on phones. */
export function SellerBottomNav({ market = false }: { market?: boolean }) {
  const t = useTranslations("nav");
  const { items, isActive } = useNav(market);
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden">
      <div className={cn("grid", items.length === 4 ? "grid-cols-4" : "grid-cols-3")}>
        {items.map((it, i) => {
          const active = isActive(it);
          // With the marketplace, a thin line separates Buy from the Sell tabs.
          const firstSell = market && it.side === "sell" && items[i - 1]?.side === "buy";
          return (
            <Link
              key={it.href}
              href={it.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex flex-col items-center gap-1 py-2.5 font-medium text-xs",
                active ? "text-foreground" : "text-muted-foreground",
                firstSell && "before:absolute before:inset-y-3 before:start-0 before:w-px before:bg-border",
              )}
            >
              <span
                className={cn(
                  "flex h-8 w-14 items-center justify-center rounded-full transition-[background-color,color,scale] duration-150 ease-out active:scale-[0.94]",
                  active && "bg-emerald-600/12 text-emerald-700 dark:text-emerald-400",
                )}
              >
                <it.icon aria-hidden="true" className="size-5.5" />
              </span>
              {t(it.key)}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
