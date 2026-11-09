"use client";

import { useState } from "react";
import { Secret } from "@/components/app/confidential";
import { Dt } from "@/components/app/money";
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
import { Form } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { attachWithdrawalProofAction, markWithdrawalPaidAction, rejectWithdrawalAction, setWithdrawalNoteAction } from "../actions";

const ACCEPT = "image/jpeg,image/png,image/webp,application/pdf";

export function MarkPaidButton({
  withdrawalId,
  ref_,
  sendMillimes,
  note,
}: { withdrawalId: string; ref_: string; sendMillimes: number; note?: string | null }) {
  const [open, setOpen] = useState(false);
  const { pending, run } = useAdminAction();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>Mark paid</DialogTrigger>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Mark <Secret>{ref_}</Secret> as paid</DialogTitle>
          <DialogDescription>
            Confirm you sent <Dt millimes={sendMillimes} className="font-semibold text-foreground" />. The seller will see the status, the
            reference and the proof.
          </DialogDescription>
        </DialogHeader>
        <Form
          className="contents"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            fd.set("withdrawalId", withdrawalId);
            run(() => markWithdrawalPaidAction(fd), { success: "Marked as paid", onSuccess: () => setOpen(false) });
          }}
        >
          <DialogPanel className="flex flex-col gap-4">
            <Field name="reference">
              <FieldLabel>Transaction reference (optional)</FieldLabel>
              <Input type="text" name="reference" placeholder="D17 / Flouci / mandate number" />
            </Field>
            <Field name="note">
              <FieldLabel>Note to seller (optional)</FieldLabel>
              <Textarea name="note" defaultValue={note ?? ""} />
            </Field>
            <Field name="proof">
              <FieldLabel>Payment proof (optional)</FieldLabel>
              <Input type="file" name="proof" accept={ACCEPT} />
              <FieldDescription>JPG, PNG, WEBP or PDF, up to 5 MB.</FieldDescription>
            </Field>
          </DialogPanel>
          <DialogFooter>
            <DialogClose render={<Button variant="ghost" type="button" />}>Cancel</DialogClose>
            <Button type="submit" loading={pending}>
              Mark paid
            </Button>
          </DialogFooter>
        </Form>
      </DialogPopup>
    </Dialog>
  );
}

export function RejectButton({ withdrawalId, ref_, grossMillimes }: { withdrawalId: string; ref_: string; grossMillimes: number }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const { pending, run } = useAdminAction();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="destructive-outline" />}>Reject</DialogTrigger>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Reject <Secret>{ref_}</Secret></DialogTitle>
          <DialogDescription>
            <Dt millimes={grossMillimes} className="font-semibold text-foreground" /> go back to the seller's balance. The reason is shown to
            the seller.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <Field name="reason">
            <FieldLabel>Reason</FieldLabel>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. D17 number does not exist" />
          </Field>
        </DialogPanel>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" type="button" />}>Cancel</DialogClose>
          <Button
            variant="destructive"
            loading={pending}
            disabled={!reason.trim()}
            onClick={() => run(() => rejectWithdrawalAction(withdrawalId, reason), { success: "Withdrawal rejected", onSuccess: () => setOpen(false) })}
          >
            Reject and refund
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

export function NoteButton({ withdrawalId, ref_, note }: { withdrawalId: string; ref_: string; note: string | null }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(note ?? "");
  const { pending, run } = useAdminAction();
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) setText(note ?? "");
        setOpen(o);
      }}
    >
      <DialogTrigger render={<Button size="sm" variant="outline" />}>{note ? "Edit note" : "Note"}</DialogTrigger>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Note to seller · <Secret>{ref_}</Secret></DialogTitle>
          <DialogDescription>
            Shown to the seller on their balance page while this withdrawal waits to be paid. Leave empty to remove it.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <Field name="note">
            <FieldLabel>Note</FieldLabel>
            <Textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} placeholder="e.g. Will be sent tomorrow morning" />
          </Field>
        </DialogPanel>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" type="button" />}>Cancel</DialogClose>
          <Button
            loading={pending}
            disabled={!text.trim() && !note}
            onClick={() =>
              run(() => setWithdrawalNoteAction(withdrawalId, text), {
                success: text.trim() ? "Note saved" : "Note removed",
                onSuccess: () => setOpen(false),
              })
            }
          >
            {text.trim() ? "Save note" : "Remove note"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

export function AttachProofButton({ withdrawalId }: { withdrawalId: string }) {
  const [open, setOpen] = useState(false);
  const { pending, run } = useAdminAction();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="outline" />}>Add proof</DialogTrigger>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Attach payment proof</DialogTitle>
        </DialogHeader>
        <Form
          className="contents"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            fd.set("withdrawalId", withdrawalId);
            run(() => attachWithdrawalProofAction(fd), { success: "Proof attached", onSuccess: () => setOpen(false) });
          }}
        >
          <DialogPanel>
            <Field name="proof">
              <FieldLabel>File</FieldLabel>
              <Input type="file" name="proof" accept={ACCEPT} required />
            </Field>
          </DialogPanel>
          <DialogFooter>
            <DialogClose render={<Button variant="ghost" type="button" />}>Cancel</DialogClose>
            <Button type="submit" loading={pending}>
              Upload
            </Button>
          </DialogFooter>
        </Form>
      </DialogPopup>
    </Dialog>
  );
}
