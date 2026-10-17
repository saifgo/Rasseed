import Link from "next/link";
import { Dt } from "@/components/app/money";
import { AutoRefresh } from "@/components/admin/auto-refresh";
import { PageHeader } from "@/components/admin/page-header";
import { TimeAgo } from "@/components/admin/time-ago";
import { Button } from "@/components/ui/button";
import { Frame } from "@/components/ui/frame";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listPayouts } from "@/lib/admin-queries";
import { AttachProofButton, MarkPaidButton } from "./payout-actions";

export const metadata = { title: "Payouts" };

export default async function PayoutsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  const status = tab === "paid" ? "paid" : "pending";
  const rows = await listPayouts(status);
  const total = rows.reduce((s, r) => s + r.payout.netMillimes, 0);

  return (
    <>
      {status === "pending" && <AutoRefresh seconds={10} />}
      <PageHeader
        title="Payouts"
        description={status === "pending" ? "Confirmed sales waiting for you to send the money. Oldest first." : "Recently paid."}
        actions={
          <div className="flex gap-1">
            <Button size="sm" variant={status === "pending" ? "secondary" : "ghost"} render={<Link href="/admin/payouts" />}>
              To pay
            </Button>
            <Button size="sm" variant={status === "paid" ? "secondary" : "ghost"} render={<Link href="/admin/payouts?tab=paid" />}>
              Paid
            </Button>
          </div>
        }
      />
      {status === "pending" && rows.length > 0 && (
        <p className="text-sm">
          {rows.length} payouts · total <Dt millimes={total} className="font-semibold" />
        </p>
      )}
      {rows.length === 0 ? (
        <div className="rounded-xl border p-10 text-center text-muted-foreground text-sm">Nothing here.</div>
      ) : (
        <Frame>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Sale</TableHead>
                <TableHead>Seller</TableHead>
                <TableHead>Method</TableHead>
                <TableHead>Pay to</TableHead>
                <TableHead className="text-right">Credit</TableHead>
                <TableHead className="text-right">Amount to send</TableHead>
                <TableHead>{status === "pending" ? "Waiting" : "Paid"}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ payout, tx, method, user }) => (
                <TableRow key={payout.id}>
                  <TableCell>
                    <Link href={`/admin/sales/${tx.id}`} className="font-mono font-medium underline-offset-4 hover:underline">
                      {tx.ref}
                    </Link>
                  </TableCell>
                  <TableCell className="max-w-40 truncate" title={user.email ?? ""}>
                    {user.name ?? user.email}
                  </TableCell>
                  <TableCell>{method.name.en}</TableCell>
                  <TableCell className="text-xs">
                    {Object.entries(payout.details).map(([k, v]) => (
                      <div key={k}>
                        <span className="text-muted-foreground">{method.fields.find((f) => f.key === k)?.label.en ?? k}: </span>
                        <span className="select-all font-mono">{v}</span>
                      </div>
                    ))}
                  </TableCell>
                  <TableCell className="text-right">
                    <Dt millimes={tx.finalMillimes} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Dt millimes={payout.netMillimes} className="font-semibold" />
                    {payout.feeMillimes > 0 && (
                      <div className="text-muted-foreground text-xs">
                        fee <Dt millimes={payout.feeMillimes} unit={false} />
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    <TimeAgo date={status === "pending" ? payout.createdAt : payout.paidAt} />
                    {payout.reference && <div className="font-mono">{payout.reference}</div>}
                  </TableCell>
                  <TableCell className="text-right">
                    {status === "pending" ? (
                      <MarkPaidButton payoutId={payout.id} ref_={tx.ref} netMillimes={payout.netMillimes} />
                    ) : payout.proofPath ? (
                      <Button size="sm" variant="outline" render={<a href={`/api/payouts/${payout.id}/proof`} target="_blank" rel="noreferrer" />}>
                        Proof
                      </Button>
                    ) : (
                      <AttachProofButton payoutId={payout.id} />
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Frame>
      )}
    </>
  );
}
