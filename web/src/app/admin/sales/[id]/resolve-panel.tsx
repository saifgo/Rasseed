"use client";

import { useState } from "react";
import { useAdminAction } from "@/components/admin/use-admin-action";
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
import { Card, CardDescription, CardFooter, CardHeader, CardPanel, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { confirmReviewAction, rejectReviewAction } from "../../actions";

export function ResolvePanel({ txId, suggestedDinars, inReview }: { txId: string; suggestedDinars: string; inReview: boolean }) {
  const { pending, run } = useAdminAction();
  const [amount, setAmount] = useState(suggestedDinars);
  const [note, setNote] = useState("");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{inReview ? "Resolve review" : "Manual override"}</CardTitle>
        <CardDescription>
          Confirming completes the sale with this amount, frees the number and creates the payout. Only confirm what you have
          verified on the SIM.
        </CardDescription>
      </CardHeader>
      <CardPanel className="flex flex-col gap-4">
        <Field>
          <FieldLabel>Amount actually received (DT)</FieldLabel>
          <Input type="text" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field>
          <FieldLabel>Note</FieldLabel>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="What you checked" />
          <FieldDescription>Stored in the audit timeline.</FieldDescription>
        </Field>
      </CardPanel>
      <CardFooter className="flex gap-2">
        <AlertDialog>
          <AlertDialogTrigger render={<Button disabled={pending} />}>Confirm {amount} DT</AlertDialogTrigger>
          <AlertDialogPopup>
            <AlertDialogHeader>
              <AlertDialogTitle>Confirm {amount} DT?</AlertDialogTitle>
              <AlertDialogDescription>The seller will be told the transfer is confirmed and a payout will be created.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogClose render={<Button variant="ghost" />}>Cancel</AlertDialogClose>
              <AlertDialogClose
                render={<Button onClick={() => run(() => confirmReviewAction(txId, amount, note), { success: "Sale confirmed" })} />}
              >
                Confirm
              </AlertDialogClose>
            </AlertDialogFooter>
          </AlertDialogPopup>
        </AlertDialog>
        <AlertDialog>
          <AlertDialogTrigger render={<Button variant="destructive-outline" disabled={pending} />}>Reject</AlertDialogTrigger>
          <AlertDialogPopup>
            <AlertDialogHeader>
              <AlertDialogTitle>Reject this sale?</AlertDialogTitle>
              <AlertDialogDescription>No payout will be made and the number is released.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogClose render={<Button variant="ghost" />}>Cancel</AlertDialogClose>
              <AlertDialogClose
                render={<Button variant="destructive" onClick={() => run(() => rejectReviewAction(txId, note), { success: "Sale rejected" })} />}
              >
                Reject
              </AlertDialogClose>
            </AlertDialogFooter>
          </AlertDialogPopup>
        </AlertDialog>
      </CardFooter>
    </Card>
  );
}
