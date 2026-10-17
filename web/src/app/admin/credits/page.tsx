import Link from "next/link";
import { Dt } from "@/components/app/money";
import { AutoRefresh } from "@/components/admin/auto-refresh";
import { PageHeader } from "@/components/admin/page-header";
import { TimeAgo } from "@/components/admin/time-ago";
import { Badge } from "@/components/ui/badge";
import { Frame } from "@/components/ui/frame";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listOpenCredits, listResolvedCredits } from "@/lib/admin-queries";
import { formatMsisdn } from "@/lib/phone";
import { CreditActions } from "./credit-actions";

export const metadata = { title: "Unmatched credits" };

export default async function CreditsPage() {
  const [open, resolved] = await Promise.all([listOpenCredits(), listResolvedCredits()]);
  return (
    <>
      <AutoRefresh seconds={10} />
      <PageHeader
        title="Unmatched credits"
        description="Transfers that arrived late (after the sale ended) or from a number that doesn't match the sale. Apply them to a sale or reject them."
      />
      {open.length === 0 ? (
        <div className="rounded-xl border p-10 text-center text-muted-foreground text-sm">No open credits.</div>
      ) : (
        <Frame>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Received</TableHead>
                <TableHead>On number</TableHead>
                <TableHead>From</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Suggested sale</TableHead>
                <TableHead>SMS</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {open.map(({ credit, sim, sms, tx }) => (
                <TableRow key={credit.id}>
                  <TableCell className="text-xs">
                    <TimeAgo date={credit.receivedAt} />
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    <Link href={`/admin/numbers/${sim.id}`} className="underline-offset-4 hover:underline">
                      {sim.msisdn ? formatMsisdn(sim.msisdn) : `slot ${sim.slotIndex + 1}`}
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{formatMsisdn(credit.senderMsisdn)}</TableCell>
                  <TableCell className="text-right">
                    <Dt millimes={credit.amountMillimes} />
                  </TableCell>
                  <TableCell>
                    <Badge variant="warning">{credit.status}</Badge>
                  </TableCell>
                  <TableCell>
                    {tx?.id ? (
                      <Link href={`/admin/sales/${tx.id}`} className="font-mono underline-offset-4 hover:underline">
                        {tx.ref}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground text-xs">{credit.note ?? "—"}</span>
                    )}
                  </TableCell>
                  <TableCell className="max-w-72 whitespace-normal text-muted-foreground text-xs">{sms?.body ?? "—"}</TableCell>
                  <TableCell className="text-right">
                    <CreditActions creditId={credit.id} suggestedRef={tx?.ref ?? ""} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Frame>
      )}

      {resolved.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="font-medium">Recently resolved</h2>
          <Frame>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Received</TableHead>
                  <TableHead>From</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Result</TableHead>
                  <TableHead>Sale / note</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {resolved.map(({ credit, tx }) => (
                  <TableRow key={credit.id}>
                    <TableCell className="text-xs">{credit.receivedAt.toLocaleString("en-GB")}</TableCell>
                    <TableCell className="font-mono text-xs">{formatMsisdn(credit.senderMsisdn)}</TableCell>
                    <TableCell className="text-right">
                      <Dt millimes={credit.amountMillimes} />
                    </TableCell>
                    <TableCell>
                      <Badge variant={credit.status === "applied" ? "success" : "secondary"}>{credit.status}</Badge>
                    </TableCell>
                    <TableCell className="text-xs">{tx?.ref ?? credit.note ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Frame>
        </section>
      )}
    </>
  );
}
