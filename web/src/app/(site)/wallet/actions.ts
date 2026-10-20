"use server";

import { revalidatePath } from "next/cache";
import { EngineError } from "@/lib/engine/core";
import { requestWithdrawal, type WithdrawalInput } from "@/lib/engine/wallet";
import { getCurrentUser } from "@/lib/session";

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

export async function requestWithdrawalAction(input: WithdrawalInput): Promise<ActionResult<string>> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "not_found" };
  try {
    const id = await requestWithdrawal(user.id, input);
    revalidatePath("/wallet");
    return { ok: true, data: id };
  } catch (e) {
    if (e instanceof EngineError) return { ok: false, error: e.code };
    console.error(e);
    return { ok: false, error: "unknown" };
  }
}
