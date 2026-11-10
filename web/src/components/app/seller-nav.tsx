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

const SELL_SECTION = ["/selling", "/sell", "/sales", "/wallet"];

const under = (path: string, href: string) => path === href || path.startsWith(`${href}/`);

function useNav(market: boolean) {
  const path = usePathname();
  const items = market ? marketItems : plainItems;
  const isActive = (it: Item) => it.match.some((m) => under(path, m));
  const section: Side | null = under(path, "/buy") ? "buy" : SELL_SECTION.some((m) => under(path, m)) ? "sell" : null;
  return { items, isActive, section };
}

// Buy is blue, Sell is green, everywhere.
const tone = {
  buy: {
    band: "bg-sky-500/8",
    activeBand: "bg-sky-500/14",
    pill: "bg-sky-600/14 text-sky-700 dark:text-sky-300",
    text: "text-sky-800 dark:text-sky-200",
  },
  sell: {
    band: "bg-emerald-500/6",
    activeBand: "bg-emerald-500/12",
    pill: "bg-emerald-600/12 text-emerald-700 dark:text-emerald-400",
    text: "text-emerald-800 dark:text-emerald-200",
  },
} as const;

/** Top menu for larger screens. */
export function SellerTopNav({ market = false }: { market?: boolean }) {
  const t = useTranslations("nav");
  const { items, isActive, section } = useNav(market);

  if (!market) {
    return (
      <nav className="hidden items-center gap-1 sm:flex">
        {items.map((it) => (
          <TopLink key={it.href} it={it} active={isActive(it)} label={t(it.key)} />
        ))}
      </nav>
    );
  }

  const buy = items.filter((it) => it.side === "buy");
  const sell = items.filter((it) => it.side === "sell");
  return (
    <nav className="hidden items-center gap-2 sm:flex">
      {(["buy", "sell"] as const).map((side) => (
        <div
          key={side}
          className={cn("flex items-center gap-0.5 rounded-xl p-1 transition-colors", section === side ? tone[side].activeBand : tone[side].band)}
        >
          {(side === "buy" ? buy : sell).map((it) => (
            <TopLink key={it.href} it={it} active={isActive(it)} label={t(it.key)} side={side} />
          ))}
        </div>
      ))}
    </nav>
  );
}

function TopLink({ it, active, label, side }: { it: Item; active: boolean; label: string; side?: Side }) {
  return (
    <Link
      href={it.href}
      aria-current={active ? "page" : undefined}
      className={
        side
          ? cn(
              "inline-flex h-8 items-center gap-2 rounded-lg px-3 font-medium text-muted-foreground text-sm transition-colors hover:bg-background/70 hover:text-foreground",
              active && cn("bg-background shadow-xs/5", tone[side].text),
            )
          : cn(
              "inline-flex h-9 items-center gap-2 rounded-lg px-3 font-medium text-muted-foreground text-sm transition-colors hover:bg-accent hover:text-foreground",
              "aria-[current=page]:bg-accent aria-[current=page]:text-foreground",
            )
      }
    >
      <it.icon aria-hidden="true" className="size-4" />
      {label}
    </Link>
  );
}

/** Big icon tabs fixed to the bottom of the screen on phones. */
export function SellerBottomNav({ market = false }: { market?: boolean }) {
  const t = useTranslations("nav");
  const { items, isActive, section } = useNav(market);
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden">
      <div className={cn("grid", items.length === 4 ? "grid-cols-4" : "grid-cols-3")}>
        {items.map((it, i) => {
          const active = isActive(it);
          const side = it.side;
          // With the marketplace, a line separates Buy from the Sell tabs and each side keeps its color.
          const firstSell = market && side === "sell" && items[i - 1]?.side === "buy";
          return (
            <Link
              key={it.href}
              href={it.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex flex-col items-center gap-1 py-2.5 font-medium text-xs transition-colors",
                active ? "text-foreground" : "text-muted-foreground",
                market && (section === side ? tone[side].activeBand : tone[side].band),
                firstSell && "border-s-2 border-border",
              )}
            >
              <span className={cn("flex h-8 w-14 items-center justify-center rounded-full transition-colors", active && tone[side].pill)}>
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
