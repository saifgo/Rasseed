import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import type { DbTx } from "@/db";
import {
  balanceSnapshots,
  credits,
  deviceCommands,
  operators,
  payouts,
  sims,
  transactionEvents,
  transactions,
  type CommandPurpose,
} from "@/db/schema";
import { grossPayout } from "@/lib/money";
import type { AppSettings } from "@/lib/settings";

export class EngineError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

export type Tx = typeof transactions.$inferSelect;
export type Sim = typeof sims.$inferSelect;

export async function logEvent(
  db: DbTx,
  txId: string,
  type: string,
  actor: "system" | "seller" | "admin" | "device",
  data: Record<string, unknown> = {},
  internal = false,
) {
  await db.insert(transactionEvents).values({ txId, type, actor, data, internal });
}

export async function lockTx(db: DbTx, txId: string): Promise<Tx | undefined> {
  const [row] = await db.select().from(transactions).where(eq(transactions.id, txId)).for("update");
  return row;
}

export async function lockSim(db: DbTx, simId: string): Promise<Sim | undefined> {
  const [row] = await db.select().from(sims).where(eq(sims.id, simId)).for("update");
  return row;
}

export async function updateTx(db: DbTx, txId: string, values: Partial<Tx>) {
  await db
    .update(transactions)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(transactions.id, txId));
}

/** Queues a balance USSD for a SIM unless an equivalent one is already waiting. */
export async function enqueueBalanceCheck(
  db: DbTx,
  sim: Sim,
  purpose: CommandPurpose,
  txId: string | null,
  delaySeconds = 0,
) {
  const open = await db
    .select({ id: deviceCommands.id, purpose: deviceCommands.purpose })
    .from(deviceCommands)
    .where(and(eq(deviceCommands.simId, sim.id), inArray(deviceCommands.status, ["pending", "sent"])));
  // One outstanding check per SIM is enough: its result triggers reconciliation regardless of purpose.
  // The only exception is the baseline, which must be taken fresh.
  if (open.length > 0 && purpose !== "baseline") return;
  if (!sim.operatorCode) return;
  const [op] = await db.select().from(operators).where(eq(operators.code, sim.operatorCode));
  await db.insert(deviceCommands).values({
    deviceId: sim.deviceId,
    simId: sim.id,
    type: "ussd_balance",
    ussdCode: op.balanceUssdCode,
    purpose,
    txId,
    notBefore: new Date(Date.now() + delaySeconds * 1000),
  });
}

export async function releaseSim(db: DbTx, simId: string | null, settings: AppSettings) {
  if (!simId) return;
  await db
    .update(sims)
    .set({ heldByTxId: null, cooldownUntil: new Date(Date.now() + settings.cooldownSeconds * 1000) })
    .where(eq(sims.id, simId));
}

/** Completes the seller side: locks the final amount, creates the payout and frees the number. */
export async function finalize(
  db: DbTx,
  tx: Tx,
  finalMillimes: number,
  settings: AppSettings,
  actor: "system" | "seller" | "admin",
  reason: string,
) {
  const gross = grossPayout(finalMillimes, tx.rateBps);
  const net = Math.max(0, gross - tx.payoutFeeMillimes);
  await updateTx(db, tx.id, {
    status: "confirmed",
    finalMillimes,
    payoutGrossMillimes: gross,
    payoutNetMillimes: net,
    completedAt: new Date(),
    reviewReason: null,
  });
  await db
    .insert(payouts)
    .values({
      txId: tx.id,
      userId: tx.userId,
      methodCode: tx.payoutMethodCode,
      details: tx.payoutDetails,
      grossMillimes: gross,
      feeMillimes: tx.payoutFeeMillimes,
      netMillimes: net,
    })
    .onConflictDoUpdate({
      target: payouts.txId,
      set: { grossMillimes: gross, netMillimes: net },
    });
  await releaseSim(db, tx.simId, settings);
  await logEvent(db, tx.id, "confirmed", actor, { finalMillimes, grossMillimes: gross, netMillimes: net, reason });
}

export async function sendToReview(db: DbTx, tx: Tx, reason: string, data: Record<string, unknown> = {}) {
  if (tx.status === "review") return;
  // The number stays held: an admin must look at it before anyone else sends credit to it.
  await updateTx(db, tx.id, { status: "review", reviewReason: reason });
  await logEvent(db, tx.id, "review", "system", { reason, ...data });
}

/**
 * Compares the latest balance with the baseline and the SMS-announced credits.
 * Only credits that are confirmed by BOTH the SMS and the balance count toward the transaction.
 */
