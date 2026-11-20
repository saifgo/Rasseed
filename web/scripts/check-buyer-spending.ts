/**
 * Integration check of buyer spending against the local database (no server needed):
 * data packages, POS pairing/auth, resale and admins spending Sarfli's own credit. Creates its own users; run with
 *   npx tsx scripts/check-buyer-spending.ts
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { devices, operators, orders, recharges, sims, transactions, users } from "@/db/schema";
import { EngineError } from "@/lib/engine/core";
import { bucketBalance, move } from "@/lib/engine/ledger";
import { sarfliCredit } from "@/lib/engine/sarfli-credit";
import { addPaymentProofs, cancelByBuyer, confirmPayment, createOrder, upsertListing } from "@/lib/engine/market";
import { createPackage } from "@/lib/engine/packages";
import { authenticatePos, createPosPairing, pairPosTerminal, revokePosTerminal } from "@/lib/engine/pos";
import { cancelRecharge, createRecharge } from "@/lib/engine/recharge";
import { getSettings, saveSettings } from "@/lib/settings";

const run = Date.now();
const OP = "ooredoo";

async function rejects(p: Promise<unknown>, code: string) {
  await assert.rejects(p, (e) => e instanceof EngineError && e.code === code, `expected ${code}`);
}

async function user(tag: string) {
  const [u] = await db
    .insert(users)
    .values({ email: `check-${tag}-${run}@example.test`, name: `Check ${tag}`, marketplaceAccess: true })
    .returning();
  return u;
}

const buyerBalance = (userId: string) => bucketBalance(db, { bucket: "buyer", operatorCode: OP, userId });

async function main() {
  const before = await getSettings();
  await saveSettings({ marketplaceEnabled: 1, commissionBps: 200 });
  const [op] = await db.select().from(operators).where(eq(operators.code, OP));
  assert.ok(op, "operator ooredoo must exist (run db:seed)");

  const shop = await user("shop");
  const reseller = await user("reseller");
  const buyer = await user("buyer");
  for (const u of [shop, reseller]) {
    await db.transaction((t) =>
      move(t, {
        kind: "check_opening",
        operatorCode: OP,
        note: "check-buyer-spending",
        legs: [
          { bucket: "external", amountMillimes: -20_000 },
          { bucket: "buyer", userId: u.id, amountMillimes: 20_000 },
        ],
      }),
    );
  }

  // --- Data packages ---------------------------------------------------------
  await rejects(
    createPackage({ operatorCode: OP, name: "x", priceMillimes: 1000, ussdTemplate: "*1#", ussdSteps: [], active: true, sortOrder: 0 }),
    "package_needs_number",
  );
  const pkgId = await createPackage({
    operatorCode: OP,
    name: `Check 1 Go ${run}`,
    priceMillimes: 3000,
    ussdTemplate: "*999*{number}#",
    ussdSteps: ["1"],
    active: true,
    sortOrder: 0,
  });
  const ref = `check-${run}`;
  const r1 = await createRecharge(shop.id, { packageId: pkgId, msisdn: "+216 22 123 456" }, { clientRef: ref });
  const r2 = await createRecharge(shop.id, { packageId: pkgId, msisdn: "22123456" }, { clientRef: ref });
  assert.equal(r1, r2, "same clientRef returns the same recharge");
  assert.equal(await buyerBalance(shop.id), 17_000, "package price reserved once");
  const [row] = await db.select().from(recharges).where(eq(recharges.id, r1));
  assert.equal(row.packageName, `Check 1 Go ${run}`);
  assert.equal(row.ussdTemplate, "*999*{number}#");
  assert.equal(row.amountMillimes, 3000);
  if (row.status === "queued") {
    await cancelRecharge(shop.id, r1);
    assert.equal(await buyerBalance(shop.id), 20_000, "cancel returns the reserve");
  } else {
    console.log(`  (recharge already ${row.status}: an agent SIM picked it up, cancel skipped)`);
  }
  await rejects(createRecharge(shop.id, { packageId: pkgId, msisdn: "123" }), "invalid_msisdn");
  console.log("✓ data packages: reserve, idempotent clientRef, cancel");

  // --- POS terminals ---------------------------------------------------------
  const { code, terminalId } = await createPosPairing(shop.id, { name: "Counter" });
  const paired = await pairPosTerminal(code, "PC-CHECK");
  await rejects(pairPosTerminal(code, null), "invalid_code");
  const auth = await authenticatePos(`Bearer ${paired.token}`, "127.0.0.1");
  assert.equal(auth?.user.id, shop.id);
  assert.equal(await authenticatePos(`Bearer pos_wrong`, null), null);
  await revokePosTerminal(shop.id, terminalId);
  assert.equal(await authenticatePos(`Bearer ${paired.token}`, null), null, "revoked token refused");
  console.log("✓ POS: pair once, bearer auth, revoke");

  // --- Resale ----------------------------------------------------------------
  const listingId = await upsertListing(reseller.id, { operatorCode: OP, priceBps: 9000, paymentInfo: "D17 test", active: true, source: "balance" });
  await rejects(createOrder(buyer.id, { listingId, amountMillimes: 25_000 }), (await getSettings()).maxOrderMillimes < 25_000 ? "above_max_order" : "reseller_balance_low");
  const o1 = await createOrder(buyer.id, { listingId, amountMillimes: 5_000 });
  let [order] = await db.select().from(orders).where(eq(orders.id, o1));
  assert.equal(order.status, "funded");
  assert.equal(order.resale, true);
  assert.equal(await buyerBalance(reseller.id), 15_000, "resale reserves the reseller's balance");
  await cancelByBuyer(buyer.id, o1);
  [order] = await db.select().from(orders).where(eq(orders.id, o1));
  assert.equal(order.buyerBadMark, false, "no bad mark on an instantly funded resale");
  assert.equal(order.leftoverMillimes, 0);
  assert.equal(await buyerBalance(reseller.id), 20_000, "cancel returns credit to the reseller");

  const o2 = await createOrder(buyer.id, { listingId, amountMillimes: 10_000 });
  await addPaymentProofs(buyer.id, o2, [{ path: "proofs/check.png", mime: "image/png" }]);
  await confirmPayment(reseller.id, o2);
  [order] = await db.select().from(orders).where(eq(orders.id, o2));
  assert.equal(order.status, "released");
  assert.equal(order.commissionMillimes, 200, "commission taken again on resale");
  assert.equal(await buyerBalance(buyer.id), 9_800);
  assert.equal(await buyerBalance(reseller.id), 10_000);
  console.log("✓ resale: instant funding, cancel back to balance, release with commission");

  // --- Admin spends Sarfli's own credit, with the marketplace switched OFF ---
  await saveSettings({ marketplaceEnabled: 0 });
  const [admin] = await db.insert(users).values({ email: `check-admin-${run}@example.test`, name: "Check admin", role: "admin" }).returning();
  const [plain] = await db.insert(users).values({ email: `check-plain-${run}@example.test`, name: "Check plain" }).returning();
  await rejects(createRecharge(plain.id, { packageId: pkgId, msisdn: "22123456" }), "marketplace_closed");
  // Isolated operator so other local data cannot change the numbers: 8 DT on its only SIM.
  const TOP = `chk${run % 1_000_000}`;
  await db.insert(operators).values({ ...op, code: TOP, name: `Check ${TOP}`, active: true, rechargeUssdTemplate: null });
  const [device] = await db.insert(devices).values({ name: `check-${run}` }).returning();
  await db.insert(sims).values({ deviceId: device.id, slotIndex: 0, subscriptionId: 1, status: "active", operatorCode: TOP, msisdn: `9${String(run).slice(-7)}`, balanceMillimes: 8_000 });
  assert.equal((await sarfliCredit(db, TOP)).spendableMillimes, 8_000, "all phone credit is Sarfli's");
  // A seller's transfer still being verified is not Sarfli's yet.
  await db.insert(transactions).values({ ref: `CHK-${run}`, userId: plain.id, operatorCode: TOP, declaredMillimes: 2_000, senderMsisdn: "98000000", rateBps: 9000, status: "verifying", smsReceivedMillimes: 2_000 } as typeof transactions.$inferInsert);
  assert.equal((await sarfliCredit(db, TOP)).spendableMillimes, 6_000, "unconfirmed sale excluded");
  const tpkg = await createPackage({ operatorCode: TOP, name: "Check pkg", priceMillimes: 5_000, ussdTemplate: "*1*{number}#", ussdSteps: [], active: true, sortOrder: 0 });
  const s1 = await createRecharge(admin.id, { packageId: tpkg, msisdn: "22123456" }, { clientRef: `sarfli-${run}` });
  const [s1row] = await db.select().from(recharges).where(eq(recharges.id, s1));
  assert.equal(s1row.funding, "sarfli");
  assert.equal(await buyerBalance(admin.id), 0, "admin's own balance untouched");
  assert.equal((await sarfliCredit(db, TOP)).spendableMillimes, 1_000, "pending send reserved");
  await rejects(createRecharge(admin.id, { packageId: tpkg, msisdn: "22123456" }), "sarfli_credit_insufficient");
  await cancelRecharge(admin.id, s1);
  assert.equal((await sarfliCredit(db, TOP)).spendableMillimes, 6_000, "cancel frees Sarfli credit");
  // Admin POS works with the marketplace off.
  const ap = await createPosPairing(admin.id, { name: "Sarfli counter" });
  const at = await pairPosTerminal(ap.code, null);
  assert.equal((await authenticatePos(`Bearer ${at.token}`, null))?.user.id, admin.id);
  // Hide the throwaway operator again so it never shows up in the POS or the web app.
  await db.update(operators).set({ active: false }).where(eq(operators.code, TOP));
  console.log("✓ Sarfli use: admin spends phone credit minus unconfirmed/others, marketplace off, POS");

  await saveSettings({ marketplaceEnabled: before.marketplaceEnabled, commissionBps: before.commissionBps });
  console.log("all checks passed");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
