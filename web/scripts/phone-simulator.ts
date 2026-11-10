/**
 * Simulated agent phone: speaks the same HTTP protocol as the Android app.
 * Used by the end-to-end test and for trying the platform without real hardware.
 *
 *   pnpm sim:phone <pairing-code> [server-url]
 *
 * Commands on stdin:
 *   send <slot> <millimes> <from>     transfer credit to the SIM in <slot> and deliver the operator SMS
 *   silent <slot> <millimes>          credit arrives WITHOUT an SMS
 *   fakesms <slot> <millimes> <from>  SMS arrives but the balance does NOT change
 *   balance                           print simulated balances
 *
 * Balance commands (ussd_balance) answer with the SIM's balance. Credit sends (ussd_send) deduct the
 * amount from the SIM and answer with a confirmation; see sendAmount() for how the amount is found.
 */
import readline from "node:readline";

export type SimSlot = { slotIndex: number; subscriptionId: number; carrierName: string; balanceMillimes: number };

type Command = { id: string; type?: string; ussd: string; steps?: string[]; subscriptionId: number };

/**
 * Amount (millimes) of a credit send, guessed from the rendered code and replies: every number in
 * them except the service code (first group of the USSD), phone numbers (8+ digits) and menu choices
 * (1-2 digits); the largest one left wins. Fits templates using {millimes}, e.g. *133*{millimes}*{number}#
 * or steps ["{millimes}", "1"]. Override `PhoneSimulator.sendAmount` for other formats.
 */
export function sendAmount(cmd: { ussd: string; steps?: string[] }): number | null {
  const [, ...rest] = cmd.ussd.match(/\d+/g) ?? [];
  const nums = [...rest, ...(cmd.steps ?? []).flatMap((s) => s.match(/\d+/g) ?? [])]
    .filter((n) => n.length >= 3 && n.length < 8)
    .map(Number);
  return nums.length ? Math.max(...nums) : null;
}

export class PhoneSimulator {
  token: string | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private smsSeq = 0;
  log: (msg: string) => void = () => {};
  /** When false, balance commands fail (simulates USSD errors). */
  ussdWorks = true;
  /** Finds the amount of a credit send (see sendAmount above). */
  sendAmount = sendAmount;
  /** Credit sends performed, for tests to inspect. */
  sends: { commandId: string; slotIndex: number; ussd: string; steps: string[]; millimes: number }[] = [];
  /** Mimics each operator's real balance reply. Orange (*101#) lists several buckets; only recharge + transfer count. */
  balanceFormat = (m: number, ussd: string) =>
    ussd === "*101#"
      ? `Votre forfait est de  30 DT. Votre report est de 0 DT. Votre credit recu par transfert est de 0 DT valable jusqu'au --. Votre solde de recharge est de  ${(m / 1000).toFixed(3)} DT.
01:Page suivante`
      : `Votre solde est de ${(m / 1000).toFixed(3)} DT. Valable jusqu'au 31/12/2026`;

  constructor(
    public server: string,
    public sims: SimSlot[],
  ) {}

  private async post(path: string, body: unknown, auth = true) {
    const res = await fetch(`${this.server}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(auth && this.token ? { Authorization: `Bearer ${this.token}` } : {}) },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${path} ${res.status} ${JSON.stringify(json)}`);
    return json;
  }

  async pair(code: string) {
    const r = await this.post("/api/device/pair", { code }, false);
    this.token = r.token;
    return r;
  }

  async sync() {
    const r = await this.post("/api/device/sync", {
      sims: this.sims.map(({ slotIndex, subscriptionId, carrierName }) => ({ slotIndex, subscriptionId, carrierName })),
      batteryPct: 87,
      charging: true,
      model: "Simulator",
      androidVersion: "14",
      appVersion: "sim-1",
    });
    for (const cmd of r.commands as Command[]) {
      const sim = this.sims.find((s) => s.subscriptionId === cmd.subscriptionId);
      if (!sim || !this.ussdWorks) {
        await this.post("/api/device/result", { id: cmd.id, ok: false, error: "USSD_RETURN_FAILURE" });
        continue;
      }
      if (cmd.type === "ussd_send") {
        await this.post("/api/device/result", { id: cmd.id, ...this.send(sim, cmd) });
        continue;
      }
      this.log(`USSD ${cmd.ussd} on slot ${sim.slotIndex} -> ${sim.balanceMillimes}`);
      await this.post("/api/device/result", { id: cmd.id, ok: true, response: this.balanceFormat(sim.balanceMillimes, cmd.ussd) });
    }
    return r.commands.length as number;
  }

