import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { listings, operators, orders, sellerRatings, users } from "@/db/schema";
import {
  buyerBadMarks,
  canRate,
  canUseMarketplace,
  getOrderForUser,
  orderCommission,
  orderPrice,
  sellerReputation,
  sellerSentCredit,
} from "@/lib/engine/market";
import { type CurrentUser, getCurrentUser, isStaff, requireUser } from "@/lib/session";
import { getSettings } from "@/lib/settings";
import { balancesByOperator } from "@/lib/engine/ledger";
import { canSpend, sarfliSpendable, spendsSarfliCredit } from "@/lib/engine/sarfli-credit";

/** True when this user may see the marketplace. */
export async function hasMarketAccess(user: CurrentUser | null) {
  if (!user) return false;
  return canUseMarketplace(user, await getSettings());
}

/** For recharge pages: marketplace users, and admins spending Sarfli's credit (even with the marketplace off). */
export async function requireSpender() {
  const user = await requireUser();
  if (!(await canSpend(user))) notFound();
  return { user, sarfli: spendsSarfliCredit(user) };
}

/** What the user can spend now, per operator: Sarfli's spendable credit for admins, otherwise his own balance. */
export async function spendableByOperator(user: { id: string; role: CurrentUser["role"] }, operatorCodes: string[]) {
  if (spendsSarfliCredit(user)) return { balances: await sarfliSpendable(operatorCodes), sarfli: true };
  return { balances: await balancesByOperator(db, "buyer", user.id), sarfli: false };
}

/** For marketplace pages: signed in and allowed, otherwise the page does not exist. */
export async function requireMarketUser() {
  const user = await requireUser();
  const settings = await getSettings();
  if (!canUseMarketplace(user, settings)) notFound();
  return { user, settings };
}

/** Active listings (operator active, seller still allowed), cheapest first. Includes the viewer's own, marked `mine`. */
export async function listActiveListings(viewerId: string) {
  const settings = await getSettings();
  const rows = await db
    .select({ listing: listings, op: operators, seller: users })
    .from(listings)
    .innerJoin(operators, eq(operators.code, listings.operatorCode))
    .leftJoin(users, eq(users.id, listings.sellerId))
    .where(and(eq(listings.active, true), eq(operators.active, true)))
    .orderBy(asc(listings.priceBps));
  const allowed = rows.filter((r) => !r.listing.sellerId || (r.seller && canUseMarketplace(r.seller, settings)));
  // Resale listings sell from the reseller's balance: show how much is left, hide them when empty.
  const resellers = [...new Set(allowed.filter((r) => r.listing.source === "balance").map((r) => r.listing.sellerId!))];
  const resaleBalances = Object.fromEntries(
    await Promise.all(resellers.map(async (id) => [id, await balancesByOperator(db, "buyer", id)] as const)),
  );
  const availableFor = (r: (typeof allowed)[number]) =>
    r.listing.source === "balance" ? (resaleBalances[r.listing.sellerId!]?.[r.listing.operatorCode] ?? 0) : null;
  const open = allowed.filter((r) => availableFor(r) !== 0);
  const reputation = await sellerReputation(open.map((r) => r.listing.sellerId));
  return open.map((r) => ({
    id: r.listing.id,
    sellerId: r.listing.sellerId,
    sellerName: r.listing.sellerId ? (r.seller?.name ?? null) : null,
    operatorCode: r.op.code,
    priceBps: r.listing.priceBps,
    paymentInfo: r.listing.paymentInfo,
    rating: reputation[r.listing.sellerId ?? "sarfli"] ?? null,
    mine: !!r.listing.sellerId && r.listing.sellerId === viewerId,
    resale: r.listing.source === "balance",
    /** Resale only: credit left to sell (null = funded by the seller's transfers, no fixed amount). */
    availableMillimes: availableFor(r),
  }));
}

/** Active listings the viewer can buy from (not his own), cheapest first. */
export async function listOpenListings(viewerId: string) {
  return (await listActiveListings(viewerId)).filter((l) => !l.mine);
}

export type OpenListing = Awaited<ReturnType<typeof listOpenListings>>[number];

/** The seller's own listings (funded by his transfers). Resale listings are managed on /buy/resell. */
export async function listSellerListings(sellerId: string, source: "transfers" | "balance" = "transfers") {
  return db
    .select()
    .from(listings)
    .where(and(eq(listings.sellerId, sellerId), eq(listings.source, source)));
}

