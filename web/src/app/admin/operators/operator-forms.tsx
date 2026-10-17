"use client";

import { useState } from "react";
import { OperatorName } from "@/components/app/operator-badge";
import { useAdminAction } from "@/components/admin/use-admin-action";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardDescription, CardFooter, CardHeader, CardPanel, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { formatRate } from "@/lib/money";
import { renderTransferUssd } from "@/lib/parsers";
import { setRateAction, testParsersAction, updateOperatorAction } from "../actions";

export function RateEditor({ code, name, color, rateBps, active }: { code: string; name: string; color: string; rateBps: number; active: boolean }) {
  const { pending, run } = useAdminAction();
  const [rate, setRate] = useState((rateBps / 10000).toFixed(4).replace(/0+$/, "").replace(/\.$/, ""));
  return (
    <Card>
      <CardHeader>
        <CardDescription>
          <OperatorName name={name} color={color} />
        </CardDescription>
        <CardTitle className="text-3xl">{formatRate(rateBps)}</CardTitle>
        <CardDescription>
          1 DT of credit pays {(rateBps / 10000).toFixed(3)} DT{!active && " · operator disabled"}
        </CardDescription>
      </CardHeader>
      <CardFooter className="flex gap-2">
        <Input type="text" inputMode="decimal" aria-label={`New rate for ${name}`} value={rate} onChange={(e) => setRate(e.target.value)} className="w-28" />
        <Button variant="outline" loading={pending} onClick={() => run(() => setRateAction(code, rate), { success: `${name} rate updated` })}>
          Set rate
        </Button>
      </CardFooter>
    </Card>
  );
}

type OpConfig = {
  code: string;
  name: string;
  color: string;
  active: boolean;
  transferUssdTemplate: string;
  balanceUssdCode: string;
  creditSmsRegex: string;
  creditSmsUnit: "millimes" | "dinars";
  creditSmsSenders: string;
  balanceRegex: string;
  balanceUnit: "auto" | "millimes" | "dinars";
};

const smsUnits = [
  { label: "Millimes", value: "millimes" },
  { label: "Dinars", value: "dinars" },
];
const balanceUnits = [
  { label: "Auto (from unit in text)", value: "auto" },
  { label: "Millimes", value: "millimes" },
  { label: "Dinars", value: "dinars" },
];

