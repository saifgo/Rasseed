import { describe, expect, it } from "vitest";
import { formatPercent, parsePercent, payoutFee } from "./money";

describe("payoutFee", () => {
  it("uses the fixed fee when no percentage is set", () => {
    expect(payoutFee(6000, { feeMillimes: 5000, feeBps: 0 })).toBe(5000);
    expect(payoutFee(6000, { feeMillimes: 0, feeBps: 0 })).toBe(0);
  });

  it("takes a percentage of the amount withdrawn, rounded down", () => {
    expect(payoutFee(100_000, { feeMillimes: 0, feeBps: 200 })).toBe(2000); // 2% of 100 DT
    expect(payoutFee(12_345, { feeMillimes: 0, feeBps: 250 })).toBe(308); // 308.625 → 308
    expect(payoutFee(39, { feeMillimes: 0, feeBps: 250 })).toBe(0); // 0.975 → 0
  });
});

describe("parsePercent", () => {
  it("accepts plain, decimal and % inputs", () => {
    expect(parsePercent("2")).toBe(200);
    expect(parsePercent("2.5")).toBe(250);
    expect(parsePercent("2,5")).toBe(250);
    expect(parsePercent("2.25 %")).toBe(225);
    expect(parsePercent("0.01")).toBe(1);
  });

  it("rejects zero, 100 and above, and bad input", () => {
    for (const s of ["0", "100", "150", "2.555", "-1", "abc", ""]) expect(parsePercent(s)).toBeNull();
  });
});

describe("formatPercent", () => {
  it("formats basis points as a percentage", () => {
    expect(formatPercent(200, "en")).toBe("2%");
    expect(formatPercent(250, "en")).toBe("2.5%");
  });
});
