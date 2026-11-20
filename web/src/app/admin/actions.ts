"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { devLoginEnabled, signOut } from "@/auth";
import { db } from "@/db";
import { resetAndSeed } from "@/db/seed-data";
import { devices, operators, payoutMethods, USER_ROLES, users, type UserRole } from "@/db/schema";
import {
  applyCredit,
  configureSim,
  rejectCredit,
  requestBalanceCheck,
  resetSimFailures,
  resolveReview,
  setRate,
} from "@/lib/engine/admin";
import { EngineError } from "@/lib/engine/core";
import { createPairingCode } from "@/lib/engine/device";
import { adjustSarfliCredit, adminCancel, adminRelease, upsertSarfliListing } from "@/lib/engine/market";
import { createPackage, updatePackage } from "@/lib/engine/packages";
import { resolveRecharge } from "@/lib/engine/recharge";
import { adjustBalance, attachWithdrawalProof, markWithdrawalPaid, rejectWithdrawal, setWithdrawalNote } from "@/lib/engine/wallet";
import { parseDinars, parsePercent, parseRate } from "@/lib/money";
import { parseBalance, parseCreditSms } from "@/lib/parsers";
import { getCurrentUser, isAdmin, isStaff, type CurrentUser } from "@/lib/session";
import { saveSettings, type AppSettings } from "@/lib/settings";
import { saveProof } from "@/lib/storage";

export type AdminResult<T = null> = { ok: true; data: T } | { ok: false; error: string };

async function guarded<T>(allowed: (u: CurrentUser) => boolean, fn: (userId: string) => Promise<T>): Promise<AdminResult<T>> {
  const user = await getCurrentUser();
  if (!user || !allowed(user)) return { ok: false, error: "forbidden" };
  try {
    const data = await fn(user.id);
    revalidatePath("/admin", "layout");
    return { ok: true, data };
  } catch (e) {
    if (e instanceof EngineError) return { ok: false, error: e.code };
    if (e instanceof Error && /^[a-z_]+$/.test(e.message)) return { ok: false, error: e.message };
    console.error("[admin action]", e);
    return { ok: false, error: "unknown" };
  }
}

/** Operations: admins and managers. */
const staff = <T,>(fn: (userId: string) => Promise<T>) => guarded(isStaff, fn);
/** Setup and user management: admins only. */
const admin = <T,>(fn: (userId: string) => Promise<T>) => guarded(isAdmin, fn);

// --- Sales -------------------------------------------------------------------

export async function confirmReviewAction(txId: string, amountDinars: string, note: string) {
  return staff(async (id) => {
    const amount = parseDinars(amountDinars);
    if (!amount) throw new EngineError("invalid_amount");
    await resolveReview(id, txId, { action: "confirm", amountMillimes: amount, note });
    return null;
  });
}

export async function rejectReviewAction(txId: string, note: string) {
  return staff(async (id) => {
    await resolveReview(id, txId, { action: "reject", note });
    return null;
  });
}

// --- Withdrawals -------------------------------------------------------------

export async function markWithdrawalPaidAction(formData: FormData) {
  return staff(async (id) => {
    const withdrawalId = String(formData.get("withdrawalId") ?? "");
    const file = formData.get("proof");
    const proof = file instanceof File && file.size > 0 ? await saveProof(file) : undefined;
    await markWithdrawalPaid(id, withdrawalId, {
      reference: String(formData.get("reference") ?? "").trim().slice(0, 200),
      note: String(formData.get("note") ?? "").trim().slice(0, 1000),
      ...proof,
    });
    return null;
  });
}

export async function rejectWithdrawalAction(withdrawalId: string, reason: string) {
  return staff(async (id) => {
    await rejectWithdrawal(id, withdrawalId, reason);
    return null;
  });
}

export async function setWithdrawalNoteAction(withdrawalId: string, note: string) {
  return staff(async () => {
    await setWithdrawalNote(withdrawalId, note);
    return null;
  });
}

