import { and, eq, sql, type SQL } from "drizzle-orm";
import { db, type DbTx } from "@/db";
import { creditEntries, type CreditBucket } from "@/db/schema";
import { EngineError } from "./core";

/**
 * Credit ledger: tracks who owns each millime of phone credit sitting on Sarfli's SIMs.
 * A movement is a set of entries in different buckets that sums to zero. Callers lock the owner
 * (user row, order row, recharge row or the Sarfli lock) before moving credit out of a bucket.
 */

export type Leg = {
  bucket: CreditBucket;
  amountMillimes: number;
  userId?: string | null;
  orderId?: string | null;
  rechargeId?: string | null;
};

export type Movement = {
  kind: string;
  operatorCode: string;
  legs: Leg[];
  txId?: string | null;
  note?: string | null;
  createdBy?: string | null;
};

type Owner = { bucket: CreditBucket; operatorCode: string; userId?: string | null; orderId?: string | null; rechargeId?: string | null };

function ownerFilter(o: Owner): SQL {
  const parts: SQL[] = [eq(creditEntries.bucket, o.bucket), eq(creditEntries.operatorCode, o.operatorCode)];
  if (o.bucket === "seller_stock" || o.bucket === "buyer") parts.push(eq(creditEntries.userId, o.userId ?? ""));
  if (o.bucket === "order") parts.push(eq(creditEntries.orderId, o.orderId ?? sql`null`));
  if (o.bucket === "recharge") parts.push(eq(creditEntries.rechargeId, o.rechargeId ?? sql`null`));
  return and(...parts)!;
}

export async function bucketBalance(dbx: DbTx | typeof db, o: Owner): Promise<number> {
  const [{ total }] = await dbx
    .select({ total: sql<string>`coalesce(sum(${creditEntries.amountMillimes}), 0)` })
    .from(creditEntries)
    .where(ownerFilter(o));
  return Number(total);
}

/** Serializes changes to Sarfli's own credit for one operator (there is no row to lock). */
export async function lockSarfli(t: DbTx, operatorCode: string) {
  await t.execute(sql`select pg_advisory_xact_lock(hashtext(${"sarfli-credit:" + operatorCode}))`);
}

/** Writes a movement. Refuses unbalanced movements and any bucket (except external) going below zero. */
export async function move(t: DbTx, m: Movement) {
  const legs = m.legs.filter((l) => l.amountMillimes !== 0);
  if (legs.length < 2) throw new EngineError("invalid_amount");
  for (const l of legs) if (!Number.isInteger(l.amountMillimes)) throw new EngineError("invalid_amount");
  if (legs.reduce((s, l) => s + l.amountMillimes, 0) !== 0) throw new Error("unbalanced_movement");
  for (const l of legs) {
    if ((l.bucket === "buyer" || l.bucket === "seller_stock") && !l.userId) throw new Error("ledger_owner_missing");
    if (l.bucket === "order" && !l.orderId) throw new Error("ledger_owner_missing");
    if (l.bucket === "recharge" && !l.rechargeId) throw new Error("ledger_owner_missing");
  }

  const movementId = crypto.randomUUID();
  await t.insert(creditEntries).values(
    legs.map((l) => ({
      movementId,
      kind: m.kind,
      bucket: l.bucket,
      operatorCode: m.operatorCode,
      userId: l.userId ?? null,
      orderId: l.orderId ?? null,
      rechargeId: l.rechargeId ?? null,
      txId: m.txId ?? null,
      amountMillimes: l.amountMillimes,
      note: m.note ?? null,
      createdBy: m.createdBy ?? null,
    })),
  );

  for (const l of legs) {
    if (l.amountMillimes >= 0 || l.bucket === "external") continue;
    const after = await bucketBalance(t, { ...l, operatorCode: m.operatorCode });
    if (after < 0) throw new EngineError(l.bucket === "sarfli" ? "sarfli_credit_insufficient" : "insufficient_credit");
  }
  return movementId;
}

/** Balances per operator of a user-owned bucket: { ooredoo: 12000, ... } (zero balances omitted). */
export async function balancesByOperator(
  dbx: DbTx | typeof db,
  bucket: "buyer" | "seller_stock",
  userId: string,
): Promise<Record<string, number>> {
  const rows = await dbx
    .select({ op: creditEntries.operatorCode, total: sql<string>`coalesce(sum(${creditEntries.amountMillimes}), 0)` })
    .from(creditEntries)
    .where(and(eq(creditEntries.bucket, bucket), eq(creditEntries.userId, userId)))
    .groupBy(creditEntries.operatorCode);
  const out: Record<string, number> = {};
  for (const r of rows) if (Number(r.total) !== 0) out[r.op] = Number(r.total);
  return out;
}

/** Totals of every bucket per operator, for the daily reconciliation with the real credit on the SIMs. */
export async function ledgerTotals(dbx: DbTx | typeof db = db) {
  const rows = await dbx
    .select({
      op: creditEntries.operatorCode,
      bucket: creditEntries.bucket,
      total: sql<string>`coalesce(sum(${creditEntries.amountMillimes}), 0)`,
    })
    .from(creditEntries)
    .groupBy(creditEntries.operatorCode, creditEntries.bucket);
  return rows.map((r) => ({ operatorCode: r.op, bucket: r.bucket as CreditBucket, totalMillimes: Number(r.total) }));
}

/** Ledger entries of a user (buyer balance and seller stock), newest first. */
export async function userCreditEntries(userId: string, limit = 200) {
  return db
    .select()
    .from(creditEntries)
    .where(and(eq(creditEntries.userId, userId), sql`${creditEntries.bucket} in ('buyer','seller_stock')`))
    .orderBy(sql`${creditEntries.createdAt} desc`)
    .limit(limit);
}

