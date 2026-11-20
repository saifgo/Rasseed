/**
 * A USSD menu step starting with "?" is a check, not a reply: the page the phone is on must contain the
 * text after it (case, accents and spacing ignored), e.g. "?4:Flexi 30J et plus". Otherwise the phone
 * closes the session before buying anything and reports MENU_CHECK_FAILED.
 */
export const MENU_CHECK_PREFIX = "?";
export const MENU_CHECK_FAILED = "menu_check_failed";
/** Note on a recharge refunded because its menu check failed (shown to the buyer). */
export const NUMBER_NOT_COMPATIBLE = "number_not_compatible";

export function isMenuCheck(step: string): boolean {
  return step.startsWith(MENU_CHECK_PREFIX);
}

/**
 * Phone errors that prove nothing was bought: the code was never dialled, or a menu check failed and the
 * session was closed first. Any other failure (timeout, app killed mid-send, reply not typed, operator
 * error) may still have moved credit, so it counts as "unknown": an unchanged balance then goes to an
 * admin instead of being refunded automatically.
 */
const NOT_DIALLED = /^(missing_permission|accessibility_not_running|no_phone_account_for_sim|silent_ussd_needs_android_8|no_telephony|unsupported_command|never_delivered|menu_check_failed)$/;

export function sendOutcome(ok: boolean | null, error: string | null): boolean | null {
  if (ok === true) return true;
  if (ok === false && error && NOT_DIALLED.test(error.trim())) return false;
  return null;
}
