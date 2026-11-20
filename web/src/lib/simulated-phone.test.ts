import { describe, expect, it } from "vitest";
import { DEFAULT_BALANCE_REGEX, DEFAULT_CREDIT_SMS_REGEX, ORANGE_BALANCE_REGEX, parseBalance, parseCreditSms } from "./parsers";
import { balanceReply, creditSmsBody, sendAmount, sendSuccessReply } from "./simulated-phone";

describe("simulated phone replies", () => {
  it("balance replies parse with the default operator settings", () => {
    expect(parseBalance(balanceReply(12_345, "*100#"), { balanceRegex: DEFAULT_BALANCE_REGEX, balanceUnit: "auto" })).toBe(12_345);
    expect(parseBalance(balanceReply(100_000, "*101#"), { balanceRegex: ORANGE_BALANCE_REGEX, balanceUnit: "dinars" })).toBe(100_000);
  });

  it("credit SMS parses with the default regex", () => {
    const parsed = parseCreditSms(creditSmsBody(5_000, "22123456"), "Ooredoo", {
      creditSmsRegex: DEFAULT_CREDIT_SMS_REGEX,
      creditSmsUnit: "millimes",
      creditSmsSenders: [],
    });
    expect(parsed).toEqual({ kind: "credit", credit: { amountMillimes: 5_000, senderMsisdn: "22123456" } });
  });

  it("send reply has one page per step and the amount", () => {
    expect(sendSuccessReply(["5000", "1"], 5_000).split("Veuillez confirmer").length).toBe(3);
    expect(sendAmount({ ussd: "*133*5000*22123456#" })).toBe(5_000);
  });
});
