import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, type DbTx } from "@/db";
import {
  ACTIVE_TX_STATUSES,
  creditEntries,
  listings,
  OPEN_ORDER_STATUSES,
  operators,
  orderEvents,
  orderProofs,
  orders,
  sellerRatings,
  STAFF_ROLES,
  transactions,
  users,
  type OrderStatus,
} from "@/db/schema";
import { BPS, grossPayout } from "@/lib/money";
import { getSettings, type AppSettings } from "@/lib/settings";
import { EngineError, type Tx } from "./core";
import { bucketBalance, lockSarfli, move } from "./ledger";
import { addEntry, lockUser } from "./wallet";

export type Order = typeof orders.$inferSelect;
type User = typeof users.$inferSelect;
type Actor = "system" | "buyer" | "seller" | "admin" | "device";

function newRef() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return "OR-" + Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

/** What the buyer pays the seller for an amount of credit at a price (rounded down, like sale payouts). */
export const orderPrice = (creditMillimes: number, priceBps: number) => grossPayout(creditMillimes, priceBps);
/** Sarfli's commission on an order amount (rounded down). */
export const orderCommission = (creditMillimes: number, commissionBps: number) =>
  Math.floor((creditMillimes * commissionBps) / BPS);

/** Staff always see the marketplace (to test it); others need the switch on and their own access. */
export function canUseMarketplace(user: Pick<User, "role" | "marketplaceAccess" | "blocked"> | null, settings: AppSettings) {
  if (!user || user.blocked) return false;
  if (STAFF_ROLES.includes(user.role)) return true;
  return settings.marketplaceEnabled === 1 && user.marketplaceAccess;
}

async function requireAccess(userId: string) {
  const settings = await getSettings();
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!canUseMarketplace(user ?? null, settings)) throw new EngineError("marketplace_closed");
  return { user: user!, settings };
}

async function logOrder(t: DbTx, orderId: string, type: string, actor: Actor, data: Record<string, unknown> = {}) {
  await t.insert(orderEvents).values({ orderId, type, actor, data });
}

async function lockOrder(t: DbTx, orderId: string) {
  const [o] = await t.select().from(orders).where(eq(orders.id, orderId)).for("update");
  if (!o) throw new EngineError("not_found");
  return o;
}

async function updateOrder(t: DbTx, orderId: string, values: Partial<Order>) {
  await t
    .update(orders)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(orders.id, orderId));
}

/** Locks whoever owns the credit that funds this order: the seller row, or Sarfli's lock. */
async function lockSellerSide(t: DbTx, sellerId: string | null, operatorCode: string) {
  if (sellerId) await lockUser(t, sellerId);
  else await lockSarfli(t, operatorCode);
}

// ---------------------------------------------------------------------------
// Listings
// ---------------------------------------------------------------------------

export type ListingSource = "transfers" | "balance";
export type ListingInput = { operatorCode: string; priceBps: number; paymentInfo: string; active: boolean; source?: ListingSource };

function validateListing(input: ListingInput) {
  if (!Number.isInteger(input.priceBps) || input.priceBps <= 0 || input.priceBps > BPS) throw new EngineError("invalid_rate");
  const paymentInfo = input.paymentInfo.trim().slice(0, 500);
  if (input.active && !paymentInfo) throw new EngineError("payment_info_required");
  return paymentInfo;
}

/** A seller publishes (or updates) his price for one operator. No credit is needed to publish. */
export async function upsertListing(sellerId: string, input: ListingInput) {
  await requireAccess(sellerId);
  return saveListing(sellerId, input);
}

/** Admin manages Sarfli's own listing (sellerId null). */
export async function upsertSarfliListing(input: ListingInput) {
  return saveListing(null, { ...input, source: "transfers" });
}

