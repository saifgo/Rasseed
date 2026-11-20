import { ArrowRightIcon, ChevronDownIcon, FileTextIcon, HandCoinsIcon, PackageIcon, PencilIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { AutoRefresh } from "@/components/app/auto-refresh";
import { Secret } from "@/components/app/confidential";
import { Rating } from "@/components/app/market-badges";
import { Dt } from "@/components/app/money";
import { OperatorLogo } from "@/components/app/operator-badge";
import { OperatorFilter } from "@/components/app/operator-filter";
import { ActionOrderCard, CollapsedList, OrderRow, SectionTitle } from "@/components/app/order-row";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { brand } from "@/config/brand";
import { OPEN_ORDER_STATUSES } from "@/db/schema";
import { db } from "@/db";
import { balancesByOperator } from "@/lib/engine/ledger";
import { buyerBadMarks, listSellerOrders, orderPrice, sellerReputation } from "@/lib/engine/market";
import { listActiveListings, listSellerListings, requireMarketUser, sellerNextStep, userNames } from "@/lib/market-queries";
import { formatDt, grossPayout } from "@/lib/money";
import { listOperators } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { ListingForm, SellStockForm } from "./selling-forms";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sell" };

const HISTORY_SHOWN = 30;

export default async function SellingPage({ searchParams }: { searchParams: Promise<{ op?: string }> }) {
  const { user } = await requireMarketUser();
  const t = await getTranslations("market");
  const format = await getFormatter();
  const { op: wanted } = await searchParams;
  const [ops, myListings, orders, stock, reputation, board] = await Promise.all([
    listOperators(),
    listSellerListings(user.id),
    listSellerOrders(user.id),
    balancesByOperator(db, "seller_stock", user.id),
    sellerReputation([user.id]),
    listActiveListings(user.id),
  ]);
  const buyerIds = [...new Set(orders.map((o) => o.buyerId))];
  const [names, marks] = await Promise.all([userNames(buyerIds), buyerBadMarks(buyerIds)]);
  const activeOps = ops.filter((o) => o.active);
  const opBy = Object.fromEntries(ops.map((o) => [o.code, o]));
  const stockOps = ops.filter((o) => (stock[o.code] ?? 0) > 0);
  const when = (d: Date) => format.dateTime(d, { dateStyle: "medium", timeStyle: "short" });
  const secret = (c: React.ReactNode) => <Secret>{c}</Secret>;
  const buyerOf = (o: (typeof orders)[number]) => {
    const bad = marks[o.buyerId] ?? 0;
    return (
      <>
        {names[o.buyerId] ?? t("buyer")}
        {bad > 0 && <span className="ms-2 text-amber-700 text-xs dark:text-amber-400">{t("badMarksShort", { count: bad })}</span>}
      </>
    );
  };

  const todo = orders
    .map((o) => ({ o, step: sellerNextStep(o) }))
    .filter((x) => x.step)
    .sort((a, b) => a.o.createdAt.getTime() - b.o.createdAt.getTime());
  const todoIds = new Set(todo.map((x) => x.o.id));
  const waiting = orders.filter((o) => OPEN_ORDER_STATUSES.includes(o.status) && !todoIds.has(o.id));
  const history = orders.filter((o) => !OPEN_ORDER_STATUSES.includes(o.status) && !todoIds.has(o.id));
  const live = todo.length > 0 || waiting.length > 0;

  // The market for one operator at a time; start with one the seller already sells.
  const op =
    activeOps.find((o) => o.code === wanted) ?? activeOps.find((o) => myListings.some((l) => l.operatorCode === o.code && l.active)) ?? activeOps[0];
  const mine = op ? myListings.find((l) => l.operatorCode === op.code) : undefined;
  const prices = op ? board.filter((l) => l.operatorCode === op.code) : [];

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8">
      {live && <AutoRefresh seconds={10} />}
      <div className="flex flex-col gap-1">
        <h1 className="font-heading font-bold text-3xl tracking-tight">{t("sellHome.title")}</h1>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">{t("myRating")}</span>
          <Rating rating={reputation[user.id] ?? null} />
        </div>
      </div>

      {/* Needs your action */}
      {todo.length > 0 && (
        <section className="flex flex-col gap-3">
          <SectionTitle title={t("needsAction")} />
          <ul className="flex flex-col gap-3">
            {todo.map(({ o, step }) => {
              const content =
                step === "send"
                  ? {
                      href: `/sell?order=${o.id}`,
                      todo: t.rich("sellHome.todoSend", { missing: formatDt(Math.max(0, o.amountMillimes - o.fundedMillimes)), secret }),
                      cta: t("sellHome.ctaSend"),
                      icon: <HandCoinsIcon aria-hidden="true" />,
                    }
                  : step === "check"
                    ? {
                        href: `/orders/${o.id}`,
                        todo: t.rich("sellHome.todoCheck", { pay: formatDt(orderPrice(o.amountMillimes, o.priceBps)), secret }),
                        cta: t("sellHome.ctaCheck"),
                        icon: <FileTextIcon aria-hidden="true" />,
                      }
                    : {
                        href: `/orders/${o.id}`,
                        todo: t.rich("sellHome.todoLeftover", { amount: formatDt(o.leftoverMillimes), secret }),
                        cta: t("sellHome.ctaChoose"),
                        icon: <PackageIcon aria-hidden="true" />,
                      };
              return (
                <ActionOrderCard
                  key={o.id}
                  href={content.href}
                  op={opBy[o.operatorCode]}
                  amountMillimes={o.amountMillimes}
                  who={buyerOf(o)}
                  todo={content.todo}
                  cta={content.cta}
                  icon={content.icon}
                />
              );
            })}
          </ul>
        </section>
      )}

      {/* Waiting for the buyer */}
      {waiting.length > 0 && (
        <section className="flex flex-col gap-3">
          <SectionTitle title={t("inProgress")} hint={t("sellHome.waitingHint")} />
          <ul className="flex flex-col divide-y overflow-hidden rounded-2xl border bg-card">
            {waiting.map((o) => (
              <OrderRow
                key={o.id}
                href={`/orders/${o.id}`}
                op={opBy[o.operatorCode]}
                amountMillimes={o.amountMillimes}
                who={buyerOf(o)}
                status={o.status}
                when={when(o.createdAt)}
                orderRef={o.ref}
              />
            ))}
          </ul>
        </section>
      )}

      {/* The market */}
      {op && (
        <section className="flex flex-col gap-3">
          <SectionTitle title={t("sellHome.marketTitle")} hint={t("sellHome.marketHint")} />
          <OperatorFilter operators={activeOps} current={op.code} hrefFor={(code) => `/selling?op=${code}`} label={t("filter")} scroll={false} />

          <div className="flex flex-col overflow-hidden rounded-2xl border bg-card">
            {/* Everyone's price for 10 DT, cheapest first */}
            {prices.length === 0 ? (
              <p className="p-4 text-center text-muted-foreground">{t("noListings")}</p>
            ) : (
              <ol className="flex flex-col divide-y">
                {prices.map((l, i) => (
                  <li
                    key={l.id}
                    className={cn("flex items-center gap-3 px-4 py-3", l.mine && "bg-emerald-600/8")}
                  >
                    <span className="w-5 shrink-0 text-center text-muted-foreground text-sm tabular-nums">{i + 1}</span>
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="flex flex-wrap items-center gap-2 font-medium">
                        {l.mine ? t("sellHome.you") : l.sellerId ? (l.sellerName ?? t("seller")) : brand.name}
                        {l.mine && (
                          <Badge variant="success" className="rounded-full">
                            {t("sellHome.yourPrice")}
                          </Badge>
                        )}
                      </span>
                      <Rating rating={l.rating} />
                    </div>
                    <Dt compact millimes={orderPrice(10_000, l.priceBps)} className={cn("font-bold text-xl", l.mine && "text-emerald-700 dark:text-emerald-400")} />
                  </li>
                ))}
              </ol>
            )}
            <p className="border-t bg-muted/40 px-4 py-2 text-muted-foreground text-xs">{t("sellers.per10", { operator: op.name })}</p>

            {/* My offer, editable here */}
            <details className="group border-t" open={!mine}>
              <summary className="flex cursor-pointer list-none items-center gap-3 p-4 [&::-webkit-details-marker]:hidden">
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="font-semibold">{t("yourOffer")}</span>
                  <span className="text-muted-foreground text-sm">
                    {mine
                      ? t.rich(mine.active ? "sellHome.offerOn" : "sellHome.offerOff", {
                          pay: () => <Dt compact millimes={grossPayout(10_000, mine.priceBps)} className="font-semibold text-foreground" />,
                        })
                      : t("sellHome.noOffer")}
                  </span>
                </span>
                <span className="inline-flex items-center gap-1.5 font-medium text-sm">
                  <PencilIcon aria-hidden="true" className="size-4" />
                  {t("sellHome.change")}
                </span>
                <ChevronDownIcon aria-hidden="true" className="size-5 text-muted-foreground transition-transform group-open:rotate-180" />
              </summary>
              <div className="border-t p-4">
                <ListingForm
                  key={op.code}
                  bare
                  op={{ code: op.code, name: op.name, color: op.color, rateBps: op.rateBps }}
                  listing={mine ? { priceBps: mine.priceBps, paymentInfo: mine.paymentInfo, active: mine.active } : null}
                />
              </div>
            </details>
          </div>

          {/* Or sell straight to Sarfli */}
          <div className="flex flex-col gap-3 rounded-2xl border bg-card p-4 sm:flex-row sm:items-center">
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="font-semibold">{t("sellHome.sarfliTitle", { brand: brand.name })}</span>
              <span className="text-muted-foreground text-sm">
                {t.rich("todayRate", { cash: () => <Dt compact millimes={grossPayout(10_000, op.rateBps)} className="font-semibold text-foreground" /> })}
              </span>
            </div>
            <Button variant="outline" className="h-12 text-base sm:h-12" render={<Link href={`/sell?op=${op.code}`} />}>
              <HandCoinsIcon aria-hidden="true" />
              {t("sellToSarfli")}
              <ArrowRightIcon aria-hidden="true" className="rtl:rotate-180" />
            </Button>
          </div>
        </section>
      )}

      {/* Stock */}
      {stockOps.length > 0 && (
        <section className="flex flex-col gap-3">
          <SectionTitle title={t("myStock")} hint={t("myStockHint")} />
          {stockOps.map((o) => (
            <div key={o.code} className="flex flex-col gap-3 rounded-2xl border bg-card p-4">
              <div className="flex items-center gap-3">
                <OperatorLogo code={o.code} name={o.name} color={o.color} className="size-12 rounded-xl" />
                <span className="flex-1 font-semibold">{o.name}</span>
                <Dt compact millimes={stock[o.code]} className="font-bold text-2xl" />
              </div>
              <span className="text-muted-foreground text-sm">
                {t.rich("todayRate", { cash: () => <Dt compact millimes={grossPayout(10_000, o.rateBps)} className="font-semibold text-foreground" /> })}
              </span>
              <SellStockForm op={{ code: o.code, name: o.name, color: o.color, rateBps: o.rateBps }} stockMillimes={stock[o.code]} />
            </div>
          ))}
        </section>
      )}

      {/* History */}
      {history.length > 0 && (
        <CollapsedList title={t("finishedOrders")} count={history.length}>
          {history.slice(0, HISTORY_SHOWN).map((o) => (
            <OrderRow
              key={o.id}
              href={`/orders/${o.id}`}
              op={opBy[o.operatorCode]}
              amountMillimes={o.amountMillimes}
              who={buyerOf(o)}
              status={o.status}
              when={when(o.createdAt)}
              orderRef={o.ref}
            />
          ))}
        </CollapsedList>
      )}
    </div>
  );
}
