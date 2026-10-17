"use client";

import { MoreHorizontalIcon, PlusIcon } from "lucide-react";
import { useState } from "react";
import { useAdminAction } from "@/components/admin/use-admin-action";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  checkBalanceAction,
  configureSimAction,
  createDeviceAction,
  newPairingCodeAction,
  resetSimFailuresAction,
  updateDeviceAction,
} from "../actions";

function PairingInfo({ code, serverUrl }: { code: string; serverUrl: string }) {
  return (
    <Alert variant="info">
      <AlertTitle>Open the agent app on the phone and enter:</AlertTitle>
      <AlertDescription className="flex flex-col gap-2">
        <span className="text-xs">
          Not installed yet? On the phone, open{" "}
          <span className="select-all font-mono text-foreground">{serverUrl}/downloads/rasseed-agent.apk</span>
        </span>
        <span>
          Server: <span className="select-all font-mono text-foreground">{serverUrl}</span>
        </span>
        <span>
          Pairing code: <span className="select-all font-mono font-semibold text-2xl text-foreground tracking-widest">{code}</span>
        </span>
        <span className="text-xs">The code is valid for 10 minutes and can be used once.</span>
      </AlertDescription>
    </Alert>
  );
}

export function AddPhoneButton({ serverUrl }: { serverUrl: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [code, setCode] = useState<string | null>(null);
  const { pending, run } = useAdminAction();
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setCode(null);
          setName("");
        }
      }}
    >
      <DialogTrigger render={<Button />}>
        <PlusIcon aria-hidden="true" />
        Add phone
      </DialogTrigger>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Add a phone</DialogTitle>
          <DialogDescription>Give it a name you'll recognise (e.g. where it is plugged in).</DialogDescription>
        </DialogHeader>
        <DialogPanel className="flex flex-col gap-4">
          {code ? (
            <PairingInfo code={code} serverUrl={serverUrl} />
          ) : (
            <Field>
              <FieldLabel>Name</FieldLabel>
              <Input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Phone A – shelf 1" />
            </Field>
          )}
        </DialogPanel>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" />}>{code ? "Done" : "Cancel"}</DialogClose>
          {!code && (
            <Button loading={pending} onClick={() => run(() => createDeviceAction(name), { onSuccess: (d) => setCode(d.code) })}>
              Create & get pairing code
            </Button>
          )}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

export function DeviceActions({ deviceId, enabled, name, serverUrl }: { deviceId: string; enabled: boolean; name: string; serverUrl: string }) {
  const { pending, run } = useAdminAction();
  const [code, setCode] = useState<string | null>(null);
  return (
    <>
      <Menu>
        <MenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`Actions for ${name}`} disabled={pending} />}>
          <MoreHorizontalIcon aria-hidden="true" />
        </MenuTrigger>
        <MenuPopup align="end">
          <MenuItem onClick={() => run(() => newPairingCodeAction(deviceId), { onSuccess: (d) => setCode(d.code) })}>
            Re-pair (new code)
          </MenuItem>
          <MenuSeparator />
          <MenuItem
            variant={enabled ? "destructive" : "default"}
            onClick={() => run(() => updateDeviceAction(deviceId, { enabled: !enabled }), { success: enabled ? "Phone disabled" : "Phone enabled" })}
          >
            {enabled ? "Disable phone" : "Enable phone"}
          </MenuItem>
        </MenuPopup>
      </Menu>
      <Dialog open={code !== null} onOpenChange={(o) => !o && setCode(null)}>
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>Re-pair {name}</DialogTitle>
            <DialogDescription>The old token stops working once the phone pairs with this code.</DialogDescription>
          </DialogHeader>
          <DialogPanel>{code && <PairingInfo code={code} serverUrl={serverUrl} />}</DialogPanel>
          <DialogFooter>
            <DialogClose render={<Button variant="ghost" />}>Done</DialogClose>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </>
  );
}

type SimInfo = { id: string; operatorCode: string | null; msisdn: string | null; status: string; slot: number };
const statusItems = [
  { label: "Active (receives sales)", value: "active" },
  { label: "Disabled", value: "disabled" },
  { label: "Not configured", value: "unconfigured" },
];

export function SimActions({ sim, operators, failing }: { sim: SimInfo; operators: { code: string; name: string }[]; failing: boolean }) {
  const { pending, run } = useAdminAction();
  const [open, setOpen] = useState(false);
  const [operatorCode, setOperatorCode] = useState(sim.operatorCode ?? "");
  const [msisdn, setMsisdn] = useState(sim.msisdn ?? "");
  const [status, setStatus] = useState(sim.status === "unconfigured" ? "active" : sim.status);
  const opItems = operators.map((o) => ({ label: o.name, value: o.code }));

  return (
    <div className="flex justify-end gap-1">
      <Button size="sm" variant="outline" loading={pending} onClick={() => run(() => checkBalanceAction(sim.id), { success: "Balance check queued" })}>
        Check balance
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger render={<Button size="sm" variant={sim.status === "unconfigured" ? "default" : "ghost"} />}>Configure</DialogTrigger>
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>Configure SIM {sim.slot}</DialogTitle>
            <DialogDescription>
              Make sure the number is exactly the one of the SIM in this slot: sellers will send credit to it.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="flex flex-col gap-4">
            <Field>
              <FieldLabel>Operator</FieldLabel>
              <Select items={opItems} value={operatorCode} onValueChange={(v) => setOperatorCode(String(v ?? ""))}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose operator" />
                </SelectTrigger>
                <SelectPopup>
                  {opItems.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </Field>
            <Field>
              <FieldLabel>Phone number of this SIM</FieldLabel>
              <Input type="tel" inputMode="numeric" value={msisdn} onChange={(e) => setMsisdn(e.target.value)} placeholder="8 digits" />
              <FieldDescription>Tip: dial the operator's "my number" code on the phone to double-check.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel>Status</FieldLabel>
              <Select items={statusItems} value={status} onValueChange={(v) => setStatus(String(v ?? "active"))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectPopup>
                  {statusItems.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </Field>
          </DialogPanel>
          <DialogFooter>
            <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
            <Button
              loading={pending}
              onClick={() =>
                run(
                  () =>
                    configureSimAction(sim.id, {
                      operatorCode: operatorCode || null,
                      msisdn: msisdn.trim() || null,
                      status: status as "active" | "disabled" | "unconfigured",
                    }),
                  { success: "SIM saved", onSuccess: () => setOpen(false) },
                )
              }
            >
              Save
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
      {failing && (
        <Button size="sm" variant="ghost" loading={pending} onClick={() => run(() => resetSimFailuresAction(sim.id), { success: "Failures reset" })}>
          Reset failures
        </Button>
      )}
    </div>
  );
}
