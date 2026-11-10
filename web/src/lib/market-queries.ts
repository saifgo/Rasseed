import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { listings, OPEN_ORDER_STATUSES, operators, orders, users } from "@/db/schema";
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

/** True when this user may see the marketplace. */
export async function hasMarketAccess(user: CurrentUser | null) {
  if (!user) return false;
  return canUseMarketplace(user, await getSettings());
}

/** For marketplace pages: signed in and allowed, otherwise the page does not exist. */
export async function requireMarketUser() {
  const user = await requireUser();
  const settings = await getSettings();
  if (!canUseMarketplace(user, settings)) notFound();
  return { user, settings };
}

/** Active listings anyone can buy from (operator active, seller still allowed), cheapest first. */
export async function listOpenListings(viewerId: string) {
  const settings = await getSettings();
  const rows = await db
    .select({ listing: listings, op: operators, seller: users })
    .from(listings)
    .innerJoin(operators, eq(operators.code, listings.operatorCode))
    .leftJoin(users, eq(users.id, listings.sellerId))
    .where(and(eq(listings.active, true), eq(operators.active, true)))
    .orderBy(asc(listings.priceBps));
  const open = rows.filter((r) => r.listing.sellerId !== viewerId && (!r.listing.sellerId || (r.seller && canUseMarketplace(r.seller, settings))));
  const reputation = await sellerReputation(open.map((r) => r.listing.sellerId));
  return open.map((r) => ({
    id: r.listing.id,
    sellerId: r.listing.sellerId,
    sellerName: r.listing.sellerId ? (r.seller?.name ?? null) : null,
    operatorCode: r.op.code,
    priceBps: r.listing.priceBps,
    paymentInfo: r.listing.paymentInfo,
    rating: reputation[r.listing.sellerId ?? "sarfli"] ?? null,
  }));
}

export type OpenListing = Awaited<ReturnType<typeof listOpenListings>>[number];

export async function listSellerListings(sellerId: string) {
  return db.select().from(listings).where(eq(listings.sellerId, sellerId));
}

/** Names of users by id (for order lists). */
export async function userNames(ids: (string | null)[]) {
  const list = [...new Set(ids.filter((x): x is string => !!x))];
  if (list.length === 0) return {} as Record<string, string | null>;
  const rows = await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, list));
  return Object.fromEntries(rows.map((r) => [r.id, r.name])) as Record<string, string | null>;
}

/** Open orders first (oldest first), then finished ones (newest first). */
export function openFirst<T extends { status: (typeof orders.$inferSelect)["status"]; createdAt: Date }>(rows: T[]) {
  const open = rows.filter((o) => OPEN_ORDER_STATUSES.includes(o.status)).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const done = rows.filter((o) => !OPEN_ORDER_STATUSES.includes(o.status));
  return [...open, ...done];
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
