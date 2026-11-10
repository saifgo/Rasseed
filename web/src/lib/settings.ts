import { db } from "@/db";
import { settings } from "@/db/schema";

export const DEFAULT_SETTINGS = {
  /** How long a number is reserved for the seller to send the credit. */
  holdMinutes: 15,
  /** A number stays unassigned this long after a transaction ends (catches late transfers). */
  cooldownSeconds: 120,
  /** A queued transaction is cancelled if no number frees up within this time. */
  queueTimeoutMinutes: 30,
  /** A device (or SIM) not heard from within this window is considered offline. */
  deviceOfflineSeconds: 45,
  /** A USSD command without a result after this long is considered failed. */
  commandTimeoutSeconds: 90,
  /** Balance checks while an SMS-announced credit is not yet visible in the balance. */
  verifyMaxAttempts: 4,
  verifyRetrySeconds: 20,
  /** Balance polling interval for held numbers (detects credit that arrives without SMS). */
  pollIntervalSeconds: 90,
  /** How long to wait for the SMS when the balance went up without one. */
  smsGraceSeconds: 180,
  /** Late transfers from the same sender within this window are linked to the old transaction. */
  lateCreditWindowHours: 24,
  /** USSD failures in a row before a SIM is skipped for new assignments. */
  maxSimFailures: 3,
  /** Smallest withdrawal a seller can request, in millimes (placeholder: 5 DT — adjust in Settings). */
  minWithdrawalMillimes: 5000,
  /** Buyer marketplace switch: 0 = hidden from everyone but staff, 1 = open to users with marketplace access. */
  marketplaceEnabled: 0,
  /** Sarfli's commission on released orders, in basis points of the credit (200 = 2%). */
  commissionBps: 0,
  /** Largest order a buyer can place, in millimes of credit (placeholder: 50 DT — adjust in Settings). */
  maxOrderMillimes: 50000,
  /** Balance checks after a recharge was sent, before it goes to an admin. */
  rechargeVerifyAttempts: 4,
};

/** Settings where 0 is a meaningful value (switches, rates). */
const ZERO_ALLOWED = new Set<string>(["marketplaceEnabled", "commissionBps"]);

export type AppSettings = typeof DEFAULT_SETTINGS;

export async function getSettings(): Promise<AppSettings> {
  const rows = await db.select().from(settings);
  const out = { ...DEFAULT_SETTINGS };
  for (const r of rows) {
    if (r.key in out && typeof r.value === "number") (out as Record<string, number>)[r.key] = r.value;
  }
  return out;
}

export async function saveSettings(values: Partial<AppSettings>) {
  for (const [key, value] of Object.entries(values)) {
    if (!(key in DEFAULT_SETTINGS) || typeof value !== "number" || !Number.isFinite(value)) continue;
    if (value < 0 || (value === 0 && !ZERO_ALLOWED.has(key))) continue;
    if (!Number.isInteger(value)) continue;
    if (key === "commissionBps" && value > 10_000) continue;
    if (key === "marketplaceEnabled" && value > 1) continue;
    await db.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value } });
  }
}
