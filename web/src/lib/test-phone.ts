import "server-only";
import { and, asc, desc, eq, gt, inArray, or } from "drizzle-orm";
import { db, type DbTx } from "@/db";
import { deviceCommands, devices, operators, orders, recharges, settings, sims, transactions, users } from "@/db/schema";
import { requestBalanceCheck } from "@/lib/engine/admin";
import { EngineError, enqueueBalanceCheck } from "@/lib/engine/core";
import { commandResult, ingestSms, syncDevice } from "@/lib/engine/device";
import { normalizeMsisdn } from "@/lib/phone";
import { balanceReply, creditSmsBody, SEND_REFUSED_REPLY, sendSuccessReply } from "@/lib/simulated-phone";

/**
 * Dev-only "Test phone": a simulated agent phone driven from the admin console, so credit flows can be
 * tried in the browser without a real phone. It goes through the same engine entry points as a real
 * phone (syncDevice / commandResult / ingestSms), so the engine can't tell the difference.
 *
 * Only exists when AUTH_DEV_LOGIN=true (never in production). It is never driven by the worker: it is
 * online only while the admin page is open and polling testPhoneTick().
 */
export function testPhoneEnabled() {
  return process.env.AUTH_DEV_LOGIN === "true" && process.env.NODE_ENV !== "production";
}

export const TEST_PHONE_NAME = "Test phone (simulated)";
const STATE_KEY = "test_phone_state";
const DEFAULT_BALANCE = 100_000; // 100 DT
const LOG_SIZE = 40;

export const SEND_MODES = ["success", "refused", "no_answer", "error"] as const;
export type SendMode = (typeof SEND_MODES)[number];
export const CREDIT_KINDS = ["real", "sms_only", "balance_only"] as const;
export type CreditKind = (typeof CREDIT_KINDS)[number];

export type TestLogEntry = {
  at: string;
  kind: "balance" | "send" | "sms";
  purpose: string;
  simId: string;
  ok: boolean | null; // null = left unanswered
  text: string;
};

type State = {
  deviceId: string | null;
  balances: Record<string, number>;
  sendMode: SendMode;
  balanceFails: boolean;
  log: TestLogEntry[];
};

const emptyState = (): State => ({ deviceId: null, balances: {}, sendMode: "success", balanceFails: false, log: [] });

function parseState(value: unknown): State {
  const v = (value && typeof value === "object" ? value : {}) as Partial<State>;
  return {
    deviceId: typeof v.deviceId === "string" ? v.deviceId : null,
    balances: v.balances && typeof v.balances === "object" ? v.balances : {},
    sendMode: SEND_MODES.includes(v.sendMode as SendMode) ? (v.sendMode as SendMode) : "success",
    balanceFails: v.balanceFails === true,
    log: Array.isArray(v.log) ? v.log : [],
  };
}

async function readState(): Promise<State> {
  const [row] = await db.select().from(settings).where(eq(settings.key, STATE_KEY));
  return parseState(row?.value);
}

/**
 * Read-modify-write of the simulated state under a row lock (stored in `settings`; getSettings and
 * saveSettings ignore keys they don't know). Several open tabs can poll at once safely.
 */
async function mutateState<T>(fn: (s: State, t: DbTx) => Promise<T> | T) {
  return db.transaction(async (t) => {
    await t.insert(settings).values({ key: STATE_KEY, value: emptyState() }).onConflictDoNothing();
    const [row] = await t.select().from(settings).where(eq(settings.key, STATE_KEY)).for("update");
    const s = parseState(row?.value);
    const out = await fn(s, t);
    await t.update(settings).set({ value: s }).where(eq(settings.key, STATE_KEY));
    return out;
  });
}

const addLog = (s: State, e: Omit<TestLogEntry, "at">) => {
  s.log = [{ at: new Date().toISOString(), ...e }, ...s.log].slice(0, LOG_SIZE);
};

/** Fake numbers outside real Tunisian mobile ranges (they start with 1); never collides with a real SIM. */
async function freeMsisdn(t: DbTx, slot: number) {
  for (let k = 0; k < 100; k++) {
    const candidate = String(10_000_000 + slot * 100 + k);
    if (!normalizeMsisdn(candidate)) continue;
    const [dup] = await t.select({ id: sims.id }).from(sims).where(eq(sims.msisdn, candidate));
    if (!dup) return candidate;
  }
  throw new EngineError("msisdn_in_use");
}

