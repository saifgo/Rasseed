import Link from "next/link";
import { notFound } from "next/navigation";
import { Dt } from "@/components/app/money";
import { AutoRefresh } from "@/components/admin/auto-refresh";
import { PageHeader } from "@/components/admin/page-header";
import { Badge } from "@/components/ui/badge";
import { Frame } from "@/components/ui/frame";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getSimHistory } from "@/lib/admin-queries";
import { formatMsisdn } from "@/lib/phone";

export const metadata = { title: "SIM history" };

export default async function SimHistoryPage({ params }: { params: Promise<{ simId: string }> }) {
  const { simId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(simId)) notFound();
  const data = await getSimHistory(simId);
  if (!data) notFound();
  const { sim, device, snapshots, commands, sms, credits } = data;

  return (
    <>
      <AutoRefresh seconds={10} />
      <PageHeader
        title={sim.msisdn ? formatMsisdn(sim.msisdn) : `SIM ${sim.slotIndex + 1}`}
        description={`${device?.name ?? "?"} · slot ${sim.slotIndex + 1} · ${sim.carrierName ?? ""}`}
        actions={<Dt millimes={sim.balanceMillimes} className="font-semibold text-2xl" />}
      />

      <section className="flex flex-col gap-3">
        <h2 className="font-medium">Balance history</h2>
        <p className="text-muted-foreground text-sm">
          “Unexplained” is the balance change that no credit SMS accounts for since the previous reading. It should be 0; a
          positive value means credit arrived without an SMS, a negative value means the balance went down.
        </p>
        <Frame>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead className="text-right">Balance</TableHead>
                <TableHead className="text-right">Unexplained</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {snapshots.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="text-xs">{s.takenAt.toLocaleString("en-GB")}</TableCell>
                  <TableCell className="text-right">
                    <Dt millimes={s.balanceMillimes} />
                  </TableCell>
                  <TableCell className="text-right">
                    {s.discrepancyMillimes == null ? (
                      "—"
                    ) : s.discrepancyMillimes === 0 ? (
                      <span className="text-muted-foreground">0</span>
                    ) : (
                      <Badge variant="warning">
                        <Dt millimes={s.discrepancyMillimes} unit={false} />
                      </Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Frame>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="flex flex-col gap-3">
          <h2 className="font-medium">Credits received</h2>
          <Frame>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>From</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Sale</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {credits.map(({ credit, tx }) => (
                  <TableRow key={credit.id}>
                    <TableCell className="text-xs">{credit.receivedAt.toLocaleString("en-GB")}</TableCell>
                    <TableCell className="font-mono text-xs">{formatMsisdn(credit.senderMsisdn)}</TableCell>
                    <TableCell className="text-right">
                      <Dt millimes={credit.amountMillimes} />
                    </TableCell>
                    <TableCell className="text-xs">
                      {tx?.id ? (
                        <Link href={`/admin/sales/${tx.id}`} className="font-mono underline-offset-4 hover:underline">
                          {tx.ref}
                        </Link>
                      ) : (
                        <Badge variant="warning">{credit.status}</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Frame>
        </section>
        <section className="flex flex-col gap-3">
          <h2 className="font-medium">Recent USSD</h2>
          <Frame>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Purpose</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Reply</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {commands.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="text-xs">{c.createdAt.toLocaleTimeString("en-GB")}</TableCell>
                    <TableCell>{c.purpose}</TableCell>
                    <TableCell>
                      <Badge variant={c.status === "succeeded" ? "success" : c.status === "failed" || c.status === "timeout" ? "error" : "info"}>
                        {c.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-72 whitespace-normal text-muted-foreground text-xs">{c.rawResponse ?? c.error ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Frame>
        </section>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="font-medium">All SMS received</h2>
        <Frame>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>From</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Message</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sms.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="text-xs">{m.createdAt.toLocaleString("en-GB")}</TableCell>
                  <TableCell className="font-mono text-xs">{m.fromAddress}</TableCell>
                  <TableCell>
                    <Badge variant={m.classification === "credit" ? "success" : m.classification === "untrusted_sender" ? "error" : "secondary"}>
                      {m.classification}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-xl whitespace-normal text-xs">{m.body}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Frame>
      </section>
    </>
  );
}
