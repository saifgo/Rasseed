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
  ShieldIcon,
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
import { OPEN_ORDER_STATUSES, type OrderStatus } from "@/db/schema";
import { formatDt, formatPercent, grossPayout } from "@/lib/money";
import { getOrderPageView, type OrderPageView, requireMarketUser } from "@/lib/market-queries";
import { cn } from "@/lib/utils";
import {
  BuyerCancelButton,
  ConfirmPaidButton,
  ExcessChoice,
  FlagButton,
  LeftoverChoice,
  NotPaidButton,
  ProofUpload,
  RateForm,
  SellerCancelButton,
  TakePartialButton,
} from "./order-actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Order" };

type T = Awaited<ReturnType<typeof getTranslations<"market">>>;

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
  const dt = (m: number) => formatDt(m);
  const secret = (c: React.ReactNode) => <Secret>{c}</Secret>;
  const checking = order.status === "proof_uploaded" || order.status === "admin_review";
  const funding = order.status === "funding" || order.status === "funded";
  // The seller checks the proof inside the main card; everyone else sees it further down.
  const proofsInCard = seller && checking;
  const back = buyer
    ? { href: "/buy", label: t("buyHome.title") }
    : seller
      ? { href: "/selling", label: t("sellHome.title") }
      : { href: `/admin/market/orders/${order.id}`, label: t("order.openAdmin") };

  const progress = order.sellerId && funding && (
    <FundingBar funded={order.fundedMillimes} amount={order.amountMillimes} color={op.color} label={t("fundingLabel")}>
      {t.rich("fundingProgress", { funded: dt(order.fundedMillimes), amount: dt(order.amountMillimes), secret })}
    </FundingBar>
  );

  const proofs = view.proofs.length > 0 && <ProofGrid orderId={order.id} proofs={view.proofs} label={t("proof")} />;

  const cancelledCard = order.status === "cancelled" && (
    <NowCard icon={<BanIcon />} title={t("cancelledTitle")}>
      <span className="flex flex-col gap-1">
        <span>{t(`cancelledBy.${order.cancelledBy ?? "admin"}`)}</span>
        {order.cancelReason && <span className="whitespace-pre-line text-foreground">“{order.cancelReason}”</span>}
        {order.buyerBadMark && <span className="font-medium text-destructive-foreground">{t(buyer ? "badMarkYou" : "badMarkGiven")}</span>}
        {!buyer && order.leftoverChoice === "stock" && <span>{t.rich("leftoverKept", { amount: dt(order.leftoverMillimes), secret })}</span>}
        {!buyer && order.leftoverChoice === "sarfli" && <span>{t.rich("leftoverSoldText", { amount: dt(order.leftoverMillimes), secret })}</span>}
      </span>
    </NowCard>
  );

  const reviewText = (
    <span className="flex flex-col gap-1">
      <span>{t(order.disputedBy === "seller" ? "reviewBySeller" : "reviewByBuyer")}</span>
      {order.disputeReason && <span className="whitespace-pre-line text-foreground">“{order.disputeReason}”</span>}
    </span>
  );

  // ---- The one "what to do now" card, and the less important actions under it ----
  let now: React.ReactNode = null;
  const secondary: React.ReactNode[] = [];

  if (buyer) {
    if (order.status === "funding") {
      now = (
        <NowCard icon={<HourglassIcon />} title={t("buyerFundingTitle")}>
          <span>{t("buyerFundingText", { seller: sellerName })}</span>
          {progress}
        </NowCard>
      );
      if (order.fundedMillimes > 0) secondary.push(<TakePartialButton key="partial" orderId={order.id} fundedMillimes={order.fundedMillimes} />);
    } else if (order.status === "funded" && order.excessMillimes > 0) {
      now = (
        <NowCard icon={<TriangleAlertIcon />} title={t("excessTitle")} tone="warning" eyebrow={t("order.now")}>
          <span>
            {t.rich("excessText", { excess: dt(order.excessMillimes), total: dt(order.fundedMillimes), pay: dt(view.payWithExcessMillimes), secret })}
          </span>
          <ExcessChoice orderId={order.id} excessMillimes={order.excessMillimes} />
        </NowCard>
      );
    } else if (order.status === "funded") {
      now = (
        <NowCard icon={<HandCoinsIcon />} title={t("buyerPayTitle")} tone="go" eyebrow={t("order.now")}>
          <span>{t.rich("buyerPayText", { pay: dt(view.payMillimes), seller: sellerName, secret })}</span>
          <PaymentBox view={view} sellerName={sellerName} t={t} label={t("toPay")} />
          <ProofUpload orderId={order.id} first />
        </NowCard>
      );
    } else if (order.status === "proof_uploaded") {
      now = (
        <NowCard icon={<ClockIcon />} title={t("buyerWaitTitle")}>
          {t("buyerWaitText", { seller: sellerName })}
        </NowCard>
      );
      secondary.push(<ProofUpload key="more" orderId={order.id} first={false} />);
      secondary.push(
        <div key="flag" className="flex flex-col gap-2">
          <p className="text-muted-foreground text-sm">{t("flagHint", { seller: sellerName })}</p>
          <FlagButton orderId={order.id} />
        </div>,
      );
    } else if (order.status === "admin_review") {
      now = (
        <NowCard icon={<SearchIcon />} title={t("reviewTitle")} tone="warning">
          {reviewText}
        </NowCard>
      );
      secondary.push(<ProofUpload key="more" orderId={order.id} first={false} />);
    } else if (order.status === "released") {
      now = (
        <SuccessCard title={t("releasedTitle")} amount={view.toBuyerMillimes}>
          <span>{t("releasedText", { operator: op.name })}</span>
          <Button variant="go" className="h-12 text-base sm:h-12" render={<Link href={`/buy/recharge?op=${op.code}`} />}>
            <SmartphoneIcon aria-hidden="true" />
            {t("rechargeCta")}
          </Button>
        </SuccessCard>
      );
    } else {
      now = cancelledCard;
    }
    if (funding) secondary.push(<BuyerCancelButton key="cancel" orderId={order.id} badMark={view.cancelGivesBadMark} />);
  } else if (seller) {
    if (order.status === "funding") {
      now = (
        <NowCard icon={<HandCoinsIcon />} title={t.rich("sellerSendTitle", { missing: dt(missing), secret })} tone="go" eyebrow={t("order.now")}>
          <span>{t("sellerSendText")}</span>
          {progress}
          <Button variant="go" className="h-12 text-base sm:h-12" render={<Link href={`/sell?order=${order.id}`} />}>
            <HandCoinsIcon aria-hidden="true" />
            {t("sellerSendCta")}
          </Button>
        </NowCard>
      );
    } else if (order.status === "funded") {
      now = (
        <NowCard icon={<ClockIcon />} title={t("sellerWaitPayTitle")}>
          {order.excessMillimes > 0
            ? t.rich("sellerWaitExcessText", { excess: dt(order.excessMillimes), secret })
            : t.rich("sellerWaitPayText", { pay: dt(view.payMillimes), secret })}
        </NowCard>
      );
    } else if (checking) {
      const review = order.status === "admin_review";
      now = (
        <NowCard
          icon={review ? <SearchIcon /> : <FileTextIcon />}
          title={review ? t("reviewTitle") : t("sellerCheckTitle")}
          tone={review ? "warning" : "go"}
          eyebrow={t("order.now")}
        >
          {review && reviewText}
          <span>{t.rich("sellerCheckText", { pay: dt(view.payMillimes), secret })}</span>
          {proofs}
          <ConfirmPaidButton orderId={order.id} payMillimes={view.payMillimes} />
        </NowCard>
      );
      if (!review) secondary.push(<NotPaidButton key="notpaid" orderId={order.id} />);
    } else if (order.status === "released") {
      now = (
        <SuccessCard title={t("sellerReleasedTitle")} amount={order.amountMillimes}>
          {t("sellerReleasedText")}
        </SuccessCard>
      );
    } else if (leftoverPending) {
      now = (
        <NowCard icon={<TriangleAlertIcon />} title={t("leftoverTitle")} tone="warning" eyebrow={t("order.now")}>
          <span>{t.rich("leftoverText", { amount: dt(order.leftoverMillimes), secret })}</span>
          <LeftoverChoice orderId={order.id} cashMillimes={grossPayout(order.leftoverMillimes, op.rateBps)} />
        </NowCard>
      );
      secondary.push(<div key="cancelled">{cancelledCard}</div>);
    } else {
      now = cancelledCard;
    }
    if (funding) secondary.push(<SellerCancelButton key="cancel" orderId={order.id} />);
  } else {
    // Staff: the order as it is, and a link to manage it.
    now =
      order.status === "cancelled" ? (
        cancelledCard
      ) : (
        <NowCard icon={<ShieldIcon />} title={t(`orderStatus.${order.status}`)} tone={order.status === "admin_review" ? "warning" : undefined}>
          {order.status === "admin_review" ? reviewText : <span>{t("betweenParties", { buyer: buyerName, seller: sellerName })}</span>}
          {progress}
          <Button variant="outline" className="h-12 text-base sm:h-12" render={<Link href={back.href} />}>
            {t("order.openAdmin")}
          </Button>
        </NowCard>
      );
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5 px-4 py-6">
      {(open || leftoverPending) && <AutoRefresh seconds={5} />}
      <Button variant="ghost" className="-ms-2 h-10 self-start text-base text-muted-foreground" render={<Link href={back.href} />}>
        <ArrowLeftIcon aria-hidden="true" className="rtl:rotate-180" />
        {back.label}
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

      <Steps status={order.status} t={t} />

      {now}

      {buyer && view.canRate && <RateForm orderId={order.id} />}

      {!proofsInCard && proofs && (
        <section className="flex flex-col gap-3">
          <h2 className="font-heading font-semibold text-lg">{t("proofs")}</h2>
          {proofs}
        </section>
      )}

      {secondary.length > 0 && (
        <section className="flex flex-col gap-3 border-t pt-5">
          <h2 className="font-medium text-muted-foreground text-sm">{t("order.otherOptions")}</h2>
          {secondary}
        </section>
      )}

      {/* Reputation info, never blocks anything */}
      {!buyer && (
        <p className={cn("flex items-center gap-2 rounded-xl p-3 text-sm", view.buyerBadMarks > 0 ? "bg-amber-500/8" : "bg-muted/60")}>
          <TriangleAlertIcon aria-hidden="true" className={cn("size-4 shrink-0", view.buyerBadMarks > 0 ? "text-amber-600" : "text-muted-foreground")} />
          {t("buyerMarks", { name: buyerName, count: view.buyerBadMarks })}
        </p>
      )}

      {/* Details */}
      <details className="group rounded-2xl border">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 font-medium [&::-webkit-details-marker]:hidden">
          <span className="flex flex-wrap items-center gap-3">
            {t("moreDetails")}
            <OrderStatusBadge status={order.status} />
          </span>
          <ChevronDownIcon aria-hidden="true" className="size-5 text-muted-foreground transition-transform group-open:rotate-180" />
        </summary>
        <div className="flex flex-col gap-5 border-t p-4">
          <dl className="flex flex-col gap-3 text-sm">
            <Detail label={t("order.ref")}>
              <Secret className="font-mono">{order.ref}</Secret>
            </Detail>
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
            <Detail label={t("howToPay", { seller: sellerName })}>
              <span className="whitespace-pre-line break-words">{order.paymentInfo || t("noPaymentInfo")}</span>
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

// ---------------------------------------------------------------------------

const STEPS = ["funding", "payment", "check", "done"] as const;

const stepIndex: Record<Exclude<OrderStatus, "cancelled">, number> = {
  funding: 0,
  funded: 1,
  proof_uploaded: 2,
  admin_review: 2,
  released: STEPS.length,
};

/** Funding → Payment → Confirmation → Done, or a single "Cancelled" line. */
function Steps({ status, t }: { status: OrderStatus; t: T }) {
  if (status === "cancelled") {
    return (
      <div className="flex items-center gap-2 rounded-xl bg-muted/60 p-3 font-medium text-muted-foreground">
        <BanIcon aria-hidden="true" className="size-5" />
        {t("orderStatus.cancelled")}
      </div>
    );
  }
  const current = stepIndex[status];
  return (
    <ol className="flex items-start" aria-label={t("order.stepsLabel")}>
      {STEPS.map((s, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={s} className="flex flex-1 flex-col items-center gap-1.5 text-center" aria-current={active ? "step" : undefined}>
            <div className="flex w-full items-center">
              <span className={cn("h-0.5 flex-1", i === 0 ? "invisible" : done || active ? "bg-emerald-600" : "bg-border")} />
              <span
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-full border-2 font-semibold text-sm",
                  done && "border-emerald-600 bg-emerald-600 text-white",
                  active && "border-emerald-600 bg-emerald-600/10 text-emerald-700 dark:text-emerald-400",
                  !done && !active && "border-border text-muted-foreground",
                )}
              >
                {done ? <CheckIcon aria-hidden="true" className="size-4" strokeWidth={3} /> : i + 1}
              </span>
              <span className={cn("h-0.5 flex-1", i === STEPS.length - 1 ? "invisible" : done ? "bg-emerald-600" : "bg-border")} />
            </div>
            <span className={cn("px-1 text-xs leading-tight", active ? "font-semibold text-foreground" : "text-muted-foreground")}>
              {t(`order.steps.${s}`)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function FundingBar({ funded, amount, color, label, children }: { funded: number; amount: number; color: string; label: string; children: React.ReactNode }) {
  return (
    <span className="flex flex-col gap-2 rounded-xl bg-background/70 p-3">
      <span className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-semibold text-foreground">{label}</span>
        <span>{children}</span>
      </span>
      <span className="block h-2.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <span className="block h-full rounded-full transition-[width]" style={{ width: `${Math.min(100, (funded / amount) * 100)}%`, backgroundColor: color }} />
      </span>
    </span>
  );
}

function PaymentBox({ view, sellerName, t, label }: { view: OrderPageView; sellerName: string; t: T; label: string }) {
  return (
    <span className="flex flex-col divide-y overflow-hidden rounded-xl border-2 bg-card text-foreground" style={{ borderColor: view.operator.color }}>
      <span className="flex items-baseline justify-between gap-3 p-4">
        <span className="font-semibold text-lg">{label}</span>
        <Dt compact millimes={view.payMillimes} className="font-bold text-3xl" />
      </span>
      <span className="flex flex-col gap-1 p-4">
        <span className="text-muted-foreground text-sm">{t("howToPay", { seller: sellerName })}</span>
        <span className="whitespace-pre-line break-words font-medium">{view.order.paymentInfo || t("noPaymentInfo")}</span>
      </span>
    </span>
  );
}

function ProofGrid({ orderId, proofs, label }: { orderId: string; proofs: OrderPageView["proofs"]; label: string }) {
  return (
    <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4">
      {proofs.map((p) => {
        const href = `/api/orders/${orderId}/proofs/${p.id}`;
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
                <img src={href} alt={label} className="size-full object-cover" />
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
      <div className="mt-1 flex w-full flex-col gap-4 text-muted-foreground">{children}</div>
    </section>
  );
}

/** The main card: what is happening and, when there is one, the action to take now. */
function NowCard({
  icon,
  title,
  children,
  tone,
  eyebrow,
}: {
  icon: React.ReactNode;
  title: React.ReactNode;
  children: React.ReactNode;
  tone?: "warning" | "go";
  eyebrow?: string;
}) {
  const toneClass = tone === "warning" ? "border-amber-500/60 bg-amber-500/6" : tone === "go" ? "border-emerald-600/50 bg-emerald-600/5" : "bg-card";
  const iconClass = tone === "warning" ? "text-amber-600" : tone === "go" ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground";
  return (
    <section className={cn("flex flex-col gap-4 rounded-2xl border-2 p-5", toneClass)}>
      <div className="flex gap-3">
        <span className={cn("shrink-0 pt-0.5 [&_svg]:size-6", iconClass)} aria-hidden="true">
          {icon}
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          {eyebrow && <span className={cn("font-semibold text-xs uppercase tracking-wide", iconClass)}>{eyebrow}</span>}
          <h2 className="font-heading font-bold text-xl">{title}</h2>
        </div>
      </div>
      <div className="flex flex-col gap-4 text-muted-foreground">{children}</div>
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