/** Creates (once) the test device with one active SIM per active operator. Adds SIMs for operators added later. */
export async function ensureTestPhone() {
  return mutateState(async (s, t) => {
    let device = s.deviceId ? (await t.select().from(devices).where(eq(devices.id, s.deviceId)))[0] : undefined;
    if (!device) {
      [device] = await t.insert(devices).values({ name: TEST_PHONE_NAME, model: "Test phone (browser)", appVersion: "test-phone" }).returning();
      s.deviceId = device.id;
      s.balances = {};
      s.log = [];
    }
    const existing = await t.select().from(sims).where(eq(sims.deviceId, device.id)).orderBy(asc(sims.slotIndex));
    const activeOps = await t.select().from(operators).where(eq(operators.active, true)).orderBy(asc(operators.sortOrder));
    let nextSlot = existing.reduce((m, x) => Math.max(m, x.slotIndex + 1), 0);
    for (const op of activeOps) {
      if (existing.some((x) => x.operatorCode === op.code)) continue;
      const slot = nextSlot++;
      const [sim] = await t
        .insert(sims)
        .values({
          deviceId: device.id,
          slotIndex: slot,
          subscriptionId: 9000 + slot,
          carrierName: `${op.name} (simulated)`,
          operatorCode: op.code,
          msisdn: await freeMsisdn(t, slot),
          status: "active",
          lastReportedAt: new Date(),
        })
        .returning();
      existing.push(sim);
      // The server learns the balance like it would for a real SIM (needed before recharges can use it).
      await enqueueBalanceCheck(t, sim, "manual", null);
    }
    for (const sim of existing) if (typeof s.balances[sim.id] !== "number") s.balances[sim.id] = DEFAULT_BALANCE;
    return { device, sims: existing };
  });
}

type DeliveredCommand = Awaited<ReturnType<typeof syncDevice>>["commands"][number];

/** Answers one delivered command like the Android app would, according to the chosen modes. */
async function answer(device: typeof devices.$inferSelect, cmd: DeliveredCommand, testSims: (typeof sims.$inferSelect)[]) {
  const sim = testSims.find((x) => x.subscriptionId === cmd.subscriptionId);
  const [row] = await db.select().from(deviceCommands).where(eq(deviceCommands.id, cmd.id));
  if (!row || !sim) return;

  if (cmd.type === "ussd_send") {
    const [r] = row.rechargeId ? await db.select().from(recharges).where(eq(recharges.id, row.rechargeId)) : [];
    const result = await mutateState((s) => {
      const mode = s.sendMode;
      let res: { ok: boolean; response?: string; error?: string } | null;
      if (mode === "no_answer") res = null;
      else if (mode === "error") res = { ok: false, error: "popup_timeout" };
      else if (mode === "refused" || !r || (s.balances[sim.id] ?? 0) < r.amountMillimes) res = { ok: true, response: SEND_REFUSED_REPLY };
      else {
        s.balances[sim.id] = (s.balances[sim.id] ?? 0) - r.amountMillimes;
        res = { ok: true, response: sendSuccessReply(cmd.steps ?? [], r.amountMillimes) };
      }
      addLog(s, {
        kind: "send",
        purpose: `${row.purpose} ${cmd.ussd} ${(cmd.steps ?? []).join(" ")}`.trim(),
        simId: sim.id,
        ok: res ? res.ok : null,
        text: res ? (res.response ?? res.error ?? "") : "(no answer — the server will time out the command)",
      });
      return res;
    });
    if (result) await commandResult(device, { id: cmd.id, ...result });
    return;
  }

  const result = await mutateState((s) => {
    const res = s.balanceFails
      ? { ok: false, error: "USSD_RETURN_FAILURE" }
      : { ok: true, response: balanceReply(s.balances[sim.id] ?? DEFAULT_BALANCE, cmd.ussd) };
    addLog(s, { kind: "balance", purpose: `${row.purpose} ${cmd.ussd}`, simId: sim.id, ok: res.ok, text: res.response ?? res.error ?? "" });
    return res;
  });
  await commandResult(device, { id: cmd.id, ...result });
}

