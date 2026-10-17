"use client";

import { ArrowRightIcon, LockIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Dt } from "@/components/app/money";
import { OperatorDot } from "@/components/app/operator-badge";
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
import type { LocalizedText, PayoutField } from "@/db/schema";
import { formatDinars, formatRate, grossPayout, parseDinars } from "@/lib/money";
import { normalizeMsisdn } from "@/lib/phone";
import { createSaleAction } from "./actions";

type Op = { code: string; name: string; color: string; rateBps: number; active: boolean };
type Method = { code: string; name: LocalizedText; feeMillimes: number; fields: PayoutField[] };

const cardOption =
  "flex cursor-pointer items-center gap-3 rounded-xl border bg-card p-3.5 transition-colors hover:bg-accent/50 has-data-checked:border-primary/48 has-data-checked:bg-accent/50 has-data-disabled:cursor-not-allowed has-data-disabled:opacity-60";

export function SellForm({ operators, methods, saved }: { operators: Op[]; methods: Method[]; saved: Record<string, Record<string, string>> }) {
  const t = useTranslations("sell");
  const te = useTranslations("errors");
  const locale = useLocale() as keyof LocalizedText;
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const firstActive = operators.find((o) => o.active)?.code ?? "";
  const [operatorCode, setOperatorCode] = useState(firstActive);
  const [amount, setAmount] = useState("");
  const [sender, setSender] = useState("");
  const [methodCode, setMethodCode] = useState(methods[0]?.code ?? "");
  const [details, setDetails] = useState<Record<string, Record<string, string>>>(saved);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const op = operators.find((o) => o.code === operatorCode);
  const method = methods.find((m) => m.code === methodCode);
  const amountMillimes = parseDinars(amount);
  const gross = op && amountMillimes ? grossPayout(amountMillimes, op.rateBps) : 0;
  const net = method ? Math.max(0, gross - method.feeMillimes) : 0;
  const methodDetails = useMemo(() => details[methodCode] ?? {}, [details, methodCode]);

  function validate() {
    const e: Record<string, string> = {};
    if (!amountMillimes) e.amount = t("invalidAmount");
    if (!normalizeMsisdn(sender)) e.sender = t("invalidPhone");
    for (const f of method?.fields ?? []) {
      const v = (methodDetails[f.key] ?? "").trim();
      if (f.required && !v) e[`d.${f.key}`] = t("required");
      else if (v && f.type === "phone" && !normalizeMsisdn(v)) e[`d.${f.key}`] = t("invalidPhone");
    }
    if (amountMillimes && method && net <= 0) e.amount = te("payout_below_fee");
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function submit() {
    setFormError(null);
    if (!validate() || !op || !method || !amountMillimes) return;
    startTransition(async () => {
      const res = await createSaleAction({
        operatorCode: op.code,
        amountMillimes,
        senderMsisdn: sender,
        payoutMethodCode: method.code,
        payoutDetails: methodDetails,
      });
      if (res.ok) router.push(`/sales/${res.data}`);
      else setFormError(te.has(res.error) ? te(res.error) : te("unknown"));
    });
  }

  return (
    <Form
      className="grid items-start gap-6 lg:grid-cols-[1fr_340px]"
      errors={errors}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="flex flex-col gap-8">
        <Fieldset>
          <FieldsetLegend>{t("operator")}</FieldsetLegend>
          <RadioGroup value={operatorCode} onValueChange={(v) => setOperatorCode(String(v))} className="grid gap-3 sm:grid-cols-3">
            {operators.map((o) => (
              <Label key={o.code} className={cardOption}>
                <Radio value={o.code} disabled={!o.active} />
                <span className="flex flex-1 flex-col gap-0.5">
                  <span className="flex items-center gap-2 font-medium">
                    <OperatorDot color={o.color} />
                    {o.name}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {o.active ? `${t("rate")} ${formatRate(o.rateBps)}` : t("operatorUnavailable")}
                  </span>
                </span>
              </Label>
            ))}
          </RadioGroup>
        </Fieldset>

        <div className="grid gap-6 sm:grid-cols-2">
          <Field name="amount">
            <FieldLabel>{t("amount")}</FieldLabel>
            <Input
              type="text"
              inputMode="decimal"
              autoComplete="off"
              placeholder="10"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              dir="ltr"
            />
            <FieldDescription>{t("amountHint")}</FieldDescription>
            <FieldError />
          </Field>
          <Field name="sender">
            <FieldLabel>{t("sender")}</FieldLabel>
            <Input
              type="tel"
              inputMode="numeric"
              autoComplete="tel-national"
              placeholder="2X XXX XXX"
              value={sender}
              onChange={(e) => setSender(e.target.value)}
              dir="ltr"
            />
            <FieldDescription>{t("senderHint")}</FieldDescription>
            <FieldError />
          </Field>
        </div>

        <Fieldset>
          <FieldsetLegend>{t("payoutMethod")}</FieldsetLegend>
          <RadioGroup value={methodCode} onValueChange={(v) => setMethodCode(String(v))} className="grid gap-3 sm:grid-cols-3">
            {methods.map((m) => (
              <Label key={m.code} className={cardOption}>
                <Radio value={m.code} />
                <span className="flex flex-1 flex-col gap-0.5">
                  <span className="font-medium">{m.name[locale] ?? m.name.en}</span>
                  <span className="text-muted-foreground text-xs">
                    {m.feeMillimes > 0 ? t("fee", { amount: formatDinars(m.feeMillimes) }) : t("noFee")}
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
      </div>

      <Card className="lg:sticky lg:top-20">
        <CardHeader>
          <CardTitle>{t("summary")}</CardTitle>
          {op && (
            <CardDescription className="flex items-center gap-2">
              <OperatorDot color={op.color} />
              {op.name}
            </CardDescription>
          )}
        </CardHeader>
        <CardPanel className="flex flex-col gap-3 text-sm">
          <Row label={t("youSend")}>
            <Dt millimes={amountMillimes ?? 0} />
          </Row>
          <Row label={t("rate")}>{op ? formatRate(op.rateBps) : "—"}</Row>
          <Row label={t("gross")}>
            <Dt millimes={gross} />
          </Row>
          <Row label={t("feeLine")}>
            <Dt millimes={method?.feeMillimes ? -method.feeMillimes : 0} />
          </Row>
          <Separator />
          <div className="flex items-baseline justify-between gap-4">
            <span className="font-medium">{t("youReceive")}</span>
            <Dt millimes={net} className="font-semibold text-2xl" />
          </div>
          <p className="flex items-center gap-1.5 text-muted-foreground text-xs">
            <LockIcon aria-hidden="true" className="size-3.5" />
            {t("rateLockNote")}
          </p>
          {formError && (
            <Alert variant="error">
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          )}
        </CardPanel>
        <CardFooter>
          <Button type="submit" size="lg" className="w-full" loading={pending} disabled={!op}>
            {pending ? t("starting") : t("start")}
            <ArrowRightIcon aria-hidden="true" className="rtl:rotate-180" />
          </Button>
        </CardFooter>
      </Card>
    </Form>
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