export function OperatorEditor({
  op,
  sampleReply,
  sampleSms,
}: {
  op: OpConfig;
  sampleReply: string;
  sampleSms: { from: string; body: string } | null;
}) {
  const { pending, run } = useAdminAction();
  const [v, setV] = useState(op);
  const [testSms, setTestSms] = useState(sampleSms?.body ?? "Vous avez recu 1000 Millimes de la part du numéro 23249201");
  const [testFrom, setTestFrom] = useState(sampleSms?.from ?? "");
  const [testBalance, setTestBalance] = useState(sampleReply);
  const [result, setResult] = useState<{
    sms: null | { kind: string; credit?: { amountMillimes: number; senderMsisdn: string } };
    balance: number | null;
  } | null>(null);
  const set = <K extends keyof OpConfig>(k: K, value: OpConfig[K]) => setV((s) => ({ ...s, [k]: value }));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          <OperatorName name={op.name} color={op.color} />
        </CardTitle>
        <CardAction>
          <Label className="flex items-center gap-2 text-sm">
            <Switch checked={v.active} onCheckedChange={(c) => set("active", c)} />
            Accept sales
          </Label>
        </CardAction>
      </CardHeader>
      <CardPanel className="grid gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <Field>
            <FieldLabel>Transfer code shown to sellers</FieldLabel>
            <Input type="text" className="font-mono" value={v.transferUssdTemplate} onChange={(e) => set("transferUssdTemplate", e.target.value)} />
            <FieldDescription>
              Placeholders: {"{number}"} {"{millimes}"} {"{dinars}"}. Example for 5 DT:{" "}
              <span className="font-mono">{renderTransferUssd(v.transferUssdTemplate, "22123456", 5000)}</span>
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel>Balance check USSD</FieldLabel>
            <Input type="text" className="font-mono" value={v.balanceUssdCode} onChange={(e) => set("balanceUssdCode", e.target.value)} />
          </Field>
          <Field>
            <FieldLabel>Credit SMS regex</FieldLabel>
            <Textarea className="font-mono text-xs" value={v.creditSmsRegex} onChange={(e) => set("creditSmsRegex", e.target.value)} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel>SMS amount unit</FieldLabel>
              <Select items={smsUnits} value={v.creditSmsUnit} onValueChange={(x) => set("creditSmsUnit", x as OpConfig["creditSmsUnit"])}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectPopup>
                  {smsUnits.map((u) => (
                    <SelectItem key={u.value} value={u.value}>
                      {u.label}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </Field>
            <Field>
              <FieldLabel>Trusted SMS senders</FieldLabel>
              <Input type="text" value={v.creditSmsSenders} onChange={(e) => set("creditSmsSenders", e.target.value)} placeholder="any" />
              <FieldDescription>Comma separated. Empty = accept from any sender (less safe).</FieldDescription>
            </Field>
          </div>
          <Field>
            <FieldLabel>Balance reply regex</FieldLabel>
            <Textarea className="font-mono text-xs" value={v.balanceRegex} onChange={(e) => set("balanceRegex", e.target.value)} />
          </Field>
          <Field>
            <FieldLabel>Balance unit</FieldLabel>
            <Select items={balanceUnits} value={v.balanceUnit} onValueChange={(x) => set("balanceUnit", x as OpConfig["balanceUnit"])}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectPopup>
                {balanceUnits.map((u) => (
                  <SelectItem key={u.value} value={u.value}>
                    {u.label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </Field>
        </div>

        <div className="flex flex-col gap-4 rounded-xl border bg-muted/40 p-4">
          <h3 className="font-medium text-sm">Test with samples</h3>
          <Field>
            <FieldLabel>Sample SMS</FieldLabel>
            <Textarea value={testSms} onChange={(e) => setTestSms(e.target.value)} />
          </Field>
          <Field>
            <FieldLabel>SMS sender address</FieldLabel>
            <Input type="text" value={testFrom} onChange={(e) => setTestFrom(e.target.value)} placeholder="e.g. Ooredoo" />
          </Field>
          <Field>
            <FieldLabel>Sample balance reply</FieldLabel>
            <Textarea value={testBalance} onChange={(e) => setTestBalance(e.target.value)} placeholder="Paste a real USSD reply" />
          </Field>
          <Button
            variant="outline"
            className="self-start"
            loading={pending}
            onClick={() =>
              run(
                () =>
                  testParsersAction({
                    creditSmsRegex: v.creditSmsRegex,
                    creditSmsUnit: v.creditSmsUnit,
                    creditSmsSenders: v.creditSmsSenders,
                    balanceRegex: v.balanceRegex,
                    balanceUnit: v.balanceUnit,
                    sampleSms: testSms,
                    sampleFrom: testFrom,
                    sampleBalance: testBalance,
                  }),
                { onSuccess: (r) => setResult(r) },
              )
            }
          >
            Run test
          </Button>
          {result && (
            <Alert>
              <AlertDescription className="flex flex-col gap-2 text-sm">
                <span>
                  SMS:{" "}
                  {result.sms == null ? (
                    "—"
                  ) : result.sms.kind === "ignored" ? (
                    <Badge variant="error">not recognised</Badge>
                  ) : (
                    <>
                      <Badge variant={result.sms.kind === "credit" ? "success" : "warning"}>{result.sms.kind}</Badge>{" "}
                      {((result.sms.credit?.amountMillimes ?? 0) / 1000).toFixed(3)} DT from {result.sms.credit?.senderMsisdn}
                    </>
                  )}
                </span>
                <span>
                  Balance:{" "}
                  {testBalance ? (
                    result.balance == null ? (
                      <Badge variant="error">not recognised</Badge>
                    ) : (
                      <Badge variant="success">{(result.balance / 1000).toFixed(3)} DT</Badge>
                    )
                  ) : (
                    "—"
                  )}
                </span>
              </AlertDescription>
            </Alert>
          )}
        </div>
      </CardPanel>
      <CardFooter className="justify-end">
        <Button loading={pending} onClick={() => run(() => updateOperatorAction(op.code, v), { success: `${op.name} saved` })}>
          Save {op.name}
        </Button>
      </CardFooter>
    </Card>
  );
}