export async function attachWithdrawalProofAction(formData: FormData) {
  return staff(async () => {
    const file = formData.get("proof");
    if (!(file instanceof File) || file.size === 0) throw new EngineError("file_missing");
    const proof = await saveProof(file);
    await attachWithdrawalProof(String(formData.get("withdrawalId") ?? ""), proof.proofPath, proof.proofMime);
    return null;
  });
}

// --- Users & balances --------------------------------------------------------

export async function adjustBalanceAction(userId: string, direction: "credit" | "debit", amountDinars: string, note: string) {
  return staff(async (id) => {
    const amount = parseDinars(amountDinars);
    if (!amount) throw new EngineError("invalid_amount");
    await adjustBalance(id, userId, direction === "debit" ? -amount : amount, note);
    return null;
  });
}

export async function setUserRoleAction(userId: string, role: UserRole) {
  return admin(async (adminId) => {
    if (!USER_ROLES.includes(role)) throw new EngineError("invalid_role");
    if (userId === adminId) throw new EngineError("cannot_change_self");
    await db.update(users).set({ role }).where(eq(users.id, userId));
    return null;
  });
}

export async function setUserBlockedAction(userId: string, blocked: boolean) {
  return admin(async (adminId) => {
    if (userId === adminId) throw new EngineError("cannot_change_self");
    await db.update(users).set({ blocked }).where(eq(users.id, userId));
    return null;
  });
}

export async function setMarketplaceAccessAction(userId: string, access: boolean) {
  return admin(async () => {
    await db.update(users).set({ marketplaceAccess: access }).where(eq(users.id, userId));
    return null;
  });
}

// --- Marketplace -------------------------------------------------------------

export async function releaseOrderAction(orderId: string, note: string) {
  return staff(async (id) => {
    await adminRelease(id, orderId, note);
    return null;
  });
}

export async function cancelOrderAction(orderId: string, note: string) {
  return staff(async (id) => {
    await adminCancel(id, orderId, note);
    return null;
  });
}

export async function resolveRechargeAction(rechargeId: string, outcome: "succeeded" | "failed", note: string) {
  return staff(async (id) => {
    if (outcome !== "succeeded" && outcome !== "failed") throw new EngineError("invalid_state");
    await resolveRecharge(id, rechargeId, outcome, note);
    return null;
  });
}

/** Signed amount in DT ("-12.5" removes credit). Admin only: it creates or removes Sarfli credit in the ledger. */
export async function adjustSarfliCreditAction(operatorCode: string, amountDinars: string, note: string) {
  return admin(async (id) => {
    const s = amountDinars.trim().replace(/\s/g, "");
    const negative = s.startsWith("-");
    const amount = parseDinars(s.replace(/^[+-]/, ""));
    if (!amount) throw new EngineError("invalid_amount");
    await adjustSarfliCredit(id, operatorCode, negative ? -amount : amount, note);
    return null;
  });
}

export async function saveSarfliListingAction(operatorCode: string, values: { price: string; paymentInfo: string; active: boolean }) {
  return admin(async () => {
    const priceBps = parseRate(values.price);
    if (!priceBps) throw new EngineError("invalid_rate");
    await upsertSarfliListing({ operatorCode, priceBps, paymentInfo: values.paymentInfo, active: values.active });
    return null;
  });
}

// --- Credits -----------------------------------------------------------------

export async function applyCreditAction(creditId: string, txRef: string) {
  return staff(async (id) => {
    await applyCredit(id, creditId, txRef);
    return null;
  });
}

export async function rejectCreditAction(creditId: string, note: string) {
  return staff(async (id) => {
    await rejectCredit(id, creditId, note);
    return null;
  });
}

// --- Devices & SIMs ----------------------------------------------------------

export async function createDeviceAction(name: string) {
  return admin(async () => {
    const [d] = await db.insert(devices).values({ name: name.trim().slice(0, 60) || "Phone" }).returning();
    return { deviceId: d.id, code: await createPairingCode(d.id) };
  });
}

export async function newPairingCodeAction(deviceId: string) {
  return admin(async () => ({ deviceId, code: await createPairingCode(deviceId) }));
}

