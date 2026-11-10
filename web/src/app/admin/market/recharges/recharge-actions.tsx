"use client";

import { useState } from "react";
import { Secret } from "@/components/app/confidential";
import { useAdminAction } from "@/components/admin/use-admin-action";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { resolveRechargeAction } from "../../actions";

/** Admin decides a recharge in review. */
export function ResolveRechargeButton({ rechargeId, ref_, amount }: { rechargeId: string; ref_: string; amount: string }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const { pending, run } = useAdminAction();
  const resolve = (outcome: "succeeded" | "failed") =>
    run(() => resolveRechargeAction(rechargeId, outcome, note), {
      success: outcome === "succeeded" ? "Marked as succeeded" : "Marked as failed · amount refunded",
      onSuccess: () => {
        setOpen(false);
        setNote("");
      },
    });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>Resolve</DialogTrigger>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>
            Resolve recharge <Secret>{ref_}</Secret>
          </DialogTitle>
          <DialogDescription>
            Check the SIM's balance and SMS (and ask the customer if needed). Succeeded: the customer got {amount} DT, nothing goes back to
            the buyer. Failed: nothing was sent, the {amount} DT go back to the buyer's balance. The SIM is freed in both cases.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <Field>
            <FieldLabel>Note</FieldLabel>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="What you checked" />
            <FieldDescription>Mandatory. Stored on the recharge and in the ledger.</FieldDescription>
          </Field>
        </DialogPanel>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" type="button" />}>Back</DialogClose>
          <Button variant="destructive-outline" loading={pending} disabled={!note.trim()} onClick={() => resolve("failed")}>
            Failed · refund buyer
          </Button>
          <Button loading={pending} disabled={!note.trim()} onClick={() => resolve("succeeded")}>
            Succeeded
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
