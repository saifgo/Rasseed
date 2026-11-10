import { and, asc, desc, eq, gt, gte, isNull, lt, or, sql } from "drizzle-orm";
import { db, type DbTx } from "@/db";
import {
  credits,
  deviceCommands,
  devices,
  operators,
  recharges,
  sims,
  users,
  type RechargeStatus,
} from "@/db/schema";
import { renderTransferUssd } from "@/lib/parsers";
import { sendOutcome } from "@/lib/recharge-outcome";
import { normalizeMsisdn } from "@/lib/phone";
import { getSettings, type AppSettings } from "@/lib/settings";
import { EngineError, lockSim, releaseSim, type Sim } from "./core";
import { move } from "./ledger";
import { canUseMarketplace } from "./market";
import { lockUser } from "./wallet";

/**
 * Buyer recharges: an agent phone sends credit from one of Sarfli's SIMs to a customer number.
 * 1. The amount is reserved from the buyer's balance for that operator.
 * 2. A free SIM is held, its balance read (baseline), then the transfer USSD is sent once.
 * 3. The balance is read again. Dropped by exactly the amount → success; unchanged and the phone
 *    reported a failure → failed, the amount goes back. Anything else → an admin decides.
 * A send is never repeated automatically.
 */

export type Recharge = typeof recharges.$inferSelect;

function newRef() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return "RC-" + Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

async function lockRecharge(t: DbTx, id: string) {
  const [r] = await t.select().from(recharges).where(eq(recharges.id, id)).for("update");
  return r;
}

async function updateRecharge(t: DbTx, id: string, values: Partial<Recharge>) {
  await t
    .update(recharges)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(recharges.id, id));
}

export type RechargeInput = { operatorCode: string; msisdn: string; amountMillimes: number };

export async function createRecharge(buyerId: string, input: RechargeInput) {
  const settings = await getSettings();
  const [user] = await db.select().from(users).where(eq(users.id, buyerId));
  if (!canUseMarketplace(user ?? null, settings)) throw new EngineError("marketplace_closed");
  const [op] = await db.select().from(operators).where(eq(operators.code, input.operatorCode));
  if (!op || !op.active) throw new EngineError("operator_unavailable");
  if (!op.rechargeUssdTemplate) throw new EngineError("recharge_unavailable");
  if (!Number.isInteger(input.amountMillimes) || input.amountMillimes <= 0) throw new EngineError("invalid_amount");
  const msisdn = normalizeMsisdn(input.msisdn);
  if (!msisdn) throw new EngineError("invalid_msisdn");

  const id = await db.transaction(async (t) => {
    await lockUser(t, buyerId);
    const [r] = await t
      .insert(recharges)
      .values({ ref: newRef(), buyerId, operatorCode: op.code, msisdn, amountMillimes: input.amountMillimes, status: "queued" })
      .returning({ id: recharges.id });
    // Throws insufficient_credit when the buyer's balance for this operator is too low.
    await move(t, {
      kind: "recharge_reserve",
      operatorCode: op.code,
      legs: [
        { bucket: "buyer", userId: buyerId, amountMillimes: -input.amountMillimes },
        { bucket: "recharge", rechargeId: r.id, amountMillimes: input.amountMillimes },
      ],
    });
    return r.id;
  });
  await assignRecharges(op.code);
  return id;
}

/** A queued recharge can be cancelled by the buyer (nothing was sent yet). */
export async function cancelRecharge(buyerId: string, rechargeId: string) {
  await db.transaction(async (t) => {
    const r = await lockRecharge(t, rechargeId);
    if (!r || r.buyerId !== buyerId) throw new EngineError("not_found");
    if (r.status !== "queued") throw new EngineError("cannot_cancel");
    await refund(t, r, "cancelled_by_buyer");
    await updateRecharge(t, r.id, { status: "failed", reviewReason: null, note: "cancelled", completedAt: new Date() });
  });
}

