import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, gt, inArray, lte } from "drizzle-orm";
import { db } from "@/db";
import { credits, deviceCommands, devices, operators, sims, smsMessages, transactions } from "@/db/schema";
import { parseBalance, parseCreditSms } from "@/lib/parsers";
import { normalizeMsisdn } from "@/lib/phone";
import { getSettings, type AppSettings } from "@/lib/settings";
import {
  EngineError,
  enqueueBalanceCheck,
  lockSim,
  lockTx,
  logEvent,
  reconcile,
  recordSnapshot,
  releaseSim,
  sendToReview,
  updateTx,
  type Sim,
} from "./core";
import type { DbTx } from "@/db";
import { assignQueued } from "./sales";

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export async function authenticateDevice(authorization: string | null) {
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7).trim() : null;
  if (!token) return null;
  const [device] = await db.select().from(devices).where(eq(devices.tokenHash, hashToken(token)));
  return device && device.enabled ? device : null;
}

/** Admin creates a device and gets a short pairing code to type on the phone. */
export async function createPairingCode(deviceId: string) {
  const code = String(100000 + (randomBytes(4).readUInt32BE() % 900000));
  await db
    .update(devices)
    .set({ pairingCode: code, pairingExpiresAt: new Date(Date.now() + 10 * 60 * 1000) })
    .where(eq(devices.id, deviceId));
  return code;
}

/** Phone exchanges the pairing code for a long-lived token. Pairing again replaces the old token. */
export async function pairDevice(code: string) {
  const [device] = await db
    .select()
    .from(devices)
    .where(and(eq(devices.pairingCode, code), gt(devices.pairingExpiresAt, new Date())));
  if (!device) throw new EngineError("invalid_pairing_code");
  const token = randomBytes(32).toString("base64url");
  await db
    .update(devices)
    .set({ tokenHash: hashToken(token), pairingCode: null, pairingExpiresAt: null })
    .where(eq(devices.id, device.id));
  return { token, deviceId: device.id, name: device.name };
}

export type ReportedSim = { slotIndex: number; subscriptionId: number; carrierName?: string | null };

export type SyncInput = {
  sims: ReportedSim[];
  batteryPct?: number;
  charging?: boolean;
  model?: string;
  androidVersion?: string;
  appVersion?: string;
};

/** Heartbeat: records device health and SIMs present, returns the USSD commands to run. */
export async function syncDevice(device: typeof devices.$inferSelect, input: SyncInput, ip: string | null) {
  const now = new Date();
  await db
    .update(devices)
    .set({
      lastSeenAt: now,
      lastIp: ip,
      batteryPct: input.batteryPct ?? null,
      charging: input.charging ?? null,
      model: input.model ?? device.model,
      androidVersion: input.androidVersion ?? device.androidVersion,
      appVersion: input.appVersion ?? device.appVersion,
    })
    .where(eq(devices.id, device.id));

  for (const r of input.sims) {
    await db.transaction(async (t) => {
      const [existing] = await t
        .select()
        .from(sims)
        .where(and(eq(sims.deviceId, device.id), eq(sims.slotIndex, r.slotIndex)))
        .for("update");
      if (!existing) {
        await t.insert(sims).values({
          deviceId: device.id,
          slotIndex: r.slotIndex,
          subscriptionId: r.subscriptionId,
          carrierName: r.carrierName ?? null,
          lastReportedAt: now,
        });
        return;
      }
      if (existing.subscriptionId !== r.subscriptionId) {
        // A different SIM card is in this slot. Never keep using the old number/operator mapping.
        await t
          .update(sims)
          .set({
            subscriptionId: r.subscriptionId,
            carrierName: r.carrierName ?? null,
            status: "unconfigured",
            msisdn: null,
            operatorCode: null,
            balanceMillimes: null,
            balanceCheckedAt: null,
            consecutiveFailures: 0,
            lastReportedAt: now,
          })
          .where(eq(sims.id, existing.id));
        if (existing.heldByTxId) {
          const tx = await lockTx(t, existing.heldByTxId);
          if (tx) await sendToReview(t, tx, "sim_changed");
        }
        return;
      }
      await t
        .update(sims)
        .set({ lastReportedAt: now, carrierName: r.carrierName ?? existing.carrierName })
        .where(eq(sims.id, existing.id));
    });
  }

  // Deliver due commands. A command stays "sent" until the phone reports a result or it times out.
  const due = await db
    .update(deviceCommands)
    .set({ status: "sent", sentAt: now })
    .where(
      and(
        eq(deviceCommands.deviceId, device.id),
        eq(deviceCommands.status, "pending"),
        lte(deviceCommands.notBefore, now),
      ),
    )
    .returning();
  const simRows = due.length
    ? await db.select().from(sims).where(inArray(sims.id, due.map((c) => c.simId)))
    : [];
  const commands = due
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .map((c) => {
      const sim = simRows.find((s) => s.id === c.simId)!;
      return {
        id: c.id,
        type: c.type,
        ussd: c.ussdCode,
        subscriptionId: sim.subscriptionId,
        slotIndex: sim.slotIndex,
      };
    });

  // New SIMs or a phone coming back online may free up capacity for queued sales.
  void assignQueued().catch(() => {});
  return { commands, serverTime: now.toISOString() };
}

