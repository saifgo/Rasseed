import Link from "next/link";
import { notFound } from "next/navigation";
import { Dt } from "@/components/app/money";
import { PageHeader } from "@/components/admin/page-header";
import { SalesTable } from "@/components/admin/sales-table";
import { TimeAgo } from "@/components/admin/time-ago";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardDescription, CardHeader, CardPanel, CardTitle } from "@/components/ui/card";
import { Frame } from "@/components/ui/frame";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { WalletEntryKind, WithdrawalStatus } from "@/db/schema";
import { OperatorName } from "@/components/app/operator-badge";
import { getUserDetail, listSales } from "@/lib/admin-queries";
import { getUserMarket } from "@/lib/market-admin-queries";
import { listOperators } from "@/lib/queries";
import { requireStaff } from "@/lib/session";
import { AdjustBalanceButton, BlockButton, MarketplaceAccessSwitch, RoleSelect } from "../user-actions";
import { Secret } from "@/components/app/confidential";

export const metadata = { title: "User" };

const kindLabel: Record<WalletEntryKind, string> = {
  sale: "Sale credited",
  withdrawal: "Withdrawal requested",
  withdrawal_refund: "Withdrawal rejected — refund",
  adjustment: "Manual adjustment",
  stock_sale: "Credit sold to Sarfli (marketplace stock)",
};
const statusVariant: Record<WithdrawalStatus, "warning" | "success" | "error"> = { pending: "warning", paid: "success", rejected: "error" };

export default async function AdminUserPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireStaff();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const detail = await getUserDetail(id);
  if (!detail) notFound();
  const { user, entries, withdrawals, balanceMillimes } = detail;
  const [sales, market, ops] = await Promise.all([listSales({ userId: user.id, limit: 50 }), getUserMarket(user.id), listOperators()]);
  const admin = me.role === "admin";
  const self = user.id === me.id;

  return (
    <>
      <PageHeader
        title={user.name ?? user.email ?? "User"}
        description={user.email ?? ""}
        actions={
          <div className="flex items-center gap-2">
            {user.blocked && <Badge variant="error">Blocked</Badge>}
            {admin ? <RoleSelect userId={user.id} role={user.role} disabled={self} /> : <Badge variant="info">{user.role}</Badge>}
            <AdjustBalanceButton userId={user.id} name={user.name ?? user.email ?? "user"} />
            {admin && <BlockButton userId={user.id} blocked={user.blocked} disabled={self} />}
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <CardDescription>Available balance</CardDescription>
            <CardTitle className="text-2xl">
              <Dt millimes={balanceMillimes} />
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Pending withdrawals</CardDescription>
            <CardTitle className="text-2xl">
              <Dt millimes={withdrawals.filter((w) => w.w.status === "pending").reduce((s, w) => s + w.w.grossMillimes, 0)} />
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Joined</CardDescription>
            <CardTitle className="text-2xl">
              <TimeAgo date={user.createdAt} />
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Marketplace</CardTitle>
          <CardDescription>
            Credit this user owns on Sarfli's SIMs, per operator. Bad marks: <Badge variant={market.badMarks > 0 ? "error" : "secondary"}>{market.badMarks}</Badge>
            {" · "}Seller rating: {market.rating ? `★ ${market.rating.avg.toFixed(1)} (${market.rating.count})` : "none yet"}
          </CardDescription>
          <CardAction>
            {admin ? (
              <MarketplaceAccessSwitch userId={user.id} access={user.marketplaceAccess} label="Marketplace access" />
            ) : (
              <Badge variant={user.marketplaceAccess ? "success" : "secondary"}>{user.marketplaceAccess ? "Has access" : "No access"}</Badge>
            )}
          </CardAction>
        </CardHeader>
        <CardPanel className="flex flex-col gap-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Operator</TableHead>
                <TableHead className="text-right">Buyer balance</TableHead>
                <TableHead className="text-right">Seller stock</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ops.map((op) => (
                <TableRow key={op.code}>
                  <TableCell>
                    <OperatorName name={op.name} color={op.color} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Dt millimes={market.buyer[op.code] ?? 0} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Dt millimes={market.stock[op.code] ?? 0} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" render={<Link href={`/admin/market/orders?tab=all&user=${user.id}`} />}>
              Orders ({market.buyerOrders} as buyer · {market.sellerOrders} as seller)
            </Button>
            <Button size="sm" variant="outline" render={<Link href={`/admin/market/recharges?tab=all&user=${user.id}`} />}>
              Recharges ({market.recharges})
            </Button>
          </div>
        </CardPanel>
      </Card>

      <section className="flex flex-col gap-3">
        <h2 className="font-medium">Withdrawals</h2>
        {withdrawals.length === 0 ? (
          <div className="rounded-xl border p-8 text-center text-muted-foreground text-sm">No withdrawal yet.</div>
        ) : (
          <Frame>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ref</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead className="text-right">From balance</TableHead>
                  <TableHead className="text-right">Sent</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Requested</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {withdrawals.map(({ w, method }) => (
                  <TableRow key={w.id}>
                    <TableCell className="font-mono">
                      <Secret>{w.ref}</Secret>
                    </TableCell>
                    <TableCell>
                      {method.name.en}
                      <div className="font-mono text-muted-foreground text-xs">
                        <Secret dir="ltr">{Object.values(w.details).join(" · ")}</Secret>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <Dt millimes={w.grossMillimes} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Dt millimes={w.sendMillimes} />
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant[w.status]}>{w.status}</Badge>
                      {w.reference && (
                        <div className="font-mono text-xs">
                          <Secret>{w.reference}</Secret>
                        </div>
                      )}
                      {w.rejectReason && <div className="text-muted-foreground text-xs">{w.rejectReason}</div>}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      <TimeAgo date={w.createdAt} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Frame>
        )}
        {withdrawals.some((w) => w.w.status === "pending") && (
          <Button size="sm" variant="outline" className="self-start" render={<Link href="/admin/withdrawals" />}>
            Go to withdrawals
          </Button>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-medium">Balance statement</h2>
        {entries.length === 0 ? (
          <div className="rounded-xl border p-8 text-center text-muted-foreground text-sm">No movement yet.</div>
        ) : (
          <Frame>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>What</TableHead>
                  <TableHead>Link</TableHead>
                  <TableHead>By</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map(({ e, tx, w, by }) => (
                  <TableRow key={e.id}>
                    <TableCell className="text-muted-foreground text-xs">
                      <TimeAgo date={e.createdAt} />
                    </TableCell>
                    <TableCell>
                      {kindLabel[e.kind]}
                      {e.note && <div className="max-w-80 whitespace-normal text-muted-foreground text-xs">{e.note}</div>}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {e.txId && tx ? (
                        <Link href={`/admin/sales/${e.txId}`} className="underline-offset-4 hover:underline">
                          <Secret>{tx.ref}</Secret>
                        </Link>
                      ) : w?.ref ? (
                        <Secret>{w.ref}</Secret>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">{by?.email ?? "system"}</TableCell>
                    <TableCell className="text-right">
                      <Dt millimes={e.amountMillimes} className={e.amountMillimes < 0 ? "text-destructive-foreground" : "text-success-foreground"} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Frame>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-medium">Latest sales</h2>
        <SalesTable rows={sales} />
      </section>
    </>
  );
}
