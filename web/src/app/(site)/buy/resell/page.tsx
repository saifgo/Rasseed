import { ArrowLeftIcon, RepeatIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Dt } from "@/components/app/money";
import { OperatorLogo } from "@/components/app/operator-badge";
import { Button } from "@/components/ui/button";
import { db } from "@/db";
import { balancesByOperator } from "@/lib/engine/ledger";
import { listSellerListings, requireMarketUser } from "@/lib/market-queries";
import { listOperators } from "@/lib/queries";
import { ListingForm } from "../../selling/selling-forms";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Resell" };

export default async function ResellPage() {
  const { user } = await requireMarketUser();
  const t = await getTranslations("market");
  const [ops, balances, mine] = await Promise.all([
    listOperators(),
    balancesByOperator(db, "buyer", user.id),
    listSellerListings(user.id, "balance"),
  ]);
  // Operators with credit to resell, or an existing resale listing to manage (e.g. to switch it off).
  const shown = ops.filter((o) => o.active && ((balances[o.code] ?? 0) > 0 || mine.some((l) => l.operatorCode === o.code)));

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8">
      <Button variant="ghost" className="-ms-2 -mb-2 h-10 self-start text-base text-muted-foreground" render={<Link href="/buy" />}>
        <ArrowLeftIcon aria-hidden="true" className="rtl:rotate-180" />
        {t("buyHome.title")}
      </Button>
      <div className="flex flex-col gap-1">
        <h1 className="font-heading font-bold text-3xl tracking-tight">{t("resell.title")}</h1>
        <p className="text-muted-foreground">{t("resell.subtitle")}</p>
      </div>
      <p className="rounded-xl bg-muted/60 p-3 text-sm">{t("resell.rules")}</p>

      {shown.length === 0 ? (
        <div className="flex flex-col items-center gap-4 py-12 text-center">
          <RepeatIcon aria-hidden="true" className="size-10 text-muted-foreground/60" />
          <p className="max-w-sm text-muted-foreground">{t("resell.none")}</p>
          <Button variant="go" className="h-12 text-base sm:h-12" render={<Link href="/buy/sellers" />}>
            {t("buyHome.buyCta")}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {shown.map((o) => {
            const listing = mine.find((l) => l.operatorCode === o.code) ?? null;
            return (
              <section key={o.code} className="flex flex-col gap-4 rounded-2xl border-2 bg-card p-4" style={{ borderColor: o.color }}>
                <div className="flex items-center gap-3">
                  <OperatorLogo code={o.code} name={o.name} color={o.color} className="size-10 rounded-xl" />
                  <span className="flex-1 font-heading font-bold text-lg">{o.name}</span>
                  <span className="flex flex-col items-end">
                    <span className="text-muted-foreground text-xs">{t("resell.balance")}</span>
                    <Dt compact millimes={balances[o.code] ?? 0} className="font-bold text-lg" />
                  </span>
                </div>
                <ListingForm
                  bare
                  source="balance"
                  op={{ code: o.code, name: o.name, color: o.color, rateBps: o.rateBps }}
                  listing={listing ? { priceBps: listing.priceBps, paymentInfo: listing.paymentInfo, active: listing.active } : null}
                />
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