/** Names of users by id (for order lists). */
export async function userNames(ids: (string | null)[]) {
  const list = [...new Set(ids.filter((x): x is string => !!x))];
  if (list.length === 0) return {} as Record<string, string | null>;
  const rows = await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, list));
  return Object.fromEntries(rows.map((r) => [r.id, r.name])) as Record<string, string | null>;
}

/** Ids of the given orders the buyer already rated. */
export async function ratedOrderIds(orderIds: string[]) {
  if (orderIds.length === 0) return new Set<string>();
  const rows = await db.select({ orderId: sellerRatings.orderId }).from(sellerRatings).where(inArray(sellerRatings.orderId, orderIds));
  return new Set(rows.map((r) => r.orderId));
}

type OrderRow = typeof orders.$inferSelect;

/** Same rule as the engine's canRate, without the rating lookup: done, or cancelled by the buyer with a bad mark. */
export const rateableStatus = (o: Pick<OrderRow, "status" | "cancelledBy" | "buyerBadMark">) =>
  o.status === "released" || (o.status === "cancelled" && o.cancelledBy === "buyer" && o.buyerBadMark);

/** What the buyer must do now on this order, or null when nothing. */
export function buyerNextStep(o: OrderRow, rated: Set<string>): "pay" | "excess" | "rate" | null {
  if (o.status === "funded") return o.excessMillimes > 0 ? "excess" : "pay";
  if (rateableStatus(o) && !rated.has(o.id)) return "rate";
  return null;
}

/** What the seller must do now on this order, or null when nothing. */
export function sellerNextStep(o: OrderRow): "send" | "check" | "leftover" | null {
  if (o.status === "funding") return "send";
  if (o.status === "proof_uploaded" || o.status === "admin_review") return "check";
  if (o.status === "cancelled" && o.leftoverMillimes > 0 && !o.leftoverChoice) return "leftover";
  return null;
}

/** Everything the order page needs, for its buyer, its seller, or staff. Null when not visible. */
export async function getOrderPageView(orderId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(orderId)) return null;
  const user = await getCurrentUser();
  if (!user) return null;
  const staff = isStaff(user);
  const found = await getOrderForUser(user.id, orderId, staff);
  if (!found) return null;
  const { order, events, proofs } = found;
  const role: "buyer" | "seller" | "staff" = order.buyerId === user.id ? "buyer" : order.sellerId && order.sellerId === user.id ? "seller" : "staff";

  const [[op], names, rating, marks, rateable, sentCredit] = await Promise.all([
    db.select().from(operators).where(eq(operators.code, order.operatorCode)),
    userNames([order.buyerId, order.sellerId]),
    sellerReputation([order.sellerId]),
    role === "buyer" ? Promise.resolve({} as Record<string, number>) : buyerBadMarks([order.buyerId]),
    role === "buyer" ? canRate(order) : Promise.resolve(false),
    role === "buyer" && order.sellerId && ["funding", "funded"].includes(order.status) ? sellerSentCredit(db, order.id) : Promise.resolve(false),
  ]);
  const commission = orderCommission(order.amountMillimes, order.commissionBps);

  return {
    role,
    order,
    operator: { code: op.code, name: op.name, color: op.color, rateBps: op.rateBps },
    sellerName: order.sellerId ? (names[order.sellerId] ?? null) : null,
    buyerName: names[order.buyerId] ?? null,
    sellerRating: rating[order.sellerId ?? "sarfli"] ?? null,
    buyerBadMarks: marks[order.buyerId] ?? 0,
    payMillimes: orderPrice(order.amountMillimes, order.priceBps),
    payWithExcessMillimes: orderPrice(order.fundedMillimes, order.priceBps),
    commissionMillimes: order.commissionMillimes ?? commission,
    toBuyerMillimes: order.releasedMillimes ?? order.amountMillimes - commission,
    canRate: rateable,
    // Cancelling now gives the buyer a bad mark.
    cancelGivesBadMark: sentCredit,
    proofs: proofs.map((p) => ({ id: p.id, mime: p.mime, createdAt: p.createdAt.toISOString() })),
    events: events.map((e) => ({ id: e.id, type: e.type, actor: e.actor, data: e.data, internal: false, createdAt: e.createdAt.toISOString() })),
  };
}

export type OrderPageView = NonNullable<Awaited<ReturnType<typeof getOrderPageView>>>;
