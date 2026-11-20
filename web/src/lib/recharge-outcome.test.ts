import { describe, expect, it } from "vitest";
import { isMenuCheck, sendOutcome } from "./recharge-outcome";

describe("sendOutcome", () => {
  it("trusts a reported success", () => expect(sendOutcome(true, null)).toBe(true));
  it("treats never-dialled errors as a clear failure", () => {
    expect(sendOutcome(false, "accessibility_not_running")).toBe(false);
    expect(sendOutcome(false, "unsupported_command")).toBe(false);
    // The server timed out a send the phone never fetched.
    expect(sendOutcome(false, "never_delivered")).toBe(false);
    // A menu check failed: the phone closed the session before buying.
    expect(sendOutcome(false, "menu_check_failed")).toBe(false);
  });
  it("treats anything that may have reached the operator as unknown", () => {
    expect(sendOutcome(false, "interrupted_unknown")).toBeNull();
    expect(sendOutcome(false, "popup_timeout")).toBeNull();
    expect(sendOutcome(false, "reply_failed_at_step_1")).toBeNull();
    expect(sendOutcome(false, "timeout")).toBeNull();
    expect(sendOutcome(null, "no_result")).toBeNull();
  });
});

describe("isMenuCheck", () => {
  it("only treats ?-steps as checks", () => {
    expect(isMenuCheck("?4:Flexi 30J et plus")).toBe(true);
    expect(isMenuCheck("4")).toBe(false);
    expect(isMenuCheck("{number}")).toBe(false);
  });
});
