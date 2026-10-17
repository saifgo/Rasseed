import { BatteryChargingIcon, BatteryIcon, WifiIcon, WifiOffIcon } from "lucide-react";
import Link from "next/link";
import { Dt } from "@/components/app/money";
import { OperatorName } from "@/components/app/operator-badge";
import { AutoRefresh } from "@/components/admin/auto-refresh";
import { PageHeader } from "@/components/admin/page-header";
import { SalesTable } from "@/components/admin/sales-table";
import { StatCard } from "@/components/admin/stat-card";
import { TimeAgo } from "@/components/admin/time-ago";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardPanel, CardTitle } from "@/components/ui/card";
import { devicesHealth, getAdminCounts, getOverview, listSales } from "@/lib/admin-queries";
import { formatRate } from "@/lib/money";
import { listOperators } from "@/lib/queries";

export const metadata = { title: "Overview" };

export default async function AdminOverview() {
  const [overview, counts, active, ops, phones] = await Promise.all([
    getOverview(),
    getAdminCounts(),
    listSales({ status: "active", limit: 20 }),
    listOperators(),
    devicesHealth(),
  ]);
  return (
    <>
      <AutoRefresh seconds={5} />
      <PageHeader title="Overview" description="Live view of sales, payouts and phones." />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Active sales" value={overview.activeSales} hint="Queued, waiting for transfer or verifying" />
        <StatCard
          label="Review queue"
          value={counts.review}
          hint={
            counts.review > 0 ? (
              <Link className="underline" href="/admin/review">
                Open review queue
              </Link>
            ) : (
              "Nothing to review"
            )
          }
        />
        <StatCard
          label="Payouts to send"
          value={<Dt millimes={overview.pendingPayouts.totalMillimes} />}
          hint={`${overview.pendingPayouts.count} pending`}
        />
        <StatCard
          label="Completed today"
          value={<Dt millimes={overview.today.creditMillimes} />}
          hint={
            <>
              {overview.today.count} sales · payout <Dt millimes={overview.today.payoutMillimes} />
            </>
          }
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Credit held per operator</CardTitle>
          </CardHeader>
          <CardPanel className="flex flex-col gap-3">
            {ops.map((op) => {
              const b = overview.balances.find((x) => x.operatorCode === op.code);
              return (
                <div key={op.code} className="flex items-center justify-between gap-3 text-sm">
                  <OperatorName name={op.name} color={op.color} />
                  <span className="flex items-center gap-3">
                    <span className="text-muted-foreground text-xs">
                      {b?.sims ?? 0} SIM · rate {formatRate(op.rateBps)}
                    </span>
                    <Dt millimes={b?.totalMillimes ?? 0} className="font-medium" />
                  </span>
                </div>
              );
            })}
          </CardPanel>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Phones</CardTitle>
          </CardHeader>
          <CardPanel className="flex flex-col gap-3">
            {phones.length === 0 && (
              <div className="flex items-center justify-between text-muted-foreground text-sm">
                No phone paired yet.
                <Button size="sm" variant="outline" render={<Link href="/admin/numbers" />}>
                  Pair a phone
                </Button>
              </div>
            )}
            {phones.map((d) => (
              <div key={d.id} className="flex items-center justify-between gap-3 text-sm">
                <span className="flex items-center gap-2">
                  {d.online ? (
                    <WifiIcon aria-hidden="true" className="size-4 text-success" />
                  ) : (
                    <WifiOffIcon aria-hidden="true" className="size-4 text-destructive" />
                  )}
                  {d.name}
                  <Badge variant={d.online ? "success" : "error"}>{d.online ? "Online" : "Offline"}</Badge>
                </span>
                <span className="flex items-center gap-3 text-muted-foreground text-xs">
                  {d.batteryPct != null && (
                    <span className="flex items-center gap-1">
                      {d.charging ? (
                        <BatteryChargingIcon aria-hidden="true" className="size-4" />
                      ) : (
                        <BatteryIcon aria-hidden="true" className="size-4" />
                      )}
                      {d.batteryPct}%
                    </span>
                  )}
                  <TimeAgo date={d.lastSeenAt} />
                </span>
              </div>
            ))}
          </CardPanel>
        </Card>
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="font-medium">Active sales</h2>
        <SalesTable rows={active} />
      </div>
    </>
  );
}
