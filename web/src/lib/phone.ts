// Tunisian mobile numbers are 8 digits. Accept +216 / 00216 / 216 prefixes and spaces.
export function normalizeMsisdn(input: string): string | null {
  let d = input.replace(/[\s\-().]/g, "");
  if (d.startsWith("+")) d = d.slice(1);
  if (d.startsWith("00")) d = d.slice(2);
  if (d.length === 11 && d.startsWith("216")) d = d.slice(3);
  return /^\d{8}$/.test(d) ? d : null;
}

export function formatMsisdn(msisdn: string): string {
  return msisdn.length === 8 ? `${msisdn.slice(0, 2)} ${msisdn.slice(2, 5)} ${msisdn.slice(5)}` : msisdn;
}