let ticking: Promise<void> | null = null;

/** One heartbeat of the test phone: keeps it online and answers every command the server delivers. */
export async function testPhoneTick() {
  // Overlapping polls from the same server process share one run.
  ticking ??= (async () => {
    try {
      const { device, sims: testSims } = await ensureTestPhone();
      // Answers can queue follow-up commands (baseline → send → …); run those right away too.
      for (let i = 0; i < 4; i++) {
        const fresh = (await db.select().from(devices).where(eq(devices.id, device.id)))[0] ?? device;
        const { commands } = await syncDevice(
          fresh,
          {
            sims: testSims.map((x) => ({ slotIndex: x.slotIndex, subscriptionId: x.subscriptionId, carrierName: x.carrierName })),
            batteryPct: 100,
            charging: true,
            model: "Test phone (browser)",
            androidVersion: "sim",
            appVersion: "test-phone",
          },
          null,
        );
        if (commands.length === 0) break;
        for (const cmd of commands) {
          try {
            await answer(fresh, cmd, testSims);
          } catch (e) {
            console.error("[test-phone] answer failed", cmd.id, e);
          }
        }
      }
    } finally {
      ticking = null;
    }
  })();
  return ticking;
}

async function testSim(simId: string) {
  const s = await readState();
  if (!s.deviceId) throw new EngineError("not_found");
  const [sim] = await db.select().from(sims).where(and(eq(sims.id, simId), eq(sims.deviceId, s.deviceId)));
  if (!sim) throw new EngineError("not_found");
  const [device] = await db.select().from(devices).where(eq(devices.id, s.deviceId));
  return { sim, device };
}

let smsSeq = 0;

/**
 * Seller credit arriving on a test SIM:
 * - real: the balance goes up and the operator SMS arrives
 * - sms_only: the SMS arrives but the balance does not change (fake SMS)
 * - balance_only: the balance goes up without SMS (found by the next balance poll)
 */
export async function simulateCredit(simId: string, millimes: number, sender: string, kind: CreditKind) {
  if (!Number.isInteger(millimes) || millimes <= 0) throw new EngineError("invalid_amount");
  const from = normalizeMsisdn(sender);
  if (!from) throw new EngineError("invalid_msisdn");
  if (!CREDIT_KINDS.includes(kind)) throw new EngineError("invalid_state");
  const { sim, device } = await testSim(simId);
  const body = creditSmsBody(millimes, from);
  await mutateState((s) => {
    if (kind !== "sms_only") s.balances[sim.id] = (s.balances[sim.id] ?? DEFAULT_BALANCE) + millimes;
    addLog(s, {
      kind: "sms",
      purpose: kind === "real" ? "credit (balance + SMS)" : kind === "sms_only" ? "SMS only (balance unchanged)" : "balance only (no SMS)",
      simId: sim.id,
      ok: true,
      text: kind === "balance_only" ? `+${millimes} millimes, no SMS` : body,
    });
  });
  if (kind === "balance_only") return;
  const [op] = sim.operatorCode ? await db.select().from(operators).where(eq(operators.code, sim.operatorCode)) : [];
  // The SMS comes from the operator: use its allow-listed address when one is configured.
  const smsFrom = op?.creditSmsSenders[0] ?? op?.name ?? "Operator";
  const now = Date.now();
  await ingestSms(device, [
    { localId: `test-${now}-${++smsSeq}`, subscriptionId: sim.subscriptionId, slotIndex: sim.slotIndex, from: smsFrom, body, sentAt: now, receivedAt: now },
  ]);
}

/** Sets a test SIM's simulated balance and asks for a balance check so the server learns it. */
export async function setTestBalance(simId: string, millimes: number) {
  if (!Number.isInteger(millimes) || millimes < 0) throw new EngineError("invalid_amount");
  const { sim } = await testSim(simId);
  await mutateState((s) => {
    s.balances[sim.id] = millimes;
  });
  if (sim.operatorCode) await requestBalanceCheck(sim.id);
}

export async function setTestModes(input: { sendMode?: SendMode; balanceFails?: boolean }) {
  if (input.sendMode && !SEND_MODES.includes(input.sendMode)) throw new EngineError("invalid_state");
  await mutateState((s) => {
    if (input.sendMode) s.sendMode = input.sendMode;
    if (typeof input.balanceFails === "boolean") s.balanceFails = input.balanceFails;
  });
}

