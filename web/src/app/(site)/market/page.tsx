import { ArrowRightIcon, ShoppingBagIcon, SmartphoneIcon, StoreIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { OrderStatusBadge, Rating } from "@/components/app/market-badges";
import { Dt } from "@/components/app/money";
import { OperatorLogo } from "@/components/app/operator-badge";
import { Button } from "@/components/ui/button";
import { brand } from "@/config/brand";
import { db } from "@/db";
import { balancesByOperator } from "@/lib/engine/ledger";
import { listBuyerOrders, orderPrice } from "@/lib/engine/market";
import { listOpenListings, openFirst, requireMarketUser, userNames } from "@/lib/market-queries";
import { listOperators } from "@/lib/queries";
import { segmentedControlItemVariants, segmentedControlRootClassName } from "@/lib/segmented-control";
import { cn } from "@/lib/utils";
import { BuyDialog } from "./buy-dialog";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Market" };

export default async function MarketPage({ searchParams }: { searchParams: Promise<{ op?: string }> }) {
  const { user, settings } = await requireMarketUser();
  const t = await getTranslations("market");
  const format = await getFormatter();
  const { op: filter } = await searchParams;
  const [ops, balances, listings, orders] = await Promise.all([
    listOperators(),
    balancesByOperator(db, "buyer", user.id),
    listOpenListings(user.id),
    listBuyerOrders(user.id),
  ]);
  const activeOps = ops.filter((o) => o.active);
  const opBy = Object.fromEntries(ops.map((o) => [o.code, o]));
  const shown = listings.filter((l) => !filter || l.operatorCode === filter);
  const names = await userNames(orders.map((o) => o.sellerId));

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8 px-4 py-8">
      <div className="flex flex-col gap-1">
        <h1 className="font-heading font-bold text-3xl tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground">{t("subtitle")}</p>
      </div>

      {/* Balances */}
      <section className="flex flex-col gap-3">
        <h2 className="font-heading font-semibold text-xl">{t("myCredit")}</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {activeOps.map((o) => (
            <div key={o.code} className="flex items-center gap-3 rounded-2xl border-2 bg-card p-4" style={{ borderColor: o.color }}>
              <OperatorLogo code={o.code} name={o.name} color={o.color} className="size-10 rounded-xl" />
              <div className="flex min-w-0 flex-col">
                <span className="text-muted-foreground text-sm">{o.name}</span>
                <Dt compact millimes={balances[o.code] ?? 0} className="font-bold text-2xl" />
              </div>
            </div>
          ))}
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <Button variant="go" className="h-12 text-base sm:h-12" render={<Link href="/market/recharge" />}>
            <SmartphoneIcon aria-hidden="true" />
            {t("rechargeCta")}
          </Button>
          <Button variant="outline" className="h-12 text-base sm:h-12" render={<Link href="/market/selling" />}>
            <StoreIcon aria-hidden="true" />
            {t("sellingCta")}
          </Button>
        </div>
      </section>

      {/* Sellers */}
      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="font-heading font-semibold text-xl">{t("buyTitle")}</h2>
          <p className="text-muted-foreground text-sm">{t("buyHint")}</p>
        </div>
        <nav className={cn(segmentedControlRootClassName, "max-w-full flex-wrap justify-start")} aria-label={t("filter")}>
          <Link href="/market" aria-current={!filter ? "page" : undefined} className={segmentedControlItemVariants({ size: "lg", state: "current" })}>
            {t("all")}
          </Link>
          {activeOps.map((o) => (
            <Link
              key={o.code}
              href={`/market?op=${o.code}`}
              aria-current={filter === o.code ? "page" : undefined}
              className={segmentedControlItemVariants({ size: "lg", state: "current" })}
            >
              {o.name}
            </Link>
          ))}
        </nav>
        {shown.length === 0 ? (
          <p className="py-6 text-center text-muted-foreground">{t("noListings")}</p>
        ) : (
          <ul className="flex flex-col divide-y overflow-hidden rounded-2xl border bg-card">
            {shown.map((l) => {
              const o = opBy[l.operatorCode];
              const seller = l.sellerId ? (l.sellerName ?? t("seller")) : brand.name;
              return (
                <li key={l.id} className="flex items-start gap-4 p-4">
                  <OperatorLogo code={o.code} name={o.name} color={o.color} className="size-12 rounded-xl" />
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="font-semibold">{seller}</span>
                      <Rating rating={l.rating} />
                    </div>
                    <span className="text-sm">
                      {t.rich("priceLine", {
                        pay: () => <Dt compact millimes={orderPrice(10_000, l.priceBps)} className="font-bold text-base" />,
                      })}
                    </span>
                    {l.paymentInfo && <span className="line-clamp-2 text-muted-foreground text-xs">{t("paysWith", { info: l.paymentInfo })}</span>}
                  </div>
                  <BuyDialog
                    listing={{
                      id: l.id,
                      seller,
                      priceBps: l.priceBps,
                      operator: { code: o.code, name: o.name, color: o.color },
                    }}
                    commissionBps={settings.commissionBps}
                    maxOrderMillimes={settings.maxOrderMillimes}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* My orders */}
      <section className="flex flex-col gap-3">
        <h2 className="font-heading font-semibold text-xl">{t("myOrders")}</h2>
        {orders.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center text-muted-foreground">
            <ShoppingBagIcon aria-hidden="true" className="size-8 opacity-60" />
            {t("noOrders")}
          </div>
        ) : (
          <ul className="flex flex-col divide-y overflow-hidden rounded-2xl border bg-card">
            {openFirst(orders).map((o) => {
              const op = opBy[o.operatorCode];
              return (
                <li key={o.id}>
                  <Link href={`/market/orders/${o.id}`} className="flex items-center gap-4 p-4 transition-colors hover:bg-accent/60">
                    <OperatorLogo code={op.code} name={op.name} color={op.color} className="size-12 rounded-xl" />
                    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <Dt compact millimes={o.amountMillimes} className="font-semibold text-lg" />
                        <span className="text-muted-foreground text-sm">· {o.sellerId ? (names[o.sellerId] ?? t("seller")) : brand.name}</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <OrderStatusBadge status={o.status} />
                        <span className="text-muted-foreground text-xs">
                          {format.dateTime(o.createdAt, { dateStyle: "medium", timeStyle: "short" })} · <span className="font-mono">{o.ref}</span>
                        </span>
                      </div>
                    </div>
                    <ArrowRightIcon aria-hidden="true" className="size-5 shrink-0 text-muted-foreground rtl:rotate-180" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
