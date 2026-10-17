import { notFound } from "next/navigation";
import { getSaleView } from "@/lib/queries";
import { requireUser } from "@/lib/session";
import { LiveSale } from "./live-sale";

export const dynamic = "force-dynamic";

export default async function SalePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const view = await getSaleView(id, user.id);
  if (!view) notFound();
  return <LiveSale initial={view} />;
}