export async function updateDeviceAction(deviceId: string, values: { name?: string; enabled?: boolean }) {
  return admin(async () => {
    await db
      .update(devices)
      .set({ ...(values.name ? { name: values.name.slice(0, 60) } : {}), ...(values.enabled !== undefined ? { enabled: values.enabled } : {}) })
      .where(eq(devices.id, deviceId));
    return null;
  });
}

export async function configureSimAction(
  simId: string,
  input: Parameters<typeof configureSim>[1],
) {
  return admin(async () => {
    await configureSim(simId, input);
    return null;
  });
}

export async function checkBalanceAction(simId: string) {
  return admin(async () => {
    await requestBalanceCheck(simId);
    return null;
  });
}

export async function resetSimFailuresAction(simId: string) {
  return admin(async () => {
    await resetSimFailures(simId);
    return null;
  });
}

// --- Operators ---------------------------------------------------------------

export async function setRateAction(operatorCode: string, rate: string) {
  return admin(async (id) => {
    const bps = parseRate(rate);
    if (!bps) throw new EngineError("invalid_rate");
    await setRate(id, operatorCode, bps);
    return null;
  });
}

export async function updateOperatorAction(
  code: string,
  values: {
    active: boolean;
    transferUssdTemplate: string;
    balanceUssdCode: string;
    creditSmsRegex: string;
    creditSmsUnit: "millimes" | "dinars";
    creditSmsSenders: string;
    balanceRegex: string;
    balanceUnit: "auto" | "millimes" | "dinars";
    rechargeUssdTemplate: string;
    rechargeUssdSteps: string;
  },
) {
  return admin(async () => {
    // Recharge USSD: empty template = recharges off. Otherwise the dialog must carry the number and the amount.
    const rechargeTemplate = values.rechargeUssdTemplate.trim();
    const rechargeSteps = rechargeTemplate
      ? values.rechargeUssdSteps
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean)
          .slice(0, 10)
      : [];
    if (rechargeTemplate) {
      const all = [rechargeTemplate, ...rechargeSteps].join("\n");
      if (!all.includes("{number}")) throw new EngineError("recharge_needs_number");
      if (!all.includes("{millimes}") && !all.includes("{dinars}")) throw new EngineError("recharge_needs_amount");
    }
    for (const re of [values.creditSmsRegex, values.balanceRegex]) {
      try {
        new RegExp(re, "iu");
      } catch {
        throw new EngineError("invalid_regex");
      }
    }
    if (!values.creditSmsRegex.includes("(?<amount>") || !values.creditSmsRegex.includes("(?<sender>")) {
      throw new EngineError("sms_regex_needs_amount_and_sender");
    }
    if (!values.balanceRegex.includes("(?<amount>")) throw new EngineError("balance_regex_needs_amount");
    if (!values.transferUssdTemplate.includes("{number}")) throw new EngineError("template_needs_number");
    await db
      .update(operators)
      .set({
        active: values.active,
        transferUssdTemplate: values.transferUssdTemplate.trim(),
        balanceUssdCode: values.balanceUssdCode.trim(),
        creditSmsRegex: values.creditSmsRegex,
        creditSmsUnit: values.creditSmsUnit,
        creditSmsSenders: values.creditSmsSenders
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        balanceRegex: values.balanceRegex,
        balanceUnit: values.balanceUnit,
        rechargeUssdTemplate: rechargeTemplate || null,
        rechargeUssdSteps: rechargeSteps,
        updatedAt: new Date(),
      })
      .where(eq(operators.code, code));
    return null;
  });
}

/** Dry-run of the parsers with unsaved settings, for the operator editor. */
export async function testParsersAction(input: {
  creditSmsRegex: string;
  creditSmsUnit: "millimes" | "dinars";
  creditSmsSenders: string;
  balanceRegex: string;
  balanceUnit: "auto" | "millimes" | "dinars";
  sampleSms: string;
  sampleFrom: string;
  sampleBalance: string;
}) {
  return admin(async () => {
    const senders = input.creditSmsSenders.split(",").map((s) => s.trim()).filter(Boolean);
    const sms = input.sampleSms
      ? parseCreditSms(input.sampleSms, input.sampleFrom, { creditSmsRegex: input.creditSmsRegex, creditSmsUnit: input.creditSmsUnit, creditSmsSenders: senders })
      : null;
    const balance = input.sampleBalance ? parseBalance(input.sampleBalance, input) : null;
    return { sms, balance };
  });
}