const WATCHED_TX = ["assigning", "awaiting_transfer", "verifying", "partial", "review"] as const;

/** Everything the page shows. Finished sales and recharges stay listed for a while so the outcome is visible. */
export async function getTestPhoneView() {
  const s = await readState();
  const [device] = s.deviceId ? await db.select().from(devices).where(eq(devices.id, s.deviceId)) : [];
  if (!device) return null;
  const simRows = await db
    .select({ sim: sims, opName: operators.name, opColor: operators.color, rechargeTemplate: operators.rechargeUssdTemplate })
    .from(sims)
    .leftJoin(operators, eq(operators.code, sims.operatorCode))
    .where(eq(sims.deviceId, device.id))
    .orderBy(asc(sims.slotIndex));
  const simIds = simRows.map((r) => r.sim.id);
  const recentSince = new Date(Date.now() - 30 * 60 * 1000);

  const txRows = simIds.length
    ? await db
        .select({ tx: transactions, sellerName: users.name, sellerEmail: users.email, orderRef: orders.ref })
        .from(transactions)
        .innerJoin(users, eq(users.id, transactions.userId))
        .leftJoin(orders, eq(orders.id, transactions.orderId))
        .where(and(inArray(transactions.simId, simIds), or(inArray(transactions.status, [...WATCHED_TX]), gt(transactions.updatedAt, recentSince))))
        .orderBy(desc(transactions.updatedAt))
        .limit(15)
    : [];
  const sales = txRows;

  const rcRows = await db
    .select()
    .from(recharges)
    .where(simIds.length ? or(inArray(recharges.simId, simIds), eq(recharges.status, "queued")) : eq(recharges.status, "queued"))
    .orderBy(desc(recharges.createdAt))
    .limit(15);

  return {
    device: { id: device.id, lastSeenAt: device.lastSeenAt?.toISOString() ?? null, enabled: device.enabled },
    sendMode: s.sendMode,
    balanceFails: s.balanceFails,
    sims: simRows.map(({ sim, opName, opColor, rechargeTemplate }) => ({
      id: sim.id,
      slotIndex: sim.slotIndex,
      operatorCode: sim.operatorCode,
      operatorName: opName ?? sim.operatorCode ?? "—",
      operatorColor: opColor ?? "#888",
      rechargeEnabled: Boolean(rechargeTemplate),
      msisdn: sim.msisdn,
      status: sim.status,
      simulatedMillimes: s.balances[sim.id] ?? DEFAULT_BALANCE,
      serverMillimes: sim.balanceMillimes,
      heldByTx: sales.find((r) => r.tx.id === sim.heldByTxId)?.tx.ref ?? (sim.heldByTxId ? "sale" : null),
      heldByRecharge: rcRows.find((r) => r.id === sim.heldByRechargeId)?.ref ?? (sim.heldByRechargeId ? "recharge" : null),
    })),
    sales: sales.map(({ tx, sellerName, sellerEmail, orderRef }) => ({
      id: tx.id,
      ref: tx.ref,
      status: tx.status,
      simId: tx.simId,
      seller: sellerName ?? sellerEmail ?? "—",
      declaredMillimes: tx.declaredMillimes,
      smsMillimes: tx.smsReceivedMillimes,
      confirmedMillimes: tx.confirmedMillimes,
      finalMillimes: tx.finalMillimes,
      sender: tx.senderMsisdn,
      orderId: tx.orderId,
      orderRef,
      reviewReason: tx.reviewReason,
      updatedAt: tx.updatedAt.toISOString(),
    })),
    recharges: rcRows.map((r) => ({
      id: r.id,
      ref: r.ref,
      status: r.status,
      operatorCode: r.operatorCode,
      simId: r.simId,
      msisdn: r.msisdn,
      amountMillimes: r.amountMillimes,
      sendOk: r.sendOk,
      reviewReason: r.reviewReason,
      updatedAt: r.updatedAt.toISOString(),
    })),
    log: s.log,
  };
}

export type TestPhoneView = NonNullable<Awaited<ReturnType<typeof getTestPhoneView>>>;
