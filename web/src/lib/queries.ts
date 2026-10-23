import "server-only";
import { and, asc, count, desc, eq, inArray, lt } from "drizzle-orm";
import { db } from "@/db";
import {
  ACTIVE_TX_STATUSES,
  operators,
  payoutMethods,
  payouts,
  savedPayoutDetails,
  transactionEvents,
  transactions,
  type TxStatus,
} from "@/db/schema";
import { renderTransferUssd } from "@/lib/parsers";

export async function listOperators() {
  return db.select().from(operators).orderBy(asc(operators.sortOrder));
}

export async function listPayoutMethods(activeOnly = true) {
  const rows = await db.select().from(payoutMethods).orderBy(asc(payoutMethods.sortOrder));
  return activeOnly ? rows.filter((m) => m.active) : rows;
}

export async function getSavedPayoutDetails(userId: string) {
  const rows = await db.select().from(savedPayoutDetails).where(eq(savedPayoutDetails.userId, userId));
  return Object.fromEntries(rows.map((r) => [r.methodCode, r.details]));
}

export type SaleView = Awaited<ReturnType<typeof getSaleView>>;

/** Everything the live sale page needs. `userId` restricts to the owner; pass null for admin views. */
export async function getSaleView(id: string, userId: string | null) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await db
    .select({ tx: transactions, op: operators, method: payoutMethods, payout: payouts })
    .from(transactions)
    .innerJoin(operators, eq(operators.code, transactions.operatorCode))
    .leftJoin(payoutMethods, eq(payoutMethods.code, transactions.payoutMethodCode))
    .leftJoin(payouts, eq(payouts.txId, transactions.id))
    .where(userId ? and(eq(transactions.id, id), eq(transactions.userId, userId)) : eq(transactions.id, id));
  if (!row) return null;
  const { tx, op, method, payout } = row;

  let queuePosition: number | null = null;
  if (tx.status === "queued") {
    const [{ n }] = await db
      .select({ n: count() })
      .from(transactions)
      .where(and(eq(transactions.status, "queued"), eq(transactions.operatorCode, tx.operatorCode), lt(transactions.queuedAt, tx.queuedAt)));
    queuePosition = n + 1;
  }

  const events = await db
    .select()
    .from(transactionEvents)
    .where(userId ? and(eq(transactionEvents.txId, tx.id), eq(transactionEvents.internal, false)) : eq(transactionEvents.txId, tx.id))
    .orderBy(asc(transactionEvents.createdAt));

  const showNumber = ["awaiting_transfer", "verifying", "partial"].includes(tx.status) && tx.assignedMsisdn;
  const remaining = Math.max(0, tx.declaredMillimes - tx.confirmedMillimes);

  return {
    id: tx.id,
    ref: tx.ref,
    status: tx.status as TxStatus,
    operator: { code: op.code, name: op.name, color: op.color },
    declaredMillimes: tx.declaredMillimes,
    confirmedMillimes: tx.confirmedMillimes,
    smsReceivedMillimes: tx.smsReceivedMillimes,
    finalMillimes: tx.finalMillimes,
    senderMsisdn: tx.senderMsisdn,
    rateBps: tx.rateBps,
    feeMillimes: tx.payoutFeeMillimes,
    payoutGrossMillimes: tx.payoutGrossMillimes,
    payoutNetMillimes: tx.payoutNetMillimes,
    // Legacy per-sale payout (sales made before the account balance). Null for new sales.
    method: method ? { code: method.code, name: method.name, fields: method.fields } : null,
    payoutDetails: tx.payoutDetails ?? {},
    partialChoice: tx.partialChoice,
    reviewReason: userId ? null : tx.reviewReason,
    assignedMsisdn: showNumber ? tx.assignedMsisdn : null,
    transferUssd: showNumber ? renderTransferUssd(op.transferUssdTemplate, tx.assignedMsisdn!, remaining) : null,
    remainingMillimes: remaining,
    expiresAt: tx.expiresAt?.toISOString() ?? null,
    createdAt: tx.createdAt.toISOString(),
    queuePosition,
    canCancel:
      ["queued", "assigning", "awaiting_transfer"].includes(tx.status) &&
      tx.smsReceivedMillimes === 0 &&
      tx.confirmedMillimes === 0 &&
      !tx.unexplainedSince,
    payout: payout
      ? {
          id: payout.id,
          status: payout.status,
          netMillimes: payout.netMillimes,
          reference: payout.reference,
          note: payout.note,
          hasProof: Boolean(payout.proofPath),
          paidAt: payout.paidAt?.toISOString() ?? null,
        }
      : null,
    events: events.map((e) => ({
      id: e.id,
      type: e.type,
      actor: e.actor,
      data: e.data,
      internal: e.internal,
      createdAt: e.createdAt.toISOString(),
    })),
    serverNow: new Date().toISOString(),
  };
}

export async function listUserSales(userId: string) {
  return db
    .select({ tx: transactions, op: operators })
    .from(transactions)
    .innerJoin(operators, eq(operators.code, transactions.operatorCode))
    .where(eq(transactions.userId, userId))
    .orderBy(desc(transactions.createdAt))
    .limit(100);
}

/** The seller's ongoing sale, if any. Only one may be active at a time. */
export async function getOngoingSale(userId: string) {
  const [row] = await db
    .select({ tx: transactions, op: operators })
    .from(transactions)
    .innerJoin(operators, eq(operators.code, transactions.operatorCode))
    .where(and(eq(transactions.userId, userId), inArray(transactions.status, ACTIVE_TX_STATUSES)))
    .orderBy(desc(transactions.createdAt))
    .limit(1);
  return row ?? null;
}
