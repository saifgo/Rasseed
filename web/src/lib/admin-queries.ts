import "server-only";
import { and, asc, count, desc, eq, gte, ilike, inArray, isNotNull, lt, lte, or, sql, sum } from "drizzle-orm";
import { db } from "@/db";
import {
  ACTIVE_TX_STATUSES,
  balanceSnapshots,
  credits,
  deviceCommands,
  devices,
  operators,
  payoutMethods,
  payouts,
  rateHistory,
  sims,
  smsMessages,
  transactions,
  users,
  walletEntries,
  withdrawals,
  type TxStatus,
  type WithdrawalStatus,
} from "@/db/schema";
import { getSettings } from "@/lib/settings";

export async function getAdminCounts() {
  const settings = await getSettings();
  const onlineSince = new Date(Date.now() - settings.deviceOfflineSeconds * 1000);
  const [[review], [pay], [cred], [simAlerts]] = await Promise.all([
    db.select({ n: count() }).from(transactions).where(eq(transactions.status, "review")),
    db.select({ n: count() }).from(withdrawals).where(eq(withdrawals.status, "pending")),
    db.select({ n: count() }).from(credits).where(inArray(credits.status, ["late", "unmatched"])),
    db
      .select({ n: count() })
      .from(sims)
      .innerJoin(devices, eq(devices.id, sims.deviceId))
      .where(
        and(
          // SIMs in a disabled phone don't need attention.
          eq(devices.enabled, true),
          or(
            eq(sims.status, "unconfigured"),
            and(eq(sims.status, "active"), or(sql`${sims.lastReportedAt} is null`, lte(sims.lastReportedAt, onlineSince))),
            and(eq(sims.status, "active"), gte(sims.consecutiveFailures, settings.maxSimFailures)),
          ),
        ),
      ),
  ]);
  return { review: review.n, withdrawals: pay.n, credits: cred.n, numbersAlert: simAlerts.n };
}

export async function getOverview() {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const [[pending], [today], [active], balances, [owed]] = await Promise.all([
    db.select({ n: count(), total: sum(withdrawals.sendMillimes) }).from(withdrawals).where(eq(withdrawals.status, "pending")),
    db
      .select({ n: count(), credit: sum(transactions.finalMillimes), payout: sum(transactions.payoutNetMillimes) })
      .from(transactions)
      .where(and(inArray(transactions.status, ["confirmed", "paid"]), gte(transactions.completedAt, startOfDay))),
    db.select({ n: count() }).from(transactions).where(inArray(transactions.status, ACTIVE_TX_STATUSES)),
    db
      .select({ operatorCode: sims.operatorCode, total: sum(sims.balanceMillimes), n: count() })
      .from(sims)
      .where(isNotNull(sims.operatorCode))
      .groupBy(sims.operatorCode),
    db.select({ total: sum(walletEntries.amountMillimes) }).from(walletEntries),
  ]);
  return {
    pendingWithdrawals: { count: pending.n, totalMillimes: Number(pending.total ?? 0) },
    // Sum of all seller balances: money the business owes (pending withdrawals excluded).
    owedMillimes: Number(owed.total ?? 0),
    today: { count: today.n, creditMillimes: Number(today.credit ?? 0), payoutMillimes: Number(today.payout ?? 0) },
    activeSales: active.n,
    balances: balances.map((b) => ({ operatorCode: b.operatorCode!, totalMillimes: Number(b.total ?? 0), sims: b.n })),
  };
}

