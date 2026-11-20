import { and, eq, inArray, sql } from "drizzle-orm";
import { db, type DbTx } from "@/db";
import { creditEntries, credits, sims, transactions, type TxStatus, users } from "@/db/schema";
import { getSettings } from "@/lib/settings";
import { canUseMarketplace } from "./market";
import { type SendUse, simUseColumn } from "./sim-uses";

/**
 * Sarfli's own credit: what admins may spend from the POS (or the web recharge page).
 *
 * Per operator: the real credit on Sarfli's active SIMs (last balance reading), minus everything that is
 * not Sarfli's yet or not Sarfli's at all:
 * - credit from sales that are not confirmed (the seller has not been credited for it),
 * - credits announced by SMS that an admin still has to match,
 * - marketplace credit owned by others: open orders, seller stock, buyer balances,
 * - recharges already submitted and not finished (they will leave the SIM).
 * Confirmed sales count as Sarfli's, whether or not the seller's withdrawal is paid yet.
 * While the marketplace is closed this is all the credit on the phones.
 */

type User = typeof users.$inferSelect;

/** Sales whose credit may already be on the SIM but is not confirmed (seller not credited). */
const UNCONFIRMED_SALES: TxStatus[] = ["assigning", "awaiting_transfer", "verifying", "partial", "review"];

/** Admins spend Sarfli's credit. */
export const spendsSarfliCredit = (user: Pick<User, "role">) => user.role === "admin";

/** May start recharges: admins (Sarfli's credit), or marketplace users (their own balance). */
export async function canSpend(user: Pick<User, "role" | "marketplaceAccess" | "blocked"> | null) {
  if (!user || user.blocked) return false;
  if (spendsSarfliCredit(user)) return true;
  return canUseMarketplace(user, await getSettings());
}

export type SarfliCreditBreakdown = {
  onSimsMillimes: number;
  unconfirmedSalesMillimes: number;
  unmatchedCreditsMillimes: number;
  othersMillimes: number;
  pendingRechargesMillimes: number;
  spendableMillimes: number;
};

/**
 * Breakdown for one operator. Pass the transaction when deciding a spend (under lockSarfli).
 * With a send use (Light or Internet), spendable is also capped by the credit on the SIMs allowed to send
 * it: credit on the other SIMs is Sarfli's but cannot leave the phones that way.
 */
export async function sarfliCredit(
  dbx: DbTx | typeof db,
  operatorCode: string,
  use?: SendUse,
): Promise<SarfliCreditBreakdown> {
  const [onSims] = await dbx
    .select({ total: sql<string>`coalesce(sum(${sims.balanceMillimes}), 0)` })
    .from(sims)
    .where(and(eq(sims.operatorCode, operatorCode), eq(sims.status, "active")));
  const [unconfirmed] = await dbx
    .select({ total: sql<string>`coalesce(sum(greatest(${transactions.smsReceivedMillimes}, ${transactions.confirmedMillimes})), 0)` })
    .from(transactions)
    .where(and(eq(transactions.operatorCode, operatorCode), inArray(transactions.status, UNCONFIRMED_SALES)));
  const [unmatched] = await dbx
    .select({ total: sql<string>`coalesce(sum(${credits.amountMillimes}), 0)` })
    .from(credits)
    .innerJoin(sims, eq(sims.id, credits.simId))
    .where(and(eq(sims.operatorCode, operatorCode), inArray(credits.status, ["unmatched", "late"])));
  const ledger = await dbx
    .select({ bucket: creditEntries.bucket, total: sql<string>`coalesce(sum(${creditEntries.amountMillimes}), 0)` })
    .from(creditEntries)
    .where(and(eq(creditEntries.operatorCode, operatorCode), inArray(creditEntries.bucket, ["order", "seller_stock", "buyer", "recharge"])))
    .groupBy(creditEntries.bucket);
  const bucket = (b: string) => Number(ledger.find((r) => r.bucket === b)?.total ?? 0);

  const onSimsMillimes = Number(onSims.total);
  const unconfirmedSalesMillimes = Number(unconfirmed.total);
  const unmatchedCreditsMillimes = Number(unmatched.total);
  const othersMillimes = bucket("order") + bucket("seller_stock") + bucket("buyer");
  const pendingRechargesMillimes = bucket("recharge");
  let spendableMillimes = Math.max(
    0,
    onSimsMillimes - unconfirmedSalesMillimes - unmatchedCreditsMillimes - othersMillimes - pendingRechargesMillimes,
  );
  if (use) {
    // Recharges in progress leave the sending SIMs, so they come off that credit too.
    const [sending] = await dbx
      .select({ total: sql<string>`coalesce(sum(${sims.balanceMillimes}), 0)` })
      .from(sims)
      .where(and(eq(sims.operatorCode, operatorCode), eq(sims.status, "active"), eq(simUseColumn(use), true)));
    spendableMillimes = Math.min(spendableMillimes, Math.max(0, Number(sending.total) - pendingRechargesMillimes));
  }
  return { onSimsMillimes, unconfirmedSalesMillimes, unmatchedCreditsMillimes, othersMillimes, pendingRechargesMillimes, spendableMillimes };
}

/** Spendable per operator code (for one send use, or overall), for the POS and the recharge page. */
export async function sarfliSpendable(operatorCodes: string[], use?: SendUse) {
  const rows = await Promise.all(operatorCodes.map(async (c) => [c, (await sarfliCredit(db, c, use)).spendableMillimes] as const));
  return Object.fromEntries(rows) as Record<string, number>;
}
