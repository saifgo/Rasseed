import { BatteryChargingIcon, BatteryIcon, SmartphoneIcon } from "lucide-react";
import Link from "next/link";
import { headers } from "next/headers";
import { Dt } from "@/components/app/money";
import { OperatorName } from "@/components/app/operator-badge";
import { AutoRefresh } from "@/components/admin/auto-refresh";
import { PageHeader } from "@/components/admin/page-header";
import { TimeAgo } from "@/components/admin/time-ago";
import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardDescription, CardHeader, CardPanel, CardTitle } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getOnlineSince, listDevicesWithSims } from "@/lib/admin-queries";
import { formatMsisdn } from "@/lib/phone";
import { getSettings } from "@/lib/settings";
import { AddPhoneButton, DeviceActions, SimActions } from "./number-actions";

export const metadata = { title: "Numbers & phones" };

export default async function NumbersPage() {
  const [{ devices, operators }, onlineSince, settings, h] = await Promise.all([
    listDevicesWithSims(),
    getOnlineSince(),
    getSettings(),
    headers(),
  ]);
  const serverUrl = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
  const opList = operators.map((o) => ({ code: o.code, name: o.name }));

  return (
    <>
      <AutoRefresh seconds={5} />
      <PageHeader
        title="Numbers & phones"
        description="Each Android phone runs the agent app. Its SIMs appear here automatically; set the operator and number, then activate."
        actions={<AddPhoneButton serverUrl={serverUrl} />}
      />

      {devices.length === 0 && (
        <Empty className="rounded-xl border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <SmartphoneIcon aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>No phone yet</EmptyTitle>
            <EmptyDescription>Add a phone, then type the pairing code in the agent app on it.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <AddPhoneButton serverUrl={serverUrl} />
          </EmptyContent>
        </Empty>
      )}

      {devices.map((d) => {
        const online = Boolean(d.lastSeenAt && d.lastSeenAt > onlineSince);
        return (
          <Card key={d.id}>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                {d.name}
                {!d.enabled ? (
                  <Badge variant="secondary">Disabled</Badge>
                ) : !d.tokenHash ? (
                  <Badge variant="warning">Not paired</Badge>
                ) : (
                  <Badge variant={online ? "success" : "error"}>{online ? "Online" : "Offline"}</Badge>
                )}
              </CardTitle>
              <CardDescription className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <span>
                  Last seen <TimeAgo date={d.lastSeenAt} />
                </span>
                {d.batteryPct != null && (
                  <span className="inline-flex items-center gap-1">
                    {d.charging ? <BatteryChargingIcon aria-hidden="true" className="size-4" /> : <BatteryIcon aria-hidden="true" className="size-4" />}
                    {d.batteryPct}%{d.charging ? " charging" : ""}
                  </span>
                )}
                {d.model && <span>{d.model}</span>}
                {d.androidVersion && <span>Android {d.androidVersion}</span>}
                {d.appVersion && <span>App {d.appVersion}</span>}
                {d.lastIp && <span className="font-mono">{d.lastIp}</span>}
              </CardDescription>
              <CardAction>
                <DeviceActions deviceId={d.id} enabled={d.enabled} name={d.name} serverUrl={serverUrl} />
              </CardAction>
            </CardHeader>
            <CardPanel>
              {d.sims.length === 0 ? (
                <p className="text-muted-foreground text-sm">No SIM reported yet. SIMs appear after the app's first sync.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Slot</TableHead>
                      <TableHead>Operator</TableHead>
                      <TableHead>Number</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Balance</TableHead>
                      <TableHead>Checked</TableHead>
                      <TableHead>Holding</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {d.sims.map(({ sim, tx }) => {
                      const op = operators.find((o) => o.code === sim.operatorCode);
                      const present = Boolean(sim.lastReportedAt && sim.lastReportedAt > onlineSince);
                      const failing = sim.consecutiveFailures >= settings.maxSimFailures;
                      const cooling = sim.cooldownUntil && sim.cooldownUntil > new Date();
                      return (
                        <TableRow key={sim.id}>
                          <TableCell>
                            <div className="font-medium">SIM {sim.slotIndex + 1}</div>
                            <div className="text-muted-foreground text-xs">{sim.carrierName ?? "?"}</div>
                          </TableCell>
                          <TableCell>{op ? <OperatorName name={op.name} color={op.color} /> : <span className="text-muted-foreground">—</span>}</TableCell>
                          <TableCell className="font-mono">
                            <Link href={`/admin/numbers/${sim.id}`} className="underline-offset-4 hover:underline">
                              {sim.msisdn ? formatMsisdn(sim.msisdn) : "set number"}
                            </Link>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              <Badge variant={sim.status === "active" ? "success" : sim.status === "disabled" ? "secondary" : "warning"}>{sim.status}</Badge>
                              {!present && <Badge variant="error">not reported</Badge>}
                              {failing && <Badge variant="error">USSD failing</Badge>}
                              {cooling && !tx?.id && <Badge variant="info">cooldown</Badge>}
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            <Dt millimes={sim.balanceMillimes} className="font-medium" />
                          </TableCell>
                          <TableCell className="text-muted-foreground text-xs">
                            <TimeAgo date={sim.balanceCheckedAt} />
                          </TableCell>
                          <TableCell>
                            {tx?.id ? (
                              <Link href={`/admin/sales/${tx.id}`} className="font-mono text-xs underline-offset-4 hover:underline">
                                {tx.ref}
                              </Link>
                            ) : (
                              <span className="text-muted-foreground text-xs">free</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <SimActions
                              sim={{ id: sim.id, operatorCode: sim.operatorCode, msisdn: sim.msisdn, status: sim.status, slot: sim.slotIndex + 1 }}
                              operators={opList}
                              failing={failing}
                            />
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardPanel>
          </Card>
        );
      })}
    </>
  );
}
