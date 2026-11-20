"use server";

import { EngineError } from "@/lib/engine/core";
import { parseDinars } from "@/lib/money";
import { getCurrentUser, isAdmin } from "@/lib/session";
import {
  getTestPhoneView,
  setTestBalance,
  setTestModes,
  simulateCredit,
  testPhoneEnabled,
  testPhoneTick,
  type CreditKind,
  type SendMode,
  type TestPhoneView,
} from "@/lib/test-phone";

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

/** Every test-phone action re-checks the dev flag and the admin role. */
async function guarded<T>(fn: () => Promise<T>): Promise<Result<T>> {
  if (!testPhoneEnabled()) return { ok: false, error: "forbidden" };
  const user = await getCurrentUser();
  if (!isAdmin(user)) return { ok: false, error: "forbidden" };
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    if (e instanceof EngineError) return { ok: false, error: e.code };
    console.error("[test-phone action]", e);
    return { ok: false, error: "unknown" };
  }
}

/** Polled by the open page: one phone heartbeat, then the fresh view. */
export async function testPhoneTickAction(): Promise<Result<TestPhoneView | null>> {
  return guarded(async () => {
    await testPhoneTick();
    return getTestPhoneView();
  });
}

export async function simulateCreditAction(simId: string, amountDinars: string, sender: string, kind: CreditKind) {
  return guarded(async () => {
    const amount = parseDinars(amountDinars);
    if (!amount) throw new EngineError("invalid_amount");
    await simulateCredit(simId, amount, sender, kind);
    return null;
  });
}

export async function setTestBalanceAction(simId: string, amountDinars: string) {
  return guarded(async () => {
    const amount = amountDinars.trim() === "0" ? 0 : parseDinars(amountDinars);
    if (amount == null) throw new EngineError("invalid_amount");
    await setTestBalance(simId, amount);
    return null;
  });
}

export async function setTestModesAction(input: { sendMode?: SendMode; balanceFails?: boolean }) {
  return guarded(async () => {
    await setTestModes(input);
    return null;
  });
}
