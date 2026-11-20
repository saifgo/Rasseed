import { AlertTriangleIcon, StarIcon } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Secret } from "@/components/app/confidential";
import { Dt } from "@/components/app/money";
import { OperatorName } from "@/components/app/operator-badge";
import { AdminStatusBadge } from "@/components/admin/admin-status-badge";
import { AutoRefresh } from "@/components/admin/auto-refresh";
import { bucketLabels, formatPrice, OrderStatusBadge } from "@/components/admin/market-badges";
import { PageHeader } from "@/components/admin/page-header";
import { TimeAgo } from "@/components/admin/time-ago";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardPanel, CardTitle } from "@/components/ui/card";
import { Frame } from "@/components/ui/frame";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { OPEN_ORDER_STATUSES } from "@/db/schema";
import { orderCommission, orderPrice } from "@/lib/engine/market";
import { getMarketOrderDetail } from "@/lib/market-admin-queries";
import { formatDinars, formatRate } from "@/lib/money";
import { requireStaff } from "@/lib/session";
import { OrderDecisionPanel } from "./order-actions";

export const metadata = { title: "Order" };

const proofUrl = (orderId: string, proofId: string) => `/api/orders/${orderId}/proofs/${proofId}`;

export default async function AdminOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireStaff();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const d = await getMarketOrderDetail(me.id, id);
  if (!d) notFound();
  const { order: o, buyer, seller, operator, events, proofs, transfers, entries } = d;
  const sarfli = !o.sellerId;
  const open = OPEN_ORDER_STATUSES.includes(o.status);
  const canRelease = o.status === "proof_uploaded" || o.status === "admin_review";
  const pay = orderPrice(o.amountMillimes, o.priceBps);
  const commission = o.commissionMillimes ?? orderCommission(o.amountMillimes, o.commissionBps);
  const toBuyer = o.releasedMillimes ?? o.amountMillimes - commission;
  const sellerName = seller ? (seller.name ?? seller.email ?? "seller") : "Sarfli";

  const releaseText = `${formatDinars(toBuyer)} DT of ${operator.name} credit go to the buyer's balance, ${formatDinars(commission)} DT commission to Sarfli. This cannot be undone.`;
  const cancelText = sarfli
    ? `The ${formatDinars(o.fundedMillimes)} DT held for this order go back to Sarfli credit. The buyer gets nothing.`
    : o.fundedMillimes > 0
      ? `The ${formatDinars(o.fundedMillimes)} DT already on Sarfli's SIMs for this order wait for the seller's choice: keep as stock or sell to Sarfli. The buyer gets nothing.`
      : "No credit is held for this order. The buyer gets nothing.";

  return (
    <>
      {open && <AutoRefresh seconds={15} />}
      <PageHeader
        title={
          <>
            Order <Secret>{o.ref}</Secret>
          </>
        }
        description={`${buyer?.name ?? buyer?.email ?? "buyer"} buys from ${sellerName}`}
        actions={
          <div className="flex items-center gap-2">
            {sarfli && <Badge>Sarfli listing</Badge>}
            <OrderStatusBadge status={o.status} />
          </div>
        }
      />

      {o.status === "admin_review" && (
        <Alert variant="error">
          <AlertTriangleIcon />
          <AlertTitle>Dispute · flagged by the {o.disputedBy ?? "?"}</AlertTitle>
          <AlertDescription>
            {o.disputeReason ? <span className="whitespace-pre-wrap">{o.disputeReason}</span> : "No reason given."}
            {o.disputedBy === "seller" ? " The seller says he was not paid." : o.disputedBy === "buyer" ? " The buyer paid and the seller does not answer." : ""}
          </AlertDescription>
        </Alert>
      )}
      {sarfli && o.status === "proof_uploaded" && (
        <Alert variant="warning">
          <AlertTriangleIcon />
          <AlertTitle>Waiting for you to confirm the payment</AlertTitle>
          <AlertDescription>
            This order is from Sarfli's own listing. Check that <Dt millimes={pay} className="font-semibold" /> reached Sarfli, then release.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardDescription>
              <OperatorName name={operator.name} color={operator.color} />
            </CardDescription>
            <CardTitle className="text-2xl">
              <Dt millimes={o.amountMillimes} />
            </CardTitle>
            <CardDescription>
              funded <Dt millimes={o.fundedMillimes} /> · requested <Dt millimes={o.requestedMillimes} />
            </CardDescription>
          </CardHeader>
          <CardPanel className="flex flex-col gap-2 text-sm">
            <Row label="Price">
              <Secret className="tabular">{formatPrice(o.priceBps)}</Secret>
            </Row>
            <Row label="Buyer pays seller">
              <Dt millimes={pay} />
            </Row>
            <Row label={`Commission (${formatRate(o.commissionBps)})`}>
              <Dt millimes={commission} />
            </Row>
            <Row label={o.releasedMillimes != null ? "Released to buyer" : "Buyer would receive"}>
              <Dt millimes={toBuyer} />
            </Row>
            {o.excessMillimes > 0 && (
              <Row label="Excess waiting for buyer">
                <Dt millimes={o.excessMillimes} />
              </Row>
            )}
            {o.status === "cancelled" && (
              <>
                <Row label="Cancelled by">{o.cancelledBy ?? "—"}</Row>
                {o.cancelReason && <Row label="Reason">{o.cancelReason}</Row>}
                <Row label="Left for seller's choice">
                  <Dt millimes={o.leftoverMillimes} />
                </Row>
                <Row label="Seller's choice">{o.leftoverMillimes > 0 ? (o.leftoverChoice ?? "not chosen yet") : "—"}</Row>
                <Row label="Buyer bad mark">{o.buyerBadMark ? <Badge variant="error">yes</Badge> : "no"}</Row>
              </>
            )}
            {o.adminNote && <Row label="Admin note">{o.adminNote}</Row>}
            <Row label="Placed">
              <TimeAgo date={o.createdAt} />
            </Row>
            <Row label="Funded">
              <TimeAgo date={o.fundedAt} />
            </Row>
            <Row label="Proof uploaded">
              <TimeAgo date={o.proofUploadedAt} />
            </Row>
            <Row label="Completed">
              <TimeAgo date={o.completedAt} />
            </Row>
          </CardPanel>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">People</CardTitle>
          </CardHeader>
          <CardPanel className="flex flex-col gap-4 text-sm">
            <div className="flex flex-col gap-1">
              <span className="text-muted-foreground text-xs">Buyer</span>
              {buyer && (
                <Link href={`/admin/users/${buyer.id}`} className="font-medium underline-offset-4 hover:underline">
                  {buyer.name ?? buyer.email}
                </Link>
              )}
              <span className="text-muted-foreground text-xs">{buyer?.email}</span>
              <span>
                Bad marks: <Badge variant={d.buyerBadMarks > 0 ? "error" : "secondary"}>{d.buyerBadMarks}</Badge>
              </span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-muted-foreground text-xs">Seller</span>
              {seller ? (
                <>
                  <Link href={`/admin/users/${seller.id}`} className="font-medium underline-offset-4 hover:underline">
                    {sellerName}
                  </Link>
                  <span className="text-muted-foreground text-xs">{seller.email}</span>
                </>
              ) : (
                <span className="font-medium">Sarfli (own listing)</span>
              )}
              <Rating rating={d.sellerRating} />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-muted-foreground text-xs">Payment instructions on the order</span>
              <Secret className="whitespace-pre-wrap">{o.paymentInfo || "—"}</Secret>
            </div>
          </CardPanel>
        </Card>

        {open ? (
          <OrderDecisionPanel orderId={o.id} canRelease={canRelease} sarfli={sarfli} releaseText={releaseText} cancelText={cancelText} />
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Closed</CardTitle>
              <CardDescription>This order is {o.status}. No action is possible.</CardDescription>
            </CardHeader>
          </Card>
        )}
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="font-medium">Payment proof</h2>
        {proofs.length === 0 ? (
          <div className="rounded-xl border p-8 text-center text-muted-foreground text-sm">No proof uploaded.</div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {proofs.map((p) => (
              <Card key={p.id}>
                <CardPanel className="flex flex-col gap-2">
                  {p.mime.startsWith("image/") ? (
                    <a href={proofUrl(o.id, p.id)} target="_blank" rel="noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element -- private, auth-checked file */}
                      <img src={proofUrl(o.id, p.id)} alt="Payment proof" className="max-h-80 w-full rounded-md border object-contain" />
                    </a>
                  ) : (
                    <Button variant="outline" render={<a href={proofUrl(o.id, p.id)} target="_blank" rel="noreferrer" />}>
                      Open PDF
                    </Button>
                  )}
                  <span className="text-muted-foreground text-xs">
                    Uploaded <TimeAgo date={p.createdAt} />
                  </span>
                </CardPanel>
              </Card>
            ))}
          </div>
        )}
      </section>

      {transfers.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="font-medium">Seller transfers deposited to this order</h2>
          <Frame>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Sale</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Declared</TableHead>
                  <TableHead className="text-right">Confirmed</TableHead>
                  <TableHead>Started</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transfers.map((tx) => (
                  <TableRow key={tx.id}>
                    <TableCell>
                      <Link href={`/admin/sales/${tx.id}`} className="font-mono underline-offset-4 hover:underline">
                        <Secret>{tx.ref}</Secret>
                      </Link>
                    </TableCell>
                    <TableCell>
                      <AdminStatusBadge status={tx.status} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Dt millimes={tx.declaredMillimes} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Dt millimes={tx.finalMillimes ?? tx.confirmedMillimes} />
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      <TimeAgo date={tx.createdAt} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Frame>
        </section>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <section className="flex flex-col gap-3">
          <h2 className="font-medium">Timeline</h2>
          <Frame>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Event</TableHead>
                  <TableHead>By</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="text-xs">{e.createdAt.toLocaleString("en-GB")}</TableCell>
                    <TableCell>
                      {e.type.replaceAll("_", " ")}
                      <EventData data={e.data} />
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">{e.actor}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Frame>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="font-medium">Ledger movements</h2>
          {entries.length === 0 ? (
            <div className="rounded-xl border p-8 text-center text-muted-foreground text-sm">No credit moved yet.</div>
          ) : (
            <Frame>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Movement</TableHead>
                    <TableHead>Bucket</TableHead>
                    <TableHead className="text-right">Credit</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map(({ e, owner }) => (
                    <TableRow key={e.id}>
                      <TableCell className="text-xs">{e.createdAt.toLocaleString("en-GB")}</TableCell>
                      <TableCell className="text-xs">
                        {e.kind.replaceAll("_", " ")}
                        {e.note && <div className="max-w-56 whitespace-normal text-muted-foreground">{e.note}</div>}
                      </TableCell>
                      <TableCell className="text-xs">
                        {bucketLabels[e.bucket] ?? e.bucket}
                        {owner?.email && <div className="text-muted-foreground">{owner.name ?? owner.email}</div>}
                      </TableCell>
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
      </div>
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  );
}

function Rating({ rating }: { rating: { avg: number; count: number } | null }) {
  if (!rating) return <span className="text-muted-foreground text-xs">No rating yet</span>;
  return (
    <span className="flex items-center gap-1 text-sm">
      <StarIcon aria-hidden="true" className="size-4 fill-warning text-warning" />
      {rating.avg.toFixed(1)} <span className="text-muted-foreground text-xs">({rating.count})</span>
    </span>
  );
}

/** Event payload, amounts in DT. */
function EventData({ data }: { data: Record<string, unknown> }) {
  const parts = Object.entries(data).filter(([, v]) => v != null && v !== "");
  if (parts.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-x-3 text-muted-foreground text-xs">
      {parts.map(([k, v]) => (
        <span key={k}>
          {k.replace(/Millimes$/, "")}:{" "}
          {k.endsWith("Millimes") && typeof v === "number" ? <Dt millimes={v} unit={false} /> : k === "priceBps" && typeof v === "number" ? formatPrice(v) : String(v)}
        </span>
      ))}
    </div>
  );
}
