import { and, eq, inArray, lt, notExists, sql } from "drizzle-orm";
import { db } from "@/db";
import { deviceCommands, sims, transactions } from "@/db/schema";
import { getSettings } from "@/lib/settings";
import { enqueueBalanceCheck, finalize, lockSim, lockTx, logEvent, releaseSim, updateTx } from "./core";
import { onCommandFailure } from "./device";
import { assignQueued } from "./sales";

/** Time-based work. Safe to run concurrently: every step locks the rows it changes. */
export async function tick() {
  const settings = await getSettings();
  const now = new Date();

  // 1. USSD commands that never came back.
  const timeoutBefore = new Date(now.getTime() - settings.commandTimeoutSeconds * 1000);
  const stale = await db
    .select({ id: deviceCommands.id })
    .from(deviceCommands)
    .where(
      and(
        inArray(deviceCommands.status, ["pending", "sent"]),
        lt(sql`coalesce(${deviceCommands.sentAt}, ${deviceCommands.notBefore})`, timeoutBefore.toISOString()),
      ),
    );
  for (const { id } of stale) {
    await db.transaction(async (t) => {
      const [cmd] = await t
        .select()
        .from(deviceCommands)
        .where(and(eq(deviceCommands.id, id), inArray(deviceCommands.status, ["pending", "sent"])))
        .for("update", { skipLocked: true });
      if (!cmd) return;
      await t
        .update(deviceCommands)
        .set({ status: "timeout", completedAt: new Date(), error: cmd.status === "pending" ? "device_offline" : "no_result" })
        .where(eq(deviceCommands.id, cmd.id));
      const sim = await lockSim(t, cmd.simId);
      if (sim) await onCommandFailure(t, cmd, sim, settings);
    });
  }

  // 2. Hold window over.
  const due = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(and(inArray(transactions.status, ["awaiting_transfer", "partial"]), lt(transactions.expiresAt, now)));
  for (const { id } of due) {
    await db.transaction(async (t) => {
      const tx = await lockTx(t, id);
      if (!tx || !["awaiting_transfer", "partial"].includes(tx.status) || !tx.expiresAt || tx.expiresAt > new Date()) return;
      // Never close while something is unexplained or not yet verified; reconciliation decides first.
      if (tx.unexplainedSince || tx.smsReceivedMillimes > tx.confirmedMillimes) return;
      if (tx.confirmedMillimes > 0) {
        await logEvent(t, tx.id, "expired_partial", "system", { confirmedMillimes: tx.confirmedMillimes });
        await finalize(t, tx, tx.confirmedMillimes, settings, "system", "expired_partial");
      } else {
        await updateTx(t, tx.id, { status: "expired", completedAt: new Date() });
        await releaseSim(t, tx.simId, settings);
        await logEvent(t, tx.id, "expired", "system");
      }
    });
  }

  // 3. Waited too long in the queue.
  const queueBefore = new Date(now.getTime() - settings.queueTimeoutMinutes * 60 * 1000);
  const longQueued = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(and(eq(transactions.status, "queued"), lt(transactions.queuedAt, queueBefore)));
  for (const { id } of longQueued) {
    await db.transaction(async (t) => {
      const tx = await lockTx(t, id);
      if (!tx || tx.status !== "queued") return;
      await updateTx(t, tx.id, { status: "cancelled", completedAt: new Date() });
      await logEvent(t, tx.id, "queue_timeout", "system");
    });
  }

  // 4. Poll balances of held numbers: catches credit that arrives without an SMS.
  const pollBefore = new Date(now.getTime() - settings.pollIntervalSeconds * 1000);
  const toPoll = await db
    .select({ sim: sims, txId: transactions.id })
    .from(sims)
    .innerJoin(transactions, eq(transactions.id, sims.heldByTxId))
    .where(
      and(
        inArray(transactions.status, ["awaiting_transfer", "partial", "verifying"]),
        notExists(
          db
            .select({ one: sql`1` })
            .from(deviceCommands)
            .where(
              and(
                eq(deviceCommands.simId, sims.id),
                sql`(${deviceCommands.status} in ('pending','sent') or ${deviceCommands.createdAt} > ${pollBefore.toISOString()})`,
              ),
            ),
        ),
      ),
    );
  for (const { sim, txId } of toPoll) {
    await db.transaction(async (t) => enqueueBalanceCheck(t, sim, "poll", txId));
  }

  // 5. Fill free numbers.
  await assignQueued();
}