export async function listSales(filter: { status?: TxStatus | "active"; q?: string; userId?: string; limit?: number }) {
  const conds = [];
  if (filter.userId) conds.push(eq(transactions.userId, filter.userId));
  if (filter.status === "active") conds.push(inArray(transactions.status, ACTIVE_TX_STATUSES));
  else if (filter.status) conds.push(eq(transactions.status, filter.status));
  if (filter.q) {
    const q = `%${filter.q.trim()}%`;
    conds.push(or(ilike(transactions.ref, q), ilike(transactions.senderMsisdn, q), ilike(users.email, q), ilike(transactions.assignedMsisdn, q)));
  }
  return db
    .select({ tx: transactions, op: operators, user: { email: users.email, name: users.name } })
    .from(transactions)
    .innerJoin(operators, eq(operators.code, transactions.operatorCode))
    .innerJoin(users, eq(users.id, transactions.userId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(transactions.createdAt))
    .limit(filter.limit ?? 200);
}

export async function getSaleAudit(txId: string) {
  const [tx] = await db.select().from(transactions).where(eq(transactions.id, txId));
  if (!tx) return null;
  const [user] = await db.select().from(users).where(eq(users.id, tx.userId));
  const [sim] = tx.simId ? await db.select().from(sims).where(eq(sims.id, tx.simId)) : [];
  const end = tx.completedAt ?? new Date();
  const txCredits = await db
    .select({ credit: credits, sms: smsMessages })
    .from(credits)
    .leftJoin(smsMessages, eq(smsMessages.id, credits.smsId))
    .where(
      or(
        eq(credits.txId, tx.id),
        tx.simId && tx.baselineAt
          ? and(eq(credits.simId, tx.simId), gte(credits.receivedAt, tx.baselineAt), lte(credits.receivedAt, end))
          : sql`false`,
      ),
    )
    .orderBy(asc(credits.receivedAt));
  const commands = tx.simId
    ? await db
        .select()
        .from(deviceCommands)
        .where(
          or(
            eq(deviceCommands.txId, tx.id),
            and(
              eq(deviceCommands.simId, tx.simId),
              gte(deviceCommands.createdAt, tx.queuedAt),
              lte(deviceCommands.createdAt, end),
            ),
          ),
        )
        .orderBy(asc(deviceCommands.createdAt))
    : [];
  return { tx, user, sim, credits: txCredits, commands };
}

export async function listWithdrawals(status: WithdrawalStatus) {
  return db
    .select({ w: withdrawals, method: payoutMethods, user: { id: users.id, email: users.email, name: users.name } })
    .from(withdrawals)
    .innerJoin(payoutMethods, eq(payoutMethods.code, withdrawals.methodCode))
    .innerJoin(users, eq(users.id, withdrawals.userId))
    .where(eq(withdrawals.status, status))
    .orderBy(status === "pending" ? asc(withdrawals.createdAt) : desc(withdrawals.createdAt))
    .limit(300);
}

/** Per-sale payouts from before the account balance. Read-only history. */
export async function listLegacyPayouts() {
  return db
    .select({ payout: payouts, tx: transactions, method: payoutMethods, user: { email: users.email, name: users.name } })
    .from(payouts)
    .innerJoin(transactions, eq(transactions.id, payouts.txId))
    .innerJoin(payoutMethods, eq(payoutMethods.code, payouts.methodCode))
    .innerJoin(users, eq(users.id, payouts.userId))
    .orderBy(desc(payouts.createdAt))
    .limit(300);
}

export async function listUsers(q?: string) {
  const balance = db
    .select({ userId: walletEntries.userId, total: sum(walletEntries.amountMillimes).as("total") })
    .from(walletEntries)
    .groupBy(walletEntries.userId)
    .as("balance");
  const salesAgg = db
    .select({ userId: transactions.userId, n: count().as("n") })
    .from(transactions)
    .groupBy(transactions.userId)
    .as("sales_agg");
  const cond = q ? or(ilike(users.email, `%${q.trim()}%`), ilike(users.name, `%${q.trim()}%`)) : undefined;
  const rows = await db
    .select({ user: users, balance: balance.total, sales: salesAgg.n })
    .from(users)
    .leftJoin(balance, eq(balance.userId, users.id))
    .leftJoin(salesAgg, eq(salesAgg.userId, users.id))
    .where(cond)
    .orderBy(desc(users.createdAt))
    .limit(300);
  return rows.map((r) => ({ user: r.user, balanceMillimes: Number(r.balance ?? 0), sales: Number(r.sales ?? 0) }));
}

export async function getUserDetail(userId: string) {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) return null;
  const [entries, userWithdrawals, [bal]] = await Promise.all([
    db
      .select({ e: walletEntries, tx: { ref: transactions.ref }, w: { ref: withdrawals.ref }, by: { email: users.email } })
      .from(walletEntries)
      .leftJoin(transactions, eq(transactions.id, walletEntries.txId))
      .leftJoin(withdrawals, eq(withdrawals.id, walletEntries.withdrawalId))
      .leftJoin(users, eq(users.id, walletEntries.createdBy))
      .where(eq(walletEntries.userId, userId))
      .orderBy(desc(walletEntries.createdAt))
      .limit(200),
    db
      .select({ w: withdrawals, method: payoutMethods })
      .from(withdrawals)
      .innerJoin(payoutMethods, eq(payoutMethods.code, withdrawals.methodCode))
      .where(eq(withdrawals.userId, userId))
      .orderBy(desc(withdrawals.createdAt))
      .limit(100),
    db.select({ total: sum(walletEntries.amountMillimes) }).from(walletEntries).where(eq(walletEntries.userId, userId)),
  ]);
  return { user, entries, withdrawals: userWithdrawals, balanceMillimes: Number(bal.total ?? 0) };
}

