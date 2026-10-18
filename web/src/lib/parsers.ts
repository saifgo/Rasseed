import { MILLIMES_PER_DINAR } from "./money";
import { normalizeMsisdn } from "./phone";

export type CreditParserConfig = {
  creditSmsRegex: string;
  creditSmsUnit: "millimes" | "dinars";
  creditSmsSenders: string[];
};

export type ParsedCredit = { amountMillimes: number; senderMsisdn: string };

// Matches: "Vous avez recu 1000 Millimes de la part du numéro 23249201"
export const DEFAULT_CREDIT_SMS_REGEX = String.raw`Vous avez re[çc]u\s+(?<amount>\d+(?:[.,]\d+)?)\s*Millimes?\s+de la part du num[ée]ro\s*:?\s*(?<sender>(?:\+?216)?\d{8})`;

// Orange *101# (first page): "... Votre credit recu par transfert est de 0 DT valable jusqu'au --.
// Votre solde de recharge est de 178.125 DT." Transfers may land in either bucket, so both are added.
export const ORANGE_BALANCE_REGEX = String.raw`cr[ée]dit re[çc]u par transfert est de\s*(?<amount>\d+(?:[.,]\d{1,3})?)\s*DT[\s\S]*?solde de recharge est de\s*(?<amount2>\d+(?:[.,]\d{1,3})?)\s*DT`;

// Generic default until the real balance replies are known: first "<number> DT|TND|dinars|millimes".
export const DEFAULT_BALANCE_REGEX = String.raw`(?<amount>\d+(?:[.,]\d{1,3})?)\s*(?<unit>DT|TND|Dinars?|Millimes?|mill)\b`;

function amountToMillimes(raw: string, unit: "millimes" | "dinars"): number | null {
  const n = Number(raw.replace(",", "."));
  if (!Number.isFinite(n) || n < 0) return null;
  const m = unit === "dinars" ? Math.round(n * MILLIMES_PER_DINAR) : n;
  return Number.isInteger(m) ? m : null;
}

function compile(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern, "iu");
  } catch {
    return null;
  }
}

/** Normalizes the SMS originating address for allow-list comparisons. */
function sameAddress(a: string, b: string) {
  const n = (s: string) => s.replace(/[\s+]/g, "").toLowerCase();
  return n(a) === n(b);
}

export type CreditParseResult =
  | { kind: "credit"; credit: ParsedCredit }
  | { kind: "untrusted_sender"; credit: ParsedCredit }
  | { kind: "ignored" };

export function parseCreditSms(body: string, fromAddress: string, cfg: CreditParserConfig): CreditParseResult {
  const re = compile(cfg.creditSmsRegex);
  const m = re ? body.normalize("NFC").match(re) : null;
  const amountRaw = m?.groups?.amount;
  const senderRaw = m?.groups?.sender;
  if (!amountRaw || !senderRaw) return { kind: "ignored" };
  const amountMillimes = amountToMillimes(amountRaw, cfg.creditSmsUnit);
  const senderMsisdn = normalizeMsisdn(senderRaw);
  if (!amountMillimes || !senderMsisdn) return { kind: "ignored" };
  const credit = { amountMillimes, senderMsisdn };
  if (cfg.creditSmsSenders.length > 0 && !cfg.creditSmsSenders.some((s) => sameAddress(s, fromAddress))) {
    return { kind: "untrusted_sender", credit };
  }
  return { kind: "credit", credit };
}

export type BalanceParserConfig = { balanceRegex: string; balanceUnit: "auto" | "millimes" | "dinars" };

/**
 * Extracts the balance in millimes from a USSD reply, or null if it can't be parsed reliably.
 * Groups named `amount`, `amount2`, `amount3`… are added together, for operators that report the
 * credit in several buckets (e.g. Orange: "credit recu par transfert" + "solde de recharge").
 * Each `amountN` may have a matching `unitN` group when the unit is "auto".
 */
export function parseBalance(response: string, cfg: BalanceParserConfig): number | null {
  const re = compile(cfg.balanceRegex);
  const m = re ? response.normalize("NFC").match(re) : null;
  const groups = m?.groups;
  if (!groups?.amount) return null;
  let total = 0;
  for (const [name, raw] of Object.entries(groups)) {
    const suffix = /^amount(\d*)$/.exec(name)?.[1];
    if (suffix === undefined || raw === undefined) continue;
    let unit: "millimes" | "dinars";
    if (cfg.balanceUnit !== "auto") unit = cfg.balanceUnit;
    else {
      const u = (groups[`unit${suffix}`] ?? "").toLowerCase();
      if (u.startsWith("mill")) unit = "millimes";
      else if (u) unit = "dinars";
      else return null; // ambiguous without a unit
    }
    const value = amountToMillimes(raw, unit);
    if (value == null) return null;
    total += value;
  }
  return total;
}

/** Builds the USSD code shown to the seller. */
export function renderTransferUssd(template: string, number: string, millimes: number): string {
  return template
    .replaceAll("{number}", number)
    .replaceAll("{millimes}", String(millimes))
    .replaceAll("{dinars}", String(millimes / MILLIMES_PER_DINAR));
}
