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
import { Textarea } from "@/components/ui/textarea";
import { cancelOrderAction, releaseOrderAction } from "../../../actions";

export function OrderDecisionPanel({
  orderId,
  canRelease,
  sarfli,
  releaseText,
  cancelText,
}: {
  orderId: string;
  canRelease: boolean;
  sarfli: boolean;
  releaseText: string;
  cancelText: string;
}) {
  const { pending, run } = useAdminAction();
  const [note, setNote] = useState("");
  const releaseLabel = sarfli ? "Confirm payment & release" : "Release to buyer";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Admin decision</CardTitle>
        <CardDescription>
          {canRelease
            ? sarfli
              ? "Sarfli's own listing: check that the buyer's payment reached Sarfli, then release the credit."
              : "Check the proof files below. Release if the buyer paid; cancel if he did not."
            : "The buyer has not uploaded payment proof yet. You can only cancel."}
        </CardDescription>
      </CardHeader>
      <CardPanel>
        <Field>
          <FieldLabel>Note</FieldLabel>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="What you checked / why" />
          <FieldDescription>Stored on the order and in its timeline. Mandatory to cancel.</FieldDescription>
        </Field>
      </CardPanel>
      <CardFooter className="flex flex-wrap gap-2">
        {canRelease && (
          <AlertDialog>
            <AlertDialogTrigger render={<Button disabled={pending} />}>{releaseLabel}</AlertDialogTrigger>
            <AlertDialogPopup>
              <AlertDialogHeader>
                <AlertDialogTitle>{releaseLabel}?</AlertDialogTitle>
                <AlertDialogDescription>{releaseText}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogClose render={<Button variant="ghost" />}>Back</AlertDialogClose>
                <AlertDialogClose render={<Button onClick={() => run(() => releaseOrderAction(orderId, note), { success: "Credit released to the buyer" })} />}>
                  Release
                </AlertDialogClose>
              </AlertDialogFooter>
            </AlertDialogPopup>
          </AlertDialog>
        )}
        <AlertDialog>
          <AlertDialogTrigger render={<Button variant="destructive-outline" disabled={pending || !note.trim()} />}>Cancel order</AlertDialogTrigger>
          <AlertDialogPopup>
            <AlertDialogHeader>
              <AlertDialogTitle>Cancel this order?</AlertDialogTitle>
              <AlertDialogDescription>{cancelText}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogClose render={<Button variant="ghost" />}>Back</AlertDialogClose>
              <AlertDialogClose
                render={<Button variant="destructive" onClick={() => run(() => cancelOrderAction(orderId, note), { success: "Order cancelled" })} />}
              >
                Cancel order
              </AlertDialogClose>
            </AlertDialogFooter>
          </AlertDialogPopup>
        </AlertDialog>
      </CardFooter>
    </Card>
  );
}