export async function listOpenCredits() {
  return db
    .select({ credit: credits, sim: sims, sms: smsMessages, tx: { id: transactions.id, ref: transactions.ref, status: transactions.status } })
    .from(credits)
    .innerJoin(sims, eq(sims.id, credits.simId))
    .leftJoin(smsMessages, eq(smsMessages.id, credits.smsId))
    .leftJoin(transactions, eq(transactions.id, credits.txId))
    .where(inArray(credits.status, ["late", "unmatched"]))
    .orderBy(desc(credits.receivedAt));
}

export async function listResolvedCredits() {
  return db
    .select({ credit: credits, sim: sims, tx: { id: transactions.id, ref: transactions.ref } })
    .from(credits)
    .innerJoin(sims, eq(sims.id, credits.simId))
    .leftJoin(transactions, eq(transactions.id, credits.txId))
    .where(inArray(credits.status, ["applied", "rejected"]))
    .orderBy(desc(credits.receivedAt))
    .limit(50);
}

export async function listDevicesWithSims() {
  const [devs, simRows, ops] = await Promise.all([
    db.select().from(devices).orderBy(asc(devices.createdAt)),
    db
      .select({ sim: sims, tx: { id: transactions.id, ref: transactions.ref, status: transactions.status } })
      .from(sims)
      .leftJoin(transactions, eq(transactions.id, sims.heldByTxId))
      .orderBy(asc(sims.slotIndex)),
    db.select().from(operators).orderBy(asc(operators.sortOrder)),
  ]);
  return { devices: devs.map((d) => ({ ...d, sims: simRows.filter((s) => s.sim.deviceId === d.id) })), operators: ops };
}

export async function getSimHistory(simId: string) {
  const [sim] = await db.select().from(sims).where(eq(sims.id, simId));
  if (!sim) return null;
  const [snapshots, cmds, sms, simCredits] = await Promise.all([
    db.select().from(balanceSnapshots).where(eq(balanceSnapshots.simId, simId)).orderBy(desc(balanceSnapshots.takenAt)).limit(100),
    db.select().from(deviceCommands).where(eq(deviceCommands.simId, simId)).orderBy(desc(deviceCommands.createdAt)).limit(50),
    db.select().from(smsMessages).where(eq(smsMessages.simId, simId)).orderBy(desc(smsMessages.createdAt)).limit(50),
    db
      .select({ credit: credits, tx: { id: transactions.id, ref: transactions.ref } })
      .from(credits)
      .leftJoin(transactions, eq(transactions.id, credits.txId))
      .where(eq(credits.simId, simId))
      .orderBy(desc(credits.receivedAt))
      .limit(100),
  ]);
  const [device] = await db.select().from(devices).where(eq(devices.id, sim.deviceId));
  return { sim, device, snapshots, commands: cmds, sms, credits: simCredits };
}

