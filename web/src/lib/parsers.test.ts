import { describe, expect, it } from "vitest";
import { grossPayout, netPayout, parseDinars, parseRate } from "./money";
import {
  DEFAULT_BALANCE_REGEX,
  DEFAULT_CREDIT_SMS_REGEX,
  parseBalance,
  parseCreditSms,
  renderTransferUssd,
} from "./parsers";
import { normalizeMsisdn } from "./phone";

const cfg = { creditSmsRegex: DEFAULT_CREDIT_SMS_REGEX, creditSmsUnit: "millimes" as const, creditSmsSenders: [] };

describe("parseCreditSms", () => {
  it("parses the operator sample", () => {
    const r = parseCreditSms("Vous avez recu 1000 Millimes de la part du numéro 23249201", "Ooredoo", cfg);
    expect(r).toEqual({ kind: "credit", credit: { amountMillimes: 1000, senderMsisdn: "23249201" } });
  });

  it("accepts accents, case and +216 prefix", () => {
    const r = parseCreditSms("vous avez reçu 25000 millimes de la part du numero +21623249201.", "x", cfg);
    expect(r).toEqual({ kind: "credit", credit: { amountMillimes: 25000, senderMsisdn: "23249201" } });
  });

  it("ignores unrelated messages", () => {
    expect(parseCreditSms("Bonus 500 Millimes offert", "Ooredoo", cfg).kind).toBe("ignored");
  });

  it("flags senders outside the allow-list", () => {
    const strict = { ...cfg, creditSmsSenders: ["Ooredoo"] };
    const body = "Vous avez recu 1000 Millimes de la part du numéro 23249201";
    expect(parseCreditSms(body, "+21655123456", strict).kind).toBe("untrusted_sender");
    expect(parseCreditSms(body, "ooredoo", strict).kind).toBe("credit");
  });
});

describe("parseBalance", () => {
  const b = { balanceRegex: DEFAULT_BALANCE_REGEX, balanceUnit: "auto" as const };
  it("reads dinars", () => expect(parseBalance("Votre solde est 12.350 DT valable", b)).toBe(12350));
  it("reads millimes", () => expect(parseBalance("Solde: 4500 Millimes", b)).toBe(4500));
  it("rejects replies without amount", () => expect(parseBalance("Service indisponible", b)).toBeNull());
});

describe("money", () => {
  it("parses dinars", () => {
    expect(parseDinars("12")).toBe(12000);
    expect(parseDinars("1,5")).toBe(1500);
    expect(parseDinars("0.125")).toBe(125);
    expect(parseDinars("1.2345")).toBeNull();
    expect(parseDinars("abc")).toBeNull();
  });
  it("computes payouts rounding down", () => {
    expect(grossPayout(10000, 8000)).toBe(8000);
    expect(grossPayout(1001, 8000)).toBe(800);
    expect(netPayout(10000, 8000, 5000)).toBe(3000);
    expect(netPayout(1000, 8000, 5000)).toBe(0);
  });
  it("parses rates", () => {
    expect(parseRate("0.85")).toBe(8500);
    expect(parseRate("82.5%")).toBe(8250);
    expect(parseRate("1.2")).toBeNull();
  });
});

describe("phone & ussd", () => {
  it("normalizes numbers", () => {
    expect(normalizeMsisdn("+216 23 249 201")).toBe("23249201");
    expect(normalizeMsisdn("0021623249201")).toBe("23249201");
    expect(normalizeMsisdn("2324920")).toBeNull();
  });
  it("renders transfer codes", () => {
    expect(renderTransferUssd("*133*{millimes}*{number}#", "98123456", 5000)).toBe("*133*5000*98123456#");
    expect(renderTransferUssd("*120*{number}#", "22123456", 5000)).toBe("*120*22123456#");
  });
});
