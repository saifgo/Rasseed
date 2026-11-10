/**
 * Phone errors that prove the code was never dialled. Any other failure (timeout, app killed mid-send,
 * reply not typed, operator error) may still have moved credit, so it counts as "unknown": an unchanged
 * balance then goes to an admin instead of being refunded automatically.
 */
const NOT_DIALLED = /^(missing_permission|accessibility_not_running|no_phone_account_for_sim|silent_ussd_needs_android_8|no_telephony|unsupported_command)$/;

export function sendOutcome(ok: boolean | null, error: string | null): boolean | null {
  if (ok === true) return true;
  if (ok === false && error && NOT_DIALLED.test(error.trim())) return false;
  return null;
}
