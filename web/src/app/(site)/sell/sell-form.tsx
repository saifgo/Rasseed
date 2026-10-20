"use client";

import { ArrowLeftIcon, ArrowRightIcon, CheckIcon, LockIcon, PhoneIcon, TriangleAlertIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useRef, useState, useSyncExternalStore, useTransition } from "react";
import { BigInput } from "@/components/app/big-input";
import { Dt } from "@/components/app/money";
import { OperatorLogo } from "@/components/app/operator-badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { formatDt, grossPayout, parseDinars } from "@/lib/money";
import { formatMsisdn, normalizeMsisdn } from "@/lib/phone";
import { cn } from "@/lib/utils";
import { createSaleAction } from "./actions";

type Op = { code: string; name: string; color: string; rateBps: number; active: boolean };
type Step = 1 | 2 | 3 | 4;

const LAST_OP = "rasseed.lastOperator";
const LAST_SENDER = "rasseed.lastSender";
// Above this, the seller most likely typed millimes instead of dinars.
const SUSPICIOUS_MILLIMES = 1_000_000;
const noopSubscribe = () => () => {};

export function SellForm({ operators, balanceMillimes, initialOp }: { operators: Op[]; balanceMillimes: number; initialOp?: string }) {
  const t = useTranslations("sell");
  const te = useTranslations("errors");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const preset = operators.find((o) => o.active && o.code === initialOp)?.code;
  const [step, setStep] = useState<Step>(preset ? 2 : 1);
  const [operatorCode, setOperatorCode] = useState(preset ?? "");
  const [amount, setAmount] = useState("");
  const [sender, setSender] = useState("");
  const [showErrors, setShowErrors] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const topRef = useRef<HTMLDivElement>(null);

  // Remember the last operator and phone number to save typing next time.
  const lastOp = useSyncExternalStore(
    noopSubscribe,
    () => localStorage.getItem(LAST_OP),
    () => null,
  );

  const op = operators.find((o) => o.code === operatorCode);
  const amountMillimes = parseDinars(amount);
  const gross = op && amountMillimes ? grossPayout(amountMillimes, op.rateBps) : 0;
  const amountOk = !!amountMillimes && gross > 0;
  const senderNorm = normalizeMsisdn(sender);

  function go(next: Step) {
    if (next === 3 && !sender) setSender(localStorage.getItem(LAST_SENDER) ?? "");
    setShowErrors(false);
    setFormError(null);
    setStep(next);
    topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function pickOperator(code: string) {
    setOperatorCode(code);
    go(2);
  }

  function submit() {
    setFormError(null);
    if (!op || !amountMillimes || !senderNorm) return;
    localStorage.setItem(LAST_OP, op.code);
    localStorage.setItem(LAST_SENDER, senderNorm);
    startTransition(async () => {
      const res = await createSaleAction({ operatorCode: op.code, amountMillimes, senderMsisdn: senderNorm });
      if (res.ok) router.push(`/sales/${res.data}`);
      else setFormError(te.has(res.error) ? te(res.error) : te("unknown"));
    });
  }

  const stepLabels = [t("stepOperator"), t("stepAmount"), t("stepNumber"), t("stepConfirm")];

  return (
    <div ref={topRef} className="mx-auto flex w-full max-w-xl scroll-mt-20 flex-col gap-6">
      {/* Progress */}
      <ol className="grid grid-cols-4 gap-2" aria-label={t("progress", { step, total: 4 })}>
        {stepLabels.map((label, i) => {
          const n = (i + 1) as Step;
          const done = n < step;
          const current = n === step;
          return (
            <li key={label} className="flex flex-col gap-1.5" aria-current={current ? "step" : undefined}>
              <span
                className={cn("h-1.5 rounded-full bg-muted transition-colors", (done || current) && "bg-foreground")}
                style={op && (done || current) ? { backgroundColor: op.color } : undefined}
              />
              <span className={cn("flex items-center gap-1 truncate text-xs", current ? "font-semibold text-foreground" : "text-muted-foreground")}>
                {done && <CheckIcon aria-hidden="true" className="size-3.5 shrink-0" />}
                {label}
              </span>
            </li>
          );
        })}
      </ol>

      {step > 1 && op && (
        <div className="flex items-center justify-between gap-3">
          <Button variant="ghost" className="-ms-2 h-10 text-base" onClick={() => go((step - 1) as Step)}>
            <ArrowLeftIcon aria-hidden="true" className="rtl:rotate-180" />
            {t("back")}
          </Button>
          <button
            type="button"
            onClick={() => go(1)}
            className="inline-flex items-center gap-2 rounded-full border-2 py-1 ps-1 pe-3 font-medium text-sm"
            style={{ borderColor: op.color }}
          >
            <OperatorLogo code={op.code} name={op.name} color={op.color} className="size-7 rounded-md" />
            {op.name}
            <span className="text-muted-foreground">· {t("change")}</span>
          </button>
        </div>
      )}

      {/* Step 1 — operator */}
      {step === 1 && (
        <section className="flex flex-col gap-4">
          <StepTitle title={t("q1")} hint={t("q1Hint")} />
          <div className="flex flex-col gap-3">
            {operators.map((o) => (
              <button
                key={o.code}
                type="button"
                disabled={!o.active}
                onClick={() => pickOperator(o.code)}
                className="flex items-center gap-4 rounded-2xl border-2 bg-card p-4 text-start transition-colors hover:bg-accent/60 active:bg-accent disabled:cursor-not-allowed disabled:opacity-50 disabled:grayscale"
                style={{ borderColor: o.active ? o.color : undefined }}
              >
                <OperatorLogo code={o.code} name={o.name} color={o.color} className="size-16 rounded-2xl" />
                <span className="flex flex-1 flex-col gap-0.5">
                  <span className="font-heading font-bold text-2xl">{o.name}</span>
                  <span className="text-muted-foreground text-sm">
                    {o.active ? t("tileRate", { amount: formatDt(grossPayout(10_000, o.rateBps)) }) : t("operatorUnavailable")}
                  </span>
                  {o.active && lastOp === o.code && <span className="font-medium text-xs" style={{ color: o.color }}>{t("lastUsed")}</span>}
                </span>
                {o.active && (
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-full text-white" style={{ backgroundColor: o.color }}>
                    <ArrowRightIcon aria-hidden="true" className="size-5 rtl:rotate-180" />
                  </span>
                )}
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Step 2 — amount */}
      {step === 2 && op && (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (amountOk) go(3);
            else setShowErrors(true);
          }}
        >
          <StepTitle title={t("q2", { operator: op.name })} hint={t("q2Hint")} />
          <label className="sr-only" htmlFor="amount">
            {t("amount")}
          </label>
          <BigInput
            id="amount"
            autoFocus
            type="text"
            inputMode="decimal"
            autoComplete="off"
            placeholder="10"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d.,]/g, ""))}
            suffix="DT"
            invalid={showErrors && !amountOk}
          />
          <p className="-mt-1 text-muted-foreground text-sm">{t("dinarsNotMillimes")}</p>
          {showErrors && !amountOk && <p className="font-medium text-destructive-foreground">{t("invalidAmount")}</p>}
          {amountMillimes != null && amountMillimes >= SUSPICIOUS_MILLIMES && (
            <Alert variant="warning">
              <TriangleAlertIcon />
              <AlertDescription className="flex flex-col gap-2">
                <span>{t("bigAmountWarning", { amount: formatDt(amountMillimes) })}</span>
                <Button
                  type="button"
                  variant="outline"
                  className="self-start"
                  onClick={() => setAmount(String(Number((amountMillimes / 1_000_000).toFixed(3))))}
                >
                  {t("didYouMean", { amount: formatDt(Math.round(amountMillimes / 1000)) })}
                </Button>
              </AlertDescription>
            </Alert>
          )}
          <YouGet millimes={gross} label={t("youReceive")} />
          <Button type="submit" variant="go" className="h-14 w-full text-lg sm:h-14 sm:text-lg">
            {t("next")}
            <ArrowRightIcon aria-hidden="true" className="size-5 rtl:rotate-180" />
          </Button>
        </form>
      )}

      {/* Step 3 — sender number */}
      {step === 3 && op && (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (senderNorm) go(4);
            else setShowErrors(true);
          }}
        >
          <StepTitle title={t("q3", { operator: op.name })} hint={t("q3Hint")} />
          <label className="sr-only" htmlFor="sender">
            {t("sender")}
          </label>
          <BigInput
            id="sender"
            autoFocus
            type="tel"
            inputMode="numeric"
            autoComplete="tel-national"
            placeholder="2X XXX XXX"
            value={sender}
            onChange={(e) => setSender(e.target.value)}
            prefix={<PhoneIcon aria-hidden="true" className="size-6 shrink-0 text-muted-foreground" />}
            invalid={showErrors && !senderNorm}
          />
          {showErrors && !senderNorm && <p className="font-medium text-destructive-foreground">{t("invalidPhone")}</p>}
          <Button type="submit" variant="go" className="h-14 w-full text-lg sm:h-14 sm:text-lg">
            {t("next")}
            <ArrowRightIcon aria-hidden="true" className="size-5 rtl:rotate-180" />
          </Button>
        </form>
      )}

      {/* Step 4 — confirm */}
      {step === 4 && op && amountMillimes && senderNorm && (
        <section className="flex flex-col gap-4">
          <StepTitle title={t("q4")} />
          <div className="overflow-hidden rounded-2xl border-2" style={{ borderColor: op.color }}>
            <div className="flex items-center gap-3 p-4 text-white" style={{ backgroundColor: op.color }}>
              <OperatorLogo code={op.code} name={op.name} color={op.color} className="size-12 rounded-xl" />
              <span className="font-heading font-bold text-xl">{op.name}</span>
            </div>
            <dl className="flex flex-col divide-y">
              <SummaryRow label={t("youSend")} onEdit={() => go(2)} editLabel={t("change")}>
                <Dt compact millimes={amountMillimes} className="font-semibold text-xl" />
              </SummaryRow>
              <SummaryRow label={t("fromNumber")} onEdit={() => go(3)} editLabel={t("change")}>
                <span dir="ltr" className="font-mono font-semibold text-xl">
                  {formatMsisdn(senderNorm)}
                </span>
              </SummaryRow>
              <div className="flex items-baseline justify-between gap-3 p-4">
                <dt className="font-semibold text-lg">{t("youReceive")}</dt>
                <dd>
                  <Dt compact millimes={gross} className="font-bold text-4xl text-emerald-700 dark:text-emerald-400" />
                </dd>
              </div>
            </dl>
          </div>
          <p className="flex items-center gap-2 text-muted-foreground text-sm">
            <LockIcon aria-hidden="true" className="size-4 shrink-0" />
            {t("rateLockNote")}
          </p>
          {formError && (
            <Alert variant="error">
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          )}
          <Button variant="go" className="h-16 w-full text-xl sm:h-16 sm:text-xl" loading={pending} onClick={submit}>
            {pending ? t("starting") : t("start")}
            <ArrowRightIcon aria-hidden="true" className="size-6 rtl:rotate-180" />
          </Button>
          <p className="text-center text-muted-foreground text-sm">
            {t("currentBalance")}: <Dt compact millimes={balanceMillimes} />
          </p>
        </section>
      )}
    </div>
  );
}

function StepTitle({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <h2 className="text-balance font-heading font-bold text-2xl leading-tight">{title}</h2>
      {hint && <p className="text-muted-foreground">{hint}</p>}
    </div>
  );
}

function YouGet({ millimes, label }: { millimes: number; label: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-t py-4">
      <span className="font-semibold text-lg">{label}</span>
      <Dt compact millimes={millimes} className="font-bold text-4xl text-emerald-700 dark:text-emerald-400" />
    </div>
  );
}

function SummaryRow({ label, children, onEdit, editLabel }: { label: string; children: React.ReactNode; onEdit: () => void; editLabel: string }) {
  return (
    <div className="flex items-center justify-between gap-3 p-4">
      <div className="flex flex-col gap-0.5">
        <dt className="text-muted-foreground text-sm">{label}</dt>
        <dd>{children}</dd>
      </div>
      <Button variant="outline" size="sm" onClick={onEdit}>
        {editLabel}
      </Button>
    </div>
  );
}
