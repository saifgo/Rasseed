/**
 * Replies a simulated agent phone gives, shared by the terminal simulator (scripts/phone-simulator.ts)
 * and the admin "Test phone" page (src/lib/test-phone.ts). Pure functions, no database.
 */

/** Mimics each operator's real balance reply. Orange (*101#) lists several buckets; only recharge + transfer count. */
export function balanceReply(millimes: number, ussd: string): string {
  return ussd === "*101#"
    ? `Votre forfait est de  30 DT. Votre report est de 0 DT. Votre credit recu par transfert est de 0 DT valable jusqu'au --. Votre solde de recharge est de  ${(millimes / 1000).toFixed(3)} DT.
01:Page suivante`
    : `Votre solde est de ${(millimes / 1000).toFixed(3)} DT. Valable jusqu'au 31/12/2026`;
}

/** Operator SMS announcing a received transfer (matches the default credit SMS regex). */
export function creditSmsBody(millimes: number, senderMsisdn: string): string {
  return `Vous avez recu ${millimes} Millimes de la part du numéro ${senderMsisdn}`;
}

/** Operator refusal of a credit send (e.g. not enough balance). A real phone still reports ok:true. */
export const SEND_REFUSED_REPLY = "Votre solde est insuffisant pour effectuer ce transfert.";

/** One menu page per scripted reply, then the final confirmation (pages joined like the app does). */
export function sendSuccessReply(steps: string[], millimes: number): string {
  return [...steps.map(() => "Veuillez confirmer:\n1:Oui\n2:Non"), `Transfert de ${millimes} Millimes effectue avec succes.`].join("\n");
}

/**
 * Amount (millimes) of a credit send, guessed from the rendered code and replies: every number in
 * them except the service code (first group of the USSD), phone numbers (8+ digits) and menu choices
 * (1-2 digits); the largest one left wins. Fits templates using {millimes}, e.g. *133*{millimes}*{number}#
 * or steps ["{millimes}", "1"].
 */
export function sendAmount(cmd: { ussd: string; steps?: string[] }): number | null {
  const [, ...rest] = cmd.ussd.match(/\d+/g) ?? [];
  const nums = [...rest, ...(cmd.steps ?? []).flatMap((s) => s.match(/\d+/g) ?? [])]
    .filter((n) => n.length >= 3 && n.length < 8)
    .map(Number);
  return nums.length ? Math.max(...nums) : null;
}
