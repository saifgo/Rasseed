import { ClockIcon, FileCheckIcon, WalletIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { Dt } from "@/components/app/money";
import { PayoutLogo } from "@/components/app/payout-logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { db } from "@/db";
import type { LocalizedText, WithdrawalStatus } from "@/db/schema";
import { getBalance, listUserEntries, listUserWithdrawals, pendingWithdrawalTotal } from "@/lib/engine/wallet";
import { formatMsisdn } from "@/lib/phone";
import { getSavedPayoutDetails, listPayoutMethods } from "@/lib/queries";
import { requireUser } from "@/lib/session";
import { getSettings } from "@/lib/settings";
import { WithdrawForm } from "./withdraw-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Balance" };

const statusVariant: Record<WithdrawalStatus, "warning" | "success" | "error"> = { pending: "warning", paid: "success", rejected: "error" };

export default async function WalletPage() {
  const user = await requireUser();
  const t = await getTranslations("wallet");
  const format = await getFormatter();
  const locale = (await getLocale()) as keyof LocalizedText;
  const [balance, pendingTotal, withdrawals, entries, methods, saved, settings] = await Promise.all([
    getBalance(db, user.id),
    pendingWithdrawalTotal(user.id),
    listUserWithdrawals(user.id),
    listUserEntries(user.id),
    listPayoutMethods(),
    getSavedPayoutDetails(user.id),
    getSettings(),
  ]);
  const when = (d: Date) => format.dateTime(d, { dateStyle: "medium", timeStyle: "short" });

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8">
      <h1 className="font-heading font-bold text-3xl tracking-tight">{t("title")}</h1>

      {/* Balance */}
      <section className="flex flex-col gap-3 rounded-2xl bg-emerald-700 p-6 text-white">
        <span className="flex items-center gap-2 text-white/85">
          <WalletIcon aria-hidden="true" className="size-5" />
          {t("available")}
        </span>
        <Dt compact millimes={balance} className="font-bold text-5xl [&_span]:text-white/80" />
        <span className="text-sm text-white/80">{t("availableHint")}</span>
        {pendingTotal > 0 && (
          <span className="flex items-center gap-2 self-start rounded-full bg-white/15 px-3 py-1.5 text-sm">
            <ClockIcon aria-hidden="true" className="size-4" />
            {t("pending")}: <Dt compact millimes={pendingTotal} className="font-semibold [&_span]:text-white/80" />
          </span>
        )}
      </section>

      <WithdrawForm
        balanceMillimes={balance}
        minMillimes={settings.minWithdrawalMillimes}
        methods={methods.map((m) => ({ code: m.code, name: m.name, feeMillimes: m.feeMillimes, feeBps: m.feeBps, fields: m.fields }))}
        saved={saved}
      />

      <section className="flex flex-col gap-3">
        <h2 className="font-heading font-semibold text-xl">{t("withdrawals")}</h2>
        {withdrawals.length === 0 ? (
          <p className="py-6 text-center text-muted-foreground">{t("noWithdrawals")}</p>
        ) : (
          <ul className="flex flex-col divide-y overflow-hidden rounded-2xl border bg-card">
            {withdrawals.map(({ w, method }) => (
              <li key={w.id} className="flex items-start gap-4 p-4">
                <PayoutLogo code={method.code} className="size-12" />
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold">{method.name[locale] ?? method.name.en}</span>
                    <Badge variant={statusVariant[w.status]} size="lg" className="rounded-full px-2.5">
                      {t(`statuses.${w.status}`)}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap items-baseline gap-x-3">
                    <span className="text-muted-foreground text-sm">{t("youGet")}</span>
                    <Dt compact millimes={w.netMillimes} className="font-bold text-xl" />
                  </div>
                  <div className="text-muted-foreground text-xs" dir="ltr">
                    {Object.entries(w.details)
                      .map(([k, v]) => (k === "phone" ? formatMsisdn(v) : v))
                      .join(" · ")}
                  </div>
                  <div className="text-muted-foreground text-xs">
                    {when(w.paidAt ?? w.rejectedAt ?? w.createdAt)} · <span className="font-mono">{w.ref}</span>
                  </div>
                  {w.status === "paid" && w.reference && (
                    <span className="text-sm">
                      {t("reference")}: <span className="font-mono">{w.reference}</span>
                    </span>
                  )}
                  {w.status === "paid" && w.note && <span className="text-muted-foreground text-sm">{w.note}</span>}
                  {w.status === "rejected" && w.rejectReason && <span className="text-destructive-foreground text-sm">{w.rejectReason}</span>}
                  {w.status === "paid" && w.proofPath && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-1 self-start"
                      render={<a href={`/api/withdrawals/${w.id}/proof`} target="_blank" rel="noreferrer" />}
                    >
                      <FileCheckIcon aria-hidden="true" />
                      {t("proof")}
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-heading font-semibold text-xl">{t("statement")}</h2>
        {entries.length === 0 ? (
          <p className="py-6 text-center text-muted-foreground">{t("noEntries")}</p>
        ) : (
          <ul className="flex flex-col divide-y rounded-2xl border bg-card">
            {entries.map((e) => {
              const plus = e.amountMillimes >= 0;
              const label = t(`kinds.${e.kind}`);
              return (
                <li key={e.id} className="flex items-center gap-3 p-4">
                  <div className="flex min-w-0 flex-1 flex-col">
                    {e.txId ? (
                      <Link href={`/sales/${e.txId}`} className="font-medium underline-offset-4 hover:underline">
                        {label}
                      </Link>
                    ) : (
                      <span className="font-medium">{label}</span>
                    )}
                    {e.note && <span className="text-muted-foreground text-xs">{e.note}</span>}
                    <span className="text-muted-foreground text-xs">{when(e.createdAt)}</span>
                  </div>
                  <span className={plus ? "font-bold text-emerald-700 dark:text-emerald-400" : "font-bold"} dir="ltr">
                    {plus ? "+" : ""}
                    <Dt compact millimes={e.amountMillimes} />
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
