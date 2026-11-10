"use client";

import { useState } from "react";
import { useAdminAction } from "@/components/admin/use-admin-action";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardFooter, CardHeader, CardPanel, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { adjustSarfliCreditAction } from "../../actions";

/** Admin: opening balance and corrections of Sarfli's own credit. */
export function AdjustSarfliCreditForm({ operators }: { operators: { value: string; label: string }[] }) {
  const { pending, run } = useAdminAction();
  const [op, setOp] = useState(operators[0]?.value ?? "");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Adjust Sarfli credit</CardTitle>
        <CardDescription>
          Use it once per operator for the opening balance (credit on the SIMs that belongs to Sarfli when the ledger starts), then only
          to correct a gap you investigated. Negative amounts remove credit. Never use it to hide a gap you cannot explain.
        </CardDescription>
      </CardHeader>
      <CardPanel className="grid gap-4 sm:grid-cols-3">
        <Field>
          <FieldLabel>Operator</FieldLabel>
          <Select items={operators} value={op} onValueChange={(v) => setOp(String(v ?? ""))}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectPopup>
              {operators.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </Field>
        <Field>
          <FieldLabel>Amount (DT, signed)</FieldLabel>
          <Input type="text" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="250.000 or -1.500" />
          <FieldDescription>Positive adds to Sarfli credit, negative removes.</FieldDescription>
        </Field>
        <Field>
          <FieldLabel>Note</FieldLabel>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Opening balance 10/11 after SIM check" />
        </Field>
      </CardPanel>
      <CardFooter className="justify-end">
        <Button
          loading={pending}
          disabled={!op || !amount.trim() || !note.trim()}
          onClick={() =>
            run(() => adjustSarfliCreditAction(op, amount, note), {
              success: "Sarfli credit adjusted",
              onSuccess: () => {
                setAmount("");
                setNote("");
              },
            })
          }
        >
          Apply adjustment
        </Button>
      </CardFooter>
    </Card>
  );
}
