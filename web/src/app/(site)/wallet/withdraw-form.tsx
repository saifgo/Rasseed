"use client";

import { SendIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Dt } from "@/components/app/money";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardFooter, CardHeader, CardPanel, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Fieldset, FieldsetLegend } from "@/components/ui/fieldset";
import { Form } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Radio, RadioGroup } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";
import { toastManager } from "@/components/ui/toast";
import type { LocalizedText, PayoutField } from "@/db/schema";
import { formatDinars, parseDinars } from "@/lib/money";
import { normalizeMsisdn } from "@/lib/phone";
import { requestWithdrawalAction } from "./actions";

type Method = { code: string; name: LocalizedText; feeMillimes: number; fields: PayoutField[] };

const cardOption =
  "flex cursor-pointer items-center gap-3 rounded-xl border bg-card p-3.5 transition-colors hover:bg-accent/50 has-data-checked:border-primary/48 has-data-checked:bg-accent/50";

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
    else if (amountMillimes < minMillimes) e.amount = t("belowMinimum", { amount: formatDinars(minMillimes) });
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
      <Card>
        <CardHeader>
          <CardTitle>{t("withdrawTitle")}</CardTitle>
          <CardDescription>
            {methods.length === 0 ? t("noMethods") : t("needMinimum", { amount: formatDinars(minMillimes) })}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("withdrawTitle")}</CardTitle>
        <CardDescription>{t("withdrawText", { min: formatDinars(minMillimes) })}</CardDescription>
      </CardHeader>
      <Form
        className="contents"
        errors={errors}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <CardPanel className="flex flex-col gap-6">
          <Field name="amount">
            <FieldLabel>{t("amount")}</FieldLabel>
            <div className="flex gap-2">
              <Input
                type="text"
                inputMode="decimal"
                autoComplete="off"
                placeholder={formatDinars(minMillimes)}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                dir="ltr"
              />
              <Button type="button" variant="outline" onClick={() => setAmount((balanceMillimes / 1000).toFixed(3))}>
                {t("all")}
              </Button>
            </div>
            <FieldDescription>{t("amountHint", { balance: formatDinars(balanceMillimes) })}</FieldDescription>
            <FieldError />
          </Field>

          <Fieldset>
            <FieldsetLegend>{tc("payoutMethod")}</FieldsetLegend>
            <RadioGroup value={methodCode} onValueChange={(v) => setMethodCode(String(v))} className="grid gap-3 sm:grid-cols-3">
              {methods.map((m) => (
                <Label key={m.code} className={cardOption}>
                  <Radio value={m.code} />
                  <span className="flex flex-1 flex-col gap-0.5">
                    <span className="font-medium">{m.name[locale] ?? m.name.en}</span>
                    <span className="text-muted-foreground text-xs">
                      {m.feeMillimes > 0 ? tc("fee", { amount: formatDinars(m.feeMillimes) }) : tc("noFee")}
                    </span>
                  </span>
                </Label>
              ))}
            </RadioGroup>
            {method && method.fields.length > 0 && (
              <div className="mt-4 grid gap-6 sm:grid-cols-2">
                {method.fields.map((f) => (
                  <Field key={`${method.code}.${f.key}`} name={`d.${f.key}`}>
                    <FieldLabel>{f.label[locale] ?? f.label.en}</FieldLabel>
                    <Input
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
            )}
          </Fieldset>

          <div className="flex flex-col gap-2 rounded-xl border bg-muted/40 p-4 text-sm">
            <Row label={t("fromBalance")}>
              <Dt millimes={amountMillimes ?? 0} />
            </Row>
            <Row label={tc("feeLine")}>
              <Dt millimes={method?.feeMillimes ? -method.feeMillimes : 0} />
            </Row>
            <Separator />
            <div className="flex items-baseline justify-between gap-4">
              <span className="font-medium">{t("youGet")}</span>
              <Dt millimes={net} className="font-semibold text-xl" />
            </div>
          </div>
          {formError && (
            <Alert variant="error">
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          )}
        </CardPanel>
        <CardFooter>
          <Button type="submit" size="lg" loading={pending}>
            <SendIcon aria-hidden="true" />
            {t("submit")}
          </Button>
        </CardFooter>
      </Form>
    </Card>
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
