import type { Metadata } from "next";
import { ArrowRightIcon } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Dt } from "@/components/app/money";
import { OperatorLogo } from "@/components/app/operator-badge";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { db } from "@/db";
import { getBalance } from "@/lib/engine/wallet";
import { grossPayout } from "@/lib/money";
import { getOngoingSale, listOperators } from "@/lib/queries";
import { requireUser } from "@/lib/session";
import { SellForm } from "./sell-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sell" };

export default async function SellPage({ searchParams }: { searchParams: Promise<{ op?: string }> }) {
  const user = await requireUser();
  const t = await getTranslations("sell");
  const { op } = await searchParams;
  const [ops, balance, ongoing] = await Promise.all([listOperators(), getBalance(db, user.id), getOngoingSale(user.id)]);

  // Only one sale at a time: send the seller back to the one in progress.
  if (ongoing) {
    const { tx, op: txOp } = ongoing;
    return (
      <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-8">
        <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
          <h1 className="font-heading font-bold text-3xl tracking-tight">{t("title")}</h1>
          <div className="flex flex-col gap-1">
            <h2 className="text-balance font-heading font-bold text-2xl leading-tight">{t("ongoingTitle")}</h2>
            <p className="text-muted-foreground">{t("ongoingText")}</p>
          </div>
          <Link
            href={`/sales/${tx.id}`}
            className="flex items-center gap-4 rounded-2xl border-2 bg-card p-4 transition-colors hover:bg-accent/60"
            style={{ borderColor: txOp.color }}
          >
            <OperatorLogo code={txOp.code} name={txOp.name} color={txOp.color} className="size-12 rounded-xl" />
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <Dt compact millimes={tx.declaredMillimes} className="font-semibold text-lg" />
                <ArrowRightIcon aria-hidden="true" className="size-4 self-center text-muted-foreground rtl:rotate-180" />
                <Dt
                  compact
                  millimes={grossPayout(tx.declaredMillimes, tx.rateBps)}
                  className="font-bold text-emerald-700 text-lg dark:text-emerald-400"
                />
              </div>
              <div>
                <StatusBadge status={tx.status} />
              </div>
            </div>
          </Link>
          <Button variant="go" className="h-14 w-full text-lg sm:h-14 sm:text-lg" render={<Link href={`/sales/${tx.id}`} />}>
            {t("ongoingOpen")}
            <ArrowRightIcon aria-hidden="true" className="size-5 rtl:rotate-180" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-8">
      <h1 className="mx-auto w-full max-w-xl font-heading font-bold text-3xl tracking-tight">{t("title")}</h1>
      <SellForm
        operators={ops.map((o) => ({ code: o.code, name: o.name, color: o.color, rateBps: o.rateBps, active: o.active }))}
        balanceMillimes={balance}
        initialOp={op}
      />
    </div>
  );
}
