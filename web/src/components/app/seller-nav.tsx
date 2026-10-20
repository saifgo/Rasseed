"use client";

import { HandCoinsIcon, ReceiptTextIcon, WalletIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

const items = [
  { href: "/sell", key: "sell", icon: HandCoinsIcon },
  { href: "/sales", key: "mySales", icon: ReceiptTextIcon },
  { href: "/wallet", key: "wallet", icon: WalletIcon },
] as const;

function useActive() {
  const path = usePathname();
  return (href: string) => path === href || path.startsWith(`${href}/`);
}

/** Top menu for larger screens. */
export function SellerTopNav() {
  const t = useTranslations("nav");
  const isActive = useActive();
  return (
    <nav className="hidden items-center gap-1 sm:flex">
      {items.map((it) => (
        <Link
          key={it.href}
          href={it.href}
          aria-current={isActive(it.href) ? "page" : undefined}
          className={cn(
            "inline-flex h-9 items-center gap-2 rounded-lg px-3 font-medium text-muted-foreground text-sm transition-colors hover:bg-accent hover:text-foreground",
            "aria-[current=page]:bg-accent aria-[current=page]:text-foreground",
          )}
        >
          <it.icon aria-hidden="true" className="size-4" />
          {t(it.key)}
        </Link>
      ))}
    </nav>
  );
}

/** Big icon tabs fixed to the bottom of the screen on phones. */
export function SellerBottomNav() {
  const t = useTranslations("nav");
  const isActive = useActive();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden">
      <div className="grid grid-cols-3">
        {items.map((it) => {
          const active = isActive(it.href);
          return (
            <Link
              key={it.href}
              href={it.href}
              aria-current={active ? "page" : undefined}
              className={cn("flex flex-col items-center gap-1 py-2.5 font-medium text-xs", active ? "text-foreground" : "text-muted-foreground")}
            >
              <span className={cn("flex h-8 w-14 items-center justify-center rounded-full transition-colors", active && "bg-emerald-600/12 text-emerald-700 dark:text-emerald-400")}>
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
