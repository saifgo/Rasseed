import "dotenv/config";
import { and, eq, sql } from "drizzle-orm";
import { db } from "./index";
import { operators, payoutMethods } from "./schema";
import { DEFAULT_BALANCE_REGEX, DEFAULT_CREDIT_SMS_REGEX, ORANGE_BALANCE_REGEX } from "@/lib/parsers";

// Idempotent: inserts defaults, never overwrites what the admin has changed.
async function main() {
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

  // Existing installs: replace Orange's generic balance regex (it would read the 30 DT "forfait")
  // with the real *101# format, unless the admin already customised it.
  await db
    .update(operators)
    .set({ balanceRegex: ORANGE_BALANCE_REGEX, balanceUnit: "dinars" })
    .where(and(eq(operators.code, "orange"), eq(operators.balanceRegex, DEFAULT_BALANCE_REGEX)));

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
    ])
    .onConflictDoNothing();

  const [{ count }] = await db.execute<{ count: string }>(sql`select count(*)::text as count from operators`);
  console.log(`seed ok (${count} operators)`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