async function refund(t: DbTx, r: Recharge, note: string, staffId?: string | null) {
  await lockUser(t, r.buyerId);
  await move(t, {
    kind: "recharge_refund",
    operatorCode: r.operatorCode,
    note,
    createdBy: staffId ?? null,
    legs: [
      { bucket: "recharge", rechargeId: r.id, amountMillimes: -r.amountMillimes },
      { bucket: "buyer", userId: r.buyerId, amountMillimes: r.amountMillimes },
    ],
  });
}

async function markSent(t: DbTx, r: Recharge, staffId?: string | null, note?: string | null) {
  await move(t, {
    kind: "recharge_sent",
    operatorCode: r.operatorCode,
    note: note ?? null,
    createdBy: staffId ?? null,
    legs: [
      { bucket: "recharge", rechargeId: r.id, amountMillimes: -r.amountMillimes },
      { bucket: "external", amountMillimes: r.amountMillimes },
    ],
  });
}

async function finish(t: DbTx, r: Recharge, status: Extract<RechargeStatus, "succeeded" | "failed">, settings: AppSettings) {
  if (status === "succeeded") await markSent(t, r);
  else await refund(t, r, "send_failed");
  await updateRecharge(t, r.id, { status, completedAt: new Date(), reviewReason: null });
  await freeSim(t, r.simId, settings);
}

async function toReview(t: DbTx, r: Recharge, reason: string) {
  // The SIM stays held until an admin looks at it, like a sale in review.
  await updateRecharge(t, r.id, { status: "review", reviewReason: reason });
}

async function freeSim(t: DbTx, simId: string | null, settings: AppSettings) {
  if (!simId) return;
  await t.update(sims).set({ heldByRechargeId: null }).where(eq(sims.id, simId));
  await releaseSim(t, simId, settings);
}

async function enqueueRechargeBalance(t: DbTx, sim: Sim, purpose: "recharge_baseline" | "recharge_verify", r: Recharge, delaySeconds = 0) {
  const [op] = sim.operatorCode ? await t.select().from(operators).where(eq(operators.code, sim.operatorCode)) : [];
  if (!op || sim.operatorCode !== r.operatorCode) {
    // The SIM was reconfigured or swapped: its balance no longer tells what happened.
    await toReview(t, r, "sim_changed");
    return;
  }
  await t.insert(deviceCommands).values({
    deviceId: sim.deviceId,
    simId: sim.id,
    type: "ussd_balance",
    ussdCode: op.balanceUssdCode,
    purpose,
    rechargeId: r.id,
    notBefore: new Date(Date.now() + delaySeconds * 1000),
  });
}

/** The SIM holding a recharge was swapped in its slot: an admin must decide. */
export async function rechargeSimChanged(t: DbTx, rechargeId: string) {
  const r = await lockRecharge(t, rechargeId);
  if (r && r.status === "sending") await toReview(t, r, "sim_changed");
}

/**
 * Hands free SIMs with enough balance to queued recharges, oldest first, per operator.
 * A recharge no SIM can serve right now is skipped, so it never blocks the ones behind it.
 */
export async function assignRecharges(operatorCode?: string) {
  const settings = await getSettings();
  const queued = await db
    .select({ id: recharges.id })
    .from(recharges)
    .where(and(eq(recharges.status, "queued"), operatorCode ? eq(recharges.operatorCode, operatorCode) : undefined))
    .orderBy(asc(recharges.createdAt))
    .limit(100);
  for (const { id } of queued) {
    await db.transaction(async (t) => {
      const [r] = await t
        .select()
        .from(recharges)
        .where(and(eq(recharges.id, id), eq(recharges.status, "queued")))
        .for("update", { skipLocked: true });
      if (!r) return;
      const onlineSince = new Date(Date.now() - settings.deviceOfflineSeconds * 1000);
      const [row] = await t
        .select({ sim: sims })
        .from(sims)
        .innerJoin(devices, eq(devices.id, sims.deviceId))
        .where(
          and(
            eq(sims.status, "active"),
            eq(sims.operatorCode, r.operatorCode),
            isNull(sims.heldByTxId),
            isNull(sims.heldByRechargeId),
            or(isNull(sims.cooldownUntil), lt(sims.cooldownUntil, new Date())),
            lt(sims.consecutiveFailures, settings.maxSimFailures),
            gt(sims.lastReportedAt, onlineSince),
            gte(sims.balanceMillimes, r.amountMillimes),
            eq(devices.enabled, true),
            gt(devices.lastSeenAt, onlineSince),
          ),
        )
        .orderBy(desc(sims.balanceMillimes))
        .limit(1)
        .for("update", { of: sims, skipLocked: true });
      if (!row) return;
      await t.update(sims).set({ heldByRechargeId: r.id }).where(eq(sims.id, row.sim.id));
      await updateRecharge(t, r.id, { status: "sending", simId: row.sim.id });
      await enqueueRechargeBalance(t, row.sim, "recharge_baseline", { ...r, status: "sending", simId: row.sim.id });
    });
  }
}

