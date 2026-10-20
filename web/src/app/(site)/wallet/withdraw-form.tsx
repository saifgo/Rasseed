"use client";

import { CheckCircle2Icon, InfoIcon, SendIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { BigInput } from "@/components/app/big-input";
import { Dt } from "@/components/app/money";
import { PayoutLogo } from "@/components/app/payout-logo";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Form } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Radio, RadioGroup } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";
import { toastManager } from "@/components/ui/toast";
import type { LocalizedText, PayoutField } from "@/db/schema";
import { formatDt, parseDinars } from "@/lib/money";
import { normalizeMsisdn } from "@/lib/phone";
import { requestWithdrawalAction } from "./actions";

type Method = { code: string; name: LocalizedText; feeMillimes: number; fields: PayoutField[] };

const cardOption =
  "group flex cursor-pointer items-center gap-3 rounded-2xl border-2 bg-card p-3 transition-colors hover:bg-accent/50 has-data-checked:border-emerald-600 has-data-checked:bg-emerald-600/6";

export function WithdrawForm({
  balanceMillimes,
  minMillimes,
  methods,
  saved,
}: {
  balanceMillimes: number;
  minMillimes: number;
  methods: Method[];
  saved: Record<string, Record<string, string>>;
}) {
  const t = useTranslations("wallet");
  const tc = useTranslations("sell");
  const te = useTranslations("errors");
  const locale = useLocale() as keyof LocalizedText;
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [amount, setAmount] = useState("");
  const [methodCode, setMethodCode] = useState(methods[0]?.code ?? "");
  const [details, setDetails] = useState<Record<string, Record<string, string>>>(saved);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const method = methods.find((m) => m.code === methodCode);
  const amountMillimes = parseDinars(amount);
  const net = method && amountMillimes ? Math.max(0, amountMillimes - method.feeMillimes) : 0;
  const methodDetails = useMemo(() => details[methodCode] ?? {}, [details, methodCode]);
  const canWithdraw = balanceMillimes >= minMillimes && methods.length > 0;

  function validate() {
    const e: Record<string, string> = {};
    if (!amountMillimes) e.amount = tc("invalidAmount");
    else if (amountMillimes < minMillimes) e.amount = t("belowMinimum", { amount: formatDt(minMillimes) });
    else if (amountMillimes > balanceMillimes) e.amount = t("aboveBalance");
    else if (method && net <= 0) e.amount = te("payout_below_fee");
    for (const f of method?.fields ?? []) {
      const v = (methodDetails[f.key] ?? "").trim();
      if (f.required && !v) e[`d.${f.key}`] = tc("required");
      else if (v && f.type === "phone" && !normalizeMsisdn(v)) e[`d.${f.key}`] = tc("invalidPhone");
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function submit() {
    setFormError(null);
    if (!validate() || !method || !amountMillimes) return;
    startTransition(async () => {
      const res = await requestWithdrawalAction({ amountMillimes, methodCode: method.code, details: methodDetails });
      if (res.ok) {
        toastManager.add({ type: "success", title: t("requested") });
        setAmount("");
        router.refresh();
      } else {
        setFormError(te.has(res.error) ? te(res.error) : te("unknown"));
      }
    });
  }

  if (!canWithdraw) {
    return (
      <div className="flex items-start gap-3 border-t pt-6">
        <InfoIcon aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
        <div className="flex flex-col gap-1">
          <h2 className="font-semibold text-lg">{t("withdrawTitle")}</h2>
          <p className="text-muted-foreground">
            {methods.length === 0 ? t("noMethods") : t("needMinimum", { amount: formatDt(minMillimes) })}
          </p>
        </div>
      </div>
    );
  }

  return (
    <section className="flex flex-col gap-5 border-t pt-6">
      <div className="flex flex-col gap-1">
        <h2 className="font-heading font-bold text-2xl">{t("withdrawTitle")}</h2>
        <p className="text-muted-foreground">{t("withdrawText", { min: formatDt(minMillimes) })}</p>
      </div>
      <Form
        className="flex flex-col gap-6"
        errors={errors}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="flex flex-col gap-3">
          <span className="font-semibold text-lg">1. {tc("payoutMethod")}</span>
          <RadioGroup value={methodCode} onValueChange={(v) => setMethodCode(String(v))} className="grid gap-3 sm:grid-cols-3">
            {methods.map((m) => (
              <Label key={m.code} className={cardOption}>
                <Radio value={m.code} className="sr-only" />
                <PayoutLogo code={m.code} className="size-12" />
                <span className="flex flex-1 flex-col gap-0.5">
                  <span className="font-semibold text-base">{m.name[locale] ?? m.name.en}</span>
                  <span className="text-muted-foreground text-xs">
                    {m.feeMillimes > 0 ? tc("fee", { amount: formatDt(m.feeMillimes) }) : tc("noFee")}
                  </span>
                </span>
                <CheckCircle2Icon aria-hidden="true" className="hidden size-6 shrink-0 text-emerald-600 group-has-data-checked:block" />
              </Label>
            ))}
          </RadioGroup>
        </div>

        <Field name="amount" className="flex flex-col items-stretch gap-3">
          <FieldLabel className="font-semibold text-lg">2. {t("amount")}</FieldLabel>
          <div className="flex gap-2">
            <BigInput
              type="text"
              inputMode="decimal"
              autoComplete="off"
              placeholder={formatDt(minMillimes)}
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d.,]/g, ""))}
              suffix="DT"
              invalid={!!errors.amount}
              className="min-w-0 flex-1"
            />
            <Button type="button" variant="outline" className="h-16 px-4 text-base sm:h-16" onClick={() => setAmount((balanceMillimes / 1000).toFixed(3))}>
              {t("all")}
            </Button>
          </div>
          <FieldDescription>{t("amountHint", { balance: formatDt(balanceMillimes) })}</FieldDescription>
          {errors.amount && <p className="font-medium text-destructive-foreground">{errors.amount}</p>}
        </Field>

        {method && method.fields.length > 0 && (
          <div className="flex flex-col gap-3">
            <span className="font-semibold text-lg">3. {t("whereToSend")}</span>
            <div className="grid gap-4 sm:grid-cols-2">
              {method.fields.map((f) => (
                <Field key={`${method.code}.${f.key}`} name={`d.${f.key}`} className="items-stretch">
                  <FieldLabel>{f.label[locale] ?? f.label.en}</FieldLabel>
                  <Input
                    size="lg"
                    className="h-12 text-lg sm:h-12 sm:text-lg [&_input]:h-full"
                    type={f.type === "phone" ? "tel" : "text"}
                    inputMode={f.type === "phone" ? "numeric" : undefined}
                    dir={f.type === "phone" ? "ltr" : undefined}
                    value={methodDetails[f.key] ?? ""}
                    onChange={(e) =>
                      setDetails((d) => ({ ...d, [method.code]: { ...(d[method.code] ?? {}), [f.key]: e.target.value } }))
                    }
                  />
                  <FieldError />
                </Field>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-col gap-2 border-t pt-4 text-sm">
          <Row label={t("fromBalance")}>
            <Dt compact millimes={amountMillimes ?? 0} />
          </Row>
          <Row label={tc("feeLine")}>
            <Dt compact millimes={method?.feeMillimes ? -method.feeMillimes : 0} />
          </Row>
          <Separator />
          <div className="flex items-center justify-between gap-4">
            <span className="font-semibold text-base">{t("youGet")}</span>
            <Dt compact millimes={net} className="font-bold text-3xl text-emerald-700 dark:text-emerald-400" />
          </div>
        </div>
        {formError && (
          <Alert variant="error">
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        )}
        <Button type="submit" variant="go" className="h-14 w-full text-lg sm:h-14 sm:text-lg" loading={pending}>
          <SendIcon aria-hidden="true" className="size-5" />
          {t("submit")}
        </Button>
      </Form>
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span>{children}</span>
    </div>
  );
}
