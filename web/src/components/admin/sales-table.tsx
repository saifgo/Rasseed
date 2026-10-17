import Link from "next/link";
import { Dt } from "@/components/app/money";
import { OperatorName } from "@/components/app/operator-badge";
import { Frame } from "@/components/ui/frame";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { listSales } from "@/lib/admin-queries";
import { formatMsisdn } from "@/lib/phone";
import { AdminStatusBadge, reviewReasons } from "./admin-status-badge";
import { TimeAgo } from "./time-ago";

type Rows = Awaited<ReturnType<typeof listSales>>;

export function SalesTable({ rows, showReason = false }: { rows: Rows; showReason?: boolean }) {
  if (rows.length === 0) {
    return <div className="rounded-xl border p-10 text-center text-muted-foreground text-sm">Nothing here.</div>;
  }
  return (
    <Frame>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Ref</TableHead>
            <TableHead>Seller</TableHead>
            <TableHead>Operator</TableHead>
            <TableHead>Sender → Number</TableHead>
            <TableHead className="text-right">Declared</TableHead>
            <TableHead className="text-right">Confirmed</TableHead>
            <TableHead className="text-right">Payout</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Created</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(({ tx, op, user }) => (
            <TableRow key={tx.id}>
              <TableCell>
                <Link href={`/admin/sales/${tx.id}`} className="font-mono font-medium underline-offset-4 hover:underline">
                  {tx.ref}
                </Link>
              </TableCell>
              <TableCell className="max-w-44 truncate" title={user.email ?? ""}>
                {user.name ?? user.email}
              </TableCell>
              <TableCell>
                <OperatorName name={op.name} color={op.color} />
              </TableCell>
              <TableCell className="font-mono text-xs">
                {formatMsisdn(tx.senderMsisdn)} → {tx.assignedMsisdn ? formatMsisdn(tx.assignedMsisdn) : "—"}
              </TableCell>
              <TableCell className="text-right">
                <Dt millimes={tx.declaredMillimes} />
              </TableCell>
              <TableCell className="text-right">
                <Dt millimes={tx.finalMillimes ?? tx.confirmedMillimes} />
              </TableCell>
              <TableCell className="text-right">
                <Dt millimes={tx.payoutNetMillimes} />
              </TableCell>
              <TableCell>
                <div className="flex flex-col gap-1">
                  <AdminStatusBadge status={tx.status} />
                  {showReason && tx.reviewReason && (
                    <span className="max-w-60 whitespace-normal text-muted-foreground text-xs">
                      {reviewReasons[tx.reviewReason] ?? tx.reviewReason}
                    </span>
                  )}
                </div>
              </TableCell>
              <TableCell className="text-muted-foreground text-xs">
                <TimeAgo date={tx.createdAt} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Frame>
  );
}
