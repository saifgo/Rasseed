import { ArrowLeftIcon, StoreIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Rating } from "@/components/app/market-badges";
import { Dt } from "@/components/app/money";
import { OperatorLogo } from "@/components/app/operator-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { brand } from "@/config/brand";
import { orderPrice } from "@/lib/engine/market";
import { listOpenListings, requireMarketUser } from "@/lib/market-queries";
import { listOperators } from "@/lib/queries";
import { segmentedControlItemVariants, segmentedControlRootClassName } from "@/lib/segmented-control";
import { cn } from "@/lib/utils";
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

      {activeOps.length > 1 && (
        <nav className={cn(segmentedControlRootClassName, "w-full")} aria-label={t("filter")}>
          {activeOps.map((o) => (
            <Link
              key={o.code}
              href={`/buy/sellers?op=${o.code}`}
              aria-current={op?.code === o.code ? "page" : undefined}
              className={cn(segmentedControlItemVariants({ size: "lg", state: "current" }), "h-11 flex-1 sm:h-10")}
            >
              <OperatorLogo code={o.code} name={o.name} color={o.color} className="size-5 rounded-md" />
              {o.name}
            </Link>
          ))}
        </nav>
      )}

      {!op || shown.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border bg-card py-10 text-center text-muted-foreground">
          <StoreIcon aria-hidden="true" className="size-8 opacity-60" />
          {t("noListings")}
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {shown.map((l, i) => {
            const seller = l.sellerId ? (l.sellerName ?? t("seller")) : brand.name;
            return (
              <li key={l.id} className="flex flex-col gap-3 rounded-2xl border-2 bg-card p-4" style={i === 0 ? { borderColor: op.color } : undefined}>
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
                  maxOrderMillimes={settings.maxOrderMillimes}
                />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
