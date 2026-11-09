import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import Link from "next/link";
import { Secret } from "@/components/app/confidential";
import { Dt } from "@/components/app/money";
import { OperatorName } from "@/components/app/operator-badge";
import { PageHeader } from "@/components/admin/page-header";
import { StatCard } from "@/components/admin/stat-card";
import { Button } from "@/components/ui/button";
import { Frame } from "@/components/ui/frame";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BUSINESS_TZ, getDayClosing, todayInBusinessTz } from "@/lib/admin-queries";

export const metadata = { title: "Day closing" };

function shiftDay(day: string, days: number) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function isValidDay(day: string | undefined): day is string {
  return Boolean(day && /^\d{4}-\d{2}-\d{2}$/.test(day) && !Number.isNaN(Date.parse(`${day}T00:00:00Z`)));
}

export default async function DayClosingPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const { date } = await searchParams;
  const today = todayInBusinessTz();
  const day = isValidDay(date) && date <= today ? date : today;
  const c = await getDayClosing(day);
  const isToday = day === today;
  const label = new Intl.DateTimeFormat("en-GB", { timeZone: BUSINESS_TZ, dateStyle: "full" }).format(c.start);

  return (
    <>
      <PageHeader
        title="Day closing"
        description={`${label}${isToday ? " · today, still open (end = latest balance check)" : ""}. Tunisia time.`}
        actions={
          <form action="/admin/closing" className="flex items-center gap-2">
            <Button size="icon" variant="outline" aria-label="Previous day" render={<Link href={`/admin/closing?date=${shiftDay(day, -1)}`} />}>
              <ChevronLeftIcon aria-hidden="true" />
            </Button>
            <Input type="date" name="date" defaultValue={day} max={today} aria-label="Closing date" className="w-44" />
            <Button type="submit" variant="outline">
              Show
            </Button>
            <Button
              size="icon"
              variant="outline"
              aria-label="Next day"
              disabled={isToday}
              render={isToday ? undefined : <Link href={`/admin/closing?date=${shiftDay(day, 1)}`} />}
            >
              <ChevronRightIcon aria-hidden="true" />
            </Button>
          </form>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Credit at start of day" value={<Dt millimes={c.totals.startMillimes} />} hint="All operators, SIM balances" />
        <StatCard
          label="Credit received"
          value={<Dt millimes={c.totals.receivedMillimes} />}
          hint={
            <>
              <Secret>{c.totals.salesCount}</Secret> confirmed sales · worth <Dt millimes={c.totals.cashMillimes} /> cash
            </>
          }
        />
        <StatCard
          label="Paid to sellers"
          value={<Dt millimes={c.totals.paidSendMillimes} />}
          hint={
            <>
              <Secret>{c.totals.paidCount}</Secret> withdrawals marked paid
            </>
          }
        />
        <StatCard label={isToday ? "Credit now" : "Credit at end of day"} value={<Dt millimes={c.totals.endMillimes} />} hint="All operators, SIM balances" />
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="font-medium">Credit per operator</h2>
        <Frame>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Operator</TableHead>
                <TableHead className="text-end">Start of day</TableHead>
                <TableHead className="text-end">Received</TableHead>
                <TableHead className="text-end">Sales</TableHead>
                <TableHead className="text-end">Cash value</TableHead>
                <TableHead className="text-end">{isToday ? "Now" : "End of day"}</TableHead>
                <TableHead className="text-end" title="End − start − received. Non-zero: credit moved out, sales still open, or missed balance checks.">
                  Difference
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {c.operators.map((op) => (
                <TableRow key={op.code}>
                  <TableCell>
                    <div className="flex flex-col gap-0.5">
                      <OperatorName name={op.name} color={op.color} code={op.code} />
                      <span className="text-muted-foreground text-xs">
                        <Secret>{op.sims}</Secret> SIM
                        {op.estimatedSims > 0 && (
                          <>
                            {" "}
                            · <Secret>{op.estimatedSims}</Secret> without an earlier check, start = first check of the day
                          </>
                        )}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-end">
                    <Dt millimes={op.startMillimes} />
                  </TableCell>
                  <TableCell className="text-end">
                    <Dt millimes={op.receivedMillimes} />
                  </TableCell>
                  <TableCell className="text-end tabular">
                    <Secret>{op.salesCount}</Secret>
                  </TableCell>
                  <TableCell className="text-end">
                    <Dt millimes={op.cashMillimes} />
                  </TableCell>
                  <TableCell className="text-end">
                    <Dt millimes={op.endMillimes} />
                  </TableCell>
                  <TableCell className={op.differenceMillimes === 0 ? "text-end text-muted-foreground" : "text-end text-warning-foreground"}>
                    <Dt millimes={op.differenceMillimes} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow className="font-medium">
                <TableCell>Total</TableCell>
                <TableCell className="text-end">
                  <Dt millimes={c.totals.startMillimes} />
                </TableCell>
                <TableCell className="text-end">
                  <Dt millimes={c.totals.receivedMillimes} />
                </TableCell>
                <TableCell className="text-end tabular">
                  <Secret>{c.totals.salesCount}</Secret>
                </TableCell>
                <TableCell className="text-end">
                  <Dt millimes={c.totals.cashMillimes} />
                </TableCell>
                <TableCell className="text-end">
                  <Dt millimes={c.totals.endMillimes} />
                </TableCell>
                <TableCell className="text-end">
                  <Dt millimes={c.totals.differenceMillimes} />
                </TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </Frame>
        <p className="text-muted-foreground text-xs">
          Received = credit from sales confirmed that day. Cash value = what those sales added to seller balances at the locked rate.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="font-medium">Paid to sellers</h2>
        <Frame>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Method</TableHead>
                <TableHead className="text-end">Withdrawals</TableHead>
                <TableHead className="text-end">Taken from balances</TableHead>
                <TableHead className="text-end">Fees</TableHead>
                <TableHead className="text-end">Sent</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {c.payouts.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-6 text-center text-muted-foreground">
                    No withdrawal marked paid on this day.
                  </TableCell>
                </TableRow>
              )}
              {c.payouts.map((p) => (
                <TableRow key={p.code}>
                  <TableCell>{p.name}</TableCell>
                  <TableCell className="text-end tabular">
                    <Secret>{p.count}</Secret>
                  </TableCell>
                  <TableCell className="text-end">
                    <Dt millimes={p.grossMillimes} />
                  </TableCell>
                  <TableCell className="text-end">
                    <Dt millimes={p.feeMillimes} />
                  </TableCell>
                  <TableCell className="text-end">
                    <Dt millimes={p.sendMillimes} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow className="font-medium">
                <TableCell>Total</TableCell>
                <TableCell className="text-end tabular">
                  <Secret>{c.totals.paidCount}</Secret>
                </TableCell>
                <TableCell className="text-end">
                  <Dt millimes={c.totals.paidGrossMillimes} />
                </TableCell>
                <TableCell className="text-end">
                  <Dt millimes={c.totals.paidFeeMillimes} />
                </TableCell>
                <TableCell className="text-end">
                  <Dt millimes={c.totals.paidSendMillimes} />
                </TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </Frame>
      </div>
    </>
  );
}
