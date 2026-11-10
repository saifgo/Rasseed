"use client";

import { HandCoinsIcon, SaveIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { BigInput } from "@/components/app/big-input";
import { Dt } from "@/components/app/money";
import { OperatorLogo } from "@/components/app/operator-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toastManager } from "@/components/ui/toast";
import { BPS, formatDt, grossPayout, parseDinars, parseRate } from "@/lib/money";
import { sellStockAction, upsertListingAction } from "../_market/actions";

type Op = { code: string; name: string; color: string; rateBps: number };

/** "0.85" from 8500 basis points. */
const priceText = (bps: number) => String(Number((bps / BPS).toFixed(4)));

export function ListingForm({
  op,
  listing,
  bare = false,
}: {
  op: Op;
  listing: { priceBps: number; paymentInfo: string; active: boolean } | null;
  /** Inside another card: no border, no operator header. */
  bare?: boolean;
}) {
  const t = useTranslations("market");
  const te = useTranslations("errors");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [price, setPrice] = useState(listing ? priceText(listing.priceBps) : "");
  const [paymentInfo, setPaymentInfo] = useState(listing?.paymentInfo ?? "");
  const [active, setActive] = useState(listing?.active ?? true);
  const [error, setError] = useState<string | null>(null);

  const priceBps = parseRate(price);
  const priceOk = priceBps != null && priceBps <= BPS;

  function save() {
    setError(null);
    if (!priceOk || priceBps == null) return setError(t("invalidPrice"));
    if (active && !paymentInfo.trim()) return setError(te("payment_info_required"));
    startTransition(async () => {
      const res = await upsertListingAction({ operatorCode: op.code, priceBps, paymentInfo, active });
      if (res.ok) {
        toastManager.add({ type: "success", title: t("listingSaved") });
        router.refresh();
      } else setError(te.has(res.error) ? te(res.error) : te("unknown"));
    });
  }

  return (
    <form
      className={bare ? "flex flex-col gap-4" : "flex flex-col gap-4 rounded-2xl border-2 bg-card p-4"}
      style={bare ? undefined : { borderColor: op.color }}
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <div className="flex items-center gap-3">
        {!bare && <OperatorLogo code={op.code} name={op.name} color={op.color} className="size-10 rounded-xl" />}
        <span className="flex-1 font-heading font-bold text-lg">{bare ? t("yourOffer") : op.name}</span>
        <label className="flex items-center gap-2 font-medium">
          {active ? t("listingOn") : t("listingOff")}
          <Switch checked={active} onCheckedChange={setActive} />
        </label>
      </div>
      <label className="flex flex-col gap-1.5">
        <span className="font-medium text-sm">{t("pricePer1")}</span>
        <Input
          size="lg"
          className="h-12 text-lg sm:h-12 sm:text-lg [&_input]:h-full"
          dir="ltr"
          inputMode="decimal"
          placeholder="0.85"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          aria-invalid={price !== "" && !priceOk ? true : undefined}
        />
        <span className="text-muted-foreground text-sm">
          {priceOk && priceBps
            ? t.rich("pricePreview", { pay: () => <Dt compact millimes={grossPayout(10_000, priceBps)} className="font-semibold text-foreground" /> })
            : t("priceHint")}
        </span>
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="font-medium text-sm">{t("paymentInfo")}</span>
        <Textarea value={paymentInfo} onChange={(e) => setPaymentInfo(e.target.value)} maxLength={500} placeholder={t("paymentInfoPlaceholder")} />
      </label>
      {error && <p className="font-medium text-destructive-foreground text-sm">{error}</p>}
      <Button type="submit" variant={bare ? "go" : "outline"} className={bare ? "h-12 text-base sm:h-12" : "h-11 self-start"} loading={pending}>
        <SaveIcon aria-hidden="true" />
        {t("saveListing")}
      </Button>
    </form>
  );
}

export function SellStockForm({ op, stockMillimes }: { op: Op; stockMillimes: number }) {
  const t = useTranslations("market");
  const te = useTranslations("errors");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);

  const credit = parseDinars(amount);
  const cash = credit ? grossPayout(credit, op.rateBps) : 0;

  function sell() {
    setError(null);
    if (!credit || cash <= 0) return setError(te("invalid_amount"));
    if (credit > stockMillimes) return setError(t("aboveStock"));
    startTransition(async () => {
      const res = await sellStockAction(op.code, credit);
      if (res.ok) {
        toastManager.add({ type: "success", title: t("stockSold", { amount: formatDt(res.data) }) });
        setAmount("");
        router.refresh();
      } else setError(te.has(res.error) ? te(res.error) : te("unknown"));
    });
  }

  return (
    <form
      className="flex flex-col gap-3 border-t pt-3"
      onSubmit={(e) => {
        e.preventDefault();
        sell();
      }}
    >
      <span className="font-medium text-sm">{t("sellStockTitle")}</span>
      <div className="flex gap-2">
        <BigInput
          type="text"
          inputMode="decimal"
          autoComplete="off"
          placeholder={formatDt(stockMillimes)}
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^\d.,]/g, ""))}
          suffix="DT"
          invalid={!!error}
          className="h-14 min-w-0 flex-1"
        />
        <Button type="button" variant="outline" className="h-14 px-4 text-base sm:h-14" onClick={() => setAmount((stockMillimes / 1000).toFixed(3))}>
          {t("all")}
        </Button>
      </div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-muted-foreground text-sm">{t("cashToWallet")}</span>
        <Dt compact millimes={cash} className="font-bold text-2xl text-emerald-700 dark:text-emerald-400" />
      </div>
      {error && <p className="font-medium text-destructive-foreground text-sm">{error}</p>}
      <Button type="submit" variant="go" className="h-12 text-base sm:h-12" loading={pending}>
        <HandCoinsIcon aria-hidden="true" />
        {t("sellToSarfli")}
      </Button>
    </form>
  );
}