export async function getOperatorsAdmin() {
  const ops = await db.select().from(operators).orderBy(asc(operators.sortOrder));
  const history = await db
    .select({ h: rateHistory, by: users.email })
    .from(rateHistory)
    .leftJoin(users, eq(users.id, rateHistory.setBy))
    .orderBy(desc(rateHistory.createdAt))
    .limit(60);
  // Latest raw replies per operator help writing and checking the balance regex.
  const recentReplies = await db
    .select({ operatorCode: sims.operatorCode, raw: deviceCommands.rawResponse, status: deviceCommands.status, at: deviceCommands.completedAt, parsed: deviceCommands.parsedBalanceMillimes })
    .from(deviceCommands)
    .innerJoin(sims, eq(sims.id, deviceCommands.simId))
    .where(isNotNull(deviceCommands.rawResponse))
    .orderBy(desc(deviceCommands.completedAt))
    .limit(30);
  const recentSms = await db
    .select({ operatorCode: sims.operatorCode, from: smsMessages.fromAddress, body: smsMessages.body, classification: smsMessages.classification, at: smsMessages.createdAt })
    .from(smsMessages)
    .leftJoin(sims, eq(sims.id, smsMessages.simId))
    .orderBy(desc(smsMessages.createdAt))
    .limit(30);
  return { operators: ops, history, recentReplies, recentSms };
}

export async function getOnlineSince() {
  const settings = await getSettings();
  return new Date(Date.now() - settings.deviceOfflineSeconds * 1000);
}

export async function recentActive() {
  return db
    .select({ tx: transactions, op: operators })
    .from(transactions)
    .innerJoin(operators, eq(operators.code, transactions.operatorCode))
    .where(inArray(transactions.status, ACTIVE_TX_STATUSES))
    .orderBy(asc(transactions.queuedAt))
    .limit(20);
}

export async function devicesHealth() {
  const onlineSince = await getOnlineSince();
  const rows = await db.select().from(devices).where(eq(devices.enabled, true));
  return rows.map((d) => ({ ...d, online: Boolean(d.lastSeenAt && d.lastSeenAt > onlineSince) }));
}


/** Business days follow Tunisia time. */
export const BUSINESS_TZ = "Africa/Tunis";

export function todayInBusinessTz() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: BUSINESS_TZ }).format(new Date());
}

/**
 * Day closing for one calendar day (YYYY-MM-DD, Tunisia time):
 * SIM credit at the start and end of the day per operator, credit received from confirmed sales,
 * and cash paid out through withdrawals marked paid that day.
 */
