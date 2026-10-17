import { NextResponse } from "next/server";
import { z } from "zod";
import { EngineError } from "@/lib/engine/core";
import { pairDevice } from "@/lib/engine/device";

const schema = z.object({ code: z.string().regex(/^\d{6}$/) });

// Unauthenticated on purpose: the short-lived pairing code is the credential.
export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  try {
    return NextResponse.json(await pairDevice(parsed.data.code));
  } catch (e) {
    if (e instanceof EngineError) return NextResponse.json({ error: e.code }, { status: 400 });
    throw e;
  }
}
