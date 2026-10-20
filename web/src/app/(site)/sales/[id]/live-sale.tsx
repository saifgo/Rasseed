"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  BanIcon,
  CheckIcon,
  ChevronDownIcon,
  ClockIcon,
  CopyIcon,
  FileCheckIcon,
  HandCoinsIcon,
  HourglassIcon,
  PhoneCallIcon,
  SearchCheckIcon,
  TriangleAlertIcon,
  WalletIcon,
  XCircleIcon,
} from "lucide-react";
import Link from "next/link";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useEffect, useState, useTransition } from "react";
import { Dt } from "@/components/app/money";
import { OperatorLogo } from "@/components/app/operator-badge";
import { StatusBadge } from "@/components/app/status-badge";
import { Timeline } from "@/components/app/timeline";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { toastManager } from "@/components/ui/toast";
import type { LocalizedText } from "@/db/schema";
import { formatDt, formatRate, grossPayout } from "@/lib/money";
import { formatMsisdn } from "@/lib/phone";
import type { SaleView } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { cancelSaleAction, choosePartialAction } from "../../sell/actions";

type View = NonNullable<SaleView>;
const LIVE: View["status"][] = ["queued", "assigning", "awaiting_transfer", "verifying", "partial", "review"];
const DONE: View["status"][] = ["expired", "cancelled", "rejected", "paid", "confirmed"];

