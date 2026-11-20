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
  getOrderForUser,
  rateSeller,
  refuseExcess,
  reportNotPaid,
  sellStock,
  takePartial,
  upsertListing,
  type ListingInput,
} from "@/lib/engine/market";
import { canSpend } from "@/lib/engine/sarfli-credit";
import { createPosPairing, revokePosTerminal, setPosDailyLimit } from "@/lib/engine/pos";
import { parseDinars } from "@/lib/money";
import { cancelRecharge, createRecharge, type RechargeInput } from "@/lib/engine/recharge";
import { getCurrentUser } from "@/lib/session";
import { getSettings } from "@/lib/settings";
import { deleteProof, saveProof } from "@/lib/storage";

const MAX_PROOF_FILES = 5;
const MAX_PROOFS_PER_ORDER = 20;

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

/**
 * Runs an engine call for a signed-in user, then refreshes the given pages. Starting new work (orders,
 * listings, recharges) needs marketplace access; finishing what is already open never does, so turning
 * the switch off cannot freeze orders or reserved credit. The engine checks that the user is a party.
 */
async function run<T>(
  fn: (userId: string) => Promise<T>,
  paths: string[] = [],
  opts: { newWork?: boolean; spending?: boolean } = {},
): Promise<ActionResult<T>> {
  const user = await getCurrentUser();
  if (!user || user.blocked) return { ok: false, error: "not_found" };
  // Spending (recharges, shop PCs) is also open to admins (Sarfli's credit); the rest needs the marketplace.
  const allowed = opts.spending ? await canSpend(user) : canUseMarketplace(user, await getSettings());
  if (opts.newWork && !allowed) return { ok: false, error: "marketplace_closed" };
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
  return run((userId) => createOrder(userId, input), ["/buy", "/selling"], { newWork: true });
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
    if (files.length > MAX_PROOF_FILES) throw new EngineError("too_many_files");
    // Check before writing anything to disk; addPaymentProofs re-checks under the order lock.
    const found = /^[0-9a-f-]{36}$/i.test(orderId) ? await getOrderForUser(userId, orderId) : null;
    if (!found || found.order.buyerId !== userId) throw new EngineError("not_found");
    if (!["funded", "proof_uploaded", "admin_review"].includes(found.order.status)) throw new EngineError("invalid_state");
    if (found.proofs.length + files.length > MAX_PROOFS_PER_ORDER) throw new EngineError("too_many_files");
    const saved: { path: string; mime: string }[] = [];
    try {
      for (const f of files) {
        const { proofPath, proofMime } = await saveProof(f);
        saved.push({ path: proofPath, mime: proofMime });
      }
      await addPaymentProofs(userId, orderId, saved);
    } catch (e) {
      await Promise.all(saved.map((s) => deleteProof(s.path).catch(() => {})));
      throw e;
    }
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
  return run((userId) => upsertListing(userId, input), ["/selling", "/buy/sellers", "/buy/resell"], { newWork: true });
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
  return run((userId) => createRecharge(userId, input), ["/buy/recharge", "/buy"], { newWork: true, spending: true });
}

export async function cancelRechargeAction(rechargeId: string) {
  return run((userId) => cancelRecharge(userId, rechargeId), ["/buy/recharge", "/buy"]);
}

// POS terminals -------------------------------------------------------------

/** New terminal (name) or a fresh code for an existing one (terminalId). Returns the 6-digit code. */
export async function createPosPairingAction(input: { name?: string; terminalId?: string }) {
  return run(async (userId) => {
    const r = await createPosPairing(userId, input);
    return { code: r.code, expiresAt: r.expiresAt.toISOString() };
  }, ["/buy/pos"], { newWork: true, spending: true });
}

export async function revokePosTerminalAction(terminalId: string) {
  return run((userId) => revokePosTerminal(userId, terminalId), ["/buy/pos"]);
}

/** The owner's daily spending limit for one PC, in DT; empty clears it. */
export async function setPosDailyLimitAction(terminalId: string, dinars: string) {
  return run(async (userId) => {
    let millimes: number | null = null;
    if (dinars.trim()) {
      millimes = parseDinars(dinars);
      if (!millimes) throw new EngineError("invalid_amount");
    }
    await setPosDailyLimit(userId, terminalId, millimes);
  }, ["/buy/pos"]);
}
