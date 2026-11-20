import { NextResponse } from "next/server";
import { z } from "zod";
import { EngineError } from "@/lib/engine/core";
import { pairPosTerminal } from "@/lib/engine/pos";
import { hit } from "@/lib/rate-limit";
import { clientIp } from "../../../device/_util";

const schema = z.object({ code: z.string().regex(/^\d{6}$/), deviceName: z.string().max(100).nullish() });

// Unauthenticated on purpose: the short-lived pairing code is the credential. Attempts are limited
// per IP and overall so the 6-digit code cannot be guessed within its 10 minutes.
export async function POST(req: Request) {
  const ip = clientIp(req) ?? "unknown";
  if (!hit(`pos-pair:${ip}`, 10, 10 * 60_000) || !hit("pos-pair:all", 200, 10 * 60_000)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  try {
    return NextResponse.json(await pairPosTerminal(parsed.data.code, parsed.data.deviceName ?? null));
  } catch (e) {
    if (e instanceof EngineError) return NextResponse.json({ error: e.code }, { status: 409 });
    console.error("[pos pair]", e);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
