import { ArrowLeftIcon, MonitorSmartphoneIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { AutoRefresh } from "@/components/app/auto-refresh";
import { Secret } from "@/components/app/confidential";
import { RechargeStatusBadge } from "@/components/app/market-badges";
import { Dt } from "@/components/app/money";
import { OperatorLogo } from "@/components/app/operator-badge";
import { Button } from "@/components/ui/button";
import { ACTIVE_RECHARGE_STATUSES } from "@/db/schema";
import { listPackages } from "@/lib/engine/packages";
import { listBuyerRecharges } from "@/lib/engine/recharge";
import { requireSpender, spendableByOperator, spendingOffer } from "@/lib/market-queries";
import { formatMsisdn } from "@/lib/phone";
import { NUMBER_NOT_COMPATIBLE } from "@/lib/recharge-outcome";
import { listOperators } from "@/lib/queries";
import { CancelRechargeButton, RechargeForm } from "./recharge-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Recharge" };

export default async function RechargePage({ searchParams }: { searchParams: Promise<{ op?: string }> }) {
  const { user, sarfli } = await requireSpender();
  const t = await getTranslations("market");
  const format = await getFormatter();
  const { op: wanted } = await searchParams;
  const [ops, recharges, allPackages] = await Promise.all([listOperators(), listBuyerRecharges(user.id), listPackages({ activeOnly: true })]);
  const [{ balances, dataBalances }, { rechargeEnabled, packages }] = await Promise.all([
    spendableByOperator(user, ops.map((o) => o.code)),
    spendingOffer(ops, allPackages),
  ]);
  const opBy = Object.fromEntries(ops.map((o) => [o.code, o]));
  // Only operators that offer credit recharges or data packages now (code set up and a SIM allowed to send).
  const usable = ops
    .filter((o) => o.active && (rechargeEnabled(o) || packages.some((p) => p.operatorCode === o.code)))
    .map((o) => ({
      code: o.code,
      name: o.name,
      color: o.color,
      balanceMillimes: balances[o.code] ?? 0,
      dataBalanceMillimes: dataBalances[o.code] ?? 0,
      rechargeEnabled: rechargeEnabled(o),
    }));
  const usablePackages = packages
    .filter((p) => usable.some((o) => o.code === p.operatorCode))
    .map((p) => ({ id: p.id, operatorCode: p.operatorCode, name: p.name, priceMillimes: p.priceMillimes }));
  const live = recharges.some((r) => ACTIVE_RECHARGE_STATUSES.includes(r.status));

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8">
      {live && <AutoRefresh seconds={4} />}
      <Button variant="ghost" className="-ms-2 -mb-2 h-10 self-start text-base text-muted-foreground" render={<Link href="/buy" />}>
        <ArrowLeftIcon aria-hidden="true" className="rtl:rotate-180" />
        {t("buyHome.title")}
      </Button>
      <div className="flex flex-col gap-1">
        <h1 className="font-heading font-bold text-3xl tracking-tight">{t("rechargeTitle")}</h1>
        <p className="text-muted-foreground">{t("rechargeSubtitle")}</p>
      </div>
      {sarfli && (
        <p className="rounded-xl bg-amber-50 p-3 text-amber-950 text-sm dark:bg-amber-950/40 dark:text-amber-100">{t("sarfliUse")}</p>
      )}

      <RechargeForm operators={usable} packages={usablePackages} initialOp={wanted} />

      {sarfli && (
        <Button variant="ghost" className="h-12 self-start text-base text-muted-foreground" render={<Link href="/buy/pos" />}>
          <MonitorSmartphoneIcon aria-hidden="true" />
          {t("pos.link")}
        </Button>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="font-heading font-semibold text-xl">{t("rechargeHistory")}</h2>
        {recharges.length === 0 ? (
          <p className="py-6 text-center text-muted-foreground">{t("noRecharges")}</p>
        ) : (
          <ul className="flex flex-col divide-y overflow-hidden rounded-2xl border bg-card">
            {recharges.map((r) => {
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
                    {r.packageName && <span className="text-sm">{r.packageName}</span>}
                    <div className="flex flex-wrap items-center gap-2">
                      <RechargeStatusBadge status={r.status} />
                      <span className="text-muted-foreground text-xs">
                        {format.dateTime(r.createdAt, { dateStyle: "medium", timeStyle: "short" })} · <span className="font-mono">{r.ref}</span>
                      </span>
                    </div>
                    {r.status === "failed" && (
                      <span className="text-muted-foreground text-xs">
                        {t(r.note === NUMBER_NOT_COMPATIBLE ? "rechargeNotCompatible" : "rechargeRefunded")}
                      </span>
                    )}
                    {r.status === "review" && <span className="text-muted-foreground text-xs">{t("rechargeReviewHint")}</span>}
                  </div>
                  {r.status === "queued" && <CancelRechargeButton id={r.id} />}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
