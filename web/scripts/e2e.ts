/**
 * End-to-end test of the transaction engine against a running server + worker:
 *   pnpm dev & pnpm worker & pnpm test:e2e
 * Uses a simulated phone over the real device HTTP API. Creates its own device, SIMs and seller.
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { and, eq, inArray, like } from "drizzle-orm";
import { db } from "@/db";
import { devices, settings, sims, transactions, users, withdrawals } from "@/db/schema";
import { applyCredit, configureSim, resolveReview } from "@/lib/engine/admin";
import { EngineError } from "@/lib/engine/core";
import { createPairingCode } from "@/lib/engine/device";
import { cancelSale, choosePartial, createSale } from "@/lib/engine/sales";
import { adjustBalance, getBalance, markWithdrawalPaid, rejectWithdrawal, requestWithdrawal } from "@/lib/engine/wallet";
import { saveSettings } from "@/lib/settings";
import { PhoneSimulator } from "./phone-simulator";

const SERVER = process.env.E2E_SERVER ?? "http://localhost:3100";
const run = Date.now() % 100000;
const OOREDOO_NO = `2${String(run).padStart(7, "0")}`;
const ORANGE_NO = `5${String(run).padStart(7, "0")}`;
const sender = (n: number) => `9${String(run).padStart(5, "0")}${String(n).padStart(2, "0")}`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function tx(id: string) {
  const [row] = await db.select().from(transactions).where(eq(transactions.id, id));
  return row;
}

async function waitFor(id: string, statuses: string[], timeoutMs = 30_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const t = await tx(id);
    if (statuses.includes(t.status)) return t;
    await sleep(300);
  }
  const t = await tx(id);
  throw new Error(`timeout waiting for ${statuses.join("|")} on ${t.ref}, status is ${t.status} (${t.reviewReason ?? ""})`);
}

let passed = 0;
async function scenario(name: string, fn: () => Promise<void>) {
  process.stdout.write(`• ${name} … `);
  await fn();
  passed++;
  console.log("ok");
}

// SIMs of other (real or simulated) phones are paused during the test so sales land on the test phone.
let pausedSims: string[] = [];

async function main() {
  pausedSims = (await db.update(sims).set({ status: "disabled" }).where(eq(sims.status, "active")).returning({ id: sims.id })).map((s) => s.id);
  // Fast timings for the test.
  await saveSettings({ verifyRetrySeconds: 1, verifyMaxAttempts: 3, smsGraceSeconds: 5, pollIntervalSeconds: 3, cooldownSeconds: 1, minWithdrawalMillimes: 2000 });

  const [seller] = await db.insert(users).values({ email: `e2e-${run}@test.local`, name: "E2E Seller" }).returning();
  // A second seller, for scenarios that need two sales running at once (one sale per seller).
  const [seller2] = await db.insert(users).values({ email: `e2e-${run}-b@test.local`, name: "E2E Seller B" }).returning();
  const [device] = await db.insert(devices).values({ name: `E2E phone ${run}` }).returning();
  const phone = new PhoneSimulator(SERVER, [
    { slotIndex: 0, subscriptionId: 9000 + (run % 900), carrierName: "Ooredoo TN", balanceMillimes: 1500 },
    { slotIndex: 1, subscriptionId: 9900 + (run % 90), carrierName: "Orange TN", balanceMillimes: 700 },
  ]);
  await phone.pair(await createPairingCode(device.id));
  await phone.sync();
  const simRows = await db.select().from(sims).where(eq(sims.deviceId, device.id));
  assert.equal(simRows.length, 2, "both SIMs reported");
  const [s0, s1] = [simRows.find((s) => s.slotIndex === 0)!, simRows.find((s) => s.slotIndex === 1)!];
  await configureSim(s0.id, { operatorCode: "ooredoo", msisdn: OOREDOO_NO, status: "active" });
  await configureSim(s1.id, { operatorCode: "orange", msisdn: ORANGE_NO, status: "active" });
  phone.start(500);
  await sleep(1500);

  const d17 = { phone: "22123456", name: "Test Seller" };
  const sale = (operatorCode: string, millimes: number, n: number, sellerId = seller.id) =>
    createSale(sellerId, { operatorCode, amountMillimes: millimes, senderMsisdn: sender(n) });
  const balance = () => getBalance(db, seller.id);

  await scenario("full transfer confirmed by SMS + balance is credited to the seller's balance", async () => {
    const id = await sale("ooredoo", 5000, 1);
    const t0 = await waitFor(id, ["awaiting_transfer"]);
    assert.equal(t0.assignedMsisdn, OOREDOO_NO);
    assert.equal(t0.baselineBalanceMillimes, 1500);
    assert.equal(t0.payoutMethodCode, null, "no payout method per sale anymore");
    await phone.transfer(0, 5000, sender(1));
    const t = await waitFor(id, ["confirmed"]);
    assert.equal(t.finalMillimes, 5000);
    const expected = Math.floor((5000 * t.rateBps) / 10000);
    assert.equal(t.payoutGrossMillimes, expected);
    assert.equal(await balance(), expected, "balance = cash at the locked rate");
  });

  await scenario("second sale adds to the same balance (no fee at sale time)", async () => {
    const before = await balance();
    const id = await sale("ooredoo", 10000, 2);
    await waitFor(id, ["awaiting_transfer"]);
    await phone.transfer(0, 10000, sender(2));
    const t = await waitFor(id, ["confirmed"]);
    assert.equal(await balance(), before + Math.floor((10000 * t.rateBps) / 10000));
  });

  await scenario("withdrawal: fee once per request, partial amount, rejection refunds, paid stays", async () => {
    const before = await balance();
    assert.ok(before >= 6000, `balance ${before}`);
    // Below the minimum (2 DT in this test) is refused.
    await assert.rejects(requestWithdrawal(seller.id, { amountMillimes: 1000, methodCode: "d17", details: d17 }), (e: unknown) => e instanceof EngineError && e.code === "below_minimum");
    // More than the balance is refused.
    await assert.rejects(requestWithdrawal(seller.id, { amountMillimes: before + 1, methodCode: "d17", details: d17 }), (e: unknown) => e instanceof EngineError && e.code === "insufficient_balance");
    // Mandate (5 DT fee): 6 DT withdrawn → 1 DT sent, fee charged once.
    const wid = await requestWithdrawal(seller.id, { amountMillimes: 6000, methodCode: "mandat", details: { name: "Test Seller", phone: "22123456" } });
    let [w] = await db.select().from(withdrawals).where(eq(withdrawals.id, wid));
    assert.equal(w.status, "pending");
    assert.equal(w.feeMillimes, 5000);
    assert.equal(w.netMillimes, 1000);
    assert.equal(await balance(), before - 6000, "amount leaves the balance when requested");
    // Reject → full amount back.
    await rejectWithdrawal(seller.id, wid, "wrong name");
    [w] = await db.select().from(withdrawals).where(eq(withdrawals.id, wid));
    assert.equal(w.status, "rejected");
    assert.equal(await balance(), before, "rejection refunds the balance");
    await assert.rejects(rejectWithdrawal(seller.id, wid, "again"), (e: unknown) => e instanceof EngineError && e.code === "invalid_state");
    // Partial D17 withdrawal (no fee), marked paid.
    const wid2 = await requestWithdrawal(seller.id, { amountMillimes: 2000, methodCode: "d17", details: d17 });
    await markWithdrawalPaid(seller.id, wid2, { reference: "D17-123" });
    [w] = await db.select().from(withdrawals).where(eq(withdrawals.id, wid2));
    assert.equal(w.status, "paid");
    assert.equal(w.netMillimes, 2000);
    assert.equal(await balance(), before - 2000);
    // Manual adjustment with a note; removing more than the balance is refused.
    await adjustBalance(seller.id, seller.id, 500, "bonus");
    assert.equal(await balance(), before - 1500);
    await assert.rejects(adjustBalance(seller.id, seller.id, -(before + 10_000), "oops"), (e: unknown) => e instanceof EngineError && e.code === "insufficient_balance");
    await assert.rejects(adjustBalance(seller.id, seller.id, 100, "  "), (e: unknown) => e instanceof EngineError && e.code === "reason_required");
  });

  await scenario("partial transfer → seller accepts the received amount", async () => {
    const id = await sale("orange", 10000, 3);
    await waitFor(id, ["awaiting_transfer"]);
    await phone.transfer(1, 4000, sender(3));
    const t = await waitFor(id, ["partial"]);
    assert.equal(t.confirmedMillimes, 4000);
    await choosePartial(seller.id, id, "accept");
    const done = await waitFor(id, ["confirmed"]);
    assert.equal(done.finalMillimes, 4000);
  });

  await scenario("partial transfer → seller tops up the rest", async () => {
    await sleep(1200); // cooldown of the orange SIM
    const id = await sale("orange", 6000, 4);
    await waitFor(id, ["awaiting_transfer"]);
    await phone.transfer(1, 2000, sender(4));
    await waitFor(id, ["partial"]);
    await choosePartial(seller.id, id, "topup");
    await phone.transfer(1, 4000, sender(4));
    const done = await waitFor(id, ["confirmed"]);
    assert.equal(done.finalMillimes, 6000);
  });

  await scenario("overpayment is credited at the actual amount", async () => {
    await sleep(1200);
    const id = await sale("ooredoo", 2000, 5);
    await waitFor(id, ["awaiting_transfer"]);
    await phone.transfer(0, 3000, sender(5));
    const done = await waitFor(id, ["confirmed"]);
    assert.equal(done.finalMillimes, 3000);
  });

  await scenario("same sender cannot run two sales at once", async () => {
    await sleep(1200);
    const id = await sale("ooredoo", 1000, 6);
    await assert.rejects(sale("orange", 1000, 6, seller2.id), (e: unknown) => e instanceof EngineError && e.code === "sender_busy");
    await waitFor(id, ["awaiting_transfer"]);
    await phone.transfer(0, 1000, sender(6));
    await waitFor(id, ["confirmed"]);
  });

  await scenario("a seller with an ongoing sale must cancel or finish it first", async () => {
    await sleep(1200);
    const id = await sale("ooredoo", 1000, 14);
    await assert.rejects(sale("orange", 1000, 15), (e: unknown) => e instanceof EngineError && e.code === "sale_in_progress");
    await waitFor(id, ["awaiting_transfer"]);
    await cancelSale(seller.id, id);
    const next = await sale("orange", 1000, 15);
    await waitFor(next, ["awaiting_transfer"]);
    await cancelSale(seller.id, next);
  });

  await scenario("fake SMS (balance unchanged) goes to review, never confirmed", async () => {
    await sleep(1200);
    const id = await sale("ooredoo", 3000, 7);
    await waitFor(id, ["awaiting_transfer"]);
    await phone.deliverSms(0, `Vous avez recu 3000 Millimes de la part du numéro ${sender(7)}`, "+21698000000");
    const t = await waitFor(id, ["review"]);
    assert.equal(t.reviewReason, "sms_not_in_balance");
    assert.equal(t.confirmedMillimes, 0);
    await resolveReview(seller.id, id, { action: "reject", note: "fake sms" });
    assert.equal((await tx(id)).status, "rejected");
  });

  await scenario("credit without SMS goes to review after the grace period", async () => {
    await sleep(1200);
    const id = await sale("orange", 3000, 8);
    await waitFor(id, ["awaiting_transfer"]);
    phone.sims[1].balanceMillimes += 3000;
    const t = await waitFor(id, ["review"], 40_000);
    assert.equal(t.reviewReason, "balance_without_sms");
    await resolveReview(seller.id, id, { action: "confirm", amountMillimes: 3000, note: "checked on phone" });
    assert.equal((await tx(id)).finalMillimes, 3000);
  });

  await scenario("credit from another number on a held SIM stays apart", async () => {
    await sleep(1200);
    const id = await sale("ooredoo", 5000, 9);
    await waitFor(id, ["awaiting_transfer"]);
    await phone.transfer(0, 1000, sender(99)); // stranger
    await sleep(1500);
    assert.notEqual((await tx(id)).status, "confirmed");
    await phone.transfer(0, 5000, sender(9));
    const done = await waitFor(id, ["confirmed"]);
    assert.equal(done.finalMillimes, 5000, "only the seller's own transfer counts");
  });

  await scenario("expiry, then a late transfer is linked and can be applied", async () => {
    await sleep(1200);
    const id = await sale("orange", 2000, 10);
    await waitFor(id, ["awaiting_transfer"]);
    await db.update(transactions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(transactions.id, id));
    await waitFor(id, ["expired"]);
    await sleep(1500); // cooldown over, SIM free
    await phone.transfer(1, 2000, sender(10));
    await sleep(1500);
    const { credits } = await import("@/db/schema");
    const [late] = await db.select().from(credits).where(eq(credits.txId, id));
    assert.equal(late?.status, "late");
    const before = await balance();
    await applyCredit(seller.id, late.id, (await tx(id)).ref);
    const done = await tx(id);
    assert.equal(done.status, "confirmed");
    assert.equal(done.finalMillimes, 2000);
    assert.equal(await balance(), before + Math.floor((2000 * done.rateBps) / 10000), "late credit lands on the balance");
  });

  await scenario("queue: second sale waits for the busy number", async () => {
    await sleep(1200);
    const a = await sale("ooredoo", 1000, 11);
    await waitFor(a, ["awaiting_transfer"]);
    const b = await sale("ooredoo", 1000, 12, seller2.id);
    assert.equal((await tx(b)).status, "queued");
    await phone.transfer(0, 1000, sender(11));
    await waitFor(a, ["confirmed"]);
    const tb = await waitFor(b, ["awaiting_transfer"], 15_000);
    assert.equal(tb.assignedMsisdn, OOREDOO_NO);
    await phone.transfer(0, 1000, sender(12));
    await waitFor(b, ["confirmed"]);
  });

  await scenario("USSD failure on baseline puts the sale back in the queue", async () => {
    await sleep(1200);
    phone.ussdWorks = false;
    const id = await sale("orange", 1000, 13);
    await sleep(2500);
    const t = await tx(id);
    assert.ok(["queued", "assigning"].includes(t.status), `status ${t.status}`);
    assert.equal(t.expiresAt, null, "number never shown without a baseline");
    phone.ussdWorks = true;
    await db.update(sims).set({ consecutiveFailures: 0 }).where(eq(sims.id, s1.id));
    await waitFor(id, ["awaiting_transfer"], 20_000);
    await phone.transfer(1, 1000, sender(13));
    await waitFor(id, ["confirmed"]);
  });

  phone.stop();
  console.log(`\n${passed} scenarios passed.`);
}

main()
  .catch((e) => {
    console.error("\nFAILED:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (pausedSims.length) await db.update(sims).set({ status: "active" }).where(inArray(sims.id, pausedSims));
    await db.delete(settings).where(inArray(settings.key, ["verifyRetrySeconds", "verifyMaxAttempts", "smsGraceSeconds", "pollIntervalSeconds", "cooldownSeconds", "minWithdrawalMillimes"]));
    // Leftover sales of the test seller must not sit in the queue and grab the next run's SIMs.
    await db
      .update(transactions)
      .set({ status: "cancelled", completedAt: new Date() })
      .where(
        and(
          inArray(transactions.status, ["queued", "assigning", "awaiting_transfer", "verifying", "partial", "review"]),
          inArray(transactions.userId, db.select({ id: users.id }).from(users).where(like(users.email, "e2e-%@test.local"))),
        ),
      );
    // Disable the test device so its SIMs never receive real sales.
    await db.update(devices).set({ enabled: false }).where(like(devices.name, "E2E phone%"));
    await db
      .update(sims)
      .set({ status: "disabled", heldByTxId: null })
      .where(inArray(sims.deviceId, db.select({ id: devices.id }).from(devices).where(like(devices.name, "E2E phone%"))));
    process.exit();
  });
