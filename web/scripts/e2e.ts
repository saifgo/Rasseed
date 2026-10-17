/**
 * End-to-end test of the transaction engine against a running server + worker:
 *   pnpm dev & pnpm worker & pnpm test:e2e
 * Uses a simulated phone over the real device HTTP API. Creates its own device, SIMs and seller.
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { eq, inArray, like } from "drizzle-orm";
import { db } from "@/db";
import { devices, payouts, settings, sims, transactions, users } from "@/db/schema";
import { applyCredit, configureSim, markPaid, resolveReview } from "@/lib/engine/admin";
import { EngineError } from "@/lib/engine/core";
import { createPairingCode } from "@/lib/engine/device";
import { choosePartial, createSale } from "@/lib/engine/sales";
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
  await saveSettings({ verifyRetrySeconds: 1, verifyMaxAttempts: 3, smsGraceSeconds: 5, pollIntervalSeconds: 3, cooldownSeconds: 1 });

  const [seller] = await db.insert(users).values({ email: `e2e-${run}@test.local`, name: "E2E Seller" }).returning();
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
  const sale = (operatorCode: string, millimes: number, n: number, method = "d17") =>
    createSale(seller.id, {
      operatorCode,
      amountMillimes: millimes,
      senderMsisdn: sender(n),
      payoutMethodCode: method,
      payoutDetails: method === "mandat" ? { name: "Test Seller", phone: "22123456" } : d17,
    });

  await scenario("full transfer confirmed by SMS + balance, then paid", async () => {
    const id = await sale("ooredoo", 5000, 1);
    const t0 = await waitFor(id, ["awaiting_transfer"]);
    assert.equal(t0.assignedMsisdn, OOREDOO_NO);
    assert.equal(t0.baselineBalanceMillimes, 1500);
    await phone.transfer(0, 5000, sender(1));
    const t = await waitFor(id, ["confirmed"]);
    assert.equal(t.finalMillimes, 5000);
    assert.equal(t.payoutNetMillimes, Math.floor((5000 * t.rateBps) / 10000));
    const [p] = await db.select().from(payouts).where(eq(payouts.txId, id));
    // paidBy references users.id: the seller stands in for the admin in this test.
    await markPaid(seller.id, p.id, { reference: "D17-123" });
    assert.equal((await tx(id)).status, "paid");
  });

  await scenario("mandate fee is deducted", async () => {
    const id = await sale("ooredoo", 10000, 2, "mandat");
    await waitFor(id, ["awaiting_transfer"]);
    await phone.transfer(0, 10000, sender(2));
    const t = await waitFor(id, ["confirmed"]);
    assert.equal(t.payoutNetMillimes, Math.floor((10000 * t.rateBps) / 10000) - 5000);
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
    await assert.rejects(sale("orange", 1000, 6), (e: unknown) => e instanceof EngineError && e.code === "sender_busy");
    await waitFor(id, ["awaiting_transfer"]);
    await phone.transfer(0, 1000, sender(6));
    await waitFor(id, ["confirmed"]);
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
    await applyCredit(seller.id, late.id, (await tx(id)).ref);
    const done = await tx(id);
    assert.equal(done.status, "confirmed");
    assert.equal(done.finalMillimes, 2000);
  });

  await scenario("queue: second sale waits for the busy number", async () => {
    await sleep(1200);
    const a = await sale("ooredoo", 1000, 11);
    await waitFor(a, ["awaiting_transfer"]);
    const b = await sale("ooredoo", 1000, 12);
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
    await db.delete(settings).where(inArray(settings.key, ["verifyRetrySeconds", "verifyMaxAttempts", "smsGraceSeconds", "pollIntervalSeconds", "cooldownSeconds"]));
    // Disable the test device so its SIMs never receive real sales.
    await db.update(devices).set({ enabled: false }).where(like(devices.name, "E2E phone%"));
    await db.update(sims).set({ status: "disabled" }).where(inArray(sims.deviceId, db.select({ id: devices.id }).from(devices).where(like(devices.name, "E2E phone%"))));
    process.exit();
  });
