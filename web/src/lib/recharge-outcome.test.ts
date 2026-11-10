import { describe, expect, it } from "vitest";
import { sendOutcome } from "./recharge-outcome";

describe("sendOutcome", () => {
  it("trusts a reported success", () => expect(sendOutcome(true, null)).toBe(true));
  it("treats never-dialled errors as a clear failure", () => {
    expect(sendOutcome(false, "accessibility_not_running")).toBe(false);
    expect(sendOutcome(false, "unsupported_command")).toBe(false);
  });
  it("treats anything that may have reached the operator as unknown", () => {
    expect(sendOutcome(false, "interrupted_unknown")).toBeNull();
    expect(sendOutcome(false, "popup_timeout")).toBeNull();
    expect(sendOutcome(false, "reply_failed_at_step_1")).toBeNull();
    expect(sendOutcome(false, "timeout")).toBeNull();
    expect(sendOutcome(null, "no_result")).toBeNull();
  });
});
