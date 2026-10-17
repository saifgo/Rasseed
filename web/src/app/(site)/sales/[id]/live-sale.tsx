"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangleIcon,
  ArrowLeftIcon,
  BanIcon,
  CheckIcon,
  CircleCheckBigIcon,
  ClockIcon,
  CopyIcon,
  FileCheckIcon,
  HourglassIcon,
  PhoneCallIcon,
  SearchCheckIcon,
  XCircleIcon,
} from "lucide-react";
import Link from "next/link";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useEffect, useState, useTransition } from "react";
import { Dt } from "@/components/app/money";
import { OperatorName } from "@/components/app/operator-badge";
import { StatusBadge } from "@/components/app/status-badge";
import { Timeline } from "@/components/app/timeline";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { Card, CardDescription, CardFooter, CardHeader, CardPanel, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { toastManager } from "@/components/ui/toast";
import type { LocalizedText } from "@/db/schema";
import { formatDinars, formatRate, grossPayout } from "@/lib/money";
import { formatMsisdn } from "@/lib/phone";
import type { SaleView } from "@/lib/queries";
import { cancelSaleAction, choosePartialAction } from "../../sell/actions";

type View = NonNullable<SaleView>;
const LIVE: View["status"][] = ["queued", "assigning", "awaiting_transfer", "verifying", "partial", "review", "confirmed"];

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
      return s === "confirmed" || s === "review" ? 15_000 : 2_000;
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

  const methodName = sale.method.name[locale] ?? sale.method.name.en;
  const dt = (m: number) => formatDinars(m);
  const estimatedNet = Math.max(0, grossPayout(sale.declaredMillimes, sale.rateBps) - sale.feeMillimes);
  const showTransfer =
    sale.assignedMsisdn &&
    (sale.status === "awaiting_transfer" || sale.status === "verifying" || (sale.status === "partial" && sale.partialChoice === "topup"));

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <Button variant="link" size="sm" className="-ms-2.5 self-start text-muted-foreground" render={<Link href="/sales" />}>
            <ArrowLeftIcon aria-hidden="true" className="rtl:rotate-180" />
            {t("backToSales")}
          </Button>
          <h1 className="flex flex-wrap items-center gap-3 font-heading font-semibold text-2xl tracking-tight">
            {t("title", { ref: sale.ref })}
            <StatusBadge status={sale.status} />
          </h1>
        </div>
        {sale.canCancel && (
          <AlertDialog>
            <AlertDialogTrigger render={<Button variant="destructive-outline" disabled={pending} />}>
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
                <AlertDialogClose render={<Button variant="destructive" onClick={() => act(() => cancelSaleAction(sale.id))} />}>
                  {t("cancel")}
                </AlertDialogClose>
              </AlertDialogFooter>
            </AlertDialogPopup>
          </AlertDialog>
        )}
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-6">
          {sale.status === "queued" && (
            <StateCard icon={<HourglassIcon />} title={t("queuedTitle")} spinner>
              {t("queuedText", { operator: sale.operator.name, position: sale.queuePosition ?? 1 })}
            </StateCard>
          )}
          {sale.status === "assigning" && (
            <StateCard icon={<SearchCheckIcon />} title={t("assigningTitle")} spinner>
              {t("assigningText")}
            </StateCard>
          )}

          {sale.status === "partial" && !sale.partialChoice && (
            <Alert variant="warning">
              <AlertTriangleIcon />
              <AlertTitle>{t("partialTitle")}</AlertTitle>
              <AlertDescription className="flex flex-col gap-3">
                <span>
                  {t("partialText", {
                    received: dt(sale.confirmedMillimes),
                    declared: dt(sale.declaredMillimes),
                    missing: dt(sale.remainingMillimes),
                  })}
                </span>
                <span className="flex flex-wrap gap-2">
                  <Button onClick={() => act(() => choosePartialAction(sale.id, "topup"))} disabled={pending}>
                    {t("partialTopup")}
                  </Button>
                  <Button variant="outline" onClick={() => act(() => choosePartialAction(sale.id, "accept"))} disabled={pending}>
                    {t("partialAccept", { received: dt(sale.confirmedMillimes) })}
                  </Button>
                </span>
              </AlertDescription>
            </Alert>
          )}
          {sale.status === "partial" && sale.partialChoice === "topup" && (
            <Alert variant="info">
              <AlertTriangleIcon />
              <AlertTitle>{t("partialTitle")}</AlertTitle>
              <AlertDescription>{t("partialTopupText", { missing: dt(sale.remainingMillimes) })}</AlertDescription>
            </Alert>
          )}

          {showTransfer && <TransferCard sale={sale} />}

          {sale.status === "partial" && !sale.partialChoice && sale.expiresAt && (
            <Card>
              <CardPanel>
                <Countdown expiresAt={sale.expiresAt} serverNow={sale.serverNow} />
              </CardPanel>
            </Card>
          )}

          {sale.status === "review" && (
            <StateCard icon={<ClockIcon />} title={t("reviewTitle")} tone="warning">
              {t("reviewText")}
            </StateCard>
          )}
          {sale.status === "confirmed" && (
            <StateCard icon={<CircleCheckBigIcon />} title={t("successTitle")} tone="success">
              {t("successText", { amount: dt(sale.finalMillimes ?? 0), net: dt(sale.payoutNetMillimes ?? 0), method: methodName })}
            </StateCard>
          )}
          {sale.status === "paid" && (
            <StateCard icon={<CircleCheckBigIcon />} title={t("paidTitle")} tone="success">
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
            </StateCard>
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
          {["expired", "cancelled", "rejected", "paid", "confirmed"].includes(sale.status) && (
            <Button variant="outline" className="self-start" render={<Link href="/sell" />}>
              {t("newSale")}
            </Button>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("timeline")}</CardTitle>
            </CardHeader>
            <CardPanel>
              <Timeline events={sale.events} />
            </CardPanel>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardDescription>
              <OperatorName name={sale.operator.name} color={sale.operator.color} />
            </CardDescription>
            <CardTitle className="text-2xl">
              <Dt millimes={sale.payoutNetMillimes ?? estimatedNet} />
            </CardTitle>
            <CardDescription>
              {t("payout")} · {methodName}
            </CardDescription>
          </CardHeader>
          <CardPanel className="flex flex-col gap-3 text-sm">
            <Detail label={t("declared")}>
              <Dt millimes={sale.declaredMillimes} />
            </Detail>
            <Detail label={t("received")}>
              <Dt millimes={sale.finalMillimes ?? sale.confirmedMillimes} />
            </Detail>
            <Detail label={t("rate")}>{formatRate(sale.rateBps)}</Detail>
            <Separator />
            <Detail label={t("method")}>{methodName}</Detail>
            {Object.entries(sale.payoutDetails).map(([k, v]) => (
              <Detail key={k} label={sale.method.fields.find((f) => f.key === k)?.label[locale] ?? k}>
                <span dir="auto">{k === "phone" ? formatMsisdn(v) : v}</span>
              </Detail>
            ))}
            <Separator />
            <Detail label={t("sender")}>
              <span dir="ltr">{formatMsisdn(sale.senderMsisdn)}</span>
            </Detail>
            <Detail label={t("created")}>{format.dateTime(new Date(sale.createdAt), { dateStyle: "medium", timeStyle: "short" })}</Detail>
          </CardPanel>
        </Card>
      </div>
    </div>
  );
}

function TransferCard({ sale }: { sale: View }) {
  const t = useTranslations("sale");
  const number = sale.assignedMsisdn!;
  const ussd = sale.transferUssd!;
  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle className="text-lg">{t("sendTitle", { amount: formatDinars(sale.remainingMillimes) })}</CardTitle>
        <CardDescription>{t("sendText", { operator: sale.operator.name, sender: formatMsisdn(sale.senderMsisdn) })}</CardDescription>
      </CardHeader>
      <CardPanel className="flex flex-col gap-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <CopyBlock label={t("sendTo")} value={number} display={formatMsisdn(number)} large />
          <CopyBlock label={t("ussd")} value={ussd} display={ussd} />
        </div>
        {sale.operator.code === "ooredoo" && <p className="text-muted-foreground text-sm">{t("ooredooHint")}</p>}
        <Button size="lg" className="sm:hidden" render={<a href={`tel:${ussd.replaceAll("#", "%23")}`} />}>
          <PhoneCallIcon aria-hidden="true" />
          {t("dial")}
        </Button>
        {sale.expiresAt && <Countdown expiresAt={sale.expiresAt} serverNow={sale.serverNow} />}
      </CardPanel>
      <CardFooter className="flex items-center gap-2 border-t bg-muted/40 text-muted-foreground text-sm">
        {sale.status === "verifying" ? (
          <>
            <Spinner className="size-4" />
            <span>
              <span className="font-medium text-foreground">{t("verifyingTitle")}</span> — {t("verifyingText")}
            </span>
          </>
        ) : (
          <>
            <Spinner className="size-4" />
            {t("waitingTransfer")}
          </>
        )}
      </CardFooter>
    </Card>
  );
}

function CopyBlock({ label, value, display, large }: { label: string; value: string; display: string; large?: boolean }) {
  const t = useTranslations("common");
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-1.5 rounded-xl border bg-muted/40 p-4">
      <span className="text-muted-foreground text-xs">{label}</span>
      <div className="flex items-center justify-between gap-2">
        <span dir="ltr" className={large ? "font-mono font-semibold text-2xl tracking-wider" : "font-mono font-medium text-lg"}>
          {display}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={copied ? t("copied") : t("copy")}
          onClick={async () => {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
        </Button>
      </div>
    </div>
  );
}

function Countdown({ expiresAt, serverNow }: { expiresAt: string; serverNow: string }) {
  const t = useTranslations("sale");
  // Correct for the difference between the phone's clock and the server's.
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
  const left = now == null ? end - new Date(serverNow).getTime() : Math.max(0, end - now);
  const total = 15 * 60 * 1000;
  const mm = String(Math.floor(left / 60000)).padStart(2, "0");
  const ss = String(Math.floor((left % 60000) / 1000)).padStart(2, "0");
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <span className="text-muted-foreground text-sm">{t("timeLeft")}</span>
        <span dir="ltr" suppressHydrationWarning className={`tabular font-mono font-semibold text-xl ${left < 120_000 ? "text-destructive-foreground" : ""}`}>
          {mm}:{ss}
        </span>
      </div>
      <Progress value={Math.min(100, (left / total) * 100)} aria-label={t("timeLeft")} />
      <span className="text-muted-foreground text-xs">{t("expiresHint")}</span>
    </div>
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
  tone?: "success" | "warning" | "error";
}) {
  const toneClass =
    tone === "success" ? "bg-success/8 text-success-foreground" : tone === "warning" ? "bg-warning/8 text-warning-foreground" : tone === "error" ? "bg-destructive/8 text-destructive-foreground" : "bg-muted text-foreground";
  return (
    <Card>
      <CardPanel className="flex gap-4 py-6">
        <span className={`flex size-11 shrink-0 items-center justify-center rounded-xl [&_svg]:size-5 ${toneClass}`} aria-hidden="true">
          {spinner ? <Spinner className="size-5" /> : icon}
        </span>
        <div className="flex flex-col gap-1">
          <h2 className="font-heading font-semibold text-lg">{title}</h2>
          <div className="text-muted-foreground">{children}</div>
        </div>
      </CardPanel>
    </Card>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-end">{children}</span>
    </div>
  );
}