export type ReportedSms = {
  localId: string;
  subscriptionId?: number | null;
  slotIndex?: number | null;
  from: string;
  body: string;
  sentAt?: number | null; // epoch ms, from the SMS PDU
  receivedAt?: number | null; // epoch ms, on the phone
};

async function findSim(deviceId: string, m: ReportedSms) {
  const rows = await db.select().from(sims).where(eq(sims.deviceId, deviceId));
  return (
    rows.find((s) => m.subscriptionId != null && s.subscriptionId === m.subscriptionId) ??
    rows.find((s) => m.slotIndex != null && s.slotIndex === m.slotIndex) ??
    (rows.length === 1 ? rows[0] : undefined)
  );
}

/** Stores SMS from a phone. Idempotent: the phone retries until acknowledged. Returns accepted local ids. */
export async function ingestSms(device: typeof devices.$inferSelect, messages: ReportedSms[]) {
  const settings = await getSettings();
  const allOps = await db.select().from(operators);
  const accepted: string[] = [];

  for (const m of messages) {
    if (!m.localId || typeof m.body !== "string" || typeof m.from !== "string") continue;
    const sim = await findSim(device.id, m);
    // The phone may report the same SMS twice (broadcast + inbox scan) with the sender written
    // differently ("+216…" vs "…"); normalize it and use the operator timestamp to the second.
    const from = normalizeMsisdn(m.from) ?? m.from.replace(/\s/g, "").toLowerCase();
    const stamp = m.sentAt ? Math.floor(m.sentAt / 1000) : (m.receivedAt ?? m.localId);
    const dedupeKey = createHash("sha256").update([device.id, from, m.body.trim(), stamp].join("|")).digest("hex");

    const ops = sim?.operatorCode ? allOps.filter((o) => o.code === sim.operatorCode) : allOps;
    let parsed: ReturnType<typeof parseCreditSms> = { kind: "ignored" };
    for (const op of ops) {
      parsed = parseCreditSms(m.body, m.from, op);
      if (parsed.kind !== "ignored") break;
    }

    await db.transaction(async (t) => {
      const [sms] = await t
        .insert(smsMessages)
        .values({
          deviceId: device.id,
          simId: sim?.id ?? null,
          dedupeKey,
          fromAddress: m.from.slice(0, 64),
          body: m.body.slice(0, 2000),
          sentAt: m.sentAt ? new Date(m.sentAt) : null,
          deviceReceivedAt: m.receivedAt ? new Date(m.receivedAt) : null,
          classification: parsed.kind,
        })
        .onConflictDoNothing({ target: smsMessages.dedupeKey })
        .returning();
      if (!sms) return; // duplicate delivery, already processed
      if (!sim) return;

      if (parsed.kind === "untrusted_sender") {
        if (sim.heldByTxId) {
          await logEvent(t, sim.heldByTxId, "untrusted_sms", "device", { from: m.from, body: m.body }, true);
        }
        return;
      }
      if (parsed.kind !== "credit") return;
      await handleCredit(t, sim.id, sms.id, parsed.credit.amountMillimes, parsed.credit.senderMsisdn, settings);
    });
    accepted.push(m.localId);
  }
  return accepted;
}

async function handleCredit(
  t: DbTx,
  simId: string,
  smsId: string,
  amount: number,
  sender: string,
  settings: AppSettings,
) {
  const sim = (await lockSim(t, simId))!;
  const tx = sim.heldByTxId ? await lockTx(t, sim.heldByTxId) : undefined;

  if (tx && ["awaiting_transfer", "verifying", "partial", "review"].includes(tx.status) && tx.senderMsisdn === sender) {
    await t.insert(credits).values({ simId, smsId, amountMillimes: amount, senderMsisdn: sender, txId: tx.id, status: "matched" });
    await updateTx(t, tx.id, {
      smsReceivedMillimes: tx.smsReceivedMillimes + amount,
      ...(tx.status === "review" ? {} : { status: "verifying" }),
    });
    await logEvent(t, tx.id, "credit_sms", "device", { amountMillimes: amount });
    await enqueueBalanceCheck(t, sim, "verify", tx.id);
    return;
  }

  if (tx) {
    // Someone else sent credit to a number held for this sale. Keep it apart, verify the balance anyway.
    await t.insert(credits).values({
      simId,
      smsId,
      amountMillimes: amount,
      senderMsisdn: sender,
      status: "unmatched",
      note: `received while held by ${tx.ref}`,
    });
    await logEvent(t, tx.id, "foreign_credit", "device", { amountMillimes: amount, sender }, true);
    await enqueueBalanceCheck(t, sim, "verify", tx.id);
    return;
  }

  // Number not held: a late transfer? Link it to the latest sale from that sender on this number.
  const windowStart = new Date(Date.now() - settings.lateCreditWindowHours * 3600 * 1000);
  const [recent] = await t
    .select()
    .from(transactions)
    .where(
      and(eq(transactions.simId, simId), eq(transactions.senderMsisdn, sender), gt(transactions.createdAt, windowStart)),
    )
    .orderBy(desc(transactions.createdAt))
    .limit(1);
  await t.insert(credits).values({
    simId,
    smsId,
    amountMillimes: amount,
    senderMsisdn: sender,
    txId: recent?.id ?? null,
    status: recent ? "late" : "unmatched",
  });
  if (recent) await logEvent(t, recent.id, "late_credit", "device", { amountMillimes: amount });
  await enqueueBalanceCheck(t, sim, "manual", null);
}

