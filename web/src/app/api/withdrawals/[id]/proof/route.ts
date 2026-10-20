import { eq } from "drizzle-orm";
import { db } from "@/db";
import { withdrawals } from "@/db/schema";
import { getCurrentUser, isStaff } from "@/lib/session";
import { readProof } from "@/lib/storage";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });
  const [w] = await db.select().from(withdrawals).where(eq(withdrawals.id, id));
  if (!w?.proofPath || (w.userId !== user.id && !isStaff(user))) {
    return new Response("Not found", { status: 404 });
  }
  const data = await readProof(w.proofPath);
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": w.proofMime ?? "application/octet-stream",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": `inline; filename="proof-${w.ref}"`,
    },
  });
}
