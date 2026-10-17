import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { credits, operators, payouts, rateHistory, sims, transactions } from "@/db/schema";
import { grossPayout } from "@/lib/money";
import { normalizeMsisdn } from "@/lib/phone";
import { getSettings } from "@/lib/settings";
import { EngineError, enqueueBalanceCheck, finalize, lockSim, lockTx, logEvent, releaseSim, updateTx } from "./core";
import { assignQueued } from "./sales";

/** Admin decision for a sale in review: confirm a (possibly corrected) amount, or reject. */
export async function resolveReview(
  adminId: string,
  txId: string,
  decision: { action: "confirm"; amountMillimes: number; note?: string } | { action: "reject"; note?: string },
) {
  const settings = await getSettings();
  await db.transaction(async (t) => {
    const tx = await lockTx(t, txId);
    if (!tx) throw new EngineError("not_found");
    if (!["review", "awaiting_transfer", "verifying", "partial"].includes(tx.status)) throw new EngineError("invalid_state");
    if (decision.action === "confirm") {
      if (!Number.isInteger(decision.amountMillimes) || decision.amountMillimes <= 0) throw new EngineError("invalid_amount");
      await t
        .update(credits)
        .set({ resolvedBy: adminId })
        .where(and(eq(credits.txId, tx.id), eq(credits.status, "matched")));
      await logEvent(t, tx.id, "admin_confirmed", "admin", { amountMillimes: decision.amountMillimes, note: decision.note ?? null });
      await finalize(t, tx, decision.amountMillimes, settings, "admin", "admin_review");
    } else {
      await updateTx(t, tx.id, { status: "rejected", completedAt: new Date() });
      await releaseSim(t, tx.simId, settings);
      await logEvent(t, tx.id, "rejected", "admin", { note: decision.note ?? null });
    }
  });
  await assignQueued();
}

/** Applies a late or unmatched credit to a sale: raises the final amount and the pending payout. */
export async function applyCredit(adminId: string, creditId: string, txRef: string) {
  const settings = await getSettings();
  await db.transaction(async (t) => {
    const [credit] = await t.select().from(credits).where(eq(credits.id, creditId)).for("update");
    if (!credit || !["late", "unmatched"].includes(credit.status)) throw new EngineError("invalid_state");
    const [txRow] = await t.select({ id: transactions.id }).from(transactions).where(eq(transactions.ref, txRef.trim().toUpperCase()));
    if (!txRow) throw new EngineError("not_found");
    const tx = (await lockTx(t, txRow.id))!;

    if (tx.status === "confirmed") {
      const [payout] = await t.select().from(payouts).where(eq(payouts.txId, tx.id)).for("update");
      if (!payout || payout.status !== "pending") throw new EngineError("payout_already_paid");
      const finalMillimes = (tx.finalMillimes ?? 0) + credit.amountMillimes;
      const gross = grossPayout(finalMillimes, tx.rateBps);
      const net = Math.max(0, gross - tx.payoutFeeMillimes);
      await updateTx(t, tx.id, { finalMillimes, payoutGrossMillimes: gross, payoutNetMillimes: net });
      await t.update(payouts).set({ grossMillimes: gross, netMillimes: net }).where(eq(payouts.id, payout.id));
    } else if (["expired", "cancelled"].includes(tx.status)) {
      await finalize(t, tx, credit.amountMillimes, settings, "admin", "late_credit");
    } else {
      throw new EngineError("invalid_state");
    }
    await t
      .update(credits)
      .set({ status: "applied", txId: tx.id, resolvedBy: adminId })
      .where(eq(credits.id, credit.id));
    await logEvent(t, tx.id, "late_credit_applied", "admin", { amountMillimes: credit.amountMillimes });
  });
}

export async function rejectCredit(adminId: string, creditId: string, note: string) {
  const [credit] = await db.select().from(credits).where(eq(credits.id, creditId));
  if (!credit || !["late", "unmatched"].includes(credit.status)) throw new EngineError("invalid_state");
  await db.update(credits).set({ status: "rejected", resolvedBy: adminId, note }).where(eq(credits.id, creditId));
}

