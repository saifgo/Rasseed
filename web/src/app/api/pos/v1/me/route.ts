import { listPackages } from "@/lib/engine/packages";
import { posSpentToday } from "@/lib/engine/pos";
import { spendableByOperator } from "@/lib/market-queries";
import { listOperators } from "@/lib/queries";
import { posRoute } from "../_util";

export const GET = posRoute(null, async ({ terminal, user }) => {
  const [ops, packages, spentToday] = await Promise.all([
    listOperators(),
    listPackages({ activeOnly: true }),
    posSpentToday(terminal.id),
  ]);
  const { balances, sarfli } = await spendableByOperator(user, ops.map((o) => o.code));
  const active = ops.filter((o) => o.active);
  const activeCodes = new Set(active.map((o) => o.code));
  return {
    terminal: {
      id: terminal.id,
      name: terminal.name,
      // The owner's daily limit for this PC (null = none) and what it spent today, Tunisia time.
      dailyLimitMillimes: terminal.dailyLimitMillimes,
      spentTodayMillimes: spentToday,
    },
    user: { name: user.name, email: user.email },
    // sarfli = an admin terminal spending Sarfli's own credit; balance = a buyer's own credit balance.
    source: sarfli ? "sarfli" : "balance",
    operators: active.map((o) => ({
      code: o.code,
      name: o.name,
      color: o.color,
      balanceMillimes: balances[o.code] ?? 0,
      rechargeEnabled: Boolean(o.rechargeUssdTemplate),
      // Largest plain recharge per POS sale (null = no cap); packages are not capped.
      maxRechargeMillimes: o.posMaxRechargeMillimes,
    })),
    packages: packages
      .filter((p) => activeCodes.has(p.operatorCode))
      .map((p) => ({ id: p.id, operatorCode: p.operatorCode, name: p.name, priceMillimes: p.priceMillimes })),
  };
});