export async function reconcile(db: DbTx, tx: Tx, sim: Sim, balance: number, settings: AppSettings) {
  if (!["awaiting_transfer", "verifying", "partial"].includes(tx.status)) return;
  if (tx.baselineBalanceMillimes == null || !tx.baselineAt) return;

  // Every credit announced on this number since the baseline moves the balance, whoever it belongs to.
  const held = await db
    .select()
    .from(credits)
    .where(and(eq(credits.simId, sim.id), gte(credits.receivedAt, tx.baselineAt)));
  const smsTotal = held.reduce((s, c) => s + c.amountMillimes, 0);
  const matched = held.filter((c) => c.txId === tx.id && c.status === "matched");
  const matchedTotal = matched.reduce((s, c) => s + c.amountMillimes, 0);
  const delta = balance - tx.baselineBalanceMillimes;

  if (delta === smsTotal) {
    if (held.length > 0) {
      await db
        .update(credits)
        .set({ balanceVerified: true })
        .where(inArray(credits.id, held.map((c) => c.id)));
    }
    const newlyConfirmed = matchedTotal - tx.confirmedMillimes;
    await updateTx(db, tx.id, { confirmedMillimes: matchedTotal, verifyAttempts: 0, unexplainedSince: null });
    if (newlyConfirmed > 0) {
      await logEvent(db, tx.id, "credit_confirmed", "system", {
        amountMillimes: newlyConfirmed,
        totalMillimes: matchedTotal,
        balanceMillimes: balance,
      });
    }
    const fresh = { ...tx, confirmedMillimes: matchedTotal };
    if (matchedTotal >= tx.declaredMillimes) {
      await finalize(db, fresh, matchedTotal, settings, "system", matchedTotal > tx.declaredMillimes ? "overpaid" : "complete");
    } else if (matchedTotal > 0) {
      if (tx.partialChoice === "accept") {
        await finalize(db, fresh, matchedTotal, settings, "seller", "accepted_partial");
      } else if (tx.status !== "partial") {
        await updateTx(db, tx.id, { status: "partial" });
        await logEvent(db, tx.id, "partial", "system", {
          confirmedMillimes: matchedTotal,
          missingMillimes: tx.declaredMillimes - matchedTotal,
        });
      }
    } else if (tx.status !== "awaiting_transfer") {
      await updateTx(db, tx.id, { status: "awaiting_transfer" });
    }
    return;
  }

  if (delta > smsTotal) {
    // Balance went up but no (or not enough) SMS yet. SMS can lag behind: wait, then escalate.
    const since = tx.unexplainedSince ?? new Date();
    if (!tx.unexplainedSince) {
      await updateTx(db, tx.id, { unexplainedSince: since });
      await logEvent(db, tx.id, "balance_without_sms", "system", { deltaMillimes: delta, smsMillimes: smsTotal }, true);
    }
    if (Date.now() - since.getTime() > settings.smsGraceSeconds * 1000) {
      await sendToReview(db, tx, "balance_without_sms", { deltaMillimes: delta, smsMillimes: smsTotal });
    } else {
      await enqueueBalanceCheck(db, sim, "verify", tx.id, settings.verifyRetrySeconds);
    }
    return;
  }

  // delta < smsTotal: an SMS announced more than the balance shows. Operators can lag; retry a few times.
  const attempts = tx.verifyAttempts + 1;
  await updateTx(db, tx.id, { verifyAttempts: attempts });
  if (attempts >= settings.verifyMaxAttempts) {
    await sendToReview(db, tx, "sms_not_in_balance", { deltaMillimes: delta, smsMillimes: smsTotal });
  } else {
    await enqueueBalanceCheck(db, sim, "verify", tx.id, settings.verifyRetrySeconds);
  }
}

/** Records a snapshot, updates the SIM balance and computes the unexplained change since the previous one. */
export async function recordSnapshot(db: DbTx, sim: Sim, balance: number, commandId: string) {
  const [prev] = await db
    .select()
    .from(balanceSnapshots)
    .where(eq(balanceSnapshots.simId, sim.id))
    .orderBy(desc(balanceSnapshots.takenAt))
    .limit(1);
  let discrepancy: number | null = null;
  if (prev) {
    const [{ total }] = await db
      .select({ total: sql<string>`coalesce(sum(${credits.amountMillimes}), 0)` })
      .from(credits)
      .where(and(eq(credits.simId, sim.id), gte(credits.receivedAt, prev.takenAt)));
    discrepancy = balance - (prev.balanceMillimes + Number(total));
  }
  await db.insert(balanceSnapshots).values({ simId: sim.id, balanceMillimes: balance, commandId, discrepancyMillimes: discrepancy });
  await db
    .update(sims)
    .set({ balanceMillimes: balance, balanceCheckedAt: new Date(), consecutiveFailures: 0 })
    .where(eq(sims.id, sim.id));
}
