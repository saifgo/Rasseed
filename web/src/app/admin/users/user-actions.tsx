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
import { Label } from "@/components/ui/label";
import { Radio, RadioGroup } from "@/components/ui/radio-group";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { USER_ROLES, type UserRole } from "@/db/schema";

const roleItems = USER_ROLES.map((r) => ({ value: r, label: r.charAt(0).toUpperCase() + r.slice(1) }));
import { adjustBalanceAction, setUserBlockedAction, setUserRoleAction } from "../actions";

/** Admin only: change the role of another user. */
export function RoleSelect({ userId, role, disabled }: { userId: string; role: UserRole; disabled?: boolean }) {
  const { pending, run } = useAdminAction();
  return (
    <Select
      items={roleItems}
      value={role}
      disabled={disabled || pending}
      onValueChange={(v) => {
        if (v && v !== role) run(() => setUserRoleAction(userId, v as UserRole), { success: "Role updated" });
      }}
    >
      <SelectTrigger size="sm" aria-label="Role" className="w-28">
        <SelectValue />
      </SelectTrigger>
      <SelectPopup>
        {roleItems.map((r) => (
          <SelectItem key={r.value} value={r.value}>
            {r.label}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}

export function BlockButton({ userId, blocked, disabled }: { userId: string; blocked: boolean; disabled?: boolean }) {
  const { pending, run } = useAdminAction();
  return (
    <Button
      size="sm"
      variant={blocked ? "outline" : "destructive-outline"}
      loading={pending}
      disabled={disabled}
      onClick={() => run(() => setUserBlockedAction(userId, !blocked), { success: blocked ? "User unblocked" : "User blocked" })}
    >
      {blocked ? "Unblock" : "Block"}
    </Button>
  );
}

/** Staff: manual balance correction or bonus with a mandatory note. */
export function AdjustBalanceButton({ userId, name }: { userId: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [direction, setDirection] = useState<"credit" | "debit">("credit");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const { pending, run } = useAdminAction();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="outline" />}>Adjust balance</DialogTrigger>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Adjust the balance of {name}</DialogTitle>
          <DialogDescription>The note is mandatory and appears in the seller's statement.</DialogDescription>
        </DialogHeader>
        <DialogPanel className="flex flex-col gap-4">
          <RadioGroup value={direction} onValueChange={(v) => setDirection(v as "credit" | "debit")} className="flex gap-4">
            <Label className="flex items-center gap-2 text-sm">
              <Radio value="credit" /> Add money
            </Label>
            <Label className="flex items-center gap-2 text-sm">
              <Radio value="debit" /> Remove money
            </Label>
          </RadioGroup>
          <Field name="amount">
            <FieldLabel>Amount (DT)</FieldLabel>
            <Input type="text" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="5.000" />
            <FieldDescription>Removing more than the available balance is refused.</FieldDescription>
          </Field>
          <Field name="note">
            <FieldLabel>Note (shown to the seller)</FieldLabel>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Bonus for referral / correction of sale RS-…" />
          </Field>
        </DialogPanel>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" type="button" />}>Cancel</DialogClose>
          <Button
            loading={pending}
            disabled={!amount.trim() || !note.trim()}
            onClick={() =>
              run(() => adjustBalanceAction(userId, direction, amount, note), {
                success: "Balance adjusted",
                onSuccess: () => {
                  setOpen(false);
                  setAmount("");
                  setNote("");
                },
              })
            }
          >
            Apply
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
