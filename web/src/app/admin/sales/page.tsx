import Link from "next/link";
import { AutoRefresh } from "@/components/admin/auto-refresh";
import { PageHeader } from "@/components/admin/page-header";
import { SalesTable } from "@/components/admin/sales-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TX_STATUSES, type TxStatus } from "@/db/schema";
import { listSales } from "@/lib/admin-queries";

export const metadata = { title: "Sales" };

const filters: { value: string; label: string }[] = [
  { value: "", label: "All" },
  { value: "active", label: "Active" },
  { value: "review", label: "Review" },
  { value: "confirmed", label: "To pay" },
  { value: "paid", label: "Paid" },
  { value: "expired", label: "Expired" },
  { value: "cancelled", label: "Cancelled" },
  { value: "rejected", label: "Rejected" },
];

export default async function AdminSalesPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string }> }) {
  const { status = "", q = "" } = await searchParams;
  const valid =
    status === "active" || (TX_STATUSES as readonly string[]).includes(status) ? (status as TxStatus | "active") : undefined;
  const rows = await listSales({ status: valid, q: q || undefined });
  return (
    <>
      <AutoRefresh seconds={10} />
      <PageHeader title="Sales" description="Search by reference, sender number, receiving number or seller e-mail." />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1">
          {filters.map((f) => (
            <Button
              key={f.value}
              size="sm"
              variant={f.value === status ? "secondary" : "ghost"}
              render={<Link href={`/admin/sales?status=${f.value}${q ? `&q=${encodeURIComponent(q)}` : ""}`} />}
            >
              {f.label}
            </Button>
          ))}
        </div>
        <form className="flex gap-2" action="/admin/sales">
          <input type="hidden" name="status" value={status} />
          <Input type="search" name="q" defaultValue={q} placeholder="RS-…, 2X XXX XXX, email" aria-label="Search sales" className="w-64" />
          <Button type="submit" variant="outline">
            Search
          </Button>
        </form>
      </div>
      <SalesTable rows={rows} showReason />
    </>
  );
}
