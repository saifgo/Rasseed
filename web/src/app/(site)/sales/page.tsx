import { ArrowRightIcon, HandCoinsIcon, ReceiptTextIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { Dt } from "@/components/app/money";
import { OperatorLogo } from "@/components/app/operator-badge";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { grossPayout } from "@/lib/money";
import { listUserSales } from "@/lib/queries";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sales" };

export default async function SalesPage() {
  const user = await requireUser();
  const t = await getTranslations();
  const format = await getFormatter();
  const rows = await listUserSales(user.id);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-heading font-bold text-3xl tracking-tight">{t("sales.title")}</h1>
        {rows.length > 0 && (
          <Button variant="go" size="lg" render={<Link href="/sell" />}>
            <HandCoinsIcon aria-hidden="true" />
            {t("sale.newSale")}
          </Button>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-4 py-12 text-center">
          <ReceiptTextIcon aria-hidden="true" className="size-10 text-muted-foreground/60" />
          <div className="flex flex-col gap-1">
            <h2 className="font-semibold text-xl">{t("sales.empty")}</h2>
            <p className="text-muted-foreground">{t("sales.emptyText")}</p>
          </div>
          <Button variant="go" className="h-14 w-full text-lg sm:h-14 sm:w-auto sm:px-8" render={<Link href="/sell" />}>
            <HandCoinsIcon aria-hidden="true" className="size-5" />
            {t("nav.sell")}
          </Button>
        </div>
      ) : (
        <ul className="flex flex-col divide-y overflow-hidden rounded-2xl border bg-card">
          {rows.map(({ tx, op }) => (
            <li key={tx.id}>
              <Link
                href={`/sales/${tx.id}`}
                className="flex items-center gap-4 p-4 transition-colors hover:bg-accent/60"
              >
                <OperatorLogo code={op.code} name={op.name} color={op.color} className="size-12 rounded-xl" />
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <Dt compact millimes={tx.finalMillimes ?? tx.declaredMillimes} className="font-semibold text-lg" />
                    <ArrowRightIcon aria-hidden="true" className="size-4 self-center text-muted-foreground rtl:rotate-180" />
                    <Dt compact
                      millimes={tx.payoutNetMillimes ?? grossPayout(tx.declaredMillimes, tx.rateBps)}
                      className="font-bold text-emerald-700 text-lg dark:text-emerald-400"
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={tx.status} />
                    <span className="text-muted-foreground text-xs">{format.dateTime(tx.createdAt, { dateStyle: "medium", timeStyle: "short" })}</span>
                  </div>
                </div>
                <ArrowRightIcon aria-hidden="true" className="size-5 shrink-0 text-muted-foreground rtl:rotate-180" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
