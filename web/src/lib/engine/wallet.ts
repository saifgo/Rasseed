import { and, desc, eq, sql } from "drizzle-orm";
import { db, type DbTx } from "@/db";
import { payoutMethods, savedPayoutDetails, users, walletEntries, withdrawals, type WalletEntryKind } from "@/db/schema";
import { payoutFee } from "@/lib/money";
import { normalizeMsisdn } from "@/lib/phone";
import { getSettings } from "@/lib/settings";
import { EngineError } from "./core";

function newRef() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return "WD-" + Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

/** Current balance = sum of the ledger. Pending withdrawals are already deducted. */
export async function getBalance(dbx: DbTx | typeof db, userId: string): Promise<number> {
  const [{ total }] = await dbx
    .select({ total: sql<string>`coalesce(sum(${walletEntries.amountMillimes}), 0)` })
    .from(walletEntries)
    .where(eq(walletEntries.userId, userId));
  return Number(total);
}

/** Serializes every balance change of a user (the users row is the lock). */
async function lockUser(t: DbTx, userId: string) {
  const [u] = await t.select().from(users).where(eq(users.id, userId)).for("update");
  if (!u) throw new EngineError("not_found");
  return u;
}

export async function addEntry(
  t: DbTx,
  entry: {
    userId: string;
    kind: WalletEntryKind;
    amountMillimes: number;
    txId?: string | null;
    withdrawalId?: string | null;
    note?: string | null;
    createdBy?: string | null;
  },
) {
  if (!Number.isInteger(entry.amountMillimes) || entry.amountMillimes === 0) throw new EngineError("invalid_amount");
  const [row] = await t.insert(walletEntries).values(entry).returning();
  return row;
}

export type WithdrawalInput = { amountMillimes: number; methodCode: string; details: Record<string, string> };

/** Seller asks for (part of) the balance to be sent. The amount leaves the balance immediately. */
export async function requestWithdrawal(userId: string, input: WithdrawalInput) {
  const settings = await getSettings();
  if (!Number.isInteger(input.amountMillimes) || input.amountMillimes <= 0) throw new EngineError("invalid_amount");
  if (input.amountMillimes < settings.minWithdrawalMillimes) throw new EngineError("below_minimum");

  const [method] = await db.select().from(payoutMethods).where(eq(payoutMethods.code, input.methodCode));
  if (!method || !method.active) throw new EngineError("payout_method_unavailable");
  const details: Record<string, string> = {};
  for (const f of method.fields) {
    const v = (input.details[f.key] ?? "").trim();
    if (f.required && !v) throw new EngineError("payout_details_missing");
    if (v && f.type === "phone" && !normalizeMsisdn(v)) throw new EngineError("payout_phone_invalid");
    if (v) details[f.key] = f.type === "phone" ? normalizeMsisdn(v)! : v.slice(0, 200);
  }
  const fee = payoutFee(input.amountMillimes, method);
  const net = input.amountMillimes - fee;
  if (net <= 0) throw new EngineError("payout_below_fee");

  return db.transaction(async (t) => {
    const user = await lockUser(t, userId);
    if (user.blocked) throw new EngineError("not_found");
    const balance = await getBalance(t, userId);
    if (input.amountMillimes > balance) throw new EngineError("insufficient_balance");
    const [w] = await t
      .insert(withdrawals)
      .values({
        ref: newRef(),
        userId,
        methodCode: method.code,
        details,
        grossMillimes: input.amountMillimes,
        feeMillimes: fee,
        netMillimes: net,
      })
      .returning();
    await addEntry(t, { userId, kind: "withdrawal", amountMillimes: -input.amountMillimes, withdrawalId: w.id });
    await t
      .insert(savedPayoutDetails)
      .values({ userId, methodCode: method.code, details })
      .onConflictDoUpdate({
        target: [savedPayoutDetails.userId, savedPayoutDetails.methodCode],
        set: { details, updatedAt: new Date() },
      });
    return w.id;
  });
}

