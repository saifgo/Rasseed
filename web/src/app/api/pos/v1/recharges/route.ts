import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { recharges } from "@/db/schema";
import { createRecharge, getBuyerRecharge } from "@/lib/engine/recharge";
import { posRoute, publicRecharge } from "../_util";

const msisdn = z.string().min(8).max(20);
const clientRef = z.string().min(8).max(100);
const schema = z.union([
  z.object({ packageId: z.string().uuid(), msisdn, clientRef }),
  z.object({ operatorCode: z.string().max(20), msisdn, amountMillimes: z.number().int().positive(), clientRef }),
]);

export const POST = posRoute(schema, async ({ terminal, user }, body) => {
  const input =
    "packageId" in body
      ? { packageId: body.packageId, msisdn: body.msisdn }
      : { operatorCode: body.operatorCode, msisdn: body.msisdn, amountMillimes: body.amountMillimes };
  const id = await createRecharge(user.id, input, { posTerminalId: terminal.id, clientRef: body.clientRef });
  const r = await getBuyerRecharge(user.id, id);
  return r && { recharge: publicRecharge(r) };
});

export const GET = posRoute(null, async ({ user }, _body, _params, req) => {
  const limit = Math.min(Math.max(Number(new URL(req.url).searchParams.get("limit")) || 50, 1), 200);
  const rows = await db
    .select()
    .from(recharges)
    .where(eq(recharges.buyerId, user.id))
    .orderBy(desc(recharges.createdAt))
    .limit(limit);
  return { recharges: rows.map(publicRecharge) };
});
