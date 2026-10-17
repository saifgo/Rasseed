"use client";

import { useState } from "react";
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
import { Input } from "@/components/ui/input";
import { applyCreditAction, rejectCreditAction } from "../actions";

export function CreditActions({ creditId, suggestedRef }: { creditId: string; suggestedRef: string }) {
  const [open, setOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [ref, setRef] = useState(suggestedRef);
  const [note, setNote] = useState("");
  const { pending, run } = useAdminAction();
  return (
    <div className="flex justify-end gap-1">
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger render={<Button size="sm" />}>Apply</DialogTrigger>
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>Apply credit to a sale</DialogTitle>
            <DialogDescription>
              If the sale's payout is still pending, its amount is increased. If the sale expired or was cancelled, it is completed
              with this credit and a payout is created.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <Field>
              <FieldLabel>Sale reference</FieldLabel>
              <Input type="text" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="RS-XXXXXX" />
              <FieldDescription>Check that the sender number matches the sale.</FieldDescription>
            </Field>
          </DialogPanel>
          <DialogFooter>
            <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
            <Button
              loading={pending}
              onClick={() => run(() => applyCreditAction(creditId, ref), { success: "Credit applied", onSuccess: () => setOpen(false) })}
            >
              Apply
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogTrigger render={<Button size="sm" variant="ghost" />}>Reject</DialogTrigger>
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>Reject credit</DialogTitle>
            <DialogDescription>It stays on the SIM balance but won't be paid to anyone.</DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <Field>
              <FieldLabel>Reason</FieldLabel>
              <Input type="text" value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
          </DialogPanel>
          <DialogFooter>
            <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
            <Button
              variant="destructive"
              loading={pending}
              onClick={() => run(() => rejectCreditAction(creditId, note), { success: "Credit rejected", onSuccess: () => setRejectOpen(false) })}
            >
              Reject
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </div>
  );
}
