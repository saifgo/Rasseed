"use client";

import { GaugeIcon, KeyRoundIcon, PlusIcon, UnplugIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { BigInput } from "@/components/app/big-input";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { toastManager } from "@/components/ui/toast";
import { Dt } from "@/components/app/money";
import { createPosPairingAction, revokePosTerminalAction, setPosDailyLimitAction } from "../../_market/actions";

function useErrorToast() {
  const te = useTranslations("errors");
  return (code: string) => {
    toastManager.add({ type: "error", title: te.has(code) ? te(code) : te("unknown") });
  };
}

/** The 6-digit code, big and spaced so it can be read across a counter. */
function PairingCode({ code }: { code: string }) {
  const t = useTranslations("market");
  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border-2 border-emerald-600 bg-emerald-600/12 p-6 text-center" role="status">
      <span className="font-semibold">{t("pos.codeTitle")}</span>
      <span dir="ltr" className="font-bold font-mono text-5xl tracking-[0.25em] tabular-nums">
        {code.slice(0, 3)} {code.slice(3)}
      </span>
      <span className="text-muted-foreground text-sm">{t("pos.codeHint")}</span>
    </div>
  );
}

export function NewTerminalForm() {
  const t = useTranslations("market");
  const showError = useErrorToast();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [code, setCode] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          startTransition(async () => {
            const res = await createPosPairingAction({ name });
            if (!res.ok) return showError(res.error);
            setCode(res.data.code);
            setName("");
            router.refresh();
          });
        }}
      >
        <label className="flex flex-col gap-2">
          <span className="font-semibold text-lg">{t("pos.name")}</span>
          <BigInput value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder={t("pos.namePlaceholder")} />
        </label>
        <Button type="submit" variant="go" className="h-14 w-full text-lg sm:h-14 sm:text-lg" loading={pending} disabled={!name.trim()}>
          <PlusIcon aria-hidden="true" className="size-5" />
          {t("pos.add")}
        </Button>
      </form>
      {code && <PairingCode code={code} />}
    </div>
  );
}

export function TerminalActions({ id, name, paired }: { id: string; name: string; paired: boolean }) {
  const t = useTranslations("market");
  const showError = useErrorToast();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [code, setCode] = useState<string | null>(null);

  return (
    <div className="flex w-full flex-col gap-3 sm:w-auto">
      <div className="flex gap-2 sm:justify-end">
        {!paired && (
          <Button
            variant="outline"
            className="h-11 text-base sm:h-11"
            loading={pending}
            onClick={() =>
              startTransition(async () => {
                const res = await createPosPairingAction({ terminalId: id });
                if (!res.ok) return showError(res.error);
                setCode(res.data.code);
              })
            }
          >
            <KeyRoundIcon aria-hidden="true" />
            {t("pos.newCode")}
          </Button>
        )}
        <AlertDialog>
          <AlertDialogTrigger render={<Button variant="ghost" className="h-11 text-base text-destructive-foreground sm:h-11" />}>
            <UnplugIcon aria-hidden="true" />
            {t("pos.revoke")}
          </AlertDialogTrigger>
          <AlertDialogPopup>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("pos.revoke")}</AlertDialogTitle>
              <AlertDialogDescription>{t("pos.revokeConfirm", { name })}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogClose render={<Button variant="ghost" />}>{t("goBack")}</AlertDialogClose>
              <AlertDialogClose
                render={
                  <Button
                    variant="destructive"
                    onClick={() =>
                      startTransition(async () => {
                        const res = await revokePosTerminalAction(id);
                        if (!res.ok) return showError(res.error);
                        toastManager.add({ type: "success", title: t("pos.revoked") });
                        router.refresh();
                      })
                    }
                  />
                }
              >
                {t("pos.revoke")}
              </AlertDialogClose>
            </AlertDialogFooter>
          </AlertDialogPopup>
        </AlertDialog>
      </div>
      {code && <PairingCode code={code} />}
    </div>
  );
}

/** The owner's daily spending limit for one PC (recharges + internet), with what it spent today. */
export function DailyLimitForm({ id, limitMillimes, spentMillimes }: { id: string; limitMillimes: number | null; spentMillimes: number }) {
  const t = useTranslations("market");
  const showError = useErrorToast();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const saved = limitMillimes ? String(limitMillimes / 1000) : "";
  const [value, setValue] = useState(saved);
  const reached = limitMillimes != null && spentMillimes >= limitMillimes;

  return (
    <form
      className="flex w-full flex-col gap-2 rounded-xl bg-muted/60 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const res = await setPosDailyLimitAction(id, value);
          if (!res.ok) return showError(res.error);
          toastManager.add({ type: "success", title: t("pos.limitSaved") });
          router.refresh();
        });
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm">
        <span className="flex items-center gap-2 font-semibold">
          <GaugeIcon aria-hidden="true" className="size-4 text-muted-foreground" />
          {limitMillimes ? t.rich("pos.dailyLimitValue", { amount: () => <Dt millimes={limitMillimes} /> }) : t("pos.dailyLimitNone")}
        </span>
        <span className={reached ? "font-semibold text-destructive-foreground" : "text-muted-foreground"}>
          {t.rich("pos.spentToday", { amount: () => <Dt millimes={spentMillimes} /> })}
        </span>
      </div>
      <label className="flex flex-col gap-2">
        <span className="sr-only">{t("pos.dailyLimit")}</span>
        <div className="flex gap-2">
          <BigInput
            className="h-12 [&_input]:text-xl"
            inputMode="decimal"
            value={value}
            maxLength={9}
            placeholder={t("pos.dailyLimitNone")}
            aria-label={t("pos.dailyLimit")}
            onChange={(e) => setValue(e.target.value.replace(/[^\d.,]/g, ""))}
            suffix="DT"
          />
          <Button type="submit" variant="outline" className="h-12 shrink-0 text-base sm:h-12" loading={pending} disabled={value.trim() === saved}>
            {t("pos.saveLimit")}
          </Button>
        </div>
        <span className="text-muted-foreground text-xs">{t("pos.dailyLimitHint")}</span>
      </label>
    </form>
  );
}
