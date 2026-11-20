import { ArrowLeftIcon, StoreIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Rating } from "@/components/app/market-badges";
import { Dt } from "@/components/app/money";
import { OperatorFilter } from "@/components/app/operator-filter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { brand } from "@/config/brand";
import { orderPrice } from "@/lib/engine/market";
import { listOpenListings, requireMarketUser } from "@/lib/market-queries";
import { listOperators } from "@/lib/queries";
import { BuyDialog } from "./buy-dialog";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Choose a seller" };

export default async function SellersPage({ searchParams }: { searchParams: Promise<{ op?: string }> }) {
  const { user, settings } = await requireMarketUser();
  const t = await getTranslations("market");
  const { op: wanted } = await searchParams;
  const [ops, listings] = await Promise.all([listOperators(), listOpenListings(user.id)]);
  const activeOps = ops.filter((o) => o.active);
  const op = activeOps.find((o) => o.code === wanted) ?? activeOps[0];
  const shown = op ? listings.filter((l) => l.operatorCode === op.code) : [];

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8">
      <Button variant="ghost" className="-ms-2 -mb-2 h-10 self-start text-base text-muted-foreground" render={<Link href="/buy" />}>
        <ArrowLeftIcon aria-hidden="true" className="rtl:rotate-180" />
        {t("buyHome.title")}
      </Button>
      <div className="flex flex-col gap-1">
        <h1 className="font-heading font-bold text-3xl tracking-tight">{t("sellers.title")}</h1>
        <p className="text-muted-foreground">{t("sellers.hint")}</p>
      </div>

      <OperatorFilter operators={activeOps} current={op?.code} hrefFor={(code) => `/buy/sellers?op=${code}`} label={t("filter")} />

      {!op || shown.length === 0 ? (
        <div className="flex flex-col items-center gap-4 py-12 text-center">
          <StoreIcon aria-hidden="true" className="size-10 text-muted-foreground/60" />
          <p className="text-muted-foreground">{t("noListings")}</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {shown.map((l, i) => {
            const seller = l.sellerId ? (l.sellerName ?? t("seller")) : brand.name;
            return (
              <li key={l.id} className="flex flex-col gap-3 rounded-2xl border bg-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="flex flex-wrap items-center gap-2 font-semibold text-lg">
                      {seller}
                      {i === 0 && shown.length > 1 && (
                        <Badge variant="success" className="rounded-full">
                          {t("sellers.cheapest")}
                        </Badge>
                      )}
                    </span>
                    <Rating rating={l.rating} />
                    {l.availableMillimes != null && (
                      <span className="text-muted-foreground text-sm">
                        {t.rich("resell.available", { amount: () => <Dt compact millimes={l.availableMillimes ?? 0} className="font-semibold text-foreground" /> })}
                      </span>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-col items-end">
                    <Dt compact millimes={orderPrice(10_000, l.priceBps)} className="font-bold text-2xl" />
                    <span className="text-muted-foreground text-xs">{t("sellers.per10", { operator: op.name })}</span>
                  </div>
                </div>
                {l.paymentInfo && <p className="line-clamp-2 text-muted-foreground text-sm">{t("paysWith", { info: l.paymentInfo })}</p>}
                <BuyDialog
                  listing={{
                    id: l.id,
                    seller,
                    priceBps: l.priceBps,
                    operator: { code: op.code, name: op.name, color: op.color },
                  }}
                  commissionBps={settings.commissionBps}
                  maxOrderMillimes={l.availableMillimes != null ? Math.min(settings.maxOrderMillimes, l.availableMillimes) : settings.maxOrderMillimes}
                />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
