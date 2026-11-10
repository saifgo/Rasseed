import {
  ArrowLeftIcon,
  BanIcon,
  CheckIcon,
  ChevronDownIcon,
  ClockIcon,
  FileTextIcon,
  HandCoinsIcon,
  HourglassIcon,
  SearchIcon,
  SmartphoneIcon,
  TriangleAlertIcon,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { AutoRefresh } from "@/components/app/auto-refresh";
import { Secret } from "@/components/app/confidential";
import { OrderStatusBadge, Rating } from "@/components/app/market-badges";
import { Dt } from "@/components/app/money";
import { OperatorLogo } from "@/components/app/operator-badge";
import { Timeline } from "@/components/app/timeline";
import { Button } from "@/components/ui/button";
import { brand } from "@/config/brand";
import { OPEN_ORDER_STATUSES } from "@/db/schema";
import { formatDt, formatPercent, grossPayout } from "@/lib/money";
import { getOrderPageView, requireMarketUser } from "@/lib/market-queries";
import { cn } from "@/lib/utils";
import {
  BuyerCancelButton,
  ConfirmPaymentButtons,
  ExcessChoice,
  FlagButton,
  LeftoverChoice,
  ProofUpload,
  RateForm,
  SellerCancelButton,
  TakePartialButton,
} from "./order-actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Order" };

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  await requireMarketUser();
  const { id } = await params;
  const view = await getOrderPageView(id);
  if (!view) notFound();
  const t = await getTranslations("market");
  const format = await getFormatter();
  const { order, role, operator: op } = view;
  const buyer = role === "buyer";
  const seller = role === "seller";
  const sellerName = order.sellerId ? (view.sellerName ?? t("seller")) : brand.name;
  const buyerName = view.buyerName ?? t("buyer");
  const missing = Math.max(0, order.amountMillimes - order.fundedMillimes);
  const open = OPEN_ORDER_STATUSES.includes(order.status);
  const leftoverPending = order.status === "cancelled" && order.leftoverMillimes > 0 && !order.leftoverChoice;
  const showPayment = ["funded", "proof_uploaded", "admin_review"].includes(order.status) && order.excessMillimes === 0;
  const dt = (m: number) => formatDt(m);
  const secret = (c: React.ReactNode) => <Secret>{c}</Secret>;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5 px-4 py-6">
      {(open || leftoverPending) && <AutoRefresh seconds={5} />}
      <Button
        variant="ghost"
        className="-ms-2 h-10 self-start text-base text-muted-foreground"
        render={<Link href={seller ? "/market/selling" : "/market"} />}
      >
        <ArrowLeftIcon aria-hidden="true" className="rtl:rotate-180" />
        {seller ? t("backToSelling") : t("backToMarket")}
      </Button>

      {/* Operator banner */}
      <div className="flex items-center gap-4 rounded-2xl p-4 text-white" style={{ backgroundColor: op.color }}>
        <OperatorLogo code={op.code} name={op.name} color={op.color} className="size-14 rounded-2xl" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="font-heading font-bold text-xl">{t("orderTitle", { operator: op.name })}</span>
          <span className="text-sm text-white/85">
            {buyer ? t("boughtFrom", { name: sellerName }) : seller ? t("soldTo", { name: buyerName }) : t("betweenParties", { buyer: buyerName, seller: sellerName })}
          </span>
        </div>
        <Dt compact millimes={order.amountMillimes} className="font-bold text-2xl [&_span]:text-white/80" />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <OrderStatusBadge status={order.status} />
        <Secret className="font-mono text-muted-foreground text-sm">{order.ref}</Secret>
      </div>

      {/* Funding progress */}
      {order.sellerId && (order.status === "funding" || order.status === "funded") && (
        <section className="flex flex-col gap-2 rounded-2xl border bg-card p-5">
          <div className="flex items-baseline justify-between gap-3">
            <span className="font-semibold">{t("fundingLabel")}</span>
            <span className="text-muted-foreground text-sm">
              {t.rich("fundingProgress", { funded: dt(order.fundedMillimes), amount: dt(order.amountMillimes), secret })}
            </span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
            <div
              className="h-full rounded-full transition-[width]"
              style={{ width: `${Math.min(100, (order.fundedMillimes / order.amountMillimes) * 100)}%`, backgroundColor: op.color }}
            />
          </div>
        </section>
      )}

      {/* ----- Buyer ----- */}
      {buyer && order.status === "funding" && (
        <StateCard icon={<HourglassIcon />} title={t("buyerFundingTitle")}>
          <span className="flex flex-col gap-4">
            <span>{t("buyerFundingText", { seller: sellerName })}</span>
            {order.fundedMillimes > 0 && <TakePartialButton orderId={order.id} fundedMillimes={order.fundedMillimes} />}
          </span>
        </StateCard>
      )}
      {buyer && order.status === "funded" && order.excessMillimes > 0 && (
        <StateCard icon={<TriangleAlertIcon />} title={t("excessTitle")} tone="warning">
          <span className="flex flex-col gap-4">
            <span>
              {t.rich("excessText", {
                excess: dt(order.excessMillimes),
                total: dt(order.fundedMillimes),
                pay: dt(view.payWithExcessMillimes),
                secret,
              })}
            </span>
            <ExcessChoice orderId={order.id} excessMillimes={order.excessMillimes} />
          </span>
        </StateCard>
      )}
      {buyer && order.status === "funded" && order.excessMillimes === 0 && (
        <StateCard icon={<HandCoinsIcon />} title={t("buyerPayTitle")} tone="go">
          {t.rich("buyerPayText", { pay: dt(view.payMillimes), seller: sellerName, secret })}
        </StateCard>
      )}
      {buyer && order.status === "proof_uploaded" && (
        <StateCard icon={<ClockIcon />} title={t("buyerWaitTitle")}>
          {t("buyerWaitText", { seller: sellerName })}
        </StateCard>
      )}
      {order.status === "admin_review" && (
        <StateCard icon={<SearchIcon />} title={t("reviewTitle")} tone="warning">
          <span className="flex flex-col gap-1">
            <span>{t(order.disputedBy === "seller" ? "reviewBySeller" : "reviewByBuyer")}</span>
            {order.disputeReason && <span className="whitespace-pre-line text-foreground">“{order.disputeReason}”</span>}
          </span>
        </StateCard>
      )}
      {buyer && order.status === "released" && (
        <SuccessCard title={t("releasedTitle")} amount={view.toBuyerMillimes}>
          <span className="flex flex-col gap-4">
            <span>{t("releasedText", { operator: op.name })}</span>
            <Button variant="go" className="h-12 text-base sm:h-12" render={<Link href="/market/recharge" />}>
              <SmartphoneIcon aria-hidden="true" />
              {t("rechargeCta")}
            </Button>
          </span>
        </SuccessCard>
      )}

      {/* ----- Seller ----- */}
      {seller && order.status === "funding" && (
        <StateCard icon={<HandCoinsIcon />} title={t.rich("sellerSendTitle", { missing: dt(missing), secret })} tone="go">
          <span className="flex flex-col gap-4">
            <span>{t("sellerSendText")}</span>
            <Button variant="go" className="h-12 text-base sm:h-12" render={<Link href={`/sell?order=${order.id}`} />}>
              <HandCoinsIcon aria-hidden="true" />
              {t("sellerSendCta")}
            </Button>
          </span>
        </StateCard>
      )}
      {seller && order.status === "funded" && (
        <StateCard icon={<ClockIcon />} title={t("sellerWaitPayTitle")}>
          {order.excessMillimes > 0
            ? t.rich("sellerWaitExcessText", { excess: dt(order.excessMillimes), secret })
            : t.rich("sellerWaitPayText", { pay: dt(view.payMillimes), secret })}
        </StateCard>
      )}
      {seller && (order.status === "proof_uploaded" || order.status === "admin_review") && (
        <StateCard icon={<FileTextIcon />} title={t("sellerCheckTitle")} tone="go">
          <span className="flex flex-col gap-4">
            <span>{t.rich("sellerCheckText", { pay: dt(view.payMillimes), secret })}</span>
            <ConfirmPaymentButtons orderId={order.id} payMillimes={view.payMillimes} canReport={order.status === "proof_uploaded"} />
          </span>
        </StateCard>
      )}
      {seller && order.status === "released" && (
        <SuccessCard title={t("sellerReleasedTitle")} amount={order.amountMillimes}>
          {t("sellerReleasedText")}
        </SuccessCard>
      )}
      {seller && leftoverPending && (
        <StateCard icon={<TriangleAlertIcon />} title={t("leftoverTitle")} tone="warning">
          <span className="flex flex-col gap-4">
            <span>{t.rich("leftoverText", { amount: dt(order.leftoverMillimes), secret })}</span>
            <LeftoverChoice orderId={order.id} cashMillimes={grossPayout(order.leftoverMillimes, op.rateBps)} />
          </span>
        </StateCard>
      )}

      {/* ----- Cancelled (everyone) ----- */}
      {order.status === "cancelled" && (
        <StateCard icon={<BanIcon />} title={t("cancelledTitle")}>
          <span className="flex flex-col gap-1">
            <span>{t(`cancelledBy.${order.cancelledBy ?? "admin"}`)}</span>
            {order.cancelReason && <span className="whitespace-pre-line text-foreground">“{order.cancelReason}”</span>}
            {order.buyerBadMark && <span className="font-medium text-destructive-foreground">{t(buyer ? "badMarkYou" : "badMarkGiven")}</span>}
            {!buyer && order.leftoverChoice === "stock" && <span>{t.rich("leftoverKept", { amount: dt(order.leftoverMillimes), secret })}</span>}
            {!buyer && order.leftoverChoice === "sarfli" && <span>{t.rich("leftoverSoldText", { amount: dt(order.leftoverMillimes), secret })}</span>}
          </span>
        </StateCard>
      )}

      {/* Payment details: amount and how to pay */}
      {showPayment && (
        <section className="flex flex-col divide-y overflow-hidden rounded-2xl border-2 bg-card" style={{ borderColor: op.color }}>
          <div className="flex items-baseline justify-between gap-3 p-4">
            <span className="font-semibold text-lg">{buyer ? t("toPay") : t("buyerPays")}</span>
            <Dt compact millimes={view.payMillimes} className="font-bold text-3xl" />
          </div>
          <div className="flex flex-col gap-1 p-4">
            <span className="text-muted-foreground text-sm">{t("howToPay", { seller: sellerName })}</span>
            <p className="whitespace-pre-line break-words font-medium">{order.paymentInfo || t("noPaymentInfo")}</p>
          </div>
        </section>
      )}

      {/* Buyer actions */}
      {buyer && order.status === "funded" && order.excessMillimes === 0 && <ProofUpload orderId={order.id} first />}
      {buyer && (order.status === "proof_uploaded" || order.status === "admin_review") && <ProofUpload orderId={order.id} first={false} />}
      {buyer && order.status === "proof_uploaded" && (
        <div className="flex flex-col gap-2">
          <p className="text-muted-foreground text-sm">{t("flagHint", { seller: sellerName })}</p>
          <FlagButton orderId={order.id} />
        </div>
      )}
      {buyer && view.canRate && <RateForm orderId={order.id} />}

      {/* Proofs */}
      {view.proofs.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="font-heading font-semibold text-xl">{t("proofs")}</h2>
          <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4">
            {view.proofs.map((p) => {
              const href = `/api/orders/${order.id}/proofs/${p.id}`;
              return (
                <li key={p.id}>
                  <a
                    href={href}
                    target="_blank"
                    rel="noreferrer"
                    className="flex aspect-square items-center justify-center overflow-hidden rounded-xl border bg-muted transition-opacity hover:opacity-80"
                  >
                    {p.mime.startsWith("image/") ? (
                      // eslint-disable-next-line @next/next/no-img-element -- private files served by our route
                      <img src={href} alt={t("proof")} className="size-full object-cover" />
                    ) : (
                      <span className="flex flex-col items-center gap-1 text-muted-foreground text-xs">
                        <FileTextIcon aria-hidden="true" className="size-8" />
                        PDF
                      </span>
                    )}
                  </a>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Reputation info, never blocks anything */}
      {!buyer && (
        <p className={cn("flex items-center gap-2 rounded-xl p-3 text-sm", view.buyerBadMarks > 0 ? "bg-amber-500/8" : "bg-muted/60")}>
          <TriangleAlertIcon aria-hidden="true" className={cn("size-4 shrink-0", view.buyerBadMarks > 0 ? "text-amber-600" : "text-muted-foreground")} />
          {t("buyerMarks", { name: buyerName, count: view.buyerBadMarks })}
        </p>
      )}

      {/* Cancel buttons */}
      {buyer && (order.status === "funding" || order.status === "funded") && (
        <BuyerCancelButton orderId={order.id} badMark={view.cancelGivesBadMark} />
      )}
      {seller && (order.status === "funding" || order.status === "funded") && <SellerCancelButton orderId={order.id} />}

      {/* Details */}
      <details className="group rounded-2xl border">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 font-medium [&::-webkit-details-marker]:hidden">
          {t("moreDetails")}
          <ChevronDownIcon aria-hidden="true" className="size-5 text-muted-foreground transition-transform group-open:rotate-180" />
        </summary>
        <div className="flex flex-col gap-5 border-t p-4">
          <dl className="flex flex-col gap-3 text-sm">
            <Detail label={t("seller")}>
              <span className="flex flex-wrap items-center justify-end gap-2">
                {sellerName}
                <Rating rating={view.sellerRating} />
              </span>
            </Detail>
            <Detail label={t("requested")}>
              <Dt compact millimes={order.requestedMillimes} />
            </Detail>
            <Detail label={t("orderAmount")}>
              <Dt compact millimes={order.amountMillimes} />
            </Detail>
            <Detail label={t("price")}>{t.rich("priceLine", { pay: () => <Dt compact millimes={grossPayout(10_000, order.priceBps)} /> })}</Detail>
            <Detail label={t("toPay")}>
              <Dt compact millimes={view.payMillimes} />
            </Detail>
            <Detail label={t("commissionLine", { percent: formatPercent(order.commissionBps) })}>
              <Dt compact millimes={view.commissionMillimes} />
            </Detail>
            <Detail label={t("toBuyerBalance")}>
              <Dt compact millimes={view.toBuyerMillimes} className="font-semibold" />
            </Detail>
            <Detail label={t("created")}>{format.dateTime(order.createdAt, { dateStyle: "medium", timeStyle: "short" })}</Detail>
            {order.adminNote && <Detail label={t("adminNote")}>{order.adminNote}</Detail>}
          </dl>
          <div className="flex flex-col gap-3">
            <h3 className="font-medium">{t("timeline")}</h3>
            <Timeline events={view.events} namespace="market.events" />
          </div>
        </div>
      </details>
    </div>
  );
}

function SuccessCard({ title, amount, children }: { title: string; amount: number; children: React.ReactNode }) {
  return (
    <section className="flex flex-col items-center gap-3 rounded-2xl border bg-card px-5 py-8 text-center">
      <span className="flex size-16 items-center justify-center rounded-full bg-emerald-600 text-white" aria-hidden="true">
        <CheckIcon className="size-9" strokeWidth={3} />
      </span>
      <h2 className="font-heading font-bold text-2xl">{title}</h2>
      <Dt compact millimes={amount} className="font-bold text-5xl text-emerald-700 dark:text-emerald-400" />
      <div className="mt-1 w-full text-muted-foreground">{children}</div>
    </section>
  );
}

function StateCard({
  icon,
  title,
  children,
  tone,
}: {
  icon: React.ReactNode;
  title: React.ReactNode;
  children: React.ReactNode;
  tone?: "warning" | "go";
}) {
  const toneClass = tone === "warning" ? "border-amber-500/50 bg-amber-500/6" : tone === "go" ? "border-emerald-600/40 bg-emerald-600/5" : "bg-card";
  const iconClass = tone === "warning" ? "text-amber-600" : tone === "go" ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground";
  return (
    <section className={cn("flex gap-4 rounded-2xl border p-5", toneClass)}>
      <span className={cn("shrink-0 pt-0.5 [&_svg]:size-6", iconClass)} aria-hidden="true">
        {icon}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <h2 className="font-heading font-bold text-xl">{title}</h2>
        <div className="text-muted-foreground">{children}</div>
      </div>
    </section>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-end">{children}</dd>
    </div>
  );
}
