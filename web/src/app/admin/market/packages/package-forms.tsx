"use client";

import { useState } from "react";
import { useAdminAction } from "@/components/admin/use-admin-action";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardFooter, CardHeader, CardPanel, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { createPackageAction, type PackageFormValues, updatePackageAction } from "../../actions";

const EMPTY: PackageFormValues = { name: "", price: "", ussdTemplate: "", ussdSteps: "", active: true, sortOrder: "0" };

/** Edits a package, or (without id) adds a new one for the operator. */
export function PackageForm({
  id,
  operatorCode,
  operatorName,
  initial = EMPTY,
}: {
  id?: string;
  operatorCode: string;
  operatorName?: string;
  initial?: PackageFormValues;
}) {
  const { pending, run } = useAdminAction();
  const [v, setV] = useState(initial);
  const set = <K extends keyof PackageFormValues>(k: K, value: PackageFormValues[K]) => setV((s) => ({ ...s, [k]: value }));

  return (
    <Card className={id ? undefined : "border-dashed"}>
      <CardHeader>
        <CardTitle className="text-base">{id ? v.name || "Package" : `New ${operatorName} package`}</CardTitle>
        <CardAction>
          <Label className="flex items-center gap-2 text-sm">
            <Switch checked={v.active} onCheckedChange={(c) => set("active", c)} />
            Active
          </Label>
        </CardAction>
      </CardHeader>
      <CardPanel className="flex flex-col gap-4">
        <Field>
          <FieldLabel>Name shown to buyers</FieldLabel>
          <Input value={v.name} maxLength={120} onChange={(e) => set("name", e.target.value)} placeholder="e.g. 1 Go · 7 days" />
        </Field>
        <div className="flex items-start gap-4">
          <Field>
            <FieldLabel>Price (DT)</FieldLabel>
            <Input type="text" inputMode="decimal" value={v.price} onChange={(e) => set("price", e.target.value)} placeholder="5" className="w-28" />
            <FieldDescription>
              Deducted from the buyer&apos;s balance (or Sarfli&apos;s credit for admins), and what the agent SIM must lose for the package to
              count as sent.
            </FieldDescription>
          </Field>
          <Field className="shrink-0">
            <FieldLabel>Order</FieldLabel>
            <Input type="text" inputMode="numeric" value={v.sortOrder} onChange={(e) => set("sortOrder", e.target.value)} className="w-20" />
          </Field>
        </div>
        <Field>
          <FieldLabel>USSD code</FieldLabel>
          <Input dir="ltr" className="font-mono" value={v.ussdTemplate} onChange={(e) => set("ussdTemplate", e.target.value)} placeholder="*xxx*{number}#" />
        </Field>
        <Field>
          <FieldLabel>Menu replies (one per line, optional)</FieldLabel>
          <Textarea dir="ltr" className="font-mono" value={v.ussdSteps} onChange={(e) => set("ussdSteps", e.target.value)} placeholder={"2\n{number}\n1"} />
          <FieldDescription>
            Placeholders: {"{number}"} (customer, required somewhere), {"{millimes}"}, {"{dinars}"}. A line starting with ? is a
            check, not a reply: the menu page must contain that text, otherwise nothing is bought and the buyer is told the number
            can&apos;t take this package. Ooredoo: *124*7# then 0, 1, {"{number}"}, ?4:Flexi 30J et plus, then the package choice.
          </FieldDescription>
        </Field>
      </CardPanel>
      <CardFooter className="justify-end">
        <Button
          loading={pending}
          onClick={() =>
            id
              ? run(() => updatePackageAction(id, v), { success: "Package saved" })
              : run(() => createPackageAction(operatorCode, v), { success: "Package added", onSuccess: () => setV(EMPTY) })
          }
        >
          {id ? "Save" : "Add package"}
        </Button>
      </CardFooter>
    </Card>
  );
}
