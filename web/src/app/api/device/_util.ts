import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateDevice } from "@/lib/engine/device";
import { EngineError } from "@/lib/engine/core";

type Device = NonNullable<Awaited<ReturnType<typeof authenticateDevice>>>;

/** Wraps a device endpoint: bearer-token auth, JSON body validation and uniform errors. */
export function deviceRoute<S extends z.ZodTypeAny>(schema: S, handler: (device: Device, body: z.infer<S>, req: Request) => Promise<unknown>) {
  return async (req: Request) => {
    const device = await authenticateDevice(req.headers.get("authorization"));
    if (!device) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "bad_request", issues: parsed.error.issues }, { status: 400 });
    try {
      return NextResponse.json(await handler(device, parsed.data, req));
    } catch (e) {
      if (e instanceof EngineError) return NextResponse.json({ error: e.code }, { status: 409 });
      console.error("[device api]", e);
      return NextResponse.json({ error: "server_error" }, { status: 500 });
    }
  };
}

export function clientIp(req: Request) {
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? req.headers.get("x-real-ip") ?? null;
}
