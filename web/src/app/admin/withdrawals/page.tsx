import Link from "next/link";
import { Dt } from "@/components/app/money";
import { AutoRefresh } from "@/components/admin/auto-refresh";
import { PageHeader } from "@/components/admin/page-header";
import { TimeAgo } from "@/components/admin/time-ago";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Frame } from "@/components/ui/frame";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { WithdrawalStatus } from "@/db/schema";
import { listLegacyPayouts, listWithdrawals } from "@/lib/admin-queries";
import { AttachProofButton, MarkPaidButton, RejectButton } from "./withdrawal-actions";

export const metadata = { title: "Withdrawals" };

const tabs: { value: WithdrawalStatus | "legacy"; label: string }[] = [
  { value: "pending", label: "To pay" },
  { value: "paid", label: "Paid" },
  { value: "rejected", label: "Rejected" },
  { value: "legacy", label: "Old per-sale payouts" },
];

export default async function WithdrawalsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  const status = (tabs.find((t) => t.value === tab)?.value ?? "pending") as WithdrawalStatus | "legacy";

  const header = (
    <PageHeader
      title="Withdrawals"
      description={
        status === "pending"
          ? "Sellers asking for their balance to be sent. Oldest first. Rejecting refunds the balance."
          : status === "legacy"
            ? "Payouts from before the account balance (one per sale). Read-only history."
            : `Recently ${status}.`
      }
      actions={
        <div className="flex gap-1">
          {tabs.map((t) => (
            <Button key={t.value} size="sm" variant={status === t.value ? "secondary" : "ghost"} render={<Link href={`/admin/withdrawals?tab=${t.value}`} />}>
              {t.label}
            </Button>
          ))}
        </div>
      }
    />
  );

  if (status === "legacy") {
    const rows = await listLegacyPayouts();
    return (
      <>
        {header}
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
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Paid</TableHead>
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
                      <Dt millimes={payout.netMillimes} />
                    </TableCell>
                    <TableCell>
                      <Badge variant={payout.status === "paid" ? "success" : "warning"}>{payout.status}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      <TimeAgo date={payout.paidAt} />
                      {payout.reference && <div className="font-mono">{payout.reference}</div>}
                    </TableCell>
                    <TableCell className="text-right">
                      {payout.proofPath && (
                        <Button size="sm" variant="outline" render={<a href={`/api/payouts/${payout.id}/proof`} target="_blank" rel="noreferrer" />}>
                          Proof
                        </Button>
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

  const rows = await listWithdrawals(status);
  const total = rows.reduce((s, r) => s + r.w.netMillimes, 0);

  return (
    <>
      {status === "pending" && <AutoRefresh seconds={10} />}
      {header}
      {status === "pending" && rows.length > 0 && (
        <p className="text-sm">
          {rows.length} withdrawals · total to send <Dt millimes={total} className="font-semibold" />
        </p>
      )}
      {rows.length === 0 ? (
        <div className="rounded-xl border p-10 text-center text-muted-foreground text-sm">Nothing here.</div>
      ) : (
        <Frame>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ref</TableHead>
                <TableHead>Seller</TableHead>
                <TableHead>Method</TableHead>
                <TableHead>Pay to</TableHead>
                <TableHead className="text-right">From balance</TableHead>
                <TableHead className="text-right">Amount to send</TableHead>
                <TableHead>{status === "pending" ? "Waiting" : status === "paid" ? "Paid" : "Rejected"}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ w, method, user }) => (
                <TableRow key={w.id}>
                  <TableCell className="font-mono font-medium">{w.ref}</TableCell>
                  <TableCell className="max-w-40 truncate" title={user.email ?? ""}>
                    <Link href={`/admin/users/${user.id}`} className="underline-offset-4 hover:underline">
                      {user.name ?? user.email}
                    </Link>
                  </TableCell>
                  <TableCell>{method.name.en}</TableCell>
                  <TableCell className="text-xs">
                    {Object.entries(w.details).map(([k, v]) => (
                      <div key={k}>
                        <span className="text-muted-foreground">{method.fields.find((f) => f.key === k)?.label.en ?? k}: </span>
                        <span className="select-all font-mono">{v}</span>
                      </div>
                    ))}
                  </TableCell>
                  <TableCell className="text-right">
                    <Dt millimes={w.grossMillimes} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Dt millimes={w.netMillimes} className="font-semibold" />
                    {w.feeMillimes > 0 && (
                      <div className="text-muted-foreground text-xs">
                        fee <Dt millimes={w.feeMillimes} unit={false} />
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    <TimeAgo date={status === "pending" ? w.createdAt : status === "paid" ? w.paidAt : w.rejectedAt} />
                    {w.reference && <div className="font-mono">{w.reference}</div>}
                    {w.rejectReason && <div className="max-w-56 whitespace-normal">{w.rejectReason}</div>}
                  </TableCell>
                  <TableCell className="text-right">
                    {status === "pending" ? (
                      <div className="flex justify-end gap-2">
                        <RejectButton withdrawalId={w.id} ref_={w.ref} grossMillimes={w.grossMillimes} />
                        <MarkPaidButton withdrawalId={w.id} ref_={w.ref} netMillimes={w.netMillimes} />
                      </div>
                    ) : status === "paid" ? (
                      w.proofPath ? (
                        <Button size="sm" variant="outline" render={<a href={`/api/withdrawals/${w.id}/proof`} target="_blank" rel="noreferrer" />}>
                          Proof
                        </Button>
                      ) : (
                        <AttachProofButton withdrawalId={w.id} />
                      )
                    ) : null}
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