export async function markPaid(
  adminId: string,
  payoutId: string,
  input: { reference?: string; note?: string; proofPath?: string; proofMime?: string },
) {
  await db.transaction(async (t) => {
    const [payout] = await t.select().from(payouts).where(eq(payouts.id, payoutId)).for("update");
    if (!payout) throw new EngineError("not_found");
    if (payout.status === "paid") throw new EngineError("payout_already_paid");
    await t
      .update(payouts)
      .set({
        status: "paid",
        paidAt: new Date(),
        paidBy: adminId,
        reference: input.reference || null,
        note: input.note || null,
        proofPath: input.proofPath ?? null,
        proofMime: input.proofMime ?? null,
      })
      .where(eq(payouts.id, payout.id));
    await updateTx(t, payout.txId, { status: "paid" });
    await logEvent(t, payout.txId, "paid", "admin", { netMillimes: payout.netMillimes, reference: input.reference || null });
  });
}

/** Attaches (or replaces) the proof on an already-paid payout. */
export async function attachProof(payoutId: string, proofPath: string, proofMime: string) {
  await db.update(payouts).set({ proofPath, proofMime }).where(eq(payouts.id, payoutId));
}

export async function setRate(adminId: string, operatorCode: string, rateBps: number) {
  if (!Number.isInteger(rateBps) || rateBps <= 0 || rateBps > 10_000) throw new EngineError("invalid_rate");
  await db.transaction(async (t) => {
    await t.update(operators).set({ rateBps, updatedAt: new Date() }).where(eq(operators.code, operatorCode));
    await t.insert(rateHistory).values({ operatorCode, rateBps, setBy: adminId });
  });
}

export async function configureSim(
  simId: string,
  input: { operatorCode: string | null; msisdn: string | null; status: "unconfigured" | "active" | "disabled" },
) {
  const msisdn = input.msisdn ? normalizeMsisdn(input.msisdn) : null;
  if (input.msisdn && !msisdn) throw new EngineError("invalid_msisdn");
  if (input.status === "active" && (!msisdn || !input.operatorCode)) throw new EngineError("sim_incomplete");
  if (msisdn) {
    const [dup] = await db.select({ id: sims.id }).from(sims).where(and(eq(sims.msisdn, msisdn), ne(sims.id, simId)));
    if (dup) throw new EngineError("msisdn_in_use");
  }
  await db.transaction(async (t) => {
    const sim = await lockSim(t, simId);
    if (!sim) throw new EngineError("not_found");
    const identityChanged = sim.msisdn !== msisdn || sim.operatorCode !== input.operatorCode;
    if (sim.heldByTxId && identityChanged) throw new EngineError("sim_busy");
    await t
      .update(sims)
      .set({
        operatorCode: input.operatorCode,
        msisdn,
        status: input.status,
        // After a configuration change the SIM gets a clean slate.
        ...(identityChanged ? { balanceMillimes: null, balanceCheckedAt: null, consecutiveFailures: 0 } : {}),
      })
      .where(eq(sims.id, simId));
    if (input.operatorCode) {
      const fresh = (await lockSim(t, simId))!;
      await enqueueBalanceCheck(t, fresh, "manual", null);
    }
  });
  await assignQueued();
}

export async function requestBalanceCheck(simId: string) {
  await db.transaction(async (t) => {
    const sim = await lockSim(t, simId);
    if (!sim) throw new EngineError("not_found");
    if (!sim.operatorCode) throw new EngineError("sim_incomplete");
    await enqueueBalanceCheck(t, sim, "manual", sim.heldByTxId);
  });
}

/** Clears the failure counter so a SIM is used again after fixing it. */
export async function resetSimFailures(simId: string) {
  await db.update(sims).set({ consecutiveFailures: 0 }).where(eq(sims.id, simId));
  await assignQueued();
}
