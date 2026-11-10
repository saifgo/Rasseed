"use client";

import { useState } from "react";
import { Dt } from "@/components/app/money";
import { OperatorName } from "@/components/app/operator-badge";
import { useAdminAction } from "@/components/admin/use-admin-action";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardDescription, CardFooter, CardHeader, CardPanel, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { saveSarfliListingAction } from "../../actions";

export function SarfliListingForm({
  code,
  name,
  color,
  operatorActive,
  price,
  paymentInfo,
  active,
  sarfliMillimes,
}: {
  code: string;
  name: string;
  color: string;
  operatorActive: boolean;
  price: string;
  paymentInfo: string;
  active: boolean;
  sarfliMillimes: number;
}) {
  const { pending, run } = useAdminAction();
  const [v, setV] = useState({ price, paymentInfo, active });
  const n = Number(v.price.replace(",", "."));
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          <OperatorName name={name} color={color} />
        </CardTitle>
        <CardDescription>
          Sarfli credit available: <Dt millimes={sarfliMillimes} />
          {!operatorActive && " · operator disabled"}
        </CardDescription>
        <CardAction>
          <Label className="flex items-center gap-2 text-sm">
            <Switch checked={v.active} onCheckedChange={(c) => setV((s) => ({ ...s, active: c }))} />
            Listed
          </Label>
        </CardAction>
      </CardHeader>
      <CardPanel className="flex flex-col gap-4">
        <Field>
          <FieldLabel>Price per 1 DT of credit</FieldLabel>
          <Input type="text" inputMode="decimal" value={v.price} onChange={(e) => setV((s) => ({ ...s, price: e.target.value }))} placeholder="0.85" className="w-28" />
          <FieldDescription>{n > 0 && n <= 1 ? `100 DT of credit costs the buyer ${(n * 100).toFixed(3)} DT.` : "Between 0 and 1, e.g. 0.85."}</FieldDescription>
        </Field>
        <Field>
          <FieldLabel>Payment instructions</FieldLabel>
          <Textarea
            value={v.paymentInfo}
            onChange={(e) => setV((s) => ({ ...s, paymentInfo: e.target.value }))}
            maxLength={500}
            placeholder="e.g. D17 to 22 123 456 (Sarfli), write the order ref in the note"
          />
          <FieldDescription>Shown to the buyer and copied onto every order. Required to list.</FieldDescription>
        </Field>
      </CardPanel>
      <CardFooter className="justify-end">
        <Button loading={pending} onClick={() => run(() => saveSarfliListingAction(code, v), { success: `${name} listing saved` })}>
          Save {name}
        </Button>
      </CardFooter>
    </Card>
  );
}
