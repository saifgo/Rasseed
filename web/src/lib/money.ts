// Money helpers. Everything is integer millimes (1 TND = 1000 millimes); rates are basis points.

export const MILLIMES_PER_DINAR = 1000;
export const BPS = 10_000;

/** Parses a user-entered dinar amount ("12", "12.5", "12,250") into millimes. Returns null if invalid. */
export function parseDinars(input: string): number | null {
  const s = input.trim().replace(",", ".");
  if (!/^\d{1,6}(\.\d{1,3})?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  return Number(whole) * MILLIMES_PER_DINAR + Number(frac.padEnd(3, "0"));
}

/** Payout before fees for a given amount of credit at a rate. Always rounds down. */
export function grossPayout(creditMillimes: number, rateBps: number): number {
  return Math.floor((creditMillimes * rateBps) / BPS);
}

export function netPayout(creditMillimes: number, rateBps: number, feeMillimes: number): number {
  return Math.max(0, grossPayout(creditMillimes, rateBps) - feeMillimes);
}

/** Converts a rate like "0.85" or "85%" into basis points. */
export function parseRate(input: string): number | null {
  const s = input.trim().replace(",", ".");
  if (s.endsWith("%")) {
    const n = Number(s.slice(0, -1));
    return Number.isFinite(n) && n > 0 && n <= 100 ? Math.round(n * 100) : null;
  }
  const n = Number(s);
  return Number.isFinite(n) && n > 0 && n <= 1 ? Math.round(n * BPS) : null;
}

export function formatDinars(millimes: number, locale = "fr-TN"): string {
  return new Intl.NumberFormat(locale, { minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(
    millimes / MILLIMES_PER_DINAR,
  );
}

export function formatRate(rateBps: number): string {
  return `${(rateBps / 100).toFixed(rateBps % 100 === 0 ? 0 : 2)}%`;
}

/** Seller-friendly amount: "10" for whole dinars (never "10,000", which reads as ten thousand), "2,500" otherwise. */
export function formatDt(millimes: number, locale = "fr-TN"): string {
  if (millimes % MILLIMES_PER_DINAR === 0) {
    return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(millimes / MILLIMES_PER_DINAR);
  }
  return formatDinars(millimes, locale);
}
