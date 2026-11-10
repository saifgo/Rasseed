"use server";

import { revalidatePath } from "next/cache";
import { EngineError } from "@/lib/engine/core";
import {
  acceptExcess,
  addPaymentProofs,
  cancelBySeller,
  cancelByBuyer,
  canUseMarketplace,
  chooseLeftover,
  confirmPayment,
  createOrder,
  flagToAdmin,
  rateSeller,
  refuseExcess,
  reportNotPaid,
  sellStock,
  takePartial,
  upsertListing,
  type ListingInput,
} from "@/lib/engine/market";
import { cancelRecharge, createRecharge, type RechargeInput } from "@/lib/engine/recharge";
import { getCurrentUser } from "@/lib/session";
import { getSettings } from "@/lib/settings";
import { saveProof } from "@/lib/storage";

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

/** Runs an engine call for a signed-in user who may use the marketplace, then refreshes the given pages. */
async function run<T>(fn: (userId: string) => Promise<T>, paths: string[] = []): Promise<ActionResult<T>> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "not_found" };
  if (!canUseMarketplace(user, await getSettings())) return { ok: false, error: "marketplace_closed" };
  try {
    const data = await fn(user.id);
    for (const p of paths) revalidatePath(p);
    return { ok: true, data };
  } catch (e) {
    if (e instanceof EngineError) return { ok: false, error: e.code };
    if (e instanceof Error && (e.message === "unsupported_file_type" || e.message === "file_too_large")) return { ok: false, error: e.message };
    console.error(e);
    return { ok: false, error: "unknown" };
  }
}

const orderPaths = (id: string) => [`/orders/${id}`, "/buy", "/selling"];

// Buyer ----------------------------------------------------------------------

export async function createOrderAction(input: { listingId: string; amountMillimes: number }) {
  return run((userId) => createOrder(userId, input), ["/buy", "/selling"]);
}

export async function takePartialAction(orderId: string) {
  return run((userId) => takePartial(userId, orderId), orderPaths(orderId));
}

export async function acceptExcessAction(orderId: string) {
  return run((userId) => acceptExcess(userId, orderId), orderPaths(orderId));
}

export async function refuseExcessAction(orderId: string) {
  return run((userId) => refuseExcess(userId, orderId), orderPaths(orderId));
}

/** FormData: orderId + one or more "files". */
export async function uploadProofsAction(formData: FormData) {
  const orderId = String(formData.get("orderId") ?? "");
  const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  return run(async (userId) => {
    if (files.length === 0) throw new EngineError("proof_required");
    const saved = [];
    for (const f of files) {
      const { proofPath, proofMime } = await saveProof(f);
      saved.push({ path: proofPath, mime: proofMime });
    }
    await addPaymentProofs(userId, orderId, saved);
  }, orderPaths(orderId));
}

export async function flagToAdminAction(orderId: string, reason: string) {
  return run((userId) => flagToAdmin(userId, orderId, reason), orderPaths(orderId));
}

export async function cancelByBuyerAction(orderId: string) {
  return run((userId) => cancelByBuyer(userId, orderId), orderPaths(orderId));
}

export async function rateSellerAction(orderId: string, stars: number, comment: string) {
  return run((userId) => rateSeller(userId, orderId, stars, comment), orderPaths(orderId));
}

// Seller ---------------------------------------------------------------------

export async function upsertListingAction(input: ListingInput) {
  return run((userId) => upsertListing(userId, input), ["/selling", "/buy/sellers"]);
}

export async function confirmPaymentAction(orderId: string) {
  return run((userId) => confirmPayment(userId, orderId), orderPaths(orderId));
}

export async function reportNotPaidAction(orderId: string, reason: string) {
  return run((userId) => reportNotPaid(userId, orderId, reason), orderPaths(orderId));
}

export async function cancelBySellerAction(orderId: string, reason: string) {
  return run((userId) => cancelBySeller(userId, orderId, reason), orderPaths(orderId));
}

export async function chooseLeftoverAction(orderId: string, choice: "stock" | "sarfli") {
  return run((userId) => chooseLeftover(userId, orderId, choice), [...orderPaths(orderId), "/wallet"]);
}

export async function sellStockAction(operatorCode: string, amountMillimes: number) {
  return run((userId) => sellStock(userId, operatorCode, amountMillimes), ["/selling", "/wallet"]);
}

// Recharges ------------------------------------------------------------------

export async function createRechargeAction(input: RechargeInput) {
  return run((userId) => createRecharge(userId, input), ["/buy/recharge", "/buy"]);
}

export async function cancelRechargeAction(rechargeId: string) {
  return run((userId) => cancelRecharge(userId, rechargeId), ["/buy/recharge", "/buy"]);
}
