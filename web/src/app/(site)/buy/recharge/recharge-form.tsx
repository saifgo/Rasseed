"use client";

import { BanIcon, PhoneIcon, SendIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { BigInput } from "@/components/app/big-input";
import { Dt } from "@/components/app/money";
import { OperatorLogo } from "@/components/app/operator-badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { toastManager } from "@/components/ui/toast";
import { formatDt, parseDinars } from "@/lib/money";
import { formatMsisdn, normalizeMsisdn } from "@/lib/phone";
import { cn } from "@/lib/utils";
import { cancelRechargeAction, createRechargeAction } from "../../_market/actions";

type Op = { code: string; name: string; color: string; balanceMillimes: number };

export function RechargeForm({ operators, initialOp }: { operators: Op[]; initialOp?: string }) {
  const t = useTranslations("market");
  const te = useTranslations("errors");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [operatorCode, setOperatorCode] = useState(operators.find((o) => o.code === initialOp)?.code ?? operators.find((o) => o.balanceMillimes > 0)?.code ?? operators[0]?.code ?? "");
  const [number, setNumber] = useState("");
  const [amount, setAmount] = useState("");
  const [showErrors, setShowErrors] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const op = operators.find((o) => o.code === operatorCode);
  const msisdn = normalizeMsisdn(number);
  const credit = parseDinars(amount);
  const amountError = !credit ? te("invalid_amount") : op && credit > op.balanceMillimes ? t("aboveBalance") : null;

  if (operators.length === 0) {
    return <p className="rounded-2xl border bg-card p-5 text-muted-foreground">{t("rechargeOff")}</p>;
  }

  function submit() {
    setError(null);
    setShowErrors(true);
    if (!op || !msisdn || amountError || !credit) return;
    startTransition(async () => {
      const res = await createRechargeAction({ operatorCode: op.code, msisdn, amountMillimes: credit });
      if (res.ok) {
        toastManager.add({ type: "success", title: t("rechargeQueued") });
        setNumber("");
        setAmount("");
        setShowErrors(false);
        router.refresh();
      } else setError(te.has(res.error) ? te(res.error) : te("unknown"));
    });
  }

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="flex flex-col gap-2">
        <span className="font-semibold text-lg">1. {t("rechargeOperator")}</span>
        <div className="grid gap-2 sm:grid-cols-3">
          {operators.map((o) => (
            <button
              key={o.code}
              type="button"
              aria-pressed={o.code === operatorCode}
              onClick={() => setOperatorCode(o.code)}
              className={cn(
                "flex items-center gap-3 rounded-2xl border-2 bg-card p-3 text-start transition-colors hover:bg-accent/50",
                o.code !== operatorCode && "border-border",
              )}
              style={o.code === operatorCode ? { borderColor: o.color, backgroundColor: `${o.color}10` } : undefined}
            >
              <OperatorLogo code={o.code} name={o.name} color={o.color} className="size-10 rounded-xl" />
              <span className="flex min-w-0 flex-col">
                <span className="font-semibold">{o.name}</span>
                <Dt compact millimes={o.balanceMillimes} className="text-muted-foreground text-sm" />
              </span>
            </button>
          ))}
        </div>
      </div>

      <label className="flex flex-col gap-2">
        <span className="font-semibold text-lg">2. {t("rechargeNumber")}</span>
        <BigInput
          type="tel"
          inputMode="numeric"
          autoComplete="off"
          placeholder="2X XXX XXX"
          value={number}
          onChange={(e) => setNumber(e.target.value)}
          prefix={<PhoneIcon aria-hidden="true" className="size-6 shrink-0 text-muted-foreground" />}
          invalid={showErrors && !msisdn}
        />
        {showErrors && !msisdn && <span className="font-medium text-destructive-foreground">{te("invalid_msisdn")}</span>}
      </label>

      <label className="flex flex-col gap-2">
        <span className="font-semibold text-lg">3. {t("rechargeAmount")}</span>
        <BigInput
          type="text"
          inputMode="decimal"
          autoComplete="off"
          placeholder="5"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^\d.,]/g, ""))}
          suffix="DT"
          invalid={showErrors && !!amountError}
        />
        <span className="text-muted-foreground text-sm">{t("rechargeAmountHint", { balance: formatDt(op?.balanceMillimes ?? 0), operator: op?.name ?? "" })}</span>
        {showErrors && amountError && <span className="font-medium text-destructive-foreground">{amountError}</span>}
      </label>

      {msisdn && credit && !amountError && op && (
        <p className="rounded-xl bg-muted/60 p-3 text-sm">
          {t.rich("rechargeSummary", {
            amount: () => <Dt compact millimes={credit} className="font-semibold" />,
            number: () => (
              <bdi dir="ltr" className="font-semibold tabular-nums">
                {formatMsisdn(msisdn)}
              </bdi>
            ),
            operator: op.name,
          })}
        </p>
      )}

      {error && (
        <Alert variant="error">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Button type="submit" variant="go" className="h-14 w-full text-lg sm:h-14 sm:text-lg" loading={pending}>
        <SendIcon aria-hidden="true" className="size-5" />
        {t("rechargeSend")}
      </Button>
    </form>
  );
}

export function CancelRechargeButton({ id }: { id: string }) {
  const t = useTranslations("market");
  const te = useTranslations("errors");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="sm"
      variant="ghost"
      className="text-destructive-foreground"
      loading={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await cancelRechargeAction(id);
          if (!res.ok) toastManager.add({ type: "error", title: te.has(res.error) ? te(res.error) : te("unknown") });
          router.refresh();
        })
      }
    >
      <BanIcon aria-hidden="true" />
      {t("rechargeCancel")}
    </Button>
  );
}
