"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { AdminStatusBadge, reviewReasons } from "@/components/admin/admin-status-badge";
import { RechargeStatusBadge, rechargeReviewReasons } from "@/components/admin/market-badges";
import { errorMessage } from "@/components/admin/use-admin-action";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardPanel, CardTitle } from "@/components/ui/card";
import { Frame } from "@/components/ui/frame";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toastManager } from "@/components/ui/toast";
import type { TxStatus, RechargeStatus } from "@/db/schema";
import { formatDinars } from "@/lib/money";
import { formatMsisdn } from "@/lib/phone";
import type { CreditKind, SendMode, TestPhoneView } from "@/lib/test-phone";
import { cn } from "@/lib/utils";
import { setTestBalanceAction, setTestModesAction, simulateCreditAction, testPhoneTickAction } from "./actions";

type ActionResult = { ok: true; data: unknown } | { ok: false; error: string };

const POLL_MS = 2000;
const CREDITABLE: TxStatus[] = ["awaiting_transfer", "verifying", "partial", "review"];

const sendModes: { value: SendMode; label: string; hint: string }[] = [
  { value: "success", label: "Success", hint: "Credit leaves the SIM and the operator confirms." },
  { value: "refused", label: "Operator refuses", hint: "Phone reports ok with a refusal text; balance unchanged." },
  { value: "no_answer", label: "No answer", hint: "Phone never answers; the worker times the command out." },
  { value: "error", label: "Phone error", hint: "Phone reports popup_timeout; balance unchanged." },
];

const dt = (m: number | null | undefined) => (m == null ? "—" : `${formatDinars(m)} DT`);
/** Prefill value for a dinar input ("12.5"). */
const dinarsInput = (m: number) => String(m / 1000);
/** A valid 8-digit number that is not the sale's sender. */
const wrongSender = (sender: string) => (sender.startsWith("9") ? "2" : "9") + sender.slice(1);