/** Credits announced on the SIM since the baseline: they raise the balance whatever the recharge did. */
async function incomingSince(t: DbTx, simId: string, since: Date) {
  const [{ total }] = await t
    .select({ total: sql<string>`coalesce(sum(${credits.amountMillimes}), 0)` })
    .from(credits)
    .where(and(eq(credits.simId, simId), gte(credits.receivedAt, since)));
  return Number(total);
}

/** Balance read for a recharge (baseline or verification). Called inside the command-result transaction. */
export async function onRechargeBalance(t: DbTx, cmd: typeof deviceCommands.$inferSelect, sim: Sim, balance: number) {
  if (!cmd.rechargeId) return;
  const settings = await getSettings();
  const r = await lockRecharge(t, cmd.rechargeId);
  if (!r || r.status !== "sending" || r.simId !== sim.id) return;

  if (cmd.purpose === "recharge_baseline") {
    if (r.sendCommandId) return;
    if (balance < r.amountMillimes) {
      // Not enough credit on this SIM after all: try another one. Nothing was sent.
      await freeSim(t, sim.id, settings);
      await updateRecharge(t, r.id, { status: "queued", simId: null });
      return;
    }
    const [op] = await t.select().from(operators).where(eq(operators.code, r.operatorCode));
    if (!op?.rechargeUssdTemplate) {
      await freeSim(t, sim.id, settings);
      await updateRecharge(t, r.id, { status: "queued", simId: null });
      return;
    }
    const ussd = renderTransferUssd(op.rechargeUssdTemplate, r.msisdn, r.amountMillimes);
    const steps = op.rechargeUssdSteps.map((s) => renderTransferUssd(s, r.msisdn, r.amountMillimes));
    const [send] = await t
      .insert(deviceCommands)
      .values({ deviceId: sim.deviceId, simId: sim.id, type: "ussd_send", ussdCode: ussd, steps, purpose: "recharge_send", rechargeId: r.id })
      .returning({ id: deviceCommands.id });
    await updateRecharge(t, r.id, { baselineBalanceMillimes: balance, baselineAt: new Date(), sendCommandId: send.id });
    return;
  }

  if (cmd.purpose !== "recharge_verify" || r.baselineBalanceMillimes == null || !r.baselineAt) return;
  // A credit announced between the phone reading the baseline and the server storing it may or may not
  // be in the baseline: the arithmetic below can't tell, so an admin decides.
  const [baselineCmd] = await t
    .select({ sentAt: deviceCommands.sentAt, createdAt: deviceCommands.createdAt })
    .from(deviceCommands)
    .where(and(eq(deviceCommands.rechargeId, r.id), eq(deviceCommands.purpose, "recharge_baseline"), eq(deviceCommands.status, "succeeded")))
    .orderBy(desc(deviceCommands.createdAt))
    .limit(1);
  const readFrom = baselineCmd?.sentAt ?? baselineCmd?.createdAt ?? r.baselineAt;
  const [overlap] = await t
    .select({ id: credits.id })
    .from(credits)
    .where(and(eq(credits.simId, sim.id), gte(credits.receivedAt, readFrom), lt(credits.receivedAt, r.baselineAt)))
    .limit(1);
  if (overlap) {
    await updateRecharge(t, r.id, { afterBalanceMillimes: balance });
    return toReview(t, r, "credit_during_baseline");
  }
  const incoming = await incomingSince(t, sim.id, r.baselineAt);
  const ifSent = r.baselineBalanceMillimes + incoming - r.amountMillimes;
  const ifNotSent = r.baselineBalanceMillimes + incoming;
  await updateRecharge(t, r.id, { afterBalanceMillimes: balance });

  if (balance === ifSent) return finish(t, { ...r, afterBalanceMillimes: balance }, "succeeded", settings);
  if (balance === ifNotSent && r.sendOk === false) return finish(t, r, "failed", settings);
  // Unchanged after a reported success, or an unexpected amount: operators can lag, look again a few times.
  const attempts = r.verifyAttempts + 1;
  await updateRecharge(t, r.id, { verifyAttempts: attempts });
  if (attempts >= settings.rechargeVerifyAttempts) {
    await toReview(t, r, balance === ifNotSent ? "balance_unchanged" : "balance_mismatch");
  } else {
    await enqueueRechargeBalance(t, sim, "recharge_verify", r, settings.verifyRetrySeconds);
  }
}

