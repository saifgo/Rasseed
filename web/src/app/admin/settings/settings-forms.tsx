"use client";

import { useState } from "react";
import { useAdminAction } from "@/components/admin/use-admin-action";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardFooter, CardHeader, CardPanel, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { AppSettings } from "@/lib/settings";
import { saveSettingsAction, updatePayoutMethodAction } from "../actions";

const labels: Record<keyof AppSettings, { label: string; unit: string; help: string }> = {
  holdMinutes: { label: "Number hold time", unit: "min", help: "Time the seller has to send the credit." },
  cooldownSeconds: { label: "Cooldown after a sale", unit: "s", help: "A number is not reused for this long after a sale ends." },
  queueTimeoutMinutes: { label: "Max queue wait", unit: "min", help: "Queued sales are cancelled after this." },
  deviceOfflineSeconds: { label: "Phone offline after", unit: "s", help: "No sync for this long = phone and its SIMs are not used." },
  commandTimeoutSeconds: { label: "USSD timeout", unit: "s", help: "A balance check without a reply is considered failed." },
  verifyMaxAttempts: { label: "Verification attempts", unit: "×", help: "Balance checks before an SMS/balance mismatch goes to review." },
  verifyRetrySeconds: { label: "Verification retry delay", unit: "s", help: "Wait between verification balance checks." },
  pollIntervalSeconds: { label: "Balance polling", unit: "s", help: "How often held numbers are checked (catches credit without SMS)." },
  smsGraceSeconds: { label: "Wait for SMS", unit: "s", help: "Balance up but no SMS: wait this long, then review." },
  lateCreditWindowHours: { label: "Late transfer window", unit: "h", help: "Late transfers within this window are linked to the old sale." },
  maxSimFailures: { label: "SIM failure limit", unit: "×", help: "USSD failures in a row before a SIM is skipped." },
  minWithdrawalMillimes: { label: "Minimum withdrawal", unit: "DT", help: "Smallest amount a seller can withdraw from their balance." },
};

// Shown and edited in dinars; stored in millimes.
const DINAR_KEYS: (keyof AppSettings)[] = ["minWithdrawalMillimes"];
const toInput = (k: keyof AppSettings, n: number) => (DINAR_KEYS.includes(k) ? (n / 1000).toFixed(3) : String(n));
const fromInput = (k: keyof AppSettings, s: string) => (DINAR_KEYS.includes(k) ? Math.round(Number(s.replace(",", ".")) * 1000) : Number(s));

export function SettingsForm({ values, defaults }: { values: AppSettings; defaults: AppSettings }) {
  const { pending, run } = useAdminAction();
  const [v, setV] = useState<Record<string, string>>(
    Object.fromEntries(Object.entries(values).map(([k, n]) => [k, toInput(k as keyof AppSettings, n)])),
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Transaction engine</CardTitle>
        <CardDescription>Changes apply to the next actions; running holds keep their expiry time.</CardDescription>
      </CardHeader>
      <CardPanel className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {(Object.keys(labels) as (keyof AppSettings)[]).map((k) => (
          <Field key={k}>
            <FieldLabel>
              {labels[k].label} ({labels[k].unit})
            </FieldLabel>
            <Input
              type={DINAR_KEYS.includes(k) ? "text" : "number"}
              inputMode="decimal"
              min={1}
              value={v[k]}
              onChange={(e) => setV((s) => ({ ...s, [k]: e.target.value }))}
            />
            <FieldDescription>
              {labels[k].help} Default {toInput(k, defaults[k])}.
            </FieldDescription>
          </Field>
        ))}
      </CardPanel>
      <CardFooter className="justify-end">
        <Button
          loading={pending}
          onClick={() =>
            run(() => saveSettingsAction(Object.fromEntries(Object.entries(v).map(([k, s]) => [k, fromInput(k as keyof AppSettings, s)]))), {
              success: "Settings saved",
            })
          }
        >
          Save settings
        </Button>
      </CardFooter>
    </Card>
  );
}

type FeeType = "fixed" | "percent";
type MethodRow = { code: string; name: string; active: boolean; feeType: FeeType; fee: string };

export function PayoutMethodsForm({ methods }: { methods: MethodRow[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Payout methods</CardTitle>
        <CardDescription>Methods sellers can choose when withdrawing. The fee is deducted once per withdrawal: a fixed amount, or a percentage of the amount withdrawn (rounded down to the millime).</CardDescription>
      </CardHeader>
      <CardPanel className="flex flex-col divide-y">
        {methods.map((m) => (
          <MethodRowForm key={m.code} method={m} />
        ))}
      </CardPanel>
    </Card>
  );
}

function MethodRowForm({ method }: { method: MethodRow }) {
  const { pending, run } = useAdminAction();
  const [active, setActive] = useState(method.active);
  const [feeType, setFeeType] = useState<FeeType>(method.feeType);
  const [fee, setFee] = useState(method.fee);
  return (
    <div className="flex flex-wrap items-center gap-4 py-3">
      <span className="w-40 font-medium">{method.name}</span>
      <Label className="flex items-center gap-2 text-sm">
        <Switch checked={active} onCheckedChange={setActive} />
        Available
      </Label>
      <div className="flex items-center gap-2 text-sm">
        <span>Fee</span>
        <Select
          aria-label="Fee type"
          value={feeType}
          onValueChange={(v) => {
            setFeeType(v as FeeType);
            setFee("");
          }}
          items={[
            { value: "fixed", label: "Fixed (DT)" },
            { value: "percent", label: "Percent (%)" },
          ]}
        >
          <SelectTrigger className="w-32" size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectPopup>
            <SelectItem value="fixed">Fixed (DT)</SelectItem>
            <SelectItem value="percent">Percent (%)</SelectItem>
          </SelectPopup>
        </Select>
        <Input
          aria-label={feeType === "percent" ? "Fee in percent" : "Fee in DT"}
          type="text"
          inputMode="decimal"
          placeholder={feeType === "percent" ? "2.5" : "0.000"}
          value={fee}
          onChange={(e) => setFee(e.target.value)}
          className="w-24"
        />
      </div>
      <Button
        size="sm"
        variant="outline"
        className="ms-auto"
        loading={pending}
        onClick={() => run(() => updatePayoutMethodAction(method.code, { active, feeType, fee }), { success: `${method.name} saved` })}
      >
        Save
      </Button>
    </div>
  );
}
