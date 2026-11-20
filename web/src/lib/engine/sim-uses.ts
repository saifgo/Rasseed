import { and, eq } from "drizzle-orm";
import { db, type DbTx } from "@/db";
import { devices, sims } from "@/db/schema";

/**
 * What an active SIM may be used for, set per SIM by the admin:
 * - accept: receive credit from sellers (sales),
 * - send_credit: send buyer recharges (Light),
 * - send_data: send data packages (Internet).
 */
export type SimUse = "accept" | SendUse;
export type SendUse = "send_credit" | "send_data";

export const simUseColumn = (use: SimUse) =>
  use === "accept" ? sims.canAcceptCredit : use === "send_credit" ? sims.canSendCredit : sims.canSendData;

/** The use a recharge needs: a data package or a plain credit recharge. */
export const rechargeUse = (r: { packageId: string | null | undefined }): SendUse => (r.packageId ? "send_data" : "send_credit");

/**
 * Operator codes with at least one active SIM (on an enabled phone) allowed for this use.
 * An operator without one is closed for that use: selling, Light or Internet is unavailable.
 */
export async function operatorsWithUse(use: SimUse, dbx: DbTx | typeof db = db) {
  const rows = await dbx
    .selectDistinct({ code: sims.operatorCode })
    .from(sims)
    .innerJoin(devices, eq(devices.id, sims.deviceId))
    .where(and(eq(sims.status, "active"), eq(simUseColumn(use), true), eq(devices.enabled, true)));
  return new Set(rows.map((r) => r.code).filter((c): c is string => !!c));
}

/** All three uses at once, for pages that show them together. */
export async function operatorUses() {
  const [accept, sendCredit, sendData] = await Promise.all([
    operatorsWithUse("accept"),
    operatorsWithUse("send_credit"),
    operatorsWithUse("send_data"),
  ]);
  return { accept, sendCredit, sendData };
}
