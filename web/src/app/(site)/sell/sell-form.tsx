"use client";

import { ArrowRightIcon, LockIcon, WalletIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
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
import { formatRate, grossPayout, parseDinars } from "@/lib/money";
import { normalizeMsisdn } from "@/lib/phone";
import { createSaleAction } from "./actions";

type Op = { code: string; name: string; color: string; rateBps: number; active: boolean };

const cardOption =
  "flex cursor-pointer items-center gap-3 rounded-xl border bg-card p-3.5 transition-colors hover:bg-accent/50 has-data-checked:border-primary/48 has-data-checked:bg-accent/50 has-data-disabled:cursor-not-allowed has-data-disabled:opacity-60";

export function SellForm({ operators, balanceMillimes }: { operators: Op[]; balanceMillimes: number }) {
  const t = useTranslations("sell");
  const te = useTranslations("errors");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const firstActive = operators.find((o) => o.active)?.code ?? "";
  const [operatorCode, setOperatorCode] = useState(firstActive);
  const [amount, setAmount] = useState("");
  const [sender, setSender] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const op = operators.find((o) => o.code === operatorCode);
  const amountMillimes = parseDinars(amount);
  const gross = op && amountMillimes ? grossPayout(amountMillimes, op.rateBps) : 0;

  function validate() {
    const e: Record<string, string> = {};
    if (!amountMillimes || gross <= 0) e.amount = t("invalidAmount");
    if (!normalizeMsisdn(sender)) e.sender = t("invalidPhone");
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function submit() {
    setFormError(null);
    if (!validate() || !op || !amountMillimes) return;
    startTransition(async () => {
      const res = await createSaleAction({ operatorCode: op.code, amountMillimes, senderMsisdn: sender });
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

        <Alert variant="info">
          <WalletIcon />
          <AlertDescription>{t("balanceNote")}</AlertDescription>
        </Alert>
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
          <Separator />
          <div className="flex items-baseline justify-between gap-4">
            <span className="font-medium">{t("youReceive")}</span>
            <Dt millimes={gross} className="font-semibold text-2xl" />
          </div>
          <Row label={t("currentBalance")}>
            <Dt millimes={balanceMillimes} />
          </Row>
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
