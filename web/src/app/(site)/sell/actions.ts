"use server";

import { EngineError } from "@/lib/engine/core";
import { cancelSale, choosePartial, createSale, type CreateSaleInput } from "@/lib/engine/sales";
import { getCurrentUser } from "@/lib/session";

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

async function run<T>(fn: (userId: string) => Promise<T>): Promise<ActionResult<T>> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "not_found" };
  try {
    return { ok: true, data: await fn(user.id) };
  } catch (e) {
    if (e instanceof EngineError) return { ok: false, error: e.code };
    console.error(e);
    return { ok: false, error: "unknown" };
  }
}

export async function createSaleAction(input: CreateSaleInput) {
  return run((userId) => createSale(userId, input));
}

export async function cancelSaleAction(txId: string) {
  return run((userId) => cancelSale(userId, txId));
}

export async function choosePartialAction(txId: string, choice: "topup" | "accept") {
  return run((userId) => choosePartial(userId, txId, choice));
}
