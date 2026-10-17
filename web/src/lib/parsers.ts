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

/** Extracts the balance in millimes from a USSD reply, or null if it can't be parsed reliably. */
export function parseBalance(response: string, cfg: BalanceParserConfig): number | null {
  const re = compile(cfg.balanceRegex);
  const m = re ? response.normalize("NFC").match(re) : null;
  const amountRaw = m?.groups?.amount;
  if (!amountRaw) return null;
  let unit: "millimes" | "dinars";
  if (cfg.balanceUnit !== "auto") unit = cfg.balanceUnit;
  else {
    const u = (m.groups?.unit ?? "").toLowerCase();
    if (u.startsWith("mill")) unit = "millimes";
    else if (u) unit = "dinars";
    else return null; // ambiguous without a unit
  }
  return amountToMillimes(amountRaw, unit);
}

/** Builds the USSD code shown to the seller. */
export function renderTransferUssd(template: string, number: string, millimes: number): string {
  return template
    .replaceAll("{number}", number)
    .replaceAll("{millimes}", String(millimes))
    .replaceAll("{dinars}", String(millimes / MILLIMES_PER_DINAR));
}
