import { AlertTriangleIcon } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Dt } from "@/components/app/money";
import { OperatorName } from "@/components/app/operator-badge";
import { Timeline } from "@/components/app/timeline";
import { AdminStatusBadge, reviewReasons } from "@/components/admin/admin-status-badge";
import { AutoRefresh } from "@/components/admin/auto-refresh";
import { PageHeader } from "@/components/admin/page-header";
import { TimeAgo } from "@/components/admin/time-ago";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardPanel, CardTitle } from "@/components/ui/card";
import { Frame } from "@/components/ui/frame";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getSaleAudit } from "@/lib/admin-queries";
import { formatRate } from "@/lib/money";
import { formatMsisdn } from "@/lib/phone";
import { getSaleView } from "@/lib/queries";
import { ResolvePanel } from "./resolve-panel";

export const metadata = { title: "Sale" };

export default async function AdminSalePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const view = await getSaleView(id, null);
  const audit = view ? await getSaleAudit(id) : null;
  if (!view || !audit) notFound();
  const { tx, user, sim } = audit;
  const canResolve = ["review", "awaiting_transfer", "verifying", "partial"].includes(tx.status);
  const live = ["queued", "assigning", "awaiting_transfer", "verifying", "partial", "review"].includes(tx.status);

  return (
    <>
      {live && <AutoRefresh seconds={3} />}
      <PageHeader
        title={`Sale ${tx.ref}`}
        description={`${user?.name ?? ""} · ${user?.email ?? ""}`}
        actions={<AdminStatusBadge status={tx.status} />}
      />

      {tx.status === "review" && (
        <Alert variant="warning">
          <AlertTriangleIcon />
          <AlertTitle>Needs your decision</AlertTitle>
          <AlertDescription>
            {reviewReasons[tx.reviewReason ?? ""] ?? tx.reviewReason}
            {" "}Check the SMS and balance readings below (and the phone itself if needed) before confirming an amount.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardDescription>
              <OperatorName name={view.operator.name} color={view.operator.color} />
            </CardDescription>
            <CardTitle className="text-2xl">
              <Dt millimes={tx.finalMillimes ?? tx.confirmedMillimes} />
            </CardTitle>
            <CardDescription>
              confirmed of <Dt millimes={tx.declaredMillimes} /> declared
            </CardDescription>
          </CardHeader>
          <CardPanel className="flex flex-col gap-2 text-sm">
            <Row label="SMS announced">
              <Dt millimes={tx.smsReceivedMillimes} />
            </Row>
            <Row label="Balance-confirmed">
              <Dt millimes={tx.confirmedMillimes} />
            </Row>
            <Row label="Baseline balance">
              <Dt millimes={tx.baselineBalanceMillimes} />
            </Row>
            <Row label="Locked rate">{formatRate(tx.rateBps)}</Row>
            <Row label="Sender">
              <span className="font-mono">{formatMsisdn(tx.senderMsisdn)}</span>
            </Row>
            <Row label="Receiving number">
              {sim ? (
                <Link className="font-mono underline-offset-4 hover:underline" href={`/admin/numbers/${sim.id}`}>
                  {tx.assignedMsisdn ? formatMsisdn(tx.assignedMsisdn) : "—"}
                </Link>
              ) : (
                "—"
              )}
            </Row>
            <Row label="Expires">{tx.expiresAt ? <TimeAgo date={tx.expiresAt} /> : "—"}</Row>
            <Row label="Partial choice">{tx.partialChoice ?? "—"}</Row>
          </CardPanel>
        </Card>

        <Card>
          <CardHeader>
            <CardDescription>{view.method ? `Legacy payout · ${view.method.name.en}` : "Credited to the seller's balance"}</CardDescription>
            <CardTitle className="text-2xl">
              <Dt millimes={view.method ? tx.payoutNetMillimes : tx.payoutGrossMillimes} />
            </CardTitle>
            <CardDescription>
              {view.method ? (
                <>
                  gross <Dt millimes={tx.payoutGrossMillimes} /> − fee <Dt millimes={tx.payoutFeeMillimes} />
                </>
              ) : (
                <>
                  <Dt millimes={tx.finalMillimes ?? 0} /> × {formatRate(tx.rateBps)} · the seller withdraws from their balance
                </>
              )}
            </CardDescription>
          </CardHeader>
          <CardPanel className="flex flex-col gap-2 text-sm">
            {!view.method && (
              <Button size="sm" variant="outline" className="self-start" render={<Link href={`/admin/users/${tx.userId}`} />}>
                Seller balance & withdrawals
              </Button>
            )}
            {Object.entries(view.payoutDetails).map(([k, v]) => (
              <Row key={k} label={view.method?.fields.find((f) => f.key === k)?.label.en ?? k}>
                <span className="select-all font-mono">{v}</span>
              </Row>
            ))}
            {view.payout && (
              <>
                <Row label="Payout status">
                  <Badge variant={view.payout.status === "paid" ? "success" : "warning"}>{view.payout.status}</Badge>
                </Row>
                {view.payout.reference && <Row label="Reference">{view.payout.reference}</Row>}
                {view.payout.hasProof && (
                  <Button variant="outline" size="sm" render={<a href={`/api/payouts/${view.payout.id}/proof`} target="_blank" rel="noreferrer" />}>
                    View proof
                  </Button>
                )}
                {view.payout.status === "pending" && (
                  <Button size="sm" render={<Link href="/admin/withdrawals?tab=legacy" />}>
                    Go to legacy payouts
                  </Button>
                )}
              </>
            )}
          </CardPanel>
        </Card>

        {canResolve ? (
          <ResolvePanel
            txId={tx.id}
            suggestedDinars={((tx.confirmedMillimes || tx.smsReceivedMillimes || tx.declaredMillimes) / 1000).toFixed(3)}
            inReview={tx.status === "review"}
          />
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Timeline</CardTitle>
            </CardHeader>
            <CardPanel>
              <Timeline events={view.events} showInternal />
            </CardPanel>
          </Card>
        )}
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="font-medium">Credits announced by SMS on this number</h2>
        <Frame>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Received</TableHead>
                <TableHead>From</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Match</TableHead>
                <TableHead>Balance verified</TableHead>
                <TableHead>SMS</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {audit.credits.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    No credit SMS.
                  </TableCell>
                </TableRow>
              )}
              {audit.credits.map(({ credit, sms }) => (
                <TableRow key={credit.id}>
                  <TableCell className="text-xs">{credit.receivedAt.toLocaleString("en-GB")}</TableCell>
                  <TableCell className="font-mono text-xs">{formatMsisdn(credit.senderMsisdn)}</TableCell>
                  <TableCell className="text-right">
                    <Dt millimes={credit.amountMillimes} />
                  </TableCell>
                  <TableCell>
                    <Badge variant={credit.txId === tx.id ? "success" : "warning"}>{credit.txId === tx.id ? credit.status : `${credit.status} (other)`}</Badge>
                  </TableCell>
                  <TableCell>{credit.balanceVerified ? <Badge variant="success">yes</Badge> : <Badge variant="secondary">no</Badge>}</TableCell>
                  <TableCell className="max-w-80 whitespace-normal text-muted-foreground text-xs">
                    {sms ? `${sms.fromAddress}: ${sms.body}` : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Frame>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-medium">Balance checks (USSD)</h2>
        <Frame>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Requested</TableHead>
                <TableHead>Purpose</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Parsed balance</TableHead>
                <TableHead>Raw reply / error</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {audit.commands.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    No balance checks yet.
                  </TableCell>
                </TableRow>
              )}
              {audit.commands.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="text-xs">{c.createdAt.toLocaleTimeString("en-GB")}</TableCell>
                  <TableCell>{c.purpose}</TableCell>
                  <TableCell>
                    <Badge variant={c.status === "succeeded" ? "success" : c.status === "failed" || c.status === "timeout" ? "error" : "info"}>
                      {c.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Dt millimes={c.parsedBalanceMillimes} />
                  </TableCell>
                  <TableCell className="max-w-96 whitespace-normal text-muted-foreground text-xs">{c.rawResponse ?? c.error ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Frame>
      </section>

      {canResolve && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Timeline</CardTitle>
          </CardHeader>
          <CardPanel>
            <Timeline events={view.events} showInternal />
          </CardPanel>
        </Card>
      )}
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