export async function getDayClosing(day: string) {
  const [bounds] = await db.execute<{ start: Date; end: Date }>(
    sql`select ((${day})::date)::timestamp at time zone ${BUSINESS_TZ} as "start",
               ((${day})::date + 1)::timestamp at time zone ${BUSINESS_TZ} as "end"`,
  );
  const start = new Date(bounds.start);
  const end = new Date(bounds.end);
  const startIso = start.toISOString();
  const endIso = end.toISOString();

  const [ops, simRows, beforeStart, firstInDay, beforeEnd, sales, paid] = await Promise.all([
    db.select().from(operators).orderBy(asc(operators.sortOrder)),
    db.select({ id: sims.id, operatorCode: sims.operatorCode }).from(sims).where(isNotNull(sims.operatorCode)),
    // Last balance check before the day started.
    db.execute<{ sim_id: string; balance: string }>(
      sql`select distinct on (sim_id) sim_id, balance_millimes::text as balance from balance_snapshots
          where taken_at < ${startIso}::timestamptz order by sim_id, taken_at desc`,
    ),
    // First check of the day: used as the start for SIMs with no earlier check (added that day).
    db.execute<{ sim_id: string; balance: string }>(
      sql`select distinct on (sim_id) sim_id, balance_millimes::text as balance from balance_snapshots
          where taken_at >= ${startIso}::timestamptz and taken_at < ${endIso}::timestamptz order by sim_id, taken_at asc`,
    ),
    // Last check before the day ended (for today: the latest check so far).
    db.execute<{ sim_id: string; balance: string }>(
      sql`select distinct on (sim_id) sim_id, balance_millimes::text as balance from balance_snapshots
          where taken_at < ${endIso}::timestamptz order by sim_id, taken_at desc`,
    ),
    db
      .select({
        operatorCode: transactions.operatorCode,
        n: count(),
        credit: sum(transactions.finalMillimes),
        cash: sum(transactions.payoutGrossMillimes),
      })
      .from(transactions)
      .where(and(inArray(transactions.status, ["confirmed", "paid"]), gte(transactions.completedAt, start), lt(transactions.completedAt, end)))
      .groupBy(transactions.operatorCode),
    db
      .select({
        methodCode: withdrawals.methodCode,
        n: count(),
        send: sum(withdrawals.sendMillimes),
        gross: sum(withdrawals.grossMillimes),
        fee: sum(withdrawals.feeMillimes),
      })
      .from(withdrawals)
      .where(and(eq(withdrawals.status, "paid"), gte(withdrawals.paidAt, start), lt(withdrawals.paidAt, end)))
      .groupBy(withdrawals.methodCode),
  ]);
  const methods = await db.select().from(payoutMethods).orderBy(asc(payoutMethods.sortOrder));

  const toMap = (rows: { sim_id: string; balance: string }[]) => new Map(rows.map((r) => [r.sim_id, Number(r.balance)]));
  const startMap = toMap(beforeStart);
  const firstMap = toMap(firstInDay);
  const endMap = toMap(beforeEnd);

  const operatorRows = ops.map((op) => {
    let startMillimes = 0;
    let endMillimes = 0;
    let simsCounted = 0;
    let estimatedSims = 0;
    for (const s of simRows) {
      if (s.operatorCode !== op.code) continue;
      const before = startMap.get(s.id);
      const first = firstMap.get(s.id);
      const last = endMap.get(s.id);
      if (before == null && first == null && last == null) continue;
      simsCounted++;
      if (before != null) startMillimes += before;
      else if (first != null) {
        startMillimes += first;
        estimatedSims++;
      }
      endMillimes += last ?? 0;
    }
    const sale = sales.find((x) => x.operatorCode === op.code);
    const receivedMillimes = Number(sale?.credit ?? 0);
    return {
      code: op.code,
      name: op.name,
      color: op.color,
      sims: simsCounted,
      estimatedSims,
      startMillimes,
      receivedMillimes,
      salesCount: sale?.n ?? 0,
      cashMillimes: Number(sale?.cash ?? 0),
      endMillimes,
      // Change not explained by confirmed sales (credit moved out, pending sales, missed checks…).
      differenceMillimes: endMillimes - startMillimes - receivedMillimes,
    };
  });

  const payoutRows = paid.map((p) => {
    const m = methods.find((x) => x.code === p.methodCode);
    return {
      code: p.methodCode,
      name: m?.name.en ?? p.methodCode,
      count: p.n,
      sendMillimes: Number(p.send ?? 0),
      grossMillimes: Number(p.gross ?? 0),
      feeMillimes: Number(p.fee ?? 0),
    };
  });

  const total = <T>(rows: T[], pick: (r: T) => number) => rows.reduce((a, r) => a + pick(r), 0);
  return {
    day,
    start,
    end,
    operators: operatorRows,
    payouts: payoutRows,
    totals: {
      startMillimes: total(operatorRows, (r) => r.startMillimes),
      receivedMillimes: total(operatorRows, (r) => r.receivedMillimes),
      salesCount: total(operatorRows, (r) => r.salesCount),
      cashMillimes: total(operatorRows, (r) => r.cashMillimes),
      endMillimes: total(operatorRows, (r) => r.endMillimes),
      differenceMillimes: total(operatorRows, (r) => r.differenceMillimes),
      paidCount: total(payoutRows, (r) => r.count),
      paidSendMillimes: total(payoutRows, (r) => r.sendMillimes),
      paidGrossMillimes: total(payoutRows, (r) => r.grossMillimes),
      paidFeeMillimes: total(payoutRows, (r) => r.feeMillimes),
    },
  };
}