export function LiveSale({ initial }: { initial: View }) {
  const t = useTranslations("sale");
  const te = useTranslations("errors");
  const locale = useLocale() as keyof LocalizedText;
  const format = useFormatter();
  const queryClient = useQueryClient();
  const queryKey = ["sale", initial.id];

  const { data: sale = initial } = useQuery<View>({
    queryKey,
    initialData: initial,
    queryFn: async () => {
      const res = await fetch(`/api/sales/${initial.id}`, { cache: "no-store" });
      if (!res.ok) throw new Error("fetch_failed");
      return res.json();
    },
    // Fast while something can change soon, slower once we only wait for the payout.
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      if (!s || !LIVE.includes(s)) return false;
      return s === "review" ? 15_000 : 2_000;
    },
  });

  const [pending, startTransition] = useTransition();
  function act(fn: () => Promise<{ ok: boolean; error?: string }>) {
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) toastManager.add({ type: "error", title: te.has(res.error ?? "") ? te(res.error!) : te("unknown") });
      await queryClient.invalidateQueries({ queryKey });
    });
  }

  // Legacy sales (before the account balance) carry their own payout method.
  const methodName = sale.method ? (sale.method.name[locale] ?? sale.method.name.en) : "";
  const dt = (m: number) => formatDt(m);
  const estimatedNet = grossPayout(sale.declaredMillimes, sale.rateBps);
  const showTransfer =
    sale.assignedMsisdn &&
    (sale.status === "awaiting_transfer" || sale.status === "verifying" || (sale.status === "partial" && sale.partialChoice === "topup"));
  const op = sale.operator;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5 px-4 py-6">
      <Button variant="ghost" className="-ms-2 h-10 self-start text-base text-muted-foreground" render={<Link href="/sales" />}>
        <ArrowLeftIcon aria-hidden="true" className="rtl:rotate-180" />
        {t("backToSales")}
      </Button>

      {/* Operator banner */}
      <div className="flex items-center gap-4 rounded-2xl p-4 text-white" style={{ backgroundColor: op.color }}>
        <OperatorLogo code={op.code} name={op.name} color={op.color} className="size-14 rounded-2xl" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="font-heading font-bold text-xl">{op.name}</span>
          <span className="flex items-center gap-1.5 text-sm text-white/85">
            <Dt compact millimes={sale.declaredMillimes} className="[&_span]:text-white/85" />
            <ArrowRightIcon aria-hidden="true" className="size-3.5 rtl:rotate-180" />
            <Dt compact millimes={sale.payoutNetMillimes ?? estimatedNet} className="font-semibold [&_span]:text-white/85" />
          </span>
        </div>
        <span className="hidden font-mono text-sm text-white/80 sm:block">{sale.ref}</span>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <StatusBadge status={sale.status} />
        <span className="font-mono text-muted-foreground text-sm sm:hidden">{sale.ref}</span>
      </div>

      {sale.status === "queued" && (
        <StateCard icon={<HourglassIcon />} title={t("queuedTitle")} spinner>
          {t("queuedText", { operator: op.name, position: sale.queuePosition ?? 1 })}
        </StateCard>
      )}
      {sale.status === "assigning" && (
        <StateCard icon={<SearchCheckIcon />} title={t("assigningTitle")} spinner>
          {t("assigningText")}
        </StateCard>
      )}

      {sale.status === "partial" && !sale.partialChoice && (
        <StateCard icon={<TriangleAlertIcon />} title={t("partialTitle")} tone="warning">
          <span className="flex flex-col gap-4">
            <span>
              {t("partialText", {
                received: dt(sale.confirmedMillimes),
                declared: dt(sale.declaredMillimes),
                missing: dt(sale.remainingMillimes),
              })}
            </span>
            <span className="flex flex-col gap-2">
              <Button variant="go" className="h-12 text-base sm:h-12" onClick={() => act(() => choosePartialAction(sale.id, "topup"))} disabled={pending}>
                {t("partialTopup")}
              </Button>
              <Button variant="outline" className="h-12 text-base sm:h-12" onClick={() => act(() => choosePartialAction(sale.id, "accept"))} disabled={pending}>
                {t("partialAccept", { received: dt(sale.confirmedMillimes) })}
              </Button>
            </span>
            {sale.expiresAt && <Countdown framed expiresAt={sale.expiresAt} serverNow={sale.serverNow} />}
          </span>
        </StateCard>
      )}
      {sale.status === "partial" && sale.partialChoice === "topup" && (
        <StateCard icon={<TriangleAlertIcon />} title={t("partialTitle")} tone="warning">
          {t("partialTopupText", { missing: dt(sale.remainingMillimes) })}
        </StateCard>
      )}

      {showTransfer && <TransferCard sale={sale} />}

      {sale.status === "review" && (
        <StateCard icon={<ClockIcon />} title={t("reviewTitle")} tone="warning">
          {t("reviewText")}
        </StateCard>
      )}
      {sale.status === "confirmed" && sale.method && (
        <SuccessCard title={t("successTitle")} amount={sale.payoutNetMillimes ?? 0}>
          {t("successTextLegacy", { amount: dt(sale.finalMillimes ?? 0), net: dt(sale.payoutNetMillimes ?? 0), method: methodName })}
        </SuccessCard>
      )}
      {sale.status === "confirmed" && !sale.method && (
        <SuccessCard title={t("successTitle")} amount={sale.payoutGrossMillimes ?? 0}>
          <span className="flex flex-col gap-4">
            <span>{t("successText", { amount: dt(sale.finalMillimes ?? 0), net: dt(sale.payoutGrossMillimes ?? 0) })}</span>
            <Button variant="go" className="h-12 text-base sm:h-12" render={<Link href="/wallet" />}>
              <WalletIcon aria-hidden="true" />
              {t("goToWallet")}
            </Button>
          </span>
        </SuccessCard>
      )}
      {sale.status === "paid" && (
        <SuccessCard title={t("paidTitle")} amount={sale.payout?.netMillimes ?? 0}>
          <span className="flex flex-col gap-3">
            <span>{t("paidText", { net: dt(sale.payout?.netMillimes ?? 0), method: methodName })}</span>
            {sale.payout?.reference && (
              <span className="text-sm">
                {t("reference")}: <span className="font-mono">{sale.payout.reference}</span>
              </span>
            )}
            {sale.payout?.note && <span className="text-sm">{sale.payout.note}</span>}
            {sale.payout?.hasProof && (
              <Button variant="outline" className="self-start" render={<a href={`/api/payouts/${sale.payout.id}/proof`} target="_blank" rel="noreferrer" />}>
                <FileCheckIcon aria-hidden="true" />
                {t("viewProof")}
              </Button>
            )}
          </span>
        </SuccessCard>
      )}
      {sale.status === "expired" && (
        <StateCard icon={<ClockIcon />} title={t("expiredTitle")}>
          {t("expiredText")}
        </StateCard>
      )}
      {sale.status === "cancelled" && (
        <StateCard icon={<XCircleIcon />} title={t("cancelledTitle")}>
          {t("cancelledText")}
        </StateCard>
      )}
      {sale.status === "rejected" && (
        <StateCard icon={<XCircleIcon />} title={t("rejectedTitle")} tone="error">
          {t("rejectedText")}
        </StateCard>
      )}
      {DONE.includes(sale.status) && (
        <Button
          variant={sale.status === "confirmed" || sale.status === "paid" ? "outline" : "go"}
          className="h-12 text-base sm:h-12"
          render={<Link href={`/sell?op=${op.code}`} />}
        >
          <HandCoinsIcon aria-hidden="true" />
          {t("newSale")}
        </Button>
      )}

      {sale.canCancel && (
        <AlertDialog>
          <AlertDialogTrigger render={<Button variant="ghost" className="self-center text-destructive-foreground" disabled={pending} />}>
            <BanIcon aria-hidden="true" />
            {t("cancel")}
          </AlertDialogTrigger>
          <AlertDialogPopup>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("cancelConfirmTitle")}</AlertDialogTitle>
              <AlertDialogDescription>{t("cancelConfirmText")}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogClose render={<Button variant="ghost" />}>{t("keep")}</AlertDialogClose>
              <AlertDialogClose render={<Button variant="destructive" onClick={() => act(() => cancelSaleAction(sale.id))} />}>{t("cancel")}</AlertDialogClose>
            </AlertDialogFooter>
          </AlertDialogPopup>
        </AlertDialog>
      )}

      {/* Details, folded away so the page stays simple */}
      <details className="group rounded-2xl border">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 font-medium [&::-webkit-details-marker]:hidden">
          {t("moreDetails")}
          <ChevronDownIcon aria-hidden="true" className="size-5 text-muted-foreground transition-transform group-open:rotate-180" />
        </summary>
        <div className="flex flex-col gap-5 border-t p-4">
          <dl className="flex flex-col gap-3 text-sm">
            <Detail label={t("declared")}>
              <Dt compact millimes={sale.declaredMillimes} />
            </Detail>
            <Detail label={t("received")}>
              <Dt compact millimes={sale.finalMillimes ?? sale.confirmedMillimes} />
            </Detail>
            <Detail label={t("rate")}>{formatRate(sale.rateBps)}</Detail>
            <Detail label={sale.method ? `${t("payout")} · ${methodName}` : t("creditedToBalance")}>
              <Dt compact millimes={sale.payoutNetMillimes ?? estimatedNet} className="font-semibold" />
            </Detail>
            {sale.method &&
              Object.entries(sale.payoutDetails).map(([k, v]) => (
                <Detail key={k} label={sale.method?.fields.find((f) => f.key === k)?.label[locale] ?? k}>
                  <span dir="auto">{k === "phone" ? formatMsisdn(v) : v}</span>
                </Detail>
              ))}
            <Detail label={t("sender")}>
              <span dir="ltr">{formatMsisdn(sale.senderMsisdn)}</span>
            </Detail>
            <Detail label={t("created")}>{format.dateTime(new Date(sale.createdAt), { dateStyle: "medium", timeStyle: "short" })}</Detail>
          </dl>
          <div className="flex flex-col gap-3">
            <h3 className="font-medium">{t("timeline")}</h3>
            <Timeline events={sale.events} />
          </div>
        </div>
      </details>
    </div>
  );
}