/** Result (or timeout, ok = null) of the send USSD. The outcome is decided by the balance, never by a retry. */
export async function onRechargeSent(
  t: DbTx,
  cmd: typeof deviceCommands.$inferSelect,
  ok: boolean | null,
  response: string | null,
  error: string | null,
) {
  if (!cmd.rechargeId) return;
  const settings = await getSettings();
  const r = await lockRecharge(t, cmd.rechargeId);
  if (!r || r.status !== "sending" || r.sendCommandId !== cmd.id) return;
  await updateRecharge(t, r.id, { sendOk: sendOutcome(ok, error), sendResponse: response, sendError: error });
  const sim = await lockSim(t, cmd.simId);
  if (!sim) return toReview(t, r, "sim_missing");
  await enqueueRechargeBalance(t, sim, "recharge_verify", r, settings.verifyRetrySeconds);
}

/** A balance read for a recharge failed or timed out. */
export async function onRechargeBalanceFailure(t: DbTx, cmd: typeof deviceCommands.$inferSelect, sim: Sim) {
  if (!cmd.rechargeId) return;
  const settings = await getSettings();
  const r = await lockRecharge(t, cmd.rechargeId);
  if (!r || r.status !== "sending" || r.simId !== sim.id) return;
  if (cmd.purpose === "recharge_baseline") {
    if (r.sendCommandId) return;
    await freeSim(t, sim.id, settings);
    await updateRecharge(t, r.id, { status: "queued", simId: null });
    return;
  }
  const attempts = r.verifyAttempts + 1;
  await updateRecharge(t, r.id, { verifyAttempts: attempts });
  if (attempts >= settings.rechargeVerifyAttempts) await toReview(t, r, "balance_check_failed");
  else await enqueueRechargeBalance(t, sim, "recharge_verify", r, settings.verifyRetrySeconds);
}

/** Admin decides a recharge in review: the customer got the credit (succeeded) or not (failed, amount back to the buyer). */
export async function resolveRecharge(staffId: string, rechargeId: string, outcome: "succeeded" | "failed", note: string) {
  const text = note.trim().slice(0, 1000);
  if (!text) throw new EngineError("reason_required");
  const settings = await getSettings();
  await db.transaction(async (t) => {
    const r = await lockRecharge(t, rechargeId);
    if (!r) throw new EngineError("not_found");
    if (r.status !== "review") throw new EngineError("invalid_state");
    if (outcome === "succeeded") await markSent(t, r, staffId, text);
    else await refund(t, r, text, staffId);
    await updateRecharge(t, r.id, { status: outcome, resolvedBy: staffId, note: text, completedAt: new Date() });
    await freeSim(t, r.simId, settings);
  });
  await assignRecharges();
}

export async function listBuyerRecharges(buyerId: string) {
  return db.select().from(recharges).where(eq(recharges.buyerId, buyerId)).orderBy(desc(recharges.createdAt)).limit(100);
}
