import { AutoRefresh } from "@/components/admin/auto-refresh";
import { PageHeader } from "@/components/admin/page-header";
import { SalesTable } from "@/components/admin/sales-table";
import { listSales } from "@/lib/admin-queries";

export const metadata = { title: "Review queue" };

export default async function ReviewPage() {
  const rows = await listSales({ status: "review" });
  return (
    <>
      <AutoRefresh seconds={10} />
      <PageHeader
        title="Review queue"
        description="Sales where the SMS and the balance did not agree. The number stays reserved until you decide."
      />
      <SalesTable rows={rows} showReason />
    </>
  );
}
