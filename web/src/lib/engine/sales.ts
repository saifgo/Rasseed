import { and, asc, eq, gt, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  ACTIVE_TX_STATUSES,
  devices,
  operators,
  sims,
  transactions,
} from "@/db/schema";
import { grossPayout } from "@/lib/money";
import { normalizeMsisdn } from "@/lib/phone";
import { getSettings } from "@/lib/settings";
import { EngineError, enqueueBalanceCheck, finalize, lockTx, logEvent, releaseSim, updateTx } from "./core";

function newRef() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return "RS-" + Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

export type CreateSaleInput = {
  operatorCode: string;
  amountMillimes: number;
  senderMsisdn: string;
};

export async function createSale(userId: string, input: CreateSaleInput) {
  const [op] = await db.select().from(operators).where(eq(operators.code, input.operatorCode));
  if (!op || !op.active) throw new EngineError("operator_unavailable");
  if (!Number.isInteger(input.amountMillimes) || input.amountMillimes <= 0) throw new EngineError("invalid_amount");
  const sender = normalizeMsisdn(input.senderMsisdn);
  if (!sender) throw new EngineError("invalid_sender");

  if (grossPayout(input.amountMillimes, op.rateBps) <= 0) throw new EngineError("invalid_amount");

  const txId = await db.transaction(async (t) => {
    // One ongoing sale per seller: they must cancel or finish it before starting another.
    // Lock order (user, then sender) is fixed so concurrent requests cannot deadlock.
    await t.execute(sql`select pg_advisory_xact_lock(hashtext(${"user-sale:" + userId}))`);
    const ongoing = await t
      .select({ id: transactions.id })
      .from(transactions)
      .where(and(eq(transactions.userId, userId), inArray(transactions.status, ACTIVE_TX_STATUSES)))
      .limit(1);
    if (ongoing.length > 0) throw new EngineError("sale_in_progress");

    // Serialize sales per sender number so two sales can never wait on the same sender at once:
    // the sender number is what ties an operator SMS to a sale.
    await t.execute(sql`select pg_advisory_xact_lock(hashtext(${"sender:" + sender}))`);
    const busy = await t
      .select({ id: transactions.id })
      .from(transactions)
      .where(and(eq(transactions.senderMsisdn, sender), inArray(transactions.status, ACTIVE_TX_STATUSES)));
    if (busy.length > 0) throw new EngineError("sender_busy");

    const [row] = await t
      .insert(transactions)
      .values({
        ref: newRef(),
        userId,
        operatorCode: op.code,
        declaredMillimes: input.amountMillimes,
        senderMsisdn: sender,
        rateBps: op.rateBps,
        status: "queued",
      })
      .returning({ id: transactions.id });
    await logEvent(t, row.id, "created", "seller", {
      declaredMillimes: input.amountMillimes,
      rateBps: op.rateBps,
    });
    return row.id;
  });

  await assignQueued(op.code);
  return txId;
}

/**
 * Hands free numbers to queued sales, oldest first. A number is free when its SIM is active, configured,
 * not held, out of cooldown, recently reported by an online phone and not failing USSD.
 */
export async function assignQueued(operatorCode?: string) {
  const settings = await getSettings();
  const ops = operatorCode
    ? [operatorCode]
    : (await db.select({ code: operators.code }).from(operators).where(eq(operators.active, true))).map((o) => o.code);

  for (const code of ops) {
    for (let i = 0; i < 50; i++) {
      const assigned = await db.transaction(async (t) => {
        const [tx] = await t
          .select()
          .from(transactions)
          .where(and(eq(transactions.status, "queued"), eq(transactions.operatorCode, code)))
          .orderBy(asc(transactions.queuedAt))
          .limit(1)
          .for("update", { skipLocked: true });
        if (!tx) return false;

        const onlineSince = new Date(Date.now() - settings.deviceOfflineSeconds * 1000);
        const [sim] = await t
          .select({ sim: sims })
          .from(sims)
          .innerJoin(devices, eq(devices.id, sims.deviceId))
          .where(
            and(
              eq(sims.status, "active"),
              eq(sims.operatorCode, code),
              isNull(sims.heldByTxId),
              or(isNull(sims.cooldownUntil), lt(sims.cooldownUntil, new Date())),
              lt(sims.consecutiveFailures, settings.maxSimFailures),
              gt(sims.lastReportedAt, onlineSince),
              eq(devices.enabled, true),
              gt(devices.lastSeenAt, onlineSince),
            ),
          )
          .orderBy(sql`${sims.lastAssignedAt} asc nulls first`)
          .limit(1)
          .for("update", { of: sims, skipLocked: true });
        if (!sim || !sim.sim.msisdn) return false;

        await t
          .update(sims)
          .set({ heldByTxId: tx.id, lastAssignedAt: new Date() })
          .where(eq(sims.id, sim.sim.id));
        await updateTx(t, tx.id, {
          status: "assigning",
          simId: sim.sim.id,
          assignedMsisdn: sim.sim.msisdn,
          assignAttempts: tx.assignAttempts + 1,
        });
        await enqueueBalanceCheck(t, sim.sim, "baseline", tx.id);
        await logEvent(t, tx.id, "assigning", "system", { simId: sim.sim.id }, true);
        return true;
      });
      if (!assigned) break;
    }
  }
}

export async function cancelSale(userId: string, txId: string) {
  const settings = await getSettings();
  await db.transaction(async (t) => {
    const tx = await lockTx(t, txId);
    if (!tx || tx.userId !== userId) throw new EngineError("not_found");
    if (!["queued", "assigning", "awaiting_transfer"].includes(tx.status)) throw new EngineError("cannot_cancel");
    if (tx.smsReceivedMillimes > 0 || tx.confirmedMillimes > 0 || tx.unexplainedSince) {
      throw new EngineError("cannot_cancel");
    }
    await updateTx(t, tx.id, { status: "cancelled", completedAt: new Date() });
    await releaseSim(t, tx.simId, settings);
    await logEvent(t, tx.id, "cancelled", "seller");
  });
  await assignQueued();
}

/** Seller decision when only part of the declared amount was confirmed. */
export async function choosePartial(userId: string, txId: string, choice: "topup" | "accept") {
  const settings = await getSettings();
  await db.transaction(async (t) => {
    const tx = await lockTx(t, txId);
    if (!tx || tx.userId !== userId) throw new EngineError("not_found");
    if (tx.status !== "partial") throw new EngineError("invalid_state");
    if (choice === "accept") {
      await updateTx(t, tx.id, { partialChoice: "accept" });
      await logEvent(t, tx.id, "partial_accepted", "seller", { confirmedMillimes: tx.confirmedMillimes });
      await finalize(t, tx, tx.confirmedMillimes, settings, "seller", "accepted_partial");
    } else {
      await updateTx(t, tx.id, { partialChoice: "topup" });
      await logEvent(t, tx.id, "topup_chosen", "seller", {
        missingMillimes: tx.declaredMillimes - tx.confirmedMillimes,
      });
    }
  });
  await assignQueued();
}
