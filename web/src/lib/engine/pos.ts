import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, gt, isNull, ne, sql } from "drizzle-orm";
import { db, type DbTx } from "@/db";
import { posTerminals, recharges, users } from "@/db/schema";
import { EngineError } from "./core";
import { canSpend } from "./sarfli-credit";

/**
 * Windows POS terminals. The buyer names a terminal on the web and gets a 6-digit code (10 minutes);
 * the POS exchanges it for a long-lived bearer token. The buyer can revoke a terminal at any time.
 */

export type PosTerminal = typeof posTerminals.$inferSelect;

const MAX_TERMINALS = 20;
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
const newCode = () => String(100000 + (randomBytes(4).readUInt32BE() % 900000));

/** Creates a terminal waiting to be paired, or a fresh code for an existing one (pairing again replaces its token). */
export async function createPosPairing(userId: string, input: { name?: string; terminalId?: string }) {
  const expires = new Date(Date.now() + 10 * 60 * 1000);
  // Codes are short: retry on the rare clash with another live code.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = newCode();
    const [clash] = await db
      .select({ id: posTerminals.id })
      .from(posTerminals)
      .where(and(eq(posTerminals.pairingCode, code), gt(posTerminals.pairingExpiresAt, new Date())));
    if (clash) continue;
    if (input.terminalId) {
      const rows = await db
        .update(posTerminals)
        .set({ pairingCode: code, pairingExpiresAt: expires })
        .where(and(eq(posTerminals.id, input.terminalId), eq(posTerminals.userId, userId), isNull(posTerminals.revokedAt)))
        .returning({ id: posTerminals.id });
      if (rows.length === 0) throw new EngineError("not_found");
      return { terminalId: input.terminalId, code, expiresAt: expires };
    }
    const name = input.name?.trim().slice(0, 60);
    if (!name) throw new EngineError("name_required");
    const live = await db
      .select({ id: posTerminals.id })
      .from(posTerminals)
      .where(and(eq(posTerminals.userId, userId), isNull(posTerminals.revokedAt)));
    if (live.length >= MAX_TERMINALS) throw new EngineError("too_many_terminals");
    const [row] = await db
      .insert(posTerminals)
      .values({ userId, name, pairingCode: code, pairingExpiresAt: expires })
      .returning({ id: posTerminals.id });
    return { terminalId: row.id, code, expiresAt: expires };
  }
  throw new EngineError("try_again");
}

export async function pairPosTerminal(code: string, deviceName: string | null) {
  const token = "pos_" + randomBytes(32).toString("base64url");
  // Single statement: two POS sending the same code cannot both get a token.
  const [terminal] = await db
    .update(posTerminals)
    .set({
      tokenHash: hashToken(token),
      pairingCode: null,
      pairingExpiresAt: null,
      deviceName: deviceName?.trim().slice(0, 100) || null,
    })
    .where(and(eq(posTerminals.pairingCode, code), gt(posTerminals.pairingExpiresAt, new Date()), isNull(posTerminals.revokedAt)))
    .returning();
  if (!terminal) throw new EngineError("invalid_code");
  return { token, terminal: { id: terminal.id, name: terminal.name } };
}

/** Terminal + its owner for a bearer token, or null (unknown, revoked, or the owner lost marketplace access). */
export async function authenticatePos(authorization: string | null, ip: string | null) {
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7).trim() : null;
  if (!token || !token.startsWith("pos_")) return null;
  const [row] = await db
    .select({ terminal: posTerminals, user: users })
    .from(posTerminals)
    .innerJoin(users, eq(users.id, posTerminals.userId))
    .where(and(eq(posTerminals.tokenHash, hashToken(token)), isNull(posTerminals.revokedAt)));
  if (!row) return null;
  if (!(await canSpend(row.user))) return null;
  // Heartbeat at most once a minute, to keep writes low.
  if (!row.terminal.lastSeenAt || Date.now() - row.terminal.lastSeenAt.getTime() > 60_000) {
    await db.update(posTerminals).set({ lastSeenAt: new Date(), lastIp: ip }).where(eq(posTerminals.id, row.terminal.id));
  }
  return row;
}

export async function revokePosTerminal(userId: string, terminalId: string) {
  const rows = await db
    .update(posTerminals)
    .set({ revokedAt: new Date(), tokenHash: null, pairingCode: null, pairingExpiresAt: null })
    .where(and(eq(posTerminals.id, terminalId), eq(posTerminals.userId, userId), isNull(posTerminals.revokedAt)))
    .returning({ id: posTerminals.id });
  if (rows.length === 0) throw new EngineError("not_found");
}

export async function listPosTerminals(userId: string) {
  return db
    .select()
    .from(posTerminals)
    .where(and(eq(posTerminals.userId, userId), isNull(posTerminals.revokedAt)))
    .orderBy(desc(posTerminals.createdAt));
}

/** Midnight today in Tunisia, when POS daily limits start again. */
const tunisDayStart = sql`(date_trunc('day', now() at time zone 'Africa/Tunis') at time zone 'Africa/Tunis')`;

/**
 * What a POS terminal spent today (Tunisia time): recharges and packages that are waiting, sending, sent
 * or in review. Failed and cancelled ones were refunded, so they do not count.
 */
export async function posSpentToday(terminalId: string, t: DbTx | typeof db = db) {
  const [row] = await t
    .select({ total: sql<string>`coalesce(sum(${recharges.amountMillimes}), 0)` })
    .from(recharges)
    .where(and(eq(recharges.posTerminalId, terminalId), ne(recharges.status, "failed"), sql`${recharges.createdAt} >= ${tunisDayStart}`));
  return Number(row?.total ?? 0);
}

/** The owner sets (or clears, with null) how much this PC may spend per day. */
export async function setPosDailyLimit(userId: string, terminalId: string, limitMillimes: number | null) {
  if (limitMillimes !== null && (!Number.isInteger(limitMillimes) || limitMillimes <= 0 || limitMillimes > 100_000_000)) {
    throw new EngineError("invalid_amount");
  }
  const rows = await db
    .update(posTerminals)
    .set({ dailyLimitMillimes: limitMillimes })
    .where(and(eq(posTerminals.id, terminalId), eq(posTerminals.userId, userId), isNull(posTerminals.revokedAt)))
    .returning({ id: posTerminals.id });
  if (rows.length === 0) throw new EngineError("not_found");
}
