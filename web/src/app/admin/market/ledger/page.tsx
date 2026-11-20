import { AlertTriangleIcon } from "lucide-react";
import Link from "next/link";
import { Dt } from "@/components/app/money";
import { OperatorName } from "@/components/app/operator-badge";
import { bucketLabels } from "@/components/admin/market-badges";
import { PageHeader } from "@/components/admin/page-header";
import { TimeAgo } from "@/components/admin/time-ago";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardHeader, CardPanel, CardTitle } from "@/components/ui/card";
import { Frame } from "@/components/ui/frame";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getReconciliation, listRecentMovements } from "@/lib/market-admin-queries";
import { requireStaff } from "@/lib/session";
import { sarfliSpendable } from "@/lib/engine/sarfli-credit";
import { cn } from "@/lib/utils";
import { Secret } from "@/components/app/confidential";
import { AdjustSarfliCreditForm } from "./ledger-forms";

export const metadata = { title: "Credit ledger" };

export default async function LedgerPage() {
  const me = await requireStaff();
  const [rows, movements] = await Promise.all([getReconciliation(), listRecentMovements()]);
  const spendable = await sarfliSpendable(rows.map((r) => r.code));
  const short = rows.filter((r) => r.simMillimes < r.customer);

  return (
    <>
      <PageHeader
        title="Credit ledger"
        description="Daily reconciliation: the real credit on Sarfli's SIMs must equal what customers own plus Sarfli's own credit. Investigate any gap before releasing more orders."
      />

      {short.length > 0 && (
        <Alert variant="error">
          <AlertTriangleIcon />
          <AlertTitle>SIM credit is below what customers own</AlertTitle>
          <AlertDescription>
            {short.map((r) => r.name).join(", ")}: the SIMs hold less than order funds + seller stock + buyer balances + recharges. Do not
            sell or move Sarfli credit for these operators until this is explained.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        {rows.map((r) => (
          <Card key={r.code} className={cn(r.simMillimes < r.customer && "border-destructive/48")}>
            <CardHeader>
              <CardDescription>
                <OperatorName name={r.name} color={r.color} />
              </CardDescription>
              <CardTitle className="text-2xl">
                <Dt millimes={r.simMillimes} />
              </CardTitle>
              <CardDescription>
                on <Secret>{r.sims}</Secret> SIM{r.sims === 1 ? "" : "s"} · oldest check <TimeAgo date={r.oldestCheck} />
                {r.unreadSims > 0 && <> · {r.unreadSims} never read</>}
              </CardDescription>
            </CardHeader>
            <CardPanel className="flex flex-col gap-2 text-sm">
              <Line label="Order funds" value={r.order} />
              <Line label="Seller stock" value={r.stock} />
              <Line label="Buyer balances" value={r.buyers} />
              <Line label="Recharges in progress" value={r.recharge} />
              <Line label="Customer-owned credit" value={r.customer} strong />
              <Line label="Sarfli credit (tracked)" value={r.sarfli} />
              <Line label="Admins can spend now (POS)" value={spendable[r.code] ?? 0} strong />
              <div className="flex items-center justify-between gap-4 border-t pt-2">
                <span className="font-medium">Gap (SIMs − ledger)</span>
                {r.gap === 0 ? (
                  <Badge variant="success">
                    <Dt millimes={0} unit={false} />
                  </Badge>
                ) : (
                  <Badge variant={r.gap < 0 ? "error" : "warning"} size="lg">
                    {r.gap > 0 ? "+" : ""}
                    <Dt millimes={r.gap} unit={false} />
                  </Badge>
                )}
              </div>
            </CardPanel>
          </Card>
        ))}
      </div>
      <p className="text-muted-foreground text-xs">
        SIM credit is the last balance read of every configured SIM; re-check the SIMs before deciding. Short gaps are normal while a sale or
        a recharge is in progress (credit already moved on the SIM, not yet in the ledger), and existing sell-to-Sarfli sales from before the
        ledger only count once the opening balance is entered.
      </p>

      {me.role === "admin" && <AdjustSarfliCreditForm operators={rows.map((r) => ({ value: r.code, label: r.name }))} />}

      <section className="flex flex-col gap-3">
        <h2 className="font-medium">Recent movements</h2>
        {movements.length === 0 ? (
          <div className="rounded-xl border p-8 text-center text-muted-foreground text-sm">No movement yet.</div>
        ) : (
          <Frame>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Movement</TableHead>
                  <TableHead>Operator</TableHead>
                  <TableHead>Legs</TableHead>
                  <TableHead>By</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {movements.map((legs) => {
                  const first = legs[0];
                  const order = legs.find((l) => l.order?.id)?.order;
                  const recharge = legs.find((l) => l.recharge?.ref)?.recharge;
                  return (
                    <TableRow key={first.e.movementId}>
                      <TableCell className="text-xs">
                        <TimeAgo date={first.e.createdAt} />
                      </TableCell>
                      <TableCell className="max-w-64 whitespace-normal text-xs">
                        <span className="font-medium">{first.e.kind.replaceAll("_", " ")}</span>
                        {order?.id && (
                          <div>
                            <Link href={`/admin/market/orders/${order.id}`} className="font-mono underline-offset-4 hover:underline">
                              <Secret>{order.ref}</Secret>
                            </Link>
                          </div>
                        )}
                        {recharge?.ref && (
                          <div className="font-mono">
                            <Secret>{recharge.ref}</Secret>
                          </div>
                        )}
                        {first.e.note && <div className="text-muted-foreground">{first.e.note}</div>}
                      </TableCell>
                      <TableCell className="text-xs">{first.e.operatorCode}</TableCell>
                      <TableCell className="text-xs">
                        <div className="flex flex-col gap-0.5">
                          {legs.map(({ e, owner }) => (
                            <span key={e.id} className="flex justify-between gap-4">
                              <span>
                                {bucketLabels[e.bucket] ?? e.bucket}
                                {owner?.email && <span className="text-muted-foreground"> · {owner.name ?? owner.email}</span>}
                              </span>
                              <Dt
                                millimes={e.amountMillimes}
                                unit={false}
                                className={e.amountMillimes < 0 ? "text-destructive-foreground" : "text-success-foreground"}
                              />
                            </span>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-xs">{first.by?.email ?? "system"}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Frame>
        )}
      </section>
    </>
  );
}

function Line({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className={cn("flex items-center justify-between gap-4", strong && "font-medium")}>
      <span className={strong ? "" : "text-muted-foreground"}>{label}</span>
      <Dt millimes={value} />
    </div>
  );
}
