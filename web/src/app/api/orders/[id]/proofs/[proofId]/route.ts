import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { orderProofs, orders } from "@/db/schema";
import { getCurrentUser, isStaff } from "@/lib/session";
import { readProof } from "@/lib/storage";

const UUID = /^[0-9a-f-]{36}$/i;

/** A payment proof of an order: visible to its buyer, its seller and staff. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; proofId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const { id, proofId } = await params;
  if (!UUID.test(id) || !UUID.test(proofId)) return new Response("Not found", { status: 404 });
  const [row] = await db
    .select({ proof: orderProofs, order: orders })
    .from(orderProofs)
    .innerJoin(orders, eq(orders.id, orderProofs.orderId))
    .where(and(eq(orderProofs.id, proofId), eq(orderProofs.orderId, id)));
  if (!row) return new Response("Not found", { status: 404 });
  const { proof, order } = row;
  if (order.buyerId !== user.id && order.sellerId !== user.id && !isStaff(user)) return new Response("Not found", { status: 404 });
  const data = await readProof(proof.path);
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": proof.mime,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": `inline; filename="proof-${order.ref}"`,
    },
  });
}
