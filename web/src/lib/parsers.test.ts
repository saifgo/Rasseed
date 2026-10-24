import { describe, expect, it } from "vitest";
import { grossPayout, netPayout, parseDinars, parseRate } from "./money";
import {
  DEFAULT_BALANCE_REGEX,
  DEFAULT_CREDIT_SMS_REGEX,
  ORANGE_BALANCE_REGEX,
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

  it("parses the Ooredoo DT format with a 216 prefix", () => {
    const sms =
      "Vous avez recu 1 DT de la part de  21623321145.Nouveau: Avec Mobicash rechargez a tout moment votre ligne avec votre carte bancaire sans vous deplacer *122#";
    expect(parseCreditSms(sms, "Ooredoo", cfg)).toEqual({
      kind: "credit",
      credit: { amountMillimes: 1000, senderMsisdn: "23321145" },
    });
  });

  it("reads decimal dinars and an 8-digit sender", () => {
    const r = parseCreditSms("Vous avez recu 2.500 DT de la part de 23321145.", "Ooredoo", cfg);
    expect(r).toEqual({ kind: "credit", credit: { amountMillimes: 2500, senderMsisdn: "23321145" } });
  });

  it("rejects a sender with too many digits", () => {
    expect(parseCreditSms("Vous avez recu 1 DT de la part de 233211451.", "Ooredoo", cfg).kind).toBe("ignored");
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

describe("Orange *101# reply", () => {
  const orange = { balanceRegex: ORANGE_BALANCE_REGEX, balanceUnit: "dinars" as const };
  const reply =
    "Votre forfait est de  30 DT. Votre report est de 0 DT. Votre credit recu par transfert est de 0 DT valable jusqu'au --. Votre solde de recharge est de  178.125 DT.\n01:Page suivante";
  it("ignores the forfait and reads recharge + transfer", () => expect(parseBalance(reply, orange)).toBe(178125));
  it("adds the transfer bucket", () =>
    expect(parseBalance(reply.replace("transfert est de 0 DT", "transfert est de 5.5 DT"), orange)).toBe(183625));
  it("rejects other replies", () => expect(parseBalance("Votre solde est 12 DT", orange)).toBeNull());
  it("reads the 'Votre solde est de' format and ignores the bonus", () =>
    expect(
      parseBalance(
        "Choix invalide Votre solde est de 7.163 dt valable jusqu'au 21/01/2027.Votre bonus sur recharge tout operateur est 0 dt valable jusqu'au --. Suivi bonus *101*2# 01:Page suivante 1:Activez ?Navigui 100Mo 0,5dt (1j) 02:Page précédente",
        orange,
      ),
    ).toBe(7163));
  it("reads format a when it is on a later page", () =>
    expect(parseBalance("Offres du moment\n01:Page suivante\n" + reply, orange)).toBe(178125));
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
