import { ArrowRightIcon, HandCoinsIcon, MonitorSmartphoneIcon, RepeatIcon, ShoppingCartIcon, SmartphoneIcon, StarIcon, TriangleAlertIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { AutoRefresh } from "@/components/app/auto-refresh";
import { Secret } from "@/components/app/confidential";
import { RechargeStatusBadge } from "@/components/app/market-badges";
import { Dt } from "@/components/app/money";
import { OperatorLogo } from "@/components/app/operator-badge";
import { ActionOrderCard, CollapsedList, OrderRow, SectionTitle } from "@/components/app/order-row";
import { Button } from "@/components/ui/button";
import { brand } from "@/config/brand";
import { ACTIVE_RECHARGE_STATUSES, OPEN_ORDER_STATUSES } from "@/db/schema";
import { db } from "@/db";
import { balancesByOperator } from "@/lib/engine/ledger";
import { listBuyerOrders, orderPrice } from "@/lib/engine/market";
import { listPackages } from "@/lib/engine/packages";
import { listBuyerRecharges } from "@/lib/engine/recharge";
import { buyerNextStep, ratedOrderIds, rateableStatus, requireMarketUser, spendingOffer, userNames } from "@/lib/market-queries";
import { formatDt } from "@/lib/money";
import { formatMsisdn } from "@/lib/phone";
import { listOperators } from "@/lib/queries";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Buy" };

const FINISHED_SHOWN = 20;
const RECHARGES_SHOWN = 3;

export default async function BuyPage() {
  const { user } = await requireMarketUser();
  const t = await getTranslations("market");
  const format = await getFormatter();
  const [ops, balances, orders, recharges, allPackages] = await Promise.all([
    listOperators(),
    balancesByOperator(db, "buyer", user.id),
    listBuyerOrders(user.id),
    listBuyerRecharges(user.id),
    listPackages({ activeOnly: true }),
  ]);
  const [names, rated, { rechargeEnabled, packages }] = await Promise.all([
    userNames(orders.map((o) => o.sellerId)),
    ratedOrderIds(orders.filter(rateableStatus).map((o) => o.id)),
    spendingOffer(ops, allPackages),
  ]);
  const activeOps = ops.filter((o) => o.active);
  const opBy = Object.fromEntries(ops.map((o) => [o.code, o]));
  const when = (d: Date) => format.dateTime(d, { dateStyle: "medium", timeStyle: "short" });
  const sellerOf = (o: (typeof orders)[number]) => (o.sellerId ? (names[o.sellerId] ?? t("seller")) : brand.name);

  // Oldest first for things to do, newest first for the rest.
  const todo = orders
    .map((o) => ({ o, step: buyerNextStep(o, rated) }))
    .filter((x) => x.step)
    .sort((a, b) => a.o.createdAt.getTime() - b.o.createdAt.getTime());
  const todoIds = new Set(todo.map((x) => x.o.id));
  const inProgress = orders.filter((o) => OPEN_ORDER_STATUSES.includes(o.status) && !todoIds.has(o.id));
  const finished = orders.filter((o) => !OPEN_ORDER_STATUSES.includes(o.status) && !todoIds.has(o.id));
  const live = orders.some((o) => OPEN_ORDER_STATUSES.includes(o.status)) || recharges.some((r) => ACTIVE_RECHARGE_STATUSES.includes(r.status));

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8">
      {live && <AutoRefresh seconds={10} />}
      <h1 className="font-heading font-bold text-3xl tracking-tight">{t("buyHome.title")}</h1>

      {/* Balances */}
      <section className="flex flex-col gap-3">
        <SectionTitle title={t("myCredit")} />
        <ul className="flex flex-col divide-y overflow-hidden rounded-2xl border bg-card">
          {activeOps.map((o) => {
            const balance = balances[o.code] ?? 0;
            // Credit recharges or data packages: either one makes the balance spendable.
            const offersSpending = rechargeEnabled(o) || packages.some((p) => p.operatorCode === o.code);
            const canRecharge = offersSpending && balance > 0;
            return (
              <li key={o.code} className="flex items-center gap-4 p-4">
                <OperatorLogo code={o.code} name={o.name} color={o.color} className="size-12 rounded-xl" />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="text-muted-foreground text-sm">{o.name}</span>
                  <Dt compact millimes={balance} className={balance > 0 ? "font-bold text-2xl" : "font-bold text-2xl text-muted-foreground"} />
                </div>
                {offersSpending &&
                  (canRecharge ? (
                    <Button variant="outline" className="h-11 shrink-0 text-base sm:h-11" render={<Link href={`/buy/recharge?op=${o.code}`} />}>
                      <SmartphoneIcon aria-hidden="true" />
                      {t("buyHome.recharge")}
                    </Button>
                  ) : (
                    <Button variant="outline" className="h-11 shrink-0 text-base sm:h-11" disabled>
                      <SmartphoneIcon aria-hidden="true" />
                      {t("buyHome.recharge")}
                    </Button>
                  ))}
              </li>
            );
          })}
        </ul>
      </section>

      <Button variant="go" className="h-14 w-full text-lg sm:h-14 sm:text-lg" render={<Link href="/buy/sellers" />}>
        <ShoppingCartIcon aria-hidden="true" className="size-5" />
        {t("buyHome.buyCta")}
        <ArrowRightIcon aria-hidden="true" className="size-5 rtl:rotate-180" />
      </Button>

      {orders.length === 0 && (
        <p className="py-6 text-center text-muted-foreground">{t("buyHome.empty")}</p>
      )}

      {/* Needs your action */}
      {todo.length > 0 && (
        <section className="flex flex-col gap-3">
          <SectionTitle title={t("needsAction")} />
          <ul className="flex flex-col gap-3">
            {todo.map(({ o, step }) => {
              const op = opBy[o.operatorCode];
              const seller = sellerOf(o);
              const secret = (c: React.ReactNode) => <Secret>{c}</Secret>;
              const content =
                step === "pay"
                  ? {
                      todo: t.rich("buyHome.todoPay", { pay: formatDt(orderPrice(o.amountMillimes, o.priceBps)), seller, secret }),
                      cta: t("buyHome.ctaPay"),
                      icon: <HandCoinsIcon aria-hidden="true" />,
                    }
                  : step === "excess"
                    ? {
                        todo: t.rich("buyHome.todoExcess", { excess: formatDt(o.excessMillimes), secret }),
                        cta: t("buyHome.ctaChoose"),
                        icon: <TriangleAlertIcon aria-hidden="true" />,
                      }
                    : { todo: t("buyHome.todoRate", { seller }), cta: t("buyHome.ctaRate"), icon: <StarIcon aria-hidden="true" /> };
              return (
                <ActionOrderCard
                  key={o.id}
                  href={`/orders/${o.id}`}
                  op={op}
                  amountMillimes={o.amountMillimes}
                  who={seller}
                  todo={content.todo}
                  cta={content.cta}
                  icon={content.icon}
                />
              );
            })}
          </ul>
        </section>
      )}

      {/* Other open orders */}
      {inProgress.length > 0 && (
        <section className="flex flex-col gap-3">
          <SectionTitle title={t("inProgress")} hint={t("buyHome.inProgressHint")} />
          <ul className="flex flex-col divide-y overflow-hidden rounded-2xl border bg-card">
            {inProgress.map((o) => (
              <OrderRow
                key={o.id}
                href={`/orders/${o.id}`}
                op={opBy[o.operatorCode]}
                amountMillimes={o.amountMillimes}
                who={sellerOf(o)}
                status={o.status}
                when={when(o.createdAt)}
                orderRef={o.ref}
              />
            ))}
          </ul>
        </section>
      )}

      {/* Finished */}
      {finished.length > 0 && (
        <CollapsedList title={t("finishedOrders")} count={finished.length}>
          {finished.slice(0, FINISHED_SHOWN).map((o) => (
            <OrderRow
              key={o.id}
              href={`/orders/${o.id}`}
              op={opBy[o.operatorCode]}
              amountMillimes={o.amountMillimes}
              who={sellerOf(o)}
              status={o.status}
              when={when(o.createdAt)}
              orderRef={o.ref}
            />
          ))}
        </CollapsedList>
      )}

      {/* Recent recharges */}
      {recharges.length > 0 && (
        <section className="flex flex-col gap-3">
          <SectionTitle
            title={t("rechargeHistory")}
            action={
              <Button variant="ghost" className="h-10 text-base" render={<Link href="/buy/recharge" />}>
                {t("seeAll")}
                <ArrowRightIcon aria-hidden="true" className="rtl:rotate-180" />
              </Button>
            }
          />
          <ul className="flex flex-col divide-y overflow-hidden rounded-2xl border bg-card">
            {recharges.slice(0, RECHARGES_SHOWN).map((r) => {
              const op = opBy[r.operatorCode];
              return (
                <li key={r.id} className="flex items-center gap-4 p-4">
                  <OperatorLogo code={op.code} name={op.name} color={op.color} className="size-12 rounded-xl" />
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <Dt compact millimes={r.amountMillimes} className="font-semibold text-lg" />
                      <Secret dir="ltr" className="font-mono text-muted-foreground text-sm">
                        {formatMsisdn(r.msisdn)}
                      </Secret>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <RechargeStatusBadge status={r.status} />
                      <span className="text-muted-foreground text-xs">{when(r.createdAt)}</span>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <Button variant="ghost" className="h-12 self-start text-base text-muted-foreground" render={<Link href="/buy/resell" />}>
        <RepeatIcon aria-hidden="true" />
        {t("resell.link")}
        <ArrowRightIcon aria-hidden="true" className="rtl:rotate-180" />
      </Button>
      <Button variant="ghost" className="-mt-4 h-12 self-start text-base text-muted-foreground" render={<Link href="/buy/pos" />}>
        <MonitorSmartphoneIcon aria-hidden="true" />
        {t("pos.link")}
        <ArrowRightIcon aria-hidden="true" className="rtl:rotate-180" />
      </Button>
    </div>
  );
}
