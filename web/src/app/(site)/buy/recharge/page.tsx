import { ArrowLeftIcon, SmartphoneIcon } from "lucide-react";
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
import { db } from "@/db";
import { balancesByOperator } from "@/lib/engine/ledger";
import { listBuyerRecharges } from "@/lib/engine/recharge";
import { requireMarketUser } from "@/lib/market-queries";
import { formatMsisdn } from "@/lib/phone";
import { listOperators } from "@/lib/queries";
import { CancelRechargeButton, RechargeForm } from "./recharge-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Recharge" };

export default async function RechargePage({ searchParams }: { searchParams: Promise<{ op?: string }> }) {
  const { user } = await requireMarketUser();
  const t = await getTranslations("market");
  const format = await getFormatter();
  const { op: wanted } = await searchParams;
  const [ops, balances, recharges] = await Promise.all([listOperators(), balancesByOperator(db, "buyer", user.id), listBuyerRecharges(user.id)]);
  const opBy = Object.fromEntries(ops.map((o) => [o.code, o]));
  // Only operators whose recharge code is set up by our team.
  const usable = ops
    .filter((o) => o.active && o.rechargeUssdTemplate)
    .map((o) => ({ code: o.code, name: o.name, color: o.color, balanceMillimes: balances[o.code] ?? 0 }));
  const live = recharges.some((r) => ACTIVE_RECHARGE_STATUSES.includes(r.status));

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8 px-4 py-8">
      {live && <AutoRefresh seconds={4} />}
      <Button variant="ghost" className="-ms-2 -mb-4 h-10 self-start text-base text-muted-foreground" render={<Link href="/buy" />}>
        <ArrowLeftIcon aria-hidden="true" className="rtl:rotate-180" />
        {t("buyHome.title")}
      </Button>
      <div className="flex flex-col gap-1">
        <h1 className="font-heading font-bold text-3xl tracking-tight">{t("rechargeTitle")}</h1>
        <p className="text-muted-foreground">{t("rechargeSubtitle")}</p>
      </div>

      <RechargeForm operators={usable} initialOp={wanted} />

      <section className="flex flex-col gap-3">
        <h2 className="font-heading font-semibold text-xl">{t("rechargeHistory")}</h2>
        {recharges.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center text-muted-foreground">
            <SmartphoneIcon aria-hidden="true" className="size-8 opacity-60" />
            {t("noRecharges")}
          </div>
        ) : (
          <ul className="flex flex-col divide-y overflow-hidden rounded-2xl border bg-card">
            {recharges.map((r) => {
              const op = opBy[r.operatorCode];
              return (
                <li key={r.id} className="flex items-center gap-4 p-4">
                  <OperatorLogo code={op.code} name={op.name} color={op.color} className="size-11 rounded-xl" />
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <Dt compact millimes={r.amountMillimes} className="font-semibold text-lg" />
                      <Secret dir="ltr" className="font-mono text-muted-foreground text-sm">
                        {formatMsisdn(r.msisdn)}
                      </Secret>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <RechargeStatusBadge status={r.status} />
                      <span className="text-muted-foreground text-xs">
                        {format.dateTime(r.createdAt, { dateStyle: "medium", timeStyle: "short" })} · <span className="font-mono">{r.ref}</span>
                      </span>
                    </div>
                    {r.status === "failed" && <span className="text-muted-foreground text-xs">{t("rechargeRefunded")}</span>}
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
