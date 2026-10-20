import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { db } from "@/db";
import { getBalance } from "@/lib/engine/wallet";
import { listOperators } from "@/lib/queries";
import { requireUser } from "@/lib/session";
import { SellForm } from "./sell-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sell" };

export default async function SellPage({ searchParams }: { searchParams: Promise<{ op?: string }> }) {
  const user = await requireUser();
  const t = await getTranslations("sell");
  const { op } = await searchParams;
  const [ops, balance] = await Promise.all([listOperators(), getBalance(db, user.id)]);
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-8">
      <h1 className="mx-auto w-full max-w-xl font-heading font-bold text-3xl tracking-tight">{t("title")}</h1>
      <SellForm
        operators={ops.map((o) => ({ code: o.code, name: o.name, color: o.color, rateBps: o.rateBps, active: o.active }))}
        balanceMillimes={balance}
        initialOp={op}
      />
    </div>
  );
}
