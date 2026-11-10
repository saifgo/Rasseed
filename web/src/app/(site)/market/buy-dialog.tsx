"use client";

import { ArrowRightIcon, ShoppingCartIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { BigInput } from "@/components/app/big-input";
import { Dt } from "@/components/app/money";
import { OperatorLogo } from "@/components/app/operator-badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogPanel, DialogPopup, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { BPS, formatDt, grossPayout, parseDinars } from "@/lib/money";
import { createOrderAction } from "./actions";

type Listing = {
  id: string;
  seller: string;
  priceBps: number;
  operator: { code: string; name: string; color: string };
};

export function BuyDialog({ listing, commissionBps, maxOrderMillimes }: { listing: Listing; commissionBps: number; maxOrderMillimes: number }) {
  const t = useTranslations("market");
  const te = useTranslations("errors");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);

  const credit = parseDinars(amount);
  // Same rounding as the engine (orderPrice / orderCommission).
  const pay = credit ? grossPayout(credit, listing.priceBps) : 0;
  const commission = credit ? Math.floor((credit * commissionBps) / BPS) : 0;
  const receive = credit ? credit - commission : 0;
  const tooBig = !!credit && credit > maxOrderMillimes;
  const valid = !!credit && pay > 0 && !tooBig;
  const op = listing.operator;

  function submit() {
    setError(null);
    if (!valid || !credit) {
      setError(tooBig ? t("maxOrder", { amount: formatDt(maxOrderMillimes) }) : te("invalid_amount"));
      return;
    }
    startTransition(async () => {
      const res = await createOrderAction({ listingId: listing.id, amountMillimes: credit });
      if (res.ok) router.push(`/market/orders/${res.data}`);
      else setError(te.has(res.error) ? te(res.error) : te("unknown"));
    });
  }

  return (
    <Dialog>
      <DialogTrigger render={<Button variant="go" className="shrink-0" />}>
        <ShoppingCartIcon aria-hidden="true" />
        {t("buy")}
      </DialogTrigger>
      <DialogPopup>
        <form
          className="contents"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              <OperatorLogo code={op.code} name={op.name} color={op.color} className="size-9 rounded-lg" />
              {t("buyFrom", { operator: op.name, seller: listing.seller })}
            </DialogTitle>
            <DialogDescription>{t("buyDialogHint", { max: formatDt(maxOrderMillimes) })}</DialogDescription>
          </DialogHeader>
          <DialogPanel className="flex flex-col gap-4">
            <label htmlFor={`amount-${listing.id}`} className="font-semibold">
              {t("creditAmount", { operator: op.name })}
            </label>
            <BigInput
              id={`amount-${listing.id}`}
              autoFocus
              type="text"
              inputMode="decimal"
              autoComplete="off"
              placeholder="20"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d.,]/g, ""))}
              suffix="DT"
              invalid={!!error || tooBig}
            />
            {tooBig && <p className="font-medium text-destructive-foreground">{t("maxOrder", { amount: formatDt(maxOrderMillimes) })}</p>}
            <dl className="flex flex-col gap-2 border-t pt-4 text-sm">
              <div className="flex items-center justify-between gap-4">
                <dt className="font-semibold text-base">{t("youPay", { seller: listing.seller })}</dt>
                <dd>
                  <Dt compact millimes={pay} className="font-bold text-2xl" />
                </dd>
              </div>
              {commission > 0 && (
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-muted-foreground">{t("commission")}</dt>
                  <dd>
                    <Dt compact millimes={-commission} />
                  </dd>
                </div>
              )}
              <div className="flex items-center justify-between gap-4">
                <dt className="font-semibold text-base">{t("youReceiveCredit", { operator: op.name })}</dt>
                <dd>
                  <Dt compact millimes={receive} className="font-bold text-2xl text-emerald-700 dark:text-emerald-400" />
                </dd>
              </div>
            </dl>
            <p className="text-muted-foreground text-sm">{t("buyHowItWorks")}</p>
            {error && !tooBig && (
              <Alert variant="error">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </DialogPanel>
          <DialogFooter>
            <Button type="submit" variant="go" className="h-12 text-base sm:h-12" loading={pending}>
              {t("placeOrder")}
              <ArrowRightIcon aria-hidden="true" className="rtl:rotate-180" />
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
