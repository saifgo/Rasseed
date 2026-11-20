import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { dataPackages, operators } from "@/db/schema";
import { isMenuCheck, MENU_CHECK_PREFIX } from "@/lib/recharge-outcome";
import { EngineError } from "./core";

/**
 * Data package catalogue, kept by admins. A package is activated for a customer number by an agent
 * phone (USSD) and paid from the buyer's balance for that operator, through the recharge pipeline:
 * the agent SIM's balance must drop by exactly the package price.
 */

export type DataPackage = typeof dataPackages.$inferSelect;

export type PackageInput = {
  operatorCode: string;
  name: string;
  priceMillimes: number;
  ussdTemplate: string;
  ussdSteps: string[];
  active: boolean;
  sortOrder: number;
};

function validate(input: Omit<PackageInput, "operatorCode">) {
  const name = input.name.trim().slice(0, 120);
  if (!name) throw new EngineError("name_required");
  if (!Number.isInteger(input.priceMillimes) || input.priceMillimes <= 0) throw new EngineError("invalid_amount");
  const ussdTemplate = input.ussdTemplate.trim();
  if (!ussdTemplate) throw new EngineError("ussd_required");
  const ussdSteps = input.ussdSteps.map((s) => s.trim()).filter(Boolean).slice(0, 10);
  // The package goes to the customer's number, so the dialog must carry it somewhere.
  if (![ussdTemplate, ...ussdSteps].join("\n").includes("{number}")) throw new EngineError("package_needs_number");
  // "?text" checks the menu page; a bare "?" would check nothing.
  if (ussdSteps.some((s) => isMenuCheck(s) && !s.slice(MENU_CHECK_PREFIX.length).trim())) throw new EngineError("empty_menu_check");
  const sortOrder = Number.isInteger(input.sortOrder) ? input.sortOrder : 0;
  return { name, priceMillimes: input.priceMillimes, ussdTemplate, ussdSteps, active: input.active, sortOrder };
}

export async function createPackage(input: PackageInput) {
  const values = validate(input);
  const [op] = await db.select().from(operators).where(eq(operators.code, input.operatorCode));
  if (!op) throw new EngineError("operator_unavailable");
  const [row] = await db
    .insert(dataPackages)
    .values({ operatorCode: op.code, ...values })
    .returning({ id: dataPackages.id });
  return row.id;
}

/** The operator of a package never changes (recharges already point to it). */
export async function updatePackage(id: string, input: Omit<PackageInput, "operatorCode">) {
  const values = validate(input);
  const rows = await db
    .update(dataPackages)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(dataPackages.id, id))
    .returning({ id: dataPackages.id });
  if (rows.length === 0) throw new EngineError("not_found");
}

export async function listPackages(opts: { activeOnly?: boolean; operatorCode?: string } = {}) {
  return db
    .select()
    .from(dataPackages)
    .where(
      and(
        opts.activeOnly ? eq(dataPackages.active, true) : undefined,
        opts.operatorCode ? eq(dataPackages.operatorCode, opts.operatorCode) : undefined,
      ),
    )
    .orderBy(asc(dataPackages.operatorCode), asc(dataPackages.sortOrder), asc(dataPackages.priceMillimes));
}