  /** Runs a credit send once, like the operator would. Like a real phone, a refusal is still ok:true. */
  private send(sim: SimSlot, cmd: Command) {
    const steps = cmd.steps ?? [];
    const millimes = this.sendAmount(cmd);
    if (millimes == null) return { ok: false, error: "sim_unknown_amount" };
    if (millimes > sim.balanceMillimes) {
      this.log(`SEND ${cmd.ussd} ${steps.join(" ")} on slot ${sim.slotIndex} refused: balance ${sim.balanceMillimes}`);
      return { ok: true, response: "Votre solde est insuffisant pour effectuer ce transfert." };
    }
    sim.balanceMillimes -= millimes;
    this.sends.push({ commandId: cmd.id, slotIndex: sim.slotIndex, ussd: cmd.ussd, steps, millimes });
    this.log(`SEND ${cmd.ussd} ${steps.join(" ")} on slot ${sim.slotIndex}: -${millimes} -> ${sim.balanceMillimes}`);
    // One menu page per scripted reply, then the final confirmation (pages joined like the app does).
    const pages = [...steps.map(() => "Veuillez confirmer:\n1:Oui\n2:Non"), `Transfert de ${millimes} Millimes effectue avec succes.`];
    return { ok: true, response: pages.join("\n") };
  }

  start(intervalMs = 1000) {
    this.timer = setInterval(() => void this.sync().catch((e) => this.log(`sync failed: ${e.message}`)), intervalMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  async deliverSms(slotIndex: number, body: string, from = "Ooredoo") {
    const sim = this.sims.find((s) => s.slotIndex === slotIndex)!;
    const now = Date.now();
    return this.post("/api/device/sms", {
      messages: [{ localId: `sim-${now}-${++this.smsSeq}`, subscriptionId: sim.subscriptionId, slotIndex, from, body, sentAt: now, receivedAt: now }],
    });
  }

  /** Real transfer: balance goes up and the operator sends the confirmation SMS. */
  async transfer(slotIndex: number, millimes: number, senderMsisdn: string) {
    const sim = this.sims.find((s) => s.slotIndex === slotIndex)!;
    sim.balanceMillimes += millimes;
    return this.deliverSms(slotIndex, `Vous avez recu ${millimes} Millimes de la part du numéro ${senderMsisdn}`);
  }
}

async function main() {
  const [code, server = "http://localhost:3000"] = process.argv.slice(2);
  if (!code) {
    console.error("usage: pnpm sim:phone <pairing-code> [server-url]");
    process.exit(1);
  }
  const phone = new PhoneSimulator(server, [
    { slotIndex: 0, subscriptionId: 101, carrierName: "Ooredoo TN", balanceMillimes: 2000 },
    { slotIndex: 1, subscriptionId: 102, carrierName: "Orange TN", balanceMillimes: 500 },
  ]);
  phone.log = (m) => console.log(`[phone] ${m}`);
  const paired = await phone.pair(code);
  console.log(`[phone] paired as "${paired.name}". Configure the SIMs in Admin → Numbers & phones.`);
  phone.start(1500);

  const rl = readline.createInterface({ input: process.stdin });
  rl.on("line", async (line) => {
    const [cmd, a, b, c] = line.trim().split(/\s+/);
    try {
      if (cmd === "send") await phone.transfer(Number(a), Number(b), c);
      else if (cmd === "silent") phone.sims[Number(a)].balanceMillimes += Number(b);
      else if (cmd === "fakesms") await phone.deliverSms(Number(a), `Vous avez recu ${b} Millimes de la part du numéro ${c}`);
      else if (cmd === "balance") console.log(phone.sims);
      else console.log("commands: send <slot> <millimes> <from> | silent <slot> <millimes> | fakesms <slot> <millimes> <from> | balance");
    } catch (e) {
      console.error(e);
    }
  });
}

if (process.argv[1]?.includes("phone-simulator")) void main();