// --- Settings ----------------------------------------------------------------

export async function saveSettingsAction(values: Partial<AppSettings>) {
  return admin(async () => {
    await saveSettings(values);
    return null;
  });
}

/** Per-operator cap on one plain (Light) recharge sent from a POS. Empty = no cap. Values in DT. */
export async function savePosRechargeLimitsAction(values: Record<string, string>) {
  return admin(async () => {
    const parsed: [string, number | null][] = [];
    for (const [code, raw] of Object.entries(values)) {
      if (!raw.trim()) {
        parsed.push([code, null]);
        continue;
      }
      const millimes = parseDinars(raw);
      if (!millimes) throw new EngineError("invalid_amount");
      parsed.push([code, millimes]);
    }
    for (const [code, millimes] of parsed) {
      await db.update(operators).set({ posMaxRechargeMillimes: millimes, updatedAt: new Date() }).where(eq(operators.code, code));
    }
    return null;
  });
}

export async function updatePayoutMethodAction(
  code: string,
  values: { active: boolean; feeType: "fixed" | "percent"; fee: string },
) {
  return admin(async () => {
    // Fixed and percentage fees are exclusive: saving one clears the other.
    const empty = values.fee.trim() === "" || Number(values.fee.trim().replace(",", ".").replace(/\s*%$/, "")) === 0;
    let feeMillimes = 0;
    let feeBps = 0;
    if (!empty) {
      const parsed = values.feeType === "percent" ? parsePercent(values.fee) : parseDinars(values.fee);
      if (parsed == null) throw new EngineError(values.feeType === "percent" ? "invalid_fee_percent" : "invalid_amount");
      if (values.feeType === "percent") feeBps = parsed;
      else feeMillimes = parsed;
    }
    await db.update(payoutMethods).set({ active: values.active, feeMillimes, feeBps }).where(eq(payoutMethods.code, code));
    return null;
  });
}

// --- Data packages (admin) ----------------------------------------------------

export type PackageFormValues = {
  name: string;
  price: string;
  ussdTemplate: string;
  ussdSteps: string;
  active: boolean;
  sortOrder: string;
};

function packageInput(v: PackageFormValues) {
  const priceMillimes = parseDinars(v.price);
  if (!priceMillimes) throw new EngineError("invalid_amount");
  return {
    name: v.name,
    priceMillimes,
    ussdTemplate: v.ussdTemplate,
    ussdSteps: v.ussdSteps.split("\n").map((l) => l.trim()),
    active: v.active,
    sortOrder: Number.parseInt(v.sortOrder, 10) || 0,
  };
}

export async function createPackageAction(operatorCode: string, values: PackageFormValues) {
  return admin(async () => createPackage({ operatorCode, ...packageInput(values) }));
}

export async function updatePackageAction(id: string, values: PackageFormValues) {
  return admin(async () => {
    await updatePackage(id, packageInput(values));
    return null;
  });
}

// --- Dev tools ---------------------------------------------------------------

/** Dev only (same switch as the password-less login): wipes the database, seeds demo data and signs out. */
export async function devResetDatabaseAction(): Promise<AdminResult> {
  if (!devLoginEnabled) return { ok: false, error: "forbidden" };
  const user = await getCurrentUser();
  if (!user || !isAdmin(user)) return { ok: false, error: "forbidden" };
  try {
    await resetAndSeed();
  } catch (e) {
    console.error("[dev reset]", e);
    return { ok: false, error: "unknown" };
  }
  // Every user (and so this session's user) was deleted: log in again with the dev login.
  await signOut({ redirectTo: "/login" });
  return { ok: true, data: null };
}
