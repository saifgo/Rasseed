import Link from "next/link";
import { Secret } from "@/components/app/confidential";
import { Dt } from "@/components/app/money";
import { OperatorName } from "@/components/app/operator-badge";
import { AutoRefresh } from "@/components/admin/auto-refresh";
import { formatPrice, OrderStatusBadge } from "@/components/admin/market-badges";
import { PageHeader } from "@/components/admin/page-header";
import { TimeAgo } from "@/components/admin/time-ago";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Frame } from "@/components/ui/frame";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ORDER_STATUSES } from "@/db/schema";
import { orderPrice } from "@/lib/engine/market";
import { listMarketOrders, type OrderTab } from "@/lib/market-admin-queries";
import { cn } from "@/lib/utils";

export const metadata = { title: "Orders" };

const tabs: { value: OrderTab; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "attention", label: "Needs admin" },
  { value: "released", label: "Released" },
  { value: "cancelled", label: "Cancelled" },
  { value: "all", label: "All" },
];
const validTabs: string[] = [...tabs.map((t) => t.value), ...ORDER_STATUSES];

export default async function MarketOrdersPage({ searchParams }: { searchParams: Promise<{ tab?: string; q?: string; user?: string }> }) {
  const { tab: rawTab, q = "", user } = await searchParams;
  const tab = (validTabs.includes(rawTab ?? "") ? rawTab : "open") as OrderTab;
  const userId = user && /^[0-9a-f-]{36}$/i.test(user) ? user : undefined;
  const rows = await listMarketOrders({ tab, q: q || undefined, userId });
  const href = (t: string) => `/admin/market/orders?${new URLSearchParams({ tab: t, ...(q ? { q } : {}), ...(userId ? { user: userId } : {}) })}`;

  return (
    <>
      {(tab === "open" || tab === "attention") && <AutoRefresh seconds={15} />}
      <PageHeader
        title="Orders"
        description="Buyer orders. Disputes (admin review) come first, then orders with payment proof. Highlighted: Sarfli-listing orders waiting for you to confirm the payment."
        actions={
          <div className="flex gap-1">
            {tabs.map((t) => (
              <Button key={t.value} size="sm" variant={tab === t.value ? "secondary" : "ghost"} render={<Link href={href(t.value)} />}>
                {t.label}
              </Button>
            ))}
          </div>
        }
      />
      <form className="flex flex-wrap gap-2" action="/admin/market/orders">
        <input type="hidden" name="tab" value={tab} />
        {userId && <input type="hidden" name="user" value={userId} />}
        <Input type="search" name="q" defaultValue={q} placeholder="ref, buyer or seller" aria-label="Search orders" className="w-64" />
        <Button type="submit" variant="outline">
          Search
        </Button>
        {(q || userId) && (
          <Button variant="ghost" render={<Link href={`/admin/market/orders?tab=${tab}`} />}>
            Clear filters
          </Button>
        )}
      </form>
      {userId && <p className="text-muted-foreground text-sm">Showing orders where this user is the buyer or the seller.</p>}

      {rows.length === 0 ? (
        <div className="rounded-xl border p-10 text-center text-muted-foreground text-sm">Nothing here.</div>
      ) : (
        <Frame>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ref</TableHead>
                <TableHead>Buyer</TableHead>
                <TableHead>Seller</TableHead>
                <TableHead>Operator</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="text-right">Funded</TableHead>
                <TableHead className="text-right">Buyer pays</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Age</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ o, op, buyer, seller }) => {
                const sarfliToConfirm = !o.sellerId && o.status === "proof_uploaded";
                return (
                  <TableRow key={o.id} className={cn(sarfliToConfirm && "bg-warning/8", o.status === "admin_review" && "bg-destructive/4")}>
                    <TableCell>
                      <Link href={`/admin/market/orders/${o.id}`} className="font-mono font-medium underline-offset-4 hover:underline">
                        <Secret>{o.ref}</Secret>
                      </Link>
                    </TableCell>
                    <TableCell className="max-w-40 truncate" title={buyer.email ?? ""}>
                      <Link href={`/admin/users/${buyer.id}`} className="underline-offset-4 hover:underline">
                        {buyer.name ?? buyer.email}
                      </Link>
                    </TableCell>
                    <TableCell className="max-w-40 truncate" title={seller?.email ?? "Sarfli"}>
                      {seller ? (
                        <Link href={`/admin/users/${seller.id}`} className="underline-offset-4 hover:underline">
                          {seller.name ?? seller.email}
                        </Link>
                      ) : (
                        <Badge variant="default">Sarfli</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <OperatorName name={op.name} color={op.color} />
                      <div className="text-muted-foreground text-xs">
                        at <Secret className="tabular">{formatPrice(o.priceBps)}</Secret>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <Dt millimes={o.amountMillimes} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Dt millimes={o.fundedMillimes} className={o.fundedMillimes < o.amountMillimes ? "text-muted-foreground" : ""} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Dt millimes={orderPrice(o.amountMillimes, o.priceBps)} />
                    </TableCell>
                    <TableCell>
                      <OrderStatusBadge status={o.status} />
                      {sarfliToConfirm && <div className="mt-1 font-medium text-warning-foreground text-xs">Confirm payment</div>}
                      {o.status === "admin_review" && o.disputedBy && (
                        <div className="mt-1 text-muted-foreground text-xs">flagged by {o.disputedBy}</div>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      <TimeAgo date={o.createdAt} />
                      {o.proofUploadedAt && ["proof_uploaded", "admin_review"].includes(o.status) && (
                        <div>
                          proof <TimeAgo date={o.proofUploadedAt} />
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Frame>
      )}
    </>
  );
}
