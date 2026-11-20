import "server-only";
import { and, asc, count, desc, eq, ilike, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import {
  creditEntries,
  listings,
  OPEN_ORDER_STATUSES,
  operators,
  orders,
  recharges,
  sims,
  transactions,
  users,
  type OrderStatus,
  type RechargeStatus,
} from "@/db/schema";
import { balancesByOperator, ledgerTotals } from "@/lib/engine/ledger";
import { buyerBadMarks, getOrderForUser, sellerReputation } from "@/lib/engine/market";

/** Sidebar and dashboard counts for the marketplace. */
export async function getMarketCounts() {
  const [[review], [sarfli], [rech]] = await Promise.all([
    db.select({ n: count() }).from(orders).where(eq(orders.status, "admin_review")),
    db
      .select({ n: count() })
      .from(orders)
      .where(and(isNull(orders.sellerId), eq(orders.status, "proof_uploaded"))),
    db.select({ n: count() }).from(recharges).where(eq(recharges.status, "review")),
  ]);
  return { orderReview: review.n, sarfliAwaiting: sarfli.n, rechargeReview: rech.n };
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

export type OrderTab = "open" | "attention" | OrderStatus | "all";

/** Disputes first, then orders with proof uploaded, then the rest (newest first). */
export async function listMarketOrders(f: { tab: OrderTab; userId?: string; q?: string }) {
  const buyer = alias(users, "buyer");
  const seller = alias(users, "seller");
  const conds = [];
  if (f.tab === "open") conds.push(inArray(orders.status, OPEN_ORDER_STATUSES));
  else if (f.tab === "attention")
    conds.push(or(eq(orders.status, "admin_review"), and(isNull(orders.sellerId), eq(orders.status, "proof_uploaded"))));
  else if (f.tab !== "all") conds.push(eq(orders.status, f.tab));
  if (f.userId) conds.push(or(eq(orders.buyerId, f.userId), eq(orders.sellerId, f.userId)));
  if (f.q) {
    const q = `%${f.q.trim()}%`;
    conds.push(or(ilike(orders.ref, q), ilike(buyer.email, q), ilike(buyer.name, q), ilike(seller.email, q), ilike(seller.name, q)));
  }
  const priority = sql`case ${orders.status} when 'admin_review' then 0 when 'proof_uploaded' then 1 else 2 end`;
  return db
    .select({
      o: orders,
      op: { name: operators.name, color: operators.color },
      buyer: { id: buyer.id, name: buyer.name, email: buyer.email },
      seller: { id: seller.id, name: seller.name, email: seller.email },
    })
    .from(orders)
    .innerJoin(operators, eq(operators.code, orders.operatorCode))
    .innerJoin(buyer, eq(buyer.id, orders.buyerId))
    .leftJoin(seller, eq(seller.id, orders.sellerId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(priority, desc(orders.createdAt))
    .limit(300);
}

/** Everything an admin needs to decide an order. */
export async function getMarketOrderDetail(staffId: string, orderId: string) {
  const base = await getOrderForUser(staffId, orderId, true);
  if (!base) return null;
  const { order } = base;
  const [buyerRows, sellerRows, [op], marks, rep, transfers, movementIds] = await Promise.all([
    db.select().from(users).where(eq(users.id, order.buyerId)),
    order.sellerId ? db.select().from(users).where(eq(users.id, order.sellerId)) : Promise.resolve([]),
    db.select().from(operators).where(eq(operators.code, order.operatorCode)),
    buyerBadMarks([order.buyerId]),
    sellerReputation([order.sellerId]),
    db.select().from(transactions).where(eq(transactions.orderId, order.id)).orderBy(asc(transactions.createdAt)),
    db.selectDistinct({ id: creditEntries.movementId }).from(creditEntries).where(eq(creditEntries.orderId, order.id)),
  ]);
  // Every leg of the movements that touched this order: shows where the credit came from and went.
  const owner = alias(users, "owner");
  const entries = movementIds.length
    ? await db
        .select({ e: creditEntries, owner: { name: owner.name, email: owner.email } })
        .from(creditEntries)
        .leftJoin(owner, eq(owner.id, creditEntries.userId))
        .where(inArray(creditEntries.movementId, movementIds.map((m) => m.id)))
        .orderBy(asc(creditEntries.createdAt))
    : [];
  return {
    ...base,
    buyer: buyerRows[0] ?? null,
    seller: sellerRows[0] ?? null,
    operator: op,
    buyerBadMarks: marks[order.buyerId] ?? 0,
    sellerRating: rep[order.sellerId ?? "sarfli"] ?? null,
    transfers,
    entries,
  };
}

// ---------------------------------------------------------------------------
// Recharges
// ---------------------------------------------------------------------------

export type RechargeTab = "review" | "active" | RechargeStatus | "all";

export async function listMarketRecharges(f: { tab: RechargeTab; userId?: string; operatorCode?: string; q?: string }) {
  const conds = [];
  if (f.tab === "active") conds.push(inArray(recharges.status, ["queued", "sending"]));
  else if (f.tab !== "all") conds.push(eq(recharges.status, f.tab));
  if (f.userId) conds.push(eq(recharges.buyerId, f.userId));
  if (f.operatorCode) conds.push(eq(recharges.operatorCode, f.operatorCode));
  if (f.q) {
    const q = `%${f.q.trim()}%`;
    conds.push(or(ilike(recharges.ref, q), ilike(recharges.msisdn, q), ilike(users.email, q), ilike(users.name, q)));
  }
  const priority = sql`case ${recharges.status} when 'review' then 0 when 'sending' then 1 when 'queued' then 2 else 3 end`;
  return db
    .select({
      r: recharges,
      op: { name: operators.name, color: operators.color },
      buyer: { id: users.id, name: users.name, email: users.email },
      sim: { id: sims.id, msisdn: sims.msisdn, balanceMillimes: sims.balanceMillimes, balanceCheckedAt: sims.balanceCheckedAt },
    })
    .from(recharges)
    .innerJoin(operators, eq(operators.code, recharges.operatorCode))
    .innerJoin(users, eq(users.id, recharges.buyerId))
    .leftJoin(sims, eq(sims.id, recharges.simId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(priority, desc(recharges.createdAt))
    .limit(300);
}

// ---------------------------------------------------------------------------
// Credit ledger (daily reconciliation)
// ---------------------------------------------------------------------------

/** Per operator: real credit on the configured SIMs vs. the ledger buckets. */
export async function getReconciliation() {
  const [ops, totals, simRows] = await Promise.all([
    db.select().from(operators).orderBy(asc(operators.sortOrder)),
    ledgerTotals(),
    db
      .select({
        operatorCode: sims.operatorCode,
        total: sql<string>`coalesce(sum(${sims.balanceMillimes}), 0)`,
        n: count(),
        unread: sql<string>`count(*) filter (where ${sims.balanceMillimes} is null)`,
        oldest: sql<Date | null>`min(${sims.balanceCheckedAt})`,
      })
      .from(sims)
      .where(and(isNotNull(sims.operatorCode), ne(sims.status, "unconfigured")))
      .groupBy(sims.operatorCode),
  ]);
  return ops.map((op) => {
    const b = (bucket: string) => totals.find((t) => t.operatorCode === op.code && t.bucket === bucket)?.totalMillimes ?? 0;
    const s = simRows.find((r) => r.operatorCode === op.code);
    const order = b("order");
    const stock = b("seller_stock");
    const buyers = b("buyer");
    const recharge = b("recharge");
    const sarfli = b("sarfli");
    const customer = order + stock + buyers + recharge;
    const simMillimes = Number(s?.total ?? 0);
    return {
      code: op.code,
      name: op.name,
      color: op.color,
      sims: s?.n ?? 0,
      unreadSims: Number(s?.unread ?? 0),
      oldestCheck: s?.oldest ? new Date(s.oldest) : null,
      simMillimes,
      order,
      stock,
      buyers,
      recharge,
      sarfli,
      customer,
      gap: simMillimes - (customer + sarfli),
    };
  });
}

/** Latest ledger movements, legs grouped together. */
export async function listRecentMovements(limit = 60) {
  const recent = db
    .select({ id: creditEntries.movementId, at: sql`max(${creditEntries.createdAt})`.as("at") })
    .from(creditEntries)
    .groupBy(creditEntries.movementId)
    .orderBy(sql`at desc`)
    .limit(limit)
    .as("recent");
  const owner = alias(users, "owner");
  const by = alias(users, "by");
  const rows = await db
    .select({
      e: creditEntries,
      owner: { name: owner.name, email: owner.email },
      by: { email: by.email },
      order: { id: orders.id, ref: orders.ref },
      recharge: { ref: recharges.ref },
    })
    .from(creditEntries)
    .innerJoin(recent, eq(recent.id, creditEntries.movementId))
    .leftJoin(owner, eq(owner.id, creditEntries.userId))
    .leftJoin(by, eq(by.id, creditEntries.createdBy))
    .leftJoin(orders, eq(orders.id, creditEntries.orderId))
    .leftJoin(recharges, eq(recharges.id, creditEntries.rechargeId))
    .orderBy(desc(creditEntries.createdAt));
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const g = groups.get(r.e.movementId) ?? [];
    g.push(r);
    groups.set(r.e.movementId, g);
  }
  return [...groups.values()];
}

// ---------------------------------------------------------------------------
// Sarfli listing & users
// ---------------------------------------------------------------------------

export async function getSarfliListings() {
  const [ops, rows, totals] = await Promise.all([
    db.select().from(operators).orderBy(asc(operators.sortOrder)),
    db.select().from(listings).where(isNull(listings.sellerId)),
    ledgerTotals(),
  ]);
  return ops.map((op) => ({
    op,
    listing: rows.find((l) => l.operatorCode === op.code) ?? null,
    sarfliMillimes: totals.find((t) => t.operatorCode === op.code && t.bucket === "sarfli")?.totalMillimes ?? 0,
  }));
}

/** Marketplace view of one user: balances per operator, reputation, order counts. */
export async function getUserMarket(userId: string) {
  const [buyer, stock, marks, rep, [asBuyer], [asSeller], [rech]] = await Promise.all([
    balancesByOperator(db, "buyer", userId),
    balancesByOperator(db, "seller_stock", userId),
    buyerBadMarks([userId]),
    sellerReputation([userId]),
    db.select({ n: count() }).from(orders).where(eq(orders.buyerId, userId)),
    db.select({ n: count() }).from(orders).where(eq(orders.sellerId, userId)),
    db.select({ n: count() }).from(recharges).where(eq(recharges.buyerId, userId)),
  ]);
  return {
    buyer,
    stock,
    badMarks: marks[userId] ?? 0,
    rating: rep[userId] ?? null,
    buyerOrders: asBuyer.n,
    sellerOrders: asSeller.n,
    recharges: rech.n,
  };
}

/** Bad marks and ratings for the users list. */
export async function getUsersReputation(userIds: string[]) {
  if (userIds.length === 0) return { marks: {} as Record<string, number>, ratings: {} as Record<string, { avg: number; count: number }> };
  const [marks, ratings] = await Promise.all([buyerBadMarks(userIds), sellerReputation(userIds)]);
  return { marks, ratings };
}
