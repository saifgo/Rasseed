import { OperatorName } from "@/components/app/operator-badge";
import { PageHeader } from "@/components/admin/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardPanel, CardTitle } from "@/components/ui/card";
import { Frame } from "@/components/ui/frame";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAdmin } from "@/lib/session";
import { getOperatorsAdmin } from "@/lib/admin-queries";
import { formatRate } from "@/lib/money";
import { OperatorEditor, RateEditor } from "./operator-forms";

export const metadata = { title: "Operators & rates" };

export default async function OperatorsPage() {
  await requireAdmin();
  const { operators, history, recentReplies, recentSms } = await getOperatorsAdmin();
  return (
    <>
      <PageHeader
        title="Operators & rates"
        description="Set today's rate per operator. A new rate applies to sales started after the change; running sales keep their locked rate."
      />

      <div className="grid gap-4 md:grid-cols-3">
        {operators.map((op) => (
          <RateEditor key={op.code} code={op.code} name={op.name} color={op.color} rateBps={op.rateBps} active={op.active} />
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Rate history</CardTitle>
        </CardHeader>
        <CardPanel>
          {history.length === 0 ? (
            <p className="text-muted-foreground text-sm">No rate changes yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Operator</TableHead>
                  <TableHead>Rate</TableHead>
                  <TableHead>By</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map(({ h, by }) => {
                  const op = operators.find((o) => o.code === h.operatorCode);
                  return (
                    <TableRow key={h.id}>
                      <TableCell className="text-xs">{h.createdAt.toLocaleString("en-GB")}</TableCell>
                      <TableCell>{op && <OperatorName name={op.name} color={op.color} />}</TableCell>
                      <TableCell>{formatRate(h.rateBps)}</TableCell>
                      <TableCell className="text-muted-foreground text-xs">{by}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardPanel>
      </Card>

      <div className="flex flex-col gap-1">
        <h2 className="font-heading font-semibold text-lg">Codes & message parsing</h2>
        <p className="text-muted-foreground text-sm">
          These settings decide how transfers are recognised. Test with real samples before saving. The SMS regex needs named groups
          <code className="mx-1">(?&lt;amount&gt;…)</code> and <code className="mx-1">(?&lt;sender&gt;…)</code>; the balance regex needs
          <code className="mx-1">(?&lt;amount&gt;…)</code> and optionally <code className="mx-1">(?&lt;unit&gt;…)</code>.
        </p>
      </div>
      {operators.map((op) => (
        <OperatorEditor
          key={op.code}
          op={{
            code: op.code,
            name: op.name,
            color: op.color,
            active: op.active,
            transferUssdTemplate: op.transferUssdTemplate,
            balanceUssdCode: op.balanceUssdCode,
            creditSmsRegex: op.creditSmsRegex,
            creditSmsUnit: op.creditSmsUnit,
            creditSmsSenders: op.creditSmsSenders.join(", "),
            balanceRegex: op.balanceRegex,
            balanceUnit: op.balanceUnit,
          }}
          sampleReply={recentReplies.find((r) => r.operatorCode === op.code)?.raw ?? ""}
          sampleSms={recentSms.find((r) => r.operatorCode === op.code && r.classification !== "ignored") ?? null}
        />
      ))}

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="flex flex-col gap-3">
          <h2 className="font-medium">Latest USSD balance replies</h2>
          <Frame>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Operator</TableHead>
                  <TableHead>Reply</TableHead>
                  <TableHead>Parsed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentReplies.map((r, i) => (
                  <TableRow key={i}>
                    <TableCell>{r.operatorCode}</TableCell>
                    <TableCell className="max-w-72 whitespace-normal font-mono text-xs">{r.raw}</TableCell>
                    <TableCell>
                      {r.parsed != null ? <Badge variant="success">{(r.parsed / 1000).toFixed(3)}</Badge> : <Badge variant="error">failed</Badge>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Frame>
        </section>
        <section className="flex flex-col gap-3">
          <h2 className="font-medium">Latest SMS</h2>
          <Frame>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>From</TableHead>
                  <TableHead>Message</TableHead>
                  <TableHead>Type</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentSms.map((r, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-mono text-xs">{r.from}</TableCell>
                    <TableCell className="max-w-72 whitespace-normal text-xs">{r.body}</TableCell>
                    <TableCell>
                      <Badge variant={r.classification === "credit" ? "success" : "secondary"}>{r.classification}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Frame>
        </section>
      </div>
    </>
  );
}