export async function markWithdrawalPaid(
  staffId: string,
  withdrawalId: string,
  input: { reference?: string; note?: string; proofPath?: string; proofMime?: string },
) {
  await db.transaction(async (t) => {
    const [w] = await t.select().from(withdrawals).where(eq(withdrawals.id, withdrawalId)).for("update");
    if (!w) throw new EngineError("not_found");
    if (w.status !== "pending") throw new EngineError("invalid_state");
    await t
      .update(withdrawals)
      .set({
        status: "paid",
        paidAt: new Date(),
        paidBy: staffId,
        reference: input.reference || null,
        note: input.note || null,
        proofPath: input.proofPath ?? null,
        proofMime: input.proofMime ?? null,
      })
      .where(eq(withdrawals.id, w.id));
  });
}

/** Staff refuses the request; the full amount (fee included) goes back to the balance. */
export async function rejectWithdrawal(staffId: string, withdrawalId: string, reason: string) {
  const text = reason.trim().slice(0, 1000);
  if (!text) throw new EngineError("reason_required");
  await db.transaction(async (t) => {
    const [w] = await t.select().from(withdrawals).where(eq(withdrawals.id, withdrawalId)).for("update");
    if (!w) throw new EngineError("not_found");
    if (w.status !== "pending") throw new EngineError("invalid_state");
    await lockUser(t, w.userId);
    await t
      .update(withdrawals)
      .set({ status: "rejected", rejectedAt: new Date(), rejectedBy: staffId, rejectReason: text })
      .where(eq(withdrawals.id, w.id));
    await addEntry(t, {
      userId: w.userId,
      kind: "withdrawal_refund",
      amountMillimes: w.grossMillimes,
      withdrawalId: w.id,
      note: text,
      createdBy: staffId,
    });
  });
}

/** Attaches (or replaces) the proof on an already-paid withdrawal. */
export async function attachWithdrawalProof(withdrawalId: string, proofPath: string, proofMime: string) {
  const [w] = await db.select({ status: withdrawals.status }).from(withdrawals).where(eq(withdrawals.id, withdrawalId));
  if (!w) throw new EngineError("not_found");
  if (w.status !== "paid") throw new EngineError("invalid_state");
  await db.update(withdrawals).set({ proofPath, proofMime }).where(eq(withdrawals.id, withdrawalId));
}

/** Manual correction or bonus by staff. The note is mandatory and shown to the seller. */
export async function adjustBalance(staffId: string, userId: string, amountMillimes: number, note: string) {
  const text = note.trim().slice(0, 1000);
  if (!text) throw new EngineError("reason_required");
  if (!Number.isInteger(amountMillimes) || amountMillimes === 0) throw new EngineError("invalid_amount");
  await db.transaction(async (t) => {
    await lockUser(t, userId);
    const balance = await getBalance(t, userId);
    if (balance + amountMillimes < 0) throw new EngineError("insufficient_balance");
    await addEntry(t, { userId, kind: "adjustment", amountMillimes, note: text, createdBy: staffId });
  });
}

export async function listUserWithdrawals(userId: string) {
  return db
    .select({ w: withdrawals, method: payoutMethods })
    .from(withdrawals)
    .innerJoin(payoutMethods, eq(payoutMethods.code, withdrawals.methodCode))
    .where(eq(withdrawals.userId, userId))
    .orderBy(desc(withdrawals.createdAt))
    .limit(100);
}

export async function listUserEntries(userId: string) {
  return db
    .select()
    .from(walletEntries)
    .where(eq(walletEntries.userId, userId))
    .orderBy(desc(walletEntries.createdAt))
    .limit(200);
}

export async function pendingWithdrawalTotal(userId: string) {
  const [{ total }] = await db
    .select({ total: sql<string>`coalesce(sum(${withdrawals.grossMillimes}), 0)` })
    .from(withdrawals)
    .where(and(eq(withdrawals.userId, userId), eq(withdrawals.status, "pending")));
  return Number(total);
}
