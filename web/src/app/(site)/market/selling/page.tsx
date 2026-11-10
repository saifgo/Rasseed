import { ArrowLeftIcon, ArrowRightIcon, InboxIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { Secret } from "@/components/app/confidential";
import { OrderStatusBadge, Rating } from "@/components/app/market-badges";
import { Dt } from "@/components/app/money";
import { OperatorLogo } from "@/components/app/operator-badge";
import { Button } from "@/components/ui/button";
import { db } from "@/db";
import { balancesByOperator } from "@/lib/engine/ledger";
import { buyerBadMarks, listSellerOrders, sellerReputation } from "@/lib/engine/market";
import { listSellerListings, openFirst, requireMarketUser, userNames } from "@/lib/market-queries";
import { formatDt, grossPayout } from "@/lib/money";
import { listOperators } from "@/lib/queries";
import { ListingForm, SellStockForm } from "./selling-forms";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Selling" };

export default async function SellingPage() {
  const { user } = await requireMarketUser();
  const t = await getTranslations("market");
  const format = await getFormatter();
  const [ops, myListings, orders, stock, reputation] = await Promise.all([
    listOperators(),
    listSellerListings(user.id),
    listSellerOrders(user.id),
    balancesByOperator(db, "seller_stock", user.id),
    sellerReputation([user.id]),
  ]);
  const buyerIds = [...new Set(orders.map((o) => o.buyerId))];
  const [names, marks] = await Promise.all([userNames(buyerIds), buyerBadMarks(buyerIds)]);
  const activeOps = ops.filter((o) => o.active);
  const opBy = Object.fromEntries(ops.map((o) => [o.code, o]));
  const stockOps = ops.filter((o) => (stock[o.code] ?? 0) > 0);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8 px-4 py-8">
      <Button variant="ghost" className="-ms-2 -mb-4 h-10 self-start text-base text-muted-foreground" render={<Link href="/market" />}>
        <ArrowLeftIcon aria-hidden="true" className="rtl:rotate-180" />
        {t("backToMarket")}
      </Button>
      <div className="flex flex-col gap-1">
        <h1 className="font-heading font-bold text-3xl tracking-tight">{t("sellingTitle")}</h1>
        <p className="text-muted-foreground">{t("sellingSubtitle")}</p>
        <div className="mt-1 flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">{t("myRating")}</span>
          <Rating rating={reputation[user.id] ?? null} />
        </div>
      </div>

      {/* Incoming orders */}
      <section className="flex flex-col gap-3">
        <h2 className="font-heading font-semibold text-xl">{t("incomingOrders")}</h2>
        {orders.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center text-muted-foreground">
            <InboxIcon aria-hidden="true" className="size-8 opacity-60" />
            {t("noIncoming")}
          </div>
        ) : (
          <ul className="flex flex-col divide-y overflow-hidden rounded-2xl border bg-card">
            {openFirst(orders).map((o) => {
              const op = opBy[o.operatorCode];
              const badMarks = marks[o.buyerId] ?? 0;
              return (
                <li key={o.id}>
                  <Link href={`/market/orders/${o.id}`} className="flex items-center gap-4 p-4 transition-colors hover:bg-accent/60">
                    <OperatorLogo code={op.code} name={op.name} color={op.color} className="size-12 rounded-xl" />
                    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <Dt compact millimes={o.amountMillimes} className="font-semibold text-lg" />
                        <span className="text-muted-foreground text-sm">· {names[o.buyerId] ?? t("buyer")}</span>
                        {badMarks > 0 && <span className="text-amber-700 text-xs dark:text-amber-400">{t("badMarksShort", { count: badMarks })}</span>}
                      </div>
                      {o.status === "funding" && (
                        <span className="text-sm">
                          {t.rich("fundingProgress", { funded: formatDt(o.fundedMillimes), amount: formatDt(o.amountMillimes), secret: (c) => <Secret>{c}</Secret> })}
                        </span>
                      )}
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

      {/* Listings */}
      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="font-heading font-semibold text-xl">{t("myPrices")}</h2>
          <p className="text-muted-foreground text-sm">{t("myPricesHint")}</p>
        </div>
        {activeOps.map((o) => {
          const l = myListings.find((x) => x.operatorCode === o.code);
          return (
            <ListingForm
              key={o.code}
              op={{ code: o.code, name: o.name, color: o.color, rateBps: o.rateBps }}
              listing={l ? { priceBps: l.priceBps, paymentInfo: l.paymentInfo, active: l.active } : null}
            />
          );
        })}
      </section>

      {/* Stock */}
      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="font-heading font-semibold text-xl">{t("myStock")}</h2>
          <p className="text-muted-foreground text-sm">{t("myStockHint")}</p>
        </div>
        {stockOps.length === 0 ? (
          <p className="py-4 text-center text-muted-foreground">{t("noStock")}</p>
        ) : (
          stockOps.map((o) => (
            <div key={o.code} className="flex flex-col gap-3 rounded-2xl border bg-card p-4">
              <div className="flex items-center gap-3">
                <OperatorLogo code={o.code} name={o.name} color={o.color} className="size-10 rounded-xl" />
                <span className="flex-1 font-semibold">{o.name}</span>
                <Dt compact millimes={stock[o.code]} className="font-bold text-2xl" />
              </div>
              <span className="text-muted-foreground text-sm">
                {t.rich("todayRate", { cash: () => <Dt compact millimes={grossPayout(10_000, o.rateBps)} className="font-semibold text-foreground" /> })}
              </span>
              <SellStockForm op={{ code: o.code, name: o.name, color: o.color, rateBps: o.rateBps }} stockMillimes={stock[o.code]} />
            </div>
          ))
        )}
      </section>
    </div>
  );
}