function TransferCard({ sale }: { sale: View }) {
  const t = useTranslations("sale");
  const number = sale.assignedMsisdn!;
  const ussd = sale.transferUssd!;
  const op = sale.operator;
  const amount = formatDt(sale.remainingMillimes);
  const askAmount = op.code === "ooredoo";

  return (
    <section className="overflow-hidden rounded-2xl border-2 bg-card" style={{ borderColor: op.color }}>
      <div className="flex flex-col gap-1 px-5 pt-5">
        <h2 className="font-heading font-bold text-2xl leading-tight">{t("sendTitle", { amount })}</h2>
        <p className="text-muted-foreground">
          {t.rich("sendFrom", {
            sender: formatMsisdn(sale.senderMsisdn),
            b: (chunks) => (
              <bdi dir="ltr" className="font-semibold text-foreground tabular-nums">
                {chunks}
              </bdi>
            ),
          })}
        </p>
      </div>

      <ol className="flex flex-col gap-3 px-5 pt-5">
        <StepLine n={1} color={op.color}>
          <span className="sm:hidden">{t("step1Mobile")}</span>
          <span className="hidden sm:inline">{t("step1Desktop")}</span>
        </StepLine>
        <StepLine n={2} color={op.color}>
          {t("step2Call")}
        </StepLine>
        {askAmount && (
          <StepLine n={3} color={op.color}>
            {t.rich("step3Amount", { amount, b: (chunks) => <strong className="tabular-nums">{chunks}</strong> })}
          </StepLine>
        )}
        <StepLine n={askAmount ? 4 : 3} color={op.color}>
          {t("stepWait")}
        </StepLine>
      </ol>

      <div className="px-5 pt-5 sm:hidden">
        <Button variant="go" className="h-16 w-full text-xl" render={<a href={`tel:${ussd.replaceAll("#", "%23")}`} />}>
          <PhoneCallIcon aria-hidden="true" className="size-6" />
          {t("dial")}
        </Button>
      </div>

      <dl className="mt-5 divide-y border-t">
        <CopyRow label={t("ussd")} value={ussd} display={ussd} large />
        <CopyRow label={t("sendTo")} value={number} display={formatMsisdn(number)} />
        {sale.expiresAt && <Countdown expiresAt={sale.expiresAt} serverNow={sale.serverNow} />}
      </dl>

      <div className="flex items-center gap-3 border-t bg-muted/60 px-5 py-4">
        <Spinner className="size-5 shrink-0" />
        {sale.status === "verifying" ? (
          <span>
            <span className="font-semibold">{t("verifyingTitle")}</span>
            <span className="block text-muted-foreground text-sm">{t("verifyingText")}</span>
          </span>
        ) : (
          <span className="font-medium">{t("waitingTransfer")}</span>
        )}
      </div>
    </section>
  );
}