/** Result of a USSD command from the phone. Idempotent. */
export async function commandResult(
  device: typeof devices.$inferSelect,
  input: { id: string; ok: boolean; response?: string | null; error?: string | null },
) {
  const settings = await getSettings();
  await db.transaction(async (t) => {
    const [cmd] = await t
      .select()
      .from(deviceCommands)
      .where(and(eq(deviceCommands.id, input.id), eq(deviceCommands.deviceId, device.id)))
      .for("update");
    if (!cmd) throw new EngineError("not_found");
    if (cmd.status !== "sent" && cmd.status !== "pending") {
      // Already timed out or completed: keep the late raw reply for the audit trail only.
      if (!cmd.rawResponse && input.response) {
        await t.update(deviceCommands).set({ rawResponse: input.response }).where(eq(deviceCommands.id, cmd.id));
      }
      return;
    }
    const sim = (await lockSim(t, cmd.simId))!;
    const [op] = sim.operatorCode ? await t.select().from(operators).where(eq(operators.code, sim.operatorCode)) : [];
    const balance = input.ok && input.response && op ? parseBalance(input.response, op) : null;

    if (balance == null) {
      await t
        .update(deviceCommands)
        .set({
          status: "failed",
          completedAt: new Date(),
          rawResponse: input.response ?? null,
          error: input.ok ? "unparseable_response" : (input.error ?? "device_error").slice(0, 500),
        })
        .where(eq(deviceCommands.id, cmd.id));
      await onCommandFailure(t, cmd, sim, settings);
      return;
    }

    await t
      .update(deviceCommands)
      .set({ status: "succeeded", completedAt: new Date(), rawResponse: input.response, parsedBalanceMillimes: balance })
      .where(eq(deviceCommands.id, cmd.id));
    await recordSnapshot(t, sim, balance, cmd.id);

    const txId = cmd.purpose === "baseline" ? cmd.txId : sim.heldByTxId;
    if (!txId) return;
    const tx = await lockTx(t, txId);
    if (!tx || tx.simId !== sim.id) return;

    if (cmd.purpose === "baseline") {
      if (tx.status !== "assigning") return;
      const now = new Date();
      await updateTx(t, tx.id, {
        status: "awaiting_transfer",
        baselineBalanceMillimes: balance,
        baselineAt: now,
        assignedAt: now,
        expiresAt: new Date(now.getTime() + settings.holdMinutes * 60 * 1000),
      });
      await logEvent(t, tx.id, "number_assigned", "system", { msisdn: tx.assignedMsisdn });
      await logEvent(t, tx.id, "baseline", "device", { balanceMillimes: balance }, true);
      return;
    }
    await reconcile(t, tx, sim, balance, settings);
  });
  await assignQueued();
}

export async function onCommandFailure(
  t: DbTx,
  cmd: typeof deviceCommands.$inferSelect,
  sim: Sim,
  settings: AppSettings,
) {
  await t
    .update(sims)
    .set({ consecutiveFailures: sim.consecutiveFailures + 1 })
    .where(eq(sims.id, sim.id));

  const txId = cmd.purpose === "baseline" ? cmd.txId : sim.heldByTxId;
  if (!txId) return;
  const tx = await lockTx(t, txId);
  if (!tx || tx.simId !== sim.id) return;

  if (cmd.purpose === "baseline") {
    if (tx.status !== "assigning") return;
    // Could not read the starting balance: never show this number. Put the sale back in the queue.
    await releaseSim(t, sim.id, settings);
    await updateTx(t, tx.id, { status: "queued", simId: null, assignedMsisdn: null });
    await logEvent(t, tx.id, "baseline_failed", "system", { simId: sim.id }, true);
    return;
  }
  if (!["awaiting_transfer", "verifying", "partial"].includes(tx.status)) return;
  const needsAnswer = tx.status === "verifying" || tx.unexplainedSince != null;
  if (!needsAnswer) return; // routine poll failed; the next poll will try again
  const attempts = tx.verifyAttempts + 1;
  await updateTx(t, tx.id, { verifyAttempts: attempts });
  if (attempts >= settings.verifyMaxAttempts) {
    await sendToReview(t, tx, "balance_check_failed");
  } else {
    await enqueueBalanceCheck(t, sim, "verify", tx.id, settings.verifyRetrySeconds);
  }
}
