import { NextResponse } from "next/server";
import type { z } from "zod";
import { recharges } from "@/db/schema";
import { EngineError } from "@/lib/engine/core";
import { authenticatePos } from "@/lib/engine/pos";
import { NUMBER_NOT_COMPATIBLE } from "@/lib/recharge-outcome";
import { clientIp } from "../../device/_util";

export type PosAuth = NonNullable<Awaited<ReturnType<typeof authenticatePos>>>;
type Ctx<P> = { params: Promise<P> };

/** Wraps a POS endpoint: bearer-token auth, optional JSON body validation and uniform errors. */
export function posRoute<P, S extends z.ZodTypeAny | null>(
  schema: S,
  handler: (auth: PosAuth, body: S extends z.ZodTypeAny ? z.infer<S> : null, params: P, req: Request) => Promise<unknown>,
) {
  return async (req: Request, ctx: Ctx<P>) => {
    const auth = await authenticatePos(req.headers.get("authorization"), clientIp(req));
    if (!auth) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    let body = null;
    if (schema) {
      const parsed = schema.safeParse(await req.json().catch(() => null));
      if (!parsed.success) return NextResponse.json({ error: "bad_request", issues: parsed.error.issues }, { status: 400 });
      body = parsed.data;
    }
    try {
      const result = await handler(auth, body as never, await ctx.params, req);
      if (result === null) return NextResponse.json({ error: "not_found" }, { status: 404 });
      return NextResponse.json(result);
    } catch (e) {
      if (e instanceof EngineError) {
        return NextResponse.json({ error: e.code }, { status: e.code === "not_found" ? 404 : 409 });
      }
      console.error("[pos api]", e);
      return NextResponse.json({ error: "server_error" }, { status: 500 });
    }
  };
}

/** The recharge as the POS sees it (no SIM, balance or review internals). */
export function publicRecharge(r: typeof recharges.$inferSelect) {
  return {
    id: r.id,
    ref: r.ref,
    operatorCode: r.operatorCode,
    msisdn: r.msisdn,
    amountMillimes: r.amountMillimes,
    packageName: r.packageName,
    // A recharge the buyer cancelled before it was sent is stored as failed + note "cancelled".
    status: r.status === "failed" && r.note === "cancelled" ? "cancelled" : r.status,
    // Why a failed recharge failed, when the buyer should know: "number_not_compatible" or null.
    failReason: r.status === "failed" && r.note === NUMBER_NOT_COMPATIBLE ? NUMBER_NOT_COMPATIBLE : null,
    createdAt: r.createdAt.toISOString(),
    completedAt: r.completedAt?.toISOString() ?? null,
  };
}