async function saveListing(sellerId: string | null, input: ListingInput) {
  const paymentInfo = validateListing(input);
  const source: ListingSource = input.source === "balance" ? "balance" : "transfers";
  const [op] = await db.select().from(operators).where(eq(operators.code, input.operatorCode));
  if (!op) throw new EngineError("operator_unavailable");
  const owner = sellerId ? eq(listings.sellerId, sellerId) : isNull(listings.sellerId);
  const [existing] = await db
    .select()
    .from(listings)
    .where(and(owner, eq(listings.operatorCode, op.code), eq(listings.source, source)));
  if (existing) {
    await db
      .update(listings)
      .set({ priceBps: input.priceBps, paymentInfo, active: input.active, updatedAt: new Date() })
      .where(eq(listings.id, existing.id));
    return existing.id;
  }
  const [row] = await db
    .insert(listings)
    .values({ sellerId, operatorCode: op.code, priceBps: input.priceBps, paymentInfo, active: input.active, source })
    .returning({ id: listings.id });
  return row.id;
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

/** Buyer orders credit from a listing. The seller's stock (or Sarfli's credit) funds it first. */
export async function createOrder(buyerId: string, input: { listingId: string; amountMillimes: number }) {
  const { settings } = await requireAccess(buyerId);
  if (!Number.isInteger(input.amountMillimes) || input.amountMillimes <= 0) throw new EngineError("invalid_amount");
  if (input.amountMillimes > settings.maxOrderMillimes) throw new EngineError("above_max_order");

  const [listing] = await db.select().from(listings).where(eq(listings.id, input.listingId));
  if (!listing || !listing.active) throw new EngineError("listing_unavailable");
  const [op] = await db.select().from(operators).where(eq(operators.code, listing.operatorCode));
  if (!op || !op.active) throw new EngineError("operator_unavailable");
  if (listing.sellerId === buyerId) throw new EngineError("own_listing");
  if (orderPrice(input.amountMillimes, listing.priceBps) <= 0) throw new EngineError("invalid_amount");
  if (listing.sellerId) {
    const [seller] = await db.select().from(users).where(eq(users.id, listing.sellerId));
    if (!canUseMarketplace(seller ?? null, settings)) throw new EngineError("listing_unavailable");
  }

  return db.transaction(async (t) => {
    await lockSellerSide(t, listing.sellerId, op.code);
    const [order] = await t
      .insert(orders)
      .values({
        ref: newRef(),
        buyerId,
        sellerId: listing.sellerId,
        listingId: listing.id,
        operatorCode: op.code,
        priceBps: listing.priceBps,
        commissionBps: settings.commissionBps,
        paymentInfo: listing.paymentInfo,
        requestedMillimes: input.amountMillimes,
        amountMillimes: input.amountMillimes,
        status: "funding",
        resale: listing.source === "balance",
      })
      .returning();
    await logOrder(t, order.id, "created", "buyer", {
      amountMillimes: input.amountMillimes,
      priceBps: listing.priceBps,
      payMillimes: orderPrice(input.amountMillimes, listing.priceBps),
    });

    if (listing.sellerId && listing.source === "balance") {
      // Resale: the credit is already on Sarfli's phones, in the reseller's balance. The whole order is
      // taken from it at once (no partial resale), and Sarfli's commission applies again on release.
      const available = await bucketBalance(t, { bucket: "buyer", operatorCode: op.code, userId: listing.sellerId });
      if (available < input.amountMillimes) throw new EngineError("reseller_balance_low");
      await move(t, {
        kind: "resale_funded",
        operatorCode: op.code,
        legs: [
          { bucket: "buyer", userId: listing.sellerId, amountMillimes: -input.amountMillimes },
          { bucket: "order", orderId: order.id, amountMillimes: input.amountMillimes },
        ],
      });
      await creditOrder(t, order, input.amountMillimes, "resale_funded", "system");
    } else if (listing.sellerId) {
      const stock = await bucketBalance(t, { bucket: "seller_stock", operatorCode: op.code, userId: listing.sellerId });
      const use = Math.min(stock, input.amountMillimes);
      if (use > 0) {
        await move(t, {
          kind: "stock_applied",
          operatorCode: op.code,
          legs: [
            { bucket: "seller_stock", userId: listing.sellerId, amountMillimes: -use },
            { bucket: "order", orderId: order.id, amountMillimes: use },
          ],
        });
        await creditOrder(t, order, use, "stock_applied", "system");
      }
    } else {
      // Sarfli's credit is already on the phones: the order is funded at once.
      await move(t, {
        kind: "sarfli_listing",
        operatorCode: op.code,
        legs: [
          { bucket: "sarfli", amountMillimes: -input.amountMillimes },
          { bucket: "order", orderId: order.id, amountMillimes: input.amountMillimes },
        ],
      });
      await creditOrder(t, order, input.amountMillimes, "sarfli_funded", "system");
    }
    return order.id;
  });
}

/** Updates the order after credit was moved into its bucket; marks it funded when complete. */
async function creditOrder(t: DbTx, order: Order, amount: number, event: string, actor: Actor, data: Record<string, unknown> = {}) {
  const funded = order.fundedMillimes + amount;
  const values: Partial<Order> = { fundedMillimes: funded };
  if (funded >= order.amountMillimes) {
    values.status = "funded";
    values.fundedAt = new Date();
    values.excessMillimes = funded - order.amountMillimes;
  }
  await updateOrder(t, order.id, values);
  Object.assign(order, values);
  await logOrder(t, order.id, event, actor, { amountMillimes: amount, fundedMillimes: funded, ...data });
  if (values.status === "funded") {
    await logOrder(t, order.id, "funded", "system", { fundedMillimes: funded, excessMillimes: values.excessMillimes });
  }
}

/**
 * Called when a seller's transfer to Sarfli's SIM is confirmed (SMS + balance) and the transfer was
 * deposited to an order. If the order no longer waits for funding, the credit becomes the seller's stock.
 */
export async function fundOrderFromTransfer(t: DbTx, tx: Tx, amount: number, actor: "system" | "seller" | "admin") {
  if (amount <= 0 || !tx.orderId) return;
  // Lock order: transaction, order, then user (same as every other order path).
  const order = await lockOrder(t, tx.orderId);
  await lockUser(t, tx.userId);
  if (order.status === "funding" && order.sellerId === tx.userId && order.operatorCode === tx.operatorCode) {
    await move(t, {
      kind: "funding_transfer",
      operatorCode: order.operatorCode,
      txId: tx.id,
      legs: [
        { bucket: "external", amountMillimes: -amount },
        { bucket: "order", orderId: order.id, amountMillimes: amount },
      ],
    });
    await creditOrder(t, order, amount, "transfer_received", actor === "admin" ? "admin" : "device", { txRef: tx.ref });
    return;
  }
  await move(t, {
    kind: "transfer_to_stock",
    operatorCode: tx.operatorCode,
    txId: tx.id,
    note: `order ${order.ref} no longer waiting for funding`,
    legs: [
      { bucket: "external", amountMillimes: -amount },
      { bucket: "seller_stock", userId: tx.userId, amountMillimes: amount },
    ],
  });
  await logOrder(t, order.id, "transfer_to_stock", "system", { amountMillimes: amount, txRef: tx.ref });
}

/** Records credit sold to Sarfli through the existing sell flow (no order). */
export async function recordSaleToSarfli(t: DbTx, tx: Tx, amount: number) {
  if (amount <= 0) return;
  await move(t, {
    kind: "sale_to_sarfli",
    operatorCode: tx.operatorCode,
    txId: tx.id,
    legs: [
      { bucket: "external", amountMillimes: -amount },
      { bucket: "sarfli", amountMillimes: amount },
    ],
  });
}

/** Open orders a seller can deposit a transfer to (for the sell page). */
export async function fundableOrders(sellerId: string, operatorCode?: string) {
  return db
    .select()
    .from(orders)
    .where(
      and(
        eq(orders.sellerId, sellerId),
        eq(orders.status, "funding"),
        operatorCode ? eq(orders.operatorCode, operatorCode) : undefined,
      ),
    )
    .orderBy(orders.createdAt);
}

async function activeTransfer(t: DbTx | typeof db, orderId: string) {
  const [row] = await t
    .select({ id: transactions.id, sms: transactions.smsReceivedMillimes })
    .from(transactions)
    .where(and(eq(transactions.orderId, orderId), inArray(transactions.status, ACTIVE_TX_STATUSES)))
    .limit(1);
  return row;
}

/** Buyer takes the part already funded; the order continues from payment with the smaller amount. */
export async function takePartial(buyerId: string, orderId: string) {
  await db.transaction(async (t) => {
    const order = await lockOrder(t, orderId);
    if (order.buyerId !== buyerId) throw new EngineError("not_found");
    if (order.status !== "funding") throw new EngineError("invalid_state");
    if (order.fundedMillimes <= 0) throw new EngineError("nothing_funded");
    await updateOrder(t, order.id, { amountMillimes: order.fundedMillimes, status: "funded", fundedAt: new Date(), excessMillimes: 0 });
    await logOrder(t, order.id, "partial_taken", "buyer", { fromMillimes: order.amountMillimes, toMillimes: order.fundedMillimes });
  });
}

/** Buyer accepts credit received beyond the order: the order grows to the amount received. */
export async function acceptExcess(buyerId: string, orderId: string) {
  await db.transaction(async (t) => {
    const order = await lockOrder(t, orderId);
    if (order.buyerId !== buyerId) throw new EngineError("not_found");
    if (order.status !== "funded" || order.excessMillimes <= 0) throw new EngineError("invalid_state");
    await updateOrder(t, order.id, { amountMillimes: order.fundedMillimes, excessMillimes: 0 });
    await logOrder(t, order.id, "excess_accepted", "buyer", { amountMillimes: order.fundedMillimes });
  });
}

/** Buyer refuses the extra credit: it goes to the seller's stock and the order keeps its amount. */
export async function refuseExcess(buyerId: string, orderId: string) {
  await db.transaction(async (t) => {
    const order = await lockOrder(t, orderId);
    if (order.buyerId !== buyerId) throw new EngineError("not_found");
    if (order.status !== "funded" || order.excessMillimes <= 0) throw new EngineError("invalid_state");
    const extra = order.excessMillimes;
    await lockSellerSide(t, order.sellerId, order.operatorCode);
    await move(t, {
      kind: order.sellerId ? "excess_to_stock" : "excess_to_sarfli",
      operatorCode: order.operatorCode,
      legs: [
        { bucket: "order", orderId: order.id, amountMillimes: -extra },
        order.sellerId
          ? { bucket: "seller_stock", userId: order.sellerId, amountMillimes: extra }
          : { bucket: "sarfli", amountMillimes: extra },
      ],
    });
    await updateOrder(t, order.id, { fundedMillimes: order.fundedMillimes - extra, excessMillimes: 0 });
    await logOrder(t, order.id, "excess_refused", "buyer", { amountMillimes: extra });
  });
}

/** Buyer uploads payment proof (first upload locks the order), or adds more files later. */
export async function addPaymentProofs(buyerId: string, orderId: string, files: { path: string; mime: string }[]) {
  if (files.length === 0) throw new EngineError("proof_required");
  await db.transaction(async (t) => {
    const order = await lockOrder(t, orderId);
    if (order.buyerId !== buyerId) throw new EngineError("not_found");
    const first = order.status === "funded";
    if (first && order.excessMillimes > 0) throw new EngineError("excess_pending");
    if (!first && !["proof_uploaded", "admin_review"].includes(order.status)) throw new EngineError("invalid_state");
    await t.insert(orderProofs).values(files.map((f) => ({ orderId: order.id, path: f.path, mime: f.mime, uploadedBy: buyerId })));
    if (first) await updateOrder(t, order.id, { status: "proof_uploaded", proofUploadedAt: new Date() });
    await logOrder(t, order.id, first ? "proof_uploaded" : "proof_added", "buyer", { files: files.length });
  });
}

/** Moves the order's credit to the buyer, minus Sarfli's commission. */
async function release(t: DbTx, order: Order, actor: Actor, note?: string | null, staffId?: string | null) {
  if (order.fundedMillimes !== order.amountMillimes || order.excessMillimes !== 0) throw new Error("order_not_balanced");
  const commission = orderCommission(order.amountMillimes, order.commissionBps);
  const toBuyer = order.amountMillimes - commission;
  await lockUser(t, order.buyerId);
  await move(t, {
    kind: "release",
    operatorCode: order.operatorCode,
    createdBy: staffId ?? null,
    note: note ?? null,
    legs: [
      { bucket: "order", orderId: order.id, amountMillimes: -order.amountMillimes },
      { bucket: "buyer", userId: order.buyerId, amountMillimes: toBuyer },
      { bucket: "sarfli", amountMillimes: commission },
    ],
  });
  await updateOrder(t, order.id, {
    status: "released",
    releasedMillimes: toBuyer,
    commissionMillimes: commission,
    completedAt: new Date(),
    ...(note ? { adminNote: note } : {}),
  });
  await logOrder(t, order.id, "released", actor, { toBuyerMillimes: toBuyer, commissionMillimes: commission, note: note ?? null });
}

/** Seller confirms he was paid: the credit is released to the buyer. */
export async function confirmPayment(sellerId: string, orderId: string) {
  await db.transaction(async (t) => {
    const order = await lockOrder(t, orderId);
    if (!order.sellerId || order.sellerId !== sellerId) throw new EngineError("not_found");
    if (!["proof_uploaded", "admin_review"].includes(order.status)) throw new EngineError("invalid_state");
    await release(t, order, "seller");
  });
}

/** Seller says he was not paid: an admin reviews the proof and decides. */
export async function reportNotPaid(sellerId: string, orderId: string, reason: string) {
  await db.transaction(async (t) => {
    const order = await lockOrder(t, orderId);
    if (!order.sellerId || order.sellerId !== sellerId) throw new EngineError("not_found");
    if (order.status !== "proof_uploaded") throw new EngineError("invalid_state");
    const text = reason.trim().slice(0, 1000) || null;
    await updateOrder(t, order.id, { status: "admin_review", disputeReason: text, disputedBy: "seller" });
    await logOrder(t, order.id, "reported_not_paid", "seller", { reason: text });
  });
}

/** Buyer paid but the seller does not answer: the buyer sends the order to an admin. */
export async function flagToAdmin(buyerId: string, orderId: string, reason: string) {
  await db.transaction(async (t) => {
    const order = await lockOrder(t, orderId);
    if (order.buyerId !== buyerId) throw new EngineError("not_found");
    if (order.status !== "proof_uploaded") throw new EngineError("invalid_state");
    const text = reason.trim().slice(0, 1000) || null;
    await updateOrder(t, order.id, { status: "admin_review", disputeReason: text, disputedBy: "buyer" });
    await logOrder(t, order.id, "flagged_to_admin", "buyer", { reason: text });
  });
}

/**
 * Cancels an order. Credit already held for it waits for the seller's choice (stock or sell to Sarfli);
 * for Sarfli's own listing it simply goes back to Sarfli.
 */
async function cancel(t: DbTx, order: Order, by: "buyer" | "seller" | "admin", reason: string | null, extra: Partial<Order> = {}) {
  let leftover = order.fundedMillimes;
  if (leftover > 0 && order.resale && order.sellerId) {
    // Resale: the credit came from the reseller's balance, it simply goes back there.
    await lockUser(t, order.sellerId);
    await move(t, {
      kind: "cancel_to_reseller",
      operatorCode: order.operatorCode,
      legs: [
        { bucket: "order", orderId: order.id, amountMillimes: -leftover },
        { bucket: "buyer", userId: order.sellerId, amountMillimes: leftover },
      ],
    });
    leftover = 0;
  }
  if (leftover > 0 && !order.sellerId) {
    await lockSarfli(t, order.operatorCode);
    await move(t, {
      kind: "cancel_to_sarfli",
      operatorCode: order.operatorCode,
      legs: [
        { bucket: "order", orderId: order.id, amountMillimes: -leftover },
        { bucket: "sarfli", amountMillimes: leftover },
      ],
    });
    leftover = 0;
  }
  await updateOrder(t, order.id, {
    status: "cancelled",
    cancelledBy: by,
    cancelReason: reason,
    leftoverMillimes: leftover,
    excessMillimes: 0,
    completedAt: new Date(),
    ...extra,
  });
  await logOrder(t, order.id, "cancelled", by, { reason, leftoverMillimes: leftover, ...extra });
}

/** True when the seller already sent credit for this order (confirmed or still being verified). */
export async function sellerSentCredit(t: DbTx | typeof db, orderId: string) {
  const [sent] = await t
    .select({ id: creditEntries.id })
    .from(creditEntries)
    .where(and(eq(creditEntries.orderId, orderId), eq(creditEntries.kind, "funding_transfer")))
    .limit(1);
  if (sent) return true;
  const active = await activeTransfer(t, orderId);
  return Boolean(active && active.sms > 0);
}

export async function cancelByBuyer(buyerId: string, orderId: string) {
  await db.transaction(async (t) => {
    const order = await lockOrder(t, orderId);
    if (order.buyerId !== buyerId) throw new EngineError("not_found");
    if (!["funding", "funded"].includes(order.status)) throw new EngineError("cannot_cancel");
    // Sarfli's own listing is funded instantly; cancelling it is never held against the buyer.
    const badMark = order.sellerId ? await sellerSentCredit(t, order.id) : false;
    await cancel(t, order, "buyer", null, { buyerBadMark: badMark });
  });
}

export async function cancelBySeller(sellerId: string, orderId: string, reason: string) {
  await db.transaction(async (t) => {
    const order = await lockOrder(t, orderId);
    if (!order.sellerId || order.sellerId !== sellerId) throw new EngineError("not_found");
    if (!["funding", "funded"].includes(order.status)) throw new EngineError("cannot_cancel");
    await cancel(t, order, "seller", reason.trim().slice(0, 1000) || null);
  });
}

/** After a cancellation: the seller keeps the credit as stock, or sells it to Sarfli at today's buy price. */
export async function chooseLeftover(sellerId: string, orderId: string, choice: "stock" | "sarfli") {
  if (choice !== "stock" && choice !== "sarfli") throw new EngineError("invalid_choice");
  await db.transaction(async (t) => {
    const order = await lockOrder(t, orderId);
    if (!order.sellerId || order.sellerId !== sellerId) throw new EngineError("not_found");
    if (order.status !== "cancelled" || order.leftoverMillimes <= 0 || order.leftoverChoice) throw new EngineError("invalid_state");
    await lockUser(t, sellerId);
    const amount = order.leftoverMillimes;
    if (choice === "stock") {
      await move(t, {
        kind: "cancel_to_stock",
        operatorCode: order.operatorCode,
        legs: [
          { bucket: "order", orderId: order.id, amountMillimes: -amount },
          { bucket: "seller_stock", userId: sellerId, amountMillimes: amount },
        ],
      });
      await updateOrder(t, order.id, { leftoverChoice: "stock" });
      await logOrder(t, order.id, "leftover_kept", "seller", { amountMillimes: amount });
    } else {
      const cash = await sellToSarfli(t, sellerId, order.operatorCode, amount, { bucket: "order", orderId: order.id }, `order ${order.ref}`);
      await updateOrder(t, order.id, { leftoverChoice: "sarfli" });
      await logOrder(t, order.id, "leftover_sold", "seller", { amountMillimes: amount, cashMillimes: cash });
    }
  });
}

/** Seller sells kept stock to Sarfli (existing flow: cash balance up, withdrawn as today). */
export async function sellStock(sellerId: string, operatorCode: string, amountMillimes: number) {
  if (!Number.isInteger(amountMillimes) || amountMillimes <= 0) throw new EngineError("invalid_amount");
  return db.transaction(async (t) => {
    await lockUser(t, sellerId);
    return sellToSarfli(t, sellerId, operatorCode, amountMillimes, { bucket: "seller_stock", userId: sellerId }, "stock");
  });
}

async function sellToSarfli(
  t: DbTx,
  sellerId: string,
  operatorCode: string,
  amount: number,
  from: { bucket: "order"; orderId: string } | { bucket: "seller_stock"; userId: string },
  note: string,
) {
  const [op] = await t.select().from(operators).where(eq(operators.code, operatorCode));
  if (!op) throw new EngineError("operator_unavailable");
  const cash = grossPayout(amount, op.rateBps);
  if (cash <= 0) throw new EngineError("invalid_amount");
  await lockSarfli(t, operatorCode);
  await move(t, {
    kind: "stock_sold_to_sarfli",
    operatorCode,
    note,
    legs: [
      { ...from, amountMillimes: -amount },
      { bucket: "sarfli", amountMillimes: amount },
    ],
  });
  await addEntry(t, { userId: sellerId, kind: "stock_sale", amountMillimes: cash, note: `${note} · ${amount} @ ${op.rateBps}` });
  return cash;
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

/** Admin releases the credit to the buyer: dispute decided for the buyer, silent seller, or Sarfli's own listing. */
export async function adminRelease(staffId: string, orderId: string, note: string) {
  await db.transaction(async (t) => {
    const order = await lockOrder(t, orderId);
    if (!["proof_uploaded", "admin_review"].includes(order.status)) throw new EngineError("invalid_state");
    await release(t, order, "admin", note.trim().slice(0, 1000) || null, staffId);
  });
}

/** Admin cancels: the buyer did not pay (or any other reason). The credit goes to the seller's choice. */
export async function adminCancel(staffId: string, orderId: string, note: string) {
  const text = note.trim().slice(0, 1000);
  if (!text) throw new EngineError("reason_required");
  await db.transaction(async (t) => {
    const order = await lockOrder(t, orderId);
    if (!OPEN_ORDER_STATUSES.includes(order.status)) throw new EngineError("invalid_state");
    await cancel(t, order, "admin", text, { adminNote: text });
    await logOrder(t, order.id, "admin_cancelled", "admin", { staffId });
  });
}

/** Sets Sarfli's credit for an operator (opening balance, corrections after the daily reconciliation). */
export async function adjustSarfliCredit(staffId: string, operatorCode: string, amountMillimes: number, note: string) {
  const text = note.trim().slice(0, 1000);
  if (!text) throw new EngineError("reason_required");
  if (!Number.isInteger(amountMillimes) || amountMillimes === 0) throw new EngineError("invalid_amount");
  await db.transaction(async (t) => {
    await lockSarfli(t, operatorCode);
    await move(t, {
      kind: "sarfli_adjustment",
      operatorCode,
      note: text,
      createdBy: staffId,
      legs: [
        { bucket: "external", amountMillimes: -amountMillimes },
        { bucket: "sarfli", amountMillimes },
      ],
    });
  });
}

// ---------------------------------------------------------------------------
// Reputation
// ---------------------------------------------------------------------------

/** Buyer rates the seller once the order ended: completed, taken as partial, or cancelled by the buyer after credit was sent. */
export async function rateSeller(buyerId: string, orderId: string, stars: number, comment: string) {
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) throw new EngineError("invalid_rating");
  await db.transaction(async (t) => {
    const order = await lockOrder(t, orderId);
    if (order.buyerId !== buyerId) throw new EngineError("not_found");
    const allowed = order.status === "released" || (order.status === "cancelled" && order.cancelledBy === "buyer" && order.buyerBadMark);
    if (!allowed) throw new EngineError("invalid_state");
    const [done] = await t.select({ id: sellerRatings.id }).from(sellerRatings).where(eq(sellerRatings.orderId, order.id));
    if (done) throw new EngineError("already_rated");
    await t.insert(sellerRatings).values({
      orderId: order.id,
      buyerId,
      sellerId: order.sellerId,
      stars,
      comment: comment.trim().slice(0, 500) || null,
    });
    await logOrder(t, order.id, "rated", "buyer", { stars });
  });
}

export async function canRate(order: Order) {
  if (!(order.status === "released" || (order.status === "cancelled" && order.cancelledBy === "buyer" && order.buyerBadMark))) return false;
  const [done] = await db.select({ id: sellerRatings.id }).from(sellerRatings).where(eq(sellerRatings.orderId, order.id));
  return !done;
}

/** Average stars and count per seller (key "sarfli" for Sarfli's own listing). */
export async function sellerReputation(sellerIds?: (string | null)[]) {
  const rows = await db
    .select({
      sellerId: sellerRatings.sellerId,
      avg: sql<string>`avg(${sellerRatings.stars})`,
      count: sql<string>`count(*)`,
    })
    .from(sellerRatings)
    .groupBy(sellerRatings.sellerId);
  const out: Record<string, { avg: number; count: number }> = {};
  for (const r of rows) {
    const key = r.sellerId ?? "sarfli";
    if (sellerIds && !sellerIds.some((s) => (s ?? "sarfli") === key)) continue;
    out[key] = { avg: Number(r.avg), count: Number(r.count) };
  }
  return out;
}

/** Bad marks per buyer. */
export async function buyerBadMarks(buyerIds?: string[]) {
  const rows = await db
    .select({ buyerId: orders.buyerId, count: sql<string>`count(*)` })
    .from(orders)
    .where(and(eq(orders.buyerBadMark, true), buyerIds?.length ? inArray(orders.buyerId, buyerIds) : undefined))
    .groupBy(orders.buyerId);
  return Object.fromEntries(rows.map((r) => [r.buyerId, Number(r.count)])) as Record<string, number>;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getOrderForUser(userId: string, orderId: string, staff = false) {
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!order) return null;
  if (!staff && order.buyerId !== userId && order.sellerId !== userId) return null;
  const [events, proofs] = await Promise.all([
    db.select().from(orderEvents).where(eq(orderEvents.orderId, order.id)).orderBy(orderEvents.createdAt),
    db.select().from(orderProofs).where(eq(orderProofs.orderId, order.id)).orderBy(orderProofs.createdAt),
  ]);
  return { order, events, proofs };
}

export async function listBuyerOrders(buyerId: string) {
  return db.select().from(orders).where(eq(orders.buyerId, buyerId)).orderBy(desc(orders.createdAt)).limit(100);
}

export async function listSellerOrders(sellerId: string) {
  return db.select().from(orders).where(eq(orders.sellerId, sellerId)).orderBy(desc(orders.createdAt)).limit(100);
}

export const ORDER_STATUS_LIST: OrderStatus[] = ["funding", "funded", "proof_uploaded", "admin_review", "released", "cancelled"];