export function TestPhonePanel({ initial }: { initial: TestPhoneView }) {
  const [view, setView] = useState(initial);
  const [stopped, setStopped] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // True after a successful heartbeat; false while the server can't be reached.
  const [online, setOnline] = useState(false);
  const inFlight = useRef(false);

  const tick = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const res = await testPhoneTickAction();
      setOnline(res.ok);
      if (res.ok) {
        if (res.data) setView(res.data);
      } else if (res.error === "forbidden") setStopped(errorMessage(res.error));
    } catch {
      // Network hiccup or server restart: try again on the next poll.
      setOnline(false);
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    if (stopped) return;
    const first = setTimeout(() => void tick(), 0);
    const id = setInterval(() => void tick(), POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [tick, stopped]);

  async function run(action: () => Promise<ActionResult>, success?: string) {
    setBusy(true);
    try {
      const res = await action();
      if (res.ok) {
        if (success) toastManager.add({ type: "success", title: success });
        await tick();
      } else {
        toastManager.add({ type: "error", title: errorMessage(res.error) });
      }
    } finally {
      setBusy(false);
    }
  }

  const simById = (id: string | null) => view.sims.find((s) => s.id === id);

  return (
    <>
      <Alert variant="info">
        <AlertTitle className="flex flex-wrap items-center gap-2">
          How to use
          <Badge variant={online && !stopped ? "success" : "secondary"}>{online && !stopped ? "Phone online" : "Phone offline"}</Badge>
          {!view.device.enabled && <Badge variant="warning">Device disabled in Numbers &amp; phones</Badge>}
        </AlertTitle>
        <AlertDescription>
          <ol className="list-decimal space-y-1 ps-5">
            <li>
              Keep this page open: the test phone is online <strong>only while this page is open</strong> (it answers the server every 2 s).
              Keep the worker running too (<code>pnpm worker</code>) for timeouts, expiries and balance polls.
            </li>
            <li>On the site, as a seller, start a sale or &quot;send credit to an order&quot;. It gets one of the test numbers below.</li>
            <li>Under Waiting transfers, click <strong>Simulate credit received</strong>.</li>
            <li>Watch the status go verifying → confirmed (or partial / review), and the linked order get funded.</li>
          </ol>
          <p className="mt-2">
            Recharges: set a recharge code for the operator in{" "}
            <Link href="/admin/operators" className="underline underline-offset-4">
              Operators &amp; rates
            </Link>{" "}
            first. Here only the amount matters; a real phone needs the real operator dialog. Test SIMs also serve real sales and
            recharges while online — use this on a dev database only.
          </p>
          {stopped && <p className="mt-2 font-medium text-destructive">Stopped: {stopped}</p>}
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>Waiting transfers</CardTitle>
          <CardDescription>
            Sales and order deposits held on test numbers. A credit counts only when the SMS (from the sale&apos;s sender) and the
            balance both show it. &quot;Balance only&quot; is found by the next balance poll (worker, every ~90 s).
          </CardDescription>
        </CardHeader>
        <CardPanel className="flex flex-col gap-3">
          {view.sales.length === 0 ? (
            <p className="text-muted-foreground text-sm">No sale on a test number. Start one on the site as a seller.</p>
          ) : (
            view.sales.map((s) => {
              const missing = Math.max(s.declaredMillimes - s.confirmedMillimes, 0) || s.declaredMillimes;
              return <SaleRow key={`${s.id}-${missing}`} sale={s} sim={simById(s.simId)} missing={missing} busy={busy} run={run} />;
            })
          )}
        </CardPanel>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Test SIMs</CardTitle>
          <CardDescription>
            One SIM per active operator. &quot;Simulated&quot; is what the phone will answer; &quot;Server&quot; is the last balance the server read.
          </CardDescription>
        </CardHeader>
        <CardPanel>
          <Frame>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Operator</TableHead>
                  <TableHead>Number</TableHead>
                  <TableHead>Simulated balance</TableHead>
                  <TableHead className="text-right">Server</TableHead>
                  <TableHead>Held by</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {view.sims.map((sim) => (
                  <SimRow key={`${sim.id}-${sim.simulatedMillimes}`} sim={sim} busy={busy} run={run} />
                ))}
              </TableBody>
            </Table>
          </Frame>
        </CardPanel>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recharges</CardTitle>
          <CardDescription>Buyer recharges queued or sent from test SIMs: balance → send → balance check.</CardDescription>
        </CardHeader>
        <CardPanel className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <span className="font-medium text-sm">When the phone is asked to send a recharge</span>
            <div className="flex flex-wrap gap-1">
              {sendModes.map((m) => (
                <Button
                  key={m.value}
                  size="sm"
                  variant={view.sendMode === m.value ? "secondary" : "ghost"}
                  disabled={busy}
                  title={m.hint}
                  onClick={() => void run(() => setTestModesAction({ sendMode: m.value }))}
                >
                  {m.label}
                </Button>
              ))}
            </div>
            <p className="text-muted-foreground text-xs">{sendModes.find((m) => m.value === view.sendMode)?.hint}</p>
            <label className="mt-1 flex items-center gap-2 text-sm">
              <Switch
                checked={view.balanceFails}
                disabled={busy}
                onCheckedChange={(checked) => void run(() => setTestModesAction({ balanceFails: checked }))}
              />
              Balance checks fail (USSD error on every balance read — sales and recharges)
            </label>
            {!view.sims.some((s) => s.rechargeEnabled) && (
              <p className="text-warning text-xs">No operator has a recharge code yet: buyers can&apos;t start recharges.</p>
            )}
          </div>
          {view.recharges.length === 0 ? (
            <p className="text-muted-foreground text-sm">No recharge yet.</p>
          ) : (
            <Frame>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Ref</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>SIM</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {view.recharges.map((r) => {
                    const sim = simById(r.simId);
                    return (
                      <TableRow key={r.id} className={cn(r.status === "review" && "bg-warning/8")}>
                        <TableCell className="font-mono">{r.ref}</TableCell>
                        <TableCell className="font-mono text-xs">
                          {r.operatorCode} · {formatMsisdn(r.msisdn)}
                        </TableCell>
                        <TableCell className="text-right">{dt(r.amountMillimes)}</TableCell>
                        <TableCell className="text-xs">{sim ? `${sim.operatorName} · slot ${sim.slotIndex}` : "waiting for a SIM"}</TableCell>
                        <TableCell className="max-w-64 whitespace-normal">
                          <RechargeStatusBadge status={r.status as RechargeStatus} />
                          {r.status === "review" && r.reviewReason && (
                            <div className="mt-1 text-muted-foreground text-xs">{rechargeReviewReasons[r.reviewReason] ?? r.reviewReason}</div>
                          )}
                          {r.status === "review" && (
                            <Link href="/admin/market/recharges" className="mt-1 block text-xs underline underline-offset-4">
                              Decide in Recharges
                            </Link>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Frame>
          )}
        </CardPanel>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Phone log</CardTitle>
          <CardDescription>Last commands answered and SMS delivered by the test phone, newest first.</CardDescription>
        </CardHeader>
        <CardPanel>
          {view.log.length === 0 ? (
            <p className="text-muted-foreground text-sm">Nothing yet.</p>
          ) : (
            <ul className="flex flex-col divide-y text-sm">
              {view.log.map((e, i) => {
                const sim = simById(e.simId);
                return (
                  <li key={`${e.at}-${i}`} className="flex flex-col gap-1 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-muted-foreground text-xs tabular-nums">{new Date(e.at).toLocaleTimeString()}</span>
                      <Badge variant={e.ok === null ? "secondary" : e.ok ? "success" : "error"}>
                        {e.kind === "balance" ? "Balance" : e.kind === "send" ? "Send" : "Credit in"}
                        {e.ok === null ? " · unanswered" : e.ok ? "" : " · failed"}
                      </Badge>
                      <span className="font-mono text-xs">{e.purpose}</span>
                      {sim && <span className="text-muted-foreground text-xs">{sim.operatorName}</span>}
                    </div>
                    <pre className="whitespace-pre-wrap break-words font-mono text-muted-foreground text-xs">{e.text}</pre>
                  </li>
                );
              })}
            </ul>
          )}
        </CardPanel>
      </Card>
    </>
  );
}

type Run = (action: () => Promise<ActionResult>, success?: string) => Promise<void>;

function SaleRow({
  sale,
  sim,
  missing,
  busy,
  run,
}: {
  sale: TestPhoneView["sales"][number];
  sim: TestPhoneView["sims"][number] | undefined;
  missing: number;
  busy: boolean;
  run: Run;
}) {
  const [amount, setAmount] = useState(dinarsInput(missing));
  const [sender, setSender] = useState(sale.sender);
  const creditable = CREDITABLE.includes(sale.status as TxStatus) && !!sim;
  const credit = (kind: CreditKind, from = sender, label = "Credit sent to the test phone") =>
    run(() => simulateCreditAction(sim!.id, amount, from, kind), label);

  return (
    <div className={cn("flex flex-col gap-3 rounded-xl border p-4", sale.status === "review" && "border-warning/40 bg-warning/4")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/admin/sales/${sale.id}`} className="font-medium font-mono underline-offset-4 hover:underline">
              {sale.ref}
            </Link>
            <AdminStatusBadge status={sale.status as TxStatus} />
            {sale.orderId && (
              <Link href={`/admin/market/orders/${sale.orderId}`} className="text-xs underline underline-offset-4">
                Order {sale.orderRef ?? ""}
              </Link>
            )}
          </div>
          <div className="text-muted-foreground text-xs">
            {sale.seller} · from <span className="font-mono">{formatMsisdn(sale.sender)}</span>
            {sim && (
              <>
                {" "}
                to {sim.operatorName} <span className="font-mono">{sim.msisdn ? formatMsisdn(sim.msisdn) : ""}</span>
              </>
            )}
          </div>
          {sale.status === "review" && sale.reviewReason && (
            <div className="text-xs">{reviewReasons[sale.reviewReason] ?? sale.reviewReason}</div>
          )}
        </div>
        <dl className="grid grid-cols-3 gap-4 text-right text-xs">
          <div>
            <dt className="text-muted-foreground">Declared</dt>
            <dd className="font-medium">{dt(sale.declaredMillimes)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">SMS seen</dt>
            <dd className="font-medium">{dt(sale.smsMillimes)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Confirmed</dt>
            <dd className="font-medium">{dt(sale.finalMillimes ?? sale.confirmedMillimes)}</dd>
          </div>
        </dl>
      </div>

      {creditable ? (
        <div className="flex flex-wrap items-end gap-2">
          <Button size="lg" disabled={busy} onClick={() => void credit("real")}>
            Simulate credit received
          </Button>
          <label className="flex flex-col gap-1 text-xs">
            Amount (DT)
            <Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" className="w-28" />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            From
            <Input value={sender} onChange={(e) => setSender(e.target.value)} inputMode="numeric" className="w-32 font-mono" />
          </label>
          <div className="flex flex-wrap gap-1">
            <Button size="sm" variant="outline" disabled={busy} title="The SMS arrives but the balance does not change" onClick={() => void credit("sms_only", sender, "Fake SMS sent")}>
              SMS only
            </Button>
            <Button size="sm" variant="outline" disabled={busy} title="The balance goes up without SMS" onClick={() => void credit("balance_only", sender, "Balance raised, no SMS")}>
              Balance only
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              title="A real transfer from another number than the sale's sender"
              onClick={() => void credit("real", wrongSender(sale.sender), "Credit sent from a wrong sender")}
            >
              From a wrong sender
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-muted-foreground text-xs">
          {sale.status === "assigning" ? "Reading the starting balance…" : "Finished — nothing to send."}
        </p>
      )}
    </div>
  );
}

function SimRow({ sim, busy, run }: { sim: TestPhoneView["sims"][number]; busy: boolean; run: Run }) {
  const [balance, setBalance] = useState(dinarsInput(sim.simulatedMillimes));
  return (
    <TableRow>
      <TableCell>
        <span className="inline-flex items-center gap-2">
          <span className="size-2.5 rounded-full" style={{ backgroundColor: sim.operatorColor }} aria-hidden="true" />
          <span className="font-medium">{sim.operatorName}</span>
          <span className="text-muted-foreground text-xs">slot {sim.slotIndex}</span>
        </span>
        {sim.status !== "active" && <Badge variant="warning" className="ms-2">{sim.status}</Badge>}
      </TableCell>
      <TableCell className="font-mono">{sim.msisdn ? formatMsisdn(sim.msisdn) : "—"}</TableCell>
      <TableCell>
        <form
          className="flex items-center gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => setTestBalanceAction(sim.id, balance), "Balance set");
          }}
        >
          <Input value={balance} onChange={(e) => setBalance(e.target.value)} inputMode="decimal" className="w-28" aria-label="Simulated balance in DT" />
          <span className="text-muted-foreground text-xs">DT</span>
          <Button type="submit" size="sm" variant="outline" disabled={busy || balance === dinarsInput(sim.simulatedMillimes)}>
            Set
          </Button>
        </form>
      </TableCell>
      <TableCell className="text-right text-xs">{dt(sim.serverMillimes)}</TableCell>
      <TableCell className="text-xs">
        {sim.heldByTx ? `Sale ${sim.heldByTx}` : sim.heldByRecharge ? `Recharge ${sim.heldByRecharge}` : <span className="text-muted-foreground">free</span>}
      </TableCell>
    </TableRow>
  );
}
