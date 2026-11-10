import Link from "next/link";
import { Secret } from "@/components/app/confidential";
import { Dt } from "@/components/app/money";
import { OperatorName } from "@/components/app/operator-badge";
import { AutoRefresh } from "@/components/admin/auto-refresh";
import { RechargeStatusBadge, rechargeReviewReasons } from "@/components/admin/market-badges";
import { PageHeader } from "@/components/admin/page-header";
import { TimeAgo } from "@/components/admin/time-ago";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Frame } from "@/components/ui/frame";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RECHARGE_STATUSES } from "@/db/schema";
import { listMarketRecharges, type RechargeTab } from "@/lib/market-admin-queries";
import { formatDinars } from "@/lib/money";
import { formatMsisdn } from "@/lib/phone";
import { listOperators } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { ResolveRechargeButton } from "./recharge-actions";

export const metadata = { title: "Recharges" };

const tabs: { value: RechargeTab; label: string }[] = [
  { value: "review", label: "Review" },
  { value: "active", label: "In progress" },
  { value: "succeeded", label: "Succeeded" },
  { value: "failed", label: "Failed" },
  { value: "all", label: "All" },
];
const validTabs: string[] = [...tabs.map((t) => t.value), ...RECHARGE_STATUSES];

export default async function MarketRechargesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; q?: string; user?: string; op?: string }>;
}) {
  const { tab: rawTab, q = "", user, op = "" } = await searchParams;
  const tab = (validTabs.includes(rawTab ?? "") ? rawTab : "review") as RechargeTab;
  const userId = user && /^[0-9a-f-]{36}$/i.test(user) ? user : undefined;
  const ops = await listOperators();
  const operatorCode = ops.some((o) => o.code === op) ? op : undefined;
  const rows = await listMarketRecharges({ tab, q: q || undefined, userId, operatorCode });
  const params = (extra: Record<string, string>) =>
    `/admin/market/recharges?${new URLSearchParams({
      tab,
      ...(q ? { q } : {}),
      ...(userId ? { user: userId } : {}),
      ...(operatorCode ? { op: operatorCode } : {}),
      ...extra,
    })}`;

  return (
    <>
      {(tab === "review" || tab === "active") && <AutoRefresh seconds={10} />}
      <PageHeader
        title="Recharges"
        description="Buyers spending their balance: an agent phone sends credit to a customer number by USSD. A recharge is never sent twice — unclear results wait here for your decision."
        actions={
          <div className="flex gap-1">
            {tabs.map((t) => (
              <Button key={t.value} size="sm" variant={tab === t.value ? "secondary" : "ghost"} render={<Link href={params({ tab: t.value })} />}>
                {t.label}
              </Button>
            ))}
          </div>
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <form className="flex gap-2" action="/admin/market/recharges">
          <input type="hidden" name="tab" value={tab} />
          {userId && <input type="hidden" name="user" value={userId} />}
          {operatorCode && <input type="hidden" name="op" value={operatorCode} />}
          <Input type="search" name="q" defaultValue={q} placeholder="ref, number or buyer" aria-label="Search recharges" className="w-64" />
          <Button type="submit" variant="outline">
            Search
          </Button>
        </form>
        <div className="flex gap-1">
          <Button size="sm" variant={!operatorCode ? "secondary" : "ghost"} render={<Link href={params({ op: "" })} />}>
            All operators
          </Button>
          {ops.map((o) => (
            <Button key={o.code} size="sm" variant={operatorCode === o.code ? "secondary" : "ghost"} render={<Link href={params({ op: o.code })} />}>
              {o.name}
            </Button>
          ))}
        </div>
        {(q || userId) && (
          <Button size="sm" variant="ghost" render={<Link href={`/admin/market/recharges?tab=${tab}`} />}>
            Clear filters
          </Button>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border p-10 text-center text-muted-foreground text-sm">Nothing here.</div>
      ) : (
        <Frame>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ref</TableHead>
                <TableHead>Buyer</TableHead>
                <TableHead>Customer number</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>SIM</TableHead>
                <TableHead className="text-right">Balance before → after</TableHead>
                <TableHead>Phone's send result</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ r, op: o, buyer, sim }) => {
                const expected = r.baselineBalanceMillimes != null ? r.baselineBalanceMillimes - r.amountMillimes : null;
                return (
                  <TableRow key={r.id} className={cn(r.status === "review" && "bg-warning/8")}>
                    <TableCell>
                      <span className="font-mono font-medium">
                        <Secret>{r.ref}</Secret>
                      </span>
                      <div className="text-muted-foreground text-xs">
                        <TimeAgo date={r.createdAt} />
                      </div>
                    </TableCell>
                    <TableCell className="max-w-40 truncate" title={buyer.email ?? ""}>
                      <Link href={`/admin/users/${buyer.id}`} className="underline-offset-4 hover:underline">
                        {buyer.name ?? buyer.email}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <OperatorName name={o.name} color={o.color} />
                      <div className="font-mono text-xs">
                        <Secret dir="ltr">{formatMsisdn(r.msisdn)}</Secret>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <Dt millimes={r.amountMillimes} className="font-medium" />
                    </TableCell>
                    <TableCell className="text-xs">
                      {sim?.id ? (
                        <Link href={`/admin/numbers/${sim.id}`} className="font-mono underline-offset-4 hover:underline">
                          <Secret dir="ltr">{sim.msisdn ? formatMsisdn(sim.msisdn) : "SIM"}</Secret>
                        </Link>
                      ) : (
                        "—"
                      )}
                      {sim?.id && r.status === "review" && (
                        <div className="text-muted-foreground">
                          now <Dt millimes={sim.balanceMillimes} unit={false} /> · <TimeAgo date={sim.balanceCheckedAt} />
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-xs">
                      <Dt millimes={r.baselineBalanceMillimes} unit={false} /> → <Dt millimes={r.afterBalanceMillimes} unit={false} />
                      {expected != null && (
                        <div className="text-muted-foreground">
                          if sent: <Dt millimes={expected} unit={false} />
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="max-w-64 whitespace-normal text-xs">
                      {r.sendOk == null ? (
                        <Badge variant="secondary">{r.sendCommandId ? "no answer" : "not sent"}</Badge>
                      ) : (
                        <Badge variant={r.sendOk ? "success" : "error"}>{r.sendOk ? "ok" : "error"}</Badge>
                      )}
                      {(r.sendResponse || r.sendError) && (
                        <div className="mt-1 font-mono text-muted-foreground">
                          <Secret>{r.sendResponse ?? r.sendError}</Secret>
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="max-w-56 whitespace-normal">
                      <RechargeStatusBadge status={r.status} />
                      {r.status === "review" && r.reviewReason && (
                        <div className="mt-1 text-muted-foreground text-xs">{rechargeReviewReasons[r.reviewReason] ?? r.reviewReason}</div>
                      )}
                      {r.note && <div className="mt-1 text-muted-foreground text-xs">Note: {r.note}</div>}
                    </TableCell>
                    <TableCell className="text-right">
                      {r.status === "review" && <ResolveRechargeButton rechargeId={r.id} ref_={r.ref} amount={formatDinars(r.amountMillimes)} />}
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