function StepLine({ n, color, children }: { n: number; color: string; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full font-bold text-sm text-white" style={{ backgroundColor: color }}>
        {n}
      </span>
      <span className="pt-0.5 text-base">{children}</span>
    </li>
  );
}

function CopyRow({ label, value, display, large }: { label: string; value: string; display: string; large?: boolean }) {
  return (
    <div className="flex flex-col gap-1 px-5 py-4">
      <div className="flex items-center justify-between gap-4">
        <dt className="text-muted-foreground text-sm">{label}</dt>
        <CopyButton value={value} />
      </div>
      <dd dir="ltr" className={cn("break-all text-start font-bold tabular-nums tracking-wide", large ? "text-3xl" : "text-2xl")}>
        {display}
      </dd>
    </div>
  );
}

function CopyButton({ value }: { value: string }) {
  const t = useTranslations("common");
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="outline"
      className={cn("h-11 min-w-28 text-base sm:h-11", copied && "border-emerald-600 text-emerald-700 dark:text-emerald-400")}
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
      {copied ? t("copied") : t("copy")}
    </Button>
  );
}

function Countdown({ expiresAt, serverNow, framed }: { expiresAt: string; serverNow: string; framed?: boolean }) {
  const t = useTranslations("sale");
  // Correct for the difference between the phone clock and the server clock.
  const [offset] = useState(() => new Date(serverNow).getTime() - Date.now());
  // Null until mounted so the server HTML and the first client render match.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const update = () => setNow(Date.now() + offset);
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [offset]);
  const end = new Date(expiresAt).getTime();
  const left = Math.max(0, now == null ? end - new Date(serverNow).getTime() : end - now);
  const total = 15 * 60 * 1000;
  const mm = String(Math.floor(left / 60000)).padStart(2, "0");
  const ss = String(Math.floor((left % 60000) / 1000)).padStart(2, "0");
  const urgent = left < 120_000;

  return (
    <div className={cn("flex flex-col gap-2 px-5 py-4", framed && "rounded-xl border px-4", urgent && "bg-destructive/6")}>
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-muted-foreground text-sm">{t("timeLeft")}</span>
        <span
          dir="ltr"
          role="timer"
          suppressHydrationWarning
          className={cn("font-bold text-3xl tabular-nums", urgent && "text-destructive-foreground")}
        >
          {mm}:{ss}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <div
          className={cn("h-full rounded-full transition-[width] duration-1000 ease-linear", urgent ? "bg-destructive" : "bg-foreground/70")}
          style={{ width: `${Math.min(100, (left / total) * 100)}%` }}
        />
      </div>
      <span className="text-muted-foreground text-xs">{t("expiresHint")}</span>
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
  spinner,
  tone,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
  spinner?: boolean;
  tone?: "warning" | "error";
}) {
  const toneClass = tone === "warning" ? "border-amber-500/50 bg-amber-500/6" : tone === "error" ? "border-destructive/40 bg-destructive/5" : "bg-card";
  const iconClass = tone === "warning" ? "text-amber-600" : tone === "error" ? "text-destructive-foreground" : "text-muted-foreground";
  return (
    <section className={cn("flex gap-4 rounded-2xl border p-5", toneClass)}>
      <span className={cn("shrink-0 pt-0.5 [&_svg]:size-6", iconClass)} aria-hidden="true">
        {spinner ? <Spinner className="size-6" /> : icon}
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
