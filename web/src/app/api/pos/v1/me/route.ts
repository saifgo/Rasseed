import { listPackages } from "@/lib/engine/packages";
import { posSpentToday } from "@/lib/engine/pos";
import { spendableByOperator, spendingOffer } from "@/lib/market-queries";
import { listOperators } from "@/lib/queries";
import { posRoute } from "../_util";

export const GET = posRoute(null, async ({ terminal, user }) => {
  const [ops, allPackages, spentToday] = await Promise.all([
    listOperators(),
    listPackages({ activeOnly: true }),
    posSpentToday(terminal.id),
  ]);
  const [{ balances, dataBalances, sarfli }, { rechargeEnabled, packages }] = await Promise.all([
    spendableByOperator(user, ops.map((o) => o.code)),
    // Light / Internet are greyed out while no SIM of the operator may send them.
    spendingOffer(ops, allPackages),
  ]);
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
      // Spendable on Light recharges; dataBalanceMillimes on Internet packages.
      balanceMillimes: balances[o.code] ?? 0,
      dataBalanceMillimes: dataBalances[o.code] ?? 0,
      rechargeEnabled: rechargeEnabled(o),
      // Largest plain recharge per POS sale (null = no cap); packages are not capped.
      maxRechargeMillimes: o.posMaxRechargeMillimes,
    })),
    packages: packages
      .filter((p) => activeCodes.has(p.operatorCode))
      .map((p) => ({ id: p.id, operatorCode: p.operatorCode, name: p.name, priceMillimes: p.priceMillimes })),
  };
});
