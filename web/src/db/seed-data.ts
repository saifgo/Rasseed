import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "./index";
import { devices, operators, payoutMethods, sims, transactions, users, walletEntries } from "./schema";
import {
  DEFAULT_BALANCE_REGEX,
  DEFAULT_CREDIT_SMS_REGEX,
  DEFAULT_CREDIT_SMS_REGEX_V1,
  DEFAULT_CREDIT_SMS_REGEX_V2,
  ORANGE_BALANCE_REGEX,
  ORANGE_BALANCE_REGEX_V1,
} from "@/lib/parsers";
import { move } from "@/lib/engine/ledger";
import {
  addPaymentProofs,
  adjustSarfliCredit,
  adminRelease,
  cancelByBuyer,
  confirmPayment,
  createOrder,
  rateSeller,
  reportNotPaid,
  upsertListing,
  upsertSarfliListing,
} from "@/lib/engine/market";
import { createPackage } from "@/lib/engine/packages";
import { adjustBalance, requestWithdrawal } from "@/lib/engine/wallet";
import { grossPayout } from "@/lib/money";
import { saveSettings } from "@/lib/settings";

// Idempotent: inserts defaults, never overwrites what the admin has changed.
export async function seedDefaults() {
  await db
    .insert(operators)
    .values([
      {
        code: "ooredoo",
        name: "Ooredoo",
        color: "#e30613",
        sortOrder: 1,
        rateBps: 8000,
        transferUssdTemplate: "*120*{number}#",
        balanceUssdCode: "*100#",
        creditSmsRegex: DEFAULT_CREDIT_SMS_REGEX,
        balanceRegex: DEFAULT_BALANCE_REGEX,
      },
      {
        code: "orange",
        name: "Orange",
        color: "#ff7900",
        sortOrder: 2,
        rateBps: 8000,
        transferUssdTemplate: "*116*{number}*{millimes}#",
        balanceUssdCode: "*101#",
        creditSmsRegex: DEFAULT_CREDIT_SMS_REGEX,
        balanceRegex: ORANGE_BALANCE_REGEX,
        balanceUnit: "dinars",
      },
      {
        code: "tt",
        name: "Tunisie Telecom",
        color: "#0067b1",
        sortOrder: 3,
        rateBps: 8000,
        transferUssdTemplate: "*133*{millimes}*{number}#",
        balanceUssdCode: "*122#",
        creditSmsRegex: DEFAULT_CREDIT_SMS_REGEX,
        balanceRegex: DEFAULT_BALANCE_REGEX,
      },
    ])
    .onConflictDoNothing();

  // Existing installs: upgrade Orange from an older default (the generic one would read the 30 DT
  // "forfait"; V1 misses the "Votre solde est de" format), unless the admin customised it.
  await db
    .update(operators)
    .set({ balanceRegex: ORANGE_BALANCE_REGEX, balanceUnit: "dinars" })
    .where(
      and(
        eq(operators.code, "orange"),
        inArray(operators.balanceRegex, [DEFAULT_BALANCE_REGEX, ORANGE_BALANCE_REGEX_V1]),
      ),
    );

  // Existing installs: the old credit SMS default only knew the "Millimes ... du numéro" format,
  // so Ooredoo's "1 DT de la part de 216..." SMS was ignored; V2 missed Tunisie Telecom's
  // "Vous venez de recevoir ... de la part du ..." SMS. Upgrade unless customised.
  await db
    .update(operators)
    .set({ creditSmsRegex: DEFAULT_CREDIT_SMS_REGEX })
    .where(inArray(operators.creditSmsRegex, [DEFAULT_CREDIT_SMS_REGEX_V1, DEFAULT_CREDIT_SMS_REGEX_V2]));

  const phone = (en: string, fr: string, ar: string) => ({ en, fr, ar });
  await db
    .insert(payoutMethods)
    .values([
      {
        code: "d17",
        name: { en: "D17", fr: "D17", ar: "D17" },
        sortOrder: 1,
        fields: [
          { key: "phone", label: phone("D17 phone number", "Numéro D17", "رقم D17"), type: "phone", required: true },
          { key: "name", label: phone("Full name", "Nom complet", "الاسم الكامل"), type: "text", required: true },
        ],
      },
      {
        code: "flouci",
        name: { en: "Flouci", fr: "Flouci", ar: "فلوسي" },
        sortOrder: 2,
        fields: [
          { key: "phone", label: phone("Flouci phone number", "Numéro Flouci", "رقم فلوسي"), type: "phone", required: true },
          { key: "name", label: phone("Full name", "Nom complet", "الاسم الكامل"), type: "text", required: true },
        ],
      },
      {
        code: "mandat",
        name: { en: "Postal money order", fr: "Mandat postal", ar: "حوالة بريدية" },
        sortOrder: 3,
        feeMillimes: 5000,
        fields: [
          { key: "name", label: phone("Full name", "Nom complet", "الاسم الكامل"), type: "text", required: true },
          { key: "phone", label: phone("Phone number", "Numéro de téléphone", "رقم الهاتف"), type: "phone", required: true },
        ],
      },
      {
        code: "izi",
        name: { en: "Izi", fr: "Izi", ar: "إيزي" },
        sortOrder: 4,
        fields: [
          { key: "phone", label: phone("Izi phone number", "Numéro Izi", "رقم إيزي"), type: "phone", required: true },
          { key: "name", label: phone("Full name", "Nom complet", "الاسم الكامل"), type: "text", required: true },
        ],
      },
      {
        code: "wafacash",
        name: { en: "Wafacash", fr: "Wafacash", ar: "وفاكاش" },
        sortOrder: 5,
        fields: [
          { key: "phone", label: phone("Phone number", "Numéro de téléphone", "رقم الهاتف"), type: "phone", required: true },
          { key: "name", label: phone("Full name", "Nom complet", "الاسم الكامل"), type: "text", required: true },
        ],
      },
    ])
    .onConflictDoNothing();
}

/** Dev only: empties every application table (users included). Migrations are kept. */
export async function resetDatabase() {
  if (process.env.NODE_ENV === "production") throw new Error("reset_disabled_in_production");
  const rows = await db.execute<{ tablename: string }>(
    sql`select tablename from pg_tables where schemaname = 'public' and tablename <> '__drizzle_migrations'`,
  );
  const names = rows.map((r) => `"public"."${r.tablename}"`);
  if (names.length) await db.execute(sql.raw(`truncate table ${names.join(", ")} restart identity cascade`));
}

const adminEmails = () =>
  (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

// 1x1 transparent PNG, used as the payment proof of the demo orders.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

async function demoProof() {
  const root = path.resolve(/*turbopackIgnore: true*/ process.env.STORAGE_DIR ?? "./storage");
  await mkdir(path.join(root, "proofs"), { recursive: true });
  const name = `demo-${crypto.randomUUID()}.png`;
  await writeFile(path.join(root, "proofs", name), PNG);
  return [{ path: `proofs/${name}`, mime: "image/png" }];
}

/** Demo users, listings, balances and orders in every state, on top of the defaults. Expects an empty database. */
export async function seedDemo() {
  await saveSettings({ marketplaceEnabled: 1, commissionBps: 200 });

  const mk = async (email: string, name: string, role: "seller" | "manager" | "admin" = "seller", marketplaceAccess = true) => {
    const [u] = await db.insert(users).values({ email, name, role, marketplaceAccess }).returning();
    return u;
  };
  const admins = await Promise.all(adminEmails().map((e) => mk(e, e.split("@")[0], "admin")));
  const admin = admins[0] ?? (await mk("admin@demo.test", "Admin", "admin"));
  await mk("manager@demo.test", "Manager Demo", "manager");
  const amine = await mk("amine@demo.test", "Amine (seller)");
  const sana = await mk("sana@demo.test", "Sana (seller)");
  const karim = await mk("karim@demo.test", "Karim (buyer)");
  const leila = await mk("leila@demo.test", "Leila (buyer, resells)");
  const nour = await mk("nour@demo.test", "Nour (sells to Sarfli)", "seller", false);

  // Agent phone (never paired, so it shows offline) with two configured SIMs.
  const [phone] = await db.insert(devices).values({ name: "Demo phone", model: "Demo", androidVersion: "14" }).returning();
  const now = new Date();
  await db.insert(sims).values([
    { deviceId: phone.id, slotIndex: 0, subscriptionId: 1, carrierName: "Ooredoo TN", operatorCode: "ooredoo", msisdn: "20000001", status: "active", balanceMillimes: 250_000, balanceCheckedAt: now },
    { deviceId: phone.id, slotIndex: 1, subscriptionId: 2, carrierName: "Orange TN", operatorCode: "orange", msisdn: "50000002", status: "active", balanceMillimes: 120_000, balanceCheckedAt: now },
  ]);

  // Sarfli's own credit and listings.
  for (const op of ["ooredoo", "orange", "tt"]) {
    await adjustSarfliCredit(admin.id, op, 200_000, "Demo opening balance");
    await upsertSarfliListing({ operatorCode: op, priceBps: 8500, paymentInfo: "D17: 20 000 000 (Sarfli demo)", active: true });
  }

  // Seller listings; Amine has Ooredoo stock so his orders are funded at once.
  const amineOoredoo = await upsertListing(amine.id, { operatorCode: "ooredoo", priceBps: 8200, paymentInfo: "D17: 21 111 111 — Amine", active: true });
  await upsertListing(amine.id, { operatorCode: "orange", priceBps: 8300, paymentInfo: "Flouci: 21 111 111 — Amine", active: true });
  const sanaTt = await upsertListing(sana.id, { operatorCode: "tt", priceBps: 8100, paymentInfo: "D17: 22 222 222 — Sana", active: true });
  const sanaOoredoo = await upsertListing(sana.id, { operatorCode: "ooredoo", priceBps: 8000, paymentInfo: "D17: 22 222 222 — Sana", active: true });

  const opening = (operatorCode: string, bucket: "buyer" | "seller_stock", userId: string, amountMillimes: number) =>
    db.transaction((t) =>
      move(t, {
        kind: "demo_opening",
        operatorCode,
        note: "Demo data",
        createdBy: admin.id,
        legs: [
          { bucket: "external", amountMillimes: -amountMillimes },
          { bucket, userId, amountMillimes },
        ],
      }),
    );
  await opening("ooredoo", "seller_stock", amine.id, 30_000);
  await opening("ooredoo", "buyer", karim.id, 25_000);
  await opening("orange", "buyer", karim.id, 10_000);
  await opening("ooredoo", "buyer", leila.id, 15_000);
  await upsertListing(leila.id, { operatorCode: "ooredoo", priceBps: 8700, paymentInfo: "D17: 23 333 333 — Leila", active: true, source: "balance" });

  const sarfliOoredoo = (await db.query.listings.findFirst({
    where: (l, { and, eq, isNull }) => and(isNull(l.sellerId), eq(l.operatorCode, "ooredoo")),
  }))!.id;

  // Orders in every state.
  const o1 = await createOrder(karim.id, { listingId: sarfliOoredoo, amountMillimes: 10_000 });
  await addPaymentProofs(karim.id, o1, await demoProof());
  await adminRelease(admin.id, o1, "Demo: payment received");
  await rateSeller(karim.id, o1, 4, "Fast");

  const o2 = await createOrder(karim.id, { listingId: amineOoredoo, amountMillimes: 15_000 });
  await addPaymentProofs(karim.id, o2, await demoProof());
  await confirmPayment(amine.id, o2);
  await rateSeller(karim.id, o2, 5, "Perfect, thanks!");

  const o3 = await createOrder(leila.id, { listingId: amineOoredoo, amountMillimes: 10_000 });
  await addPaymentProofs(leila.id, o3, await demoProof()); // waits for Amine to confirm

  const o4 = await createOrder(leila.id, { listingId: amineOoredoo, amountMillimes: 5_000 });
  await addPaymentProofs(leila.id, o4, await demoProof());
  await reportNotPaid(amine.id, o4, "Demo: no payment on my D17"); // admin review

  await createOrder(karim.id, { listingId: sanaTt, amountMillimes: 5_000 }); // waits for Sana's transfer
  const o6 = await createOrder(karim.id, { listingId: sanaOoredoo, amountMillimes: 8_000 });
  await cancelByBuyer(karim.id, o6);

  await createPackage({ operatorCode: "ooredoo", name: "Demo 1 Go", priceMillimes: 3000, ussdTemplate: "*999*{number}#", ussdSteps: ["1"], active: true, sortOrder: 1 });

  // Nour sold credit to Sarfli (confirmed sales credited to the balance), then asked for a withdrawal.
  for (const [i, credit] of [20_000, 30_000].entries()) {
    const gross = grossPayout(credit, 8000);
    const [tx] = await db
      .insert(transactions)
      .values({
        ref: `RS-DEMO${i + 1}`,
        userId: nour.id,
        operatorCode: "ooredoo",
        declaredMillimes: credit,
        senderMsisdn: "29999999",
        rateBps: 8000,
        status: "confirmed",
        assignedMsisdn: "20000001",
        smsReceivedMillimes: credit,
        confirmedMillimes: credit,
        finalMillimes: credit,
        payoutGrossMillimes: gross,
        payoutNetMillimes: gross,
        assignedAt: now,
        completedAt: now,
      })
      .returning();
    await db.insert(walletEntries).values({ userId: nour.id, kind: "sale", amountMillimes: gross, txId: tx.id });
  }
  await adjustBalance(admin.id, nour.id, 2_000, "Demo bonus");
  await requestWithdrawal(nour.id, { amountMillimes: 15_000, methodCode: "d17", details: { phone: "24444444", name: "Nour Demo" } });
}

/** Wipes the database and seeds defaults plus demo data. Returns the demo login e-mails. */
export async function resetAndSeed() {
  await resetDatabase();
  await seedDefaults();
  await seedDemo();
  const rows = await db.select({ email: users.email }).from(users);
  return rows.map((r) => r.email!).filter(Boolean);
}
