import { z } from "zod";
import { commandResult } from "@/lib/engine/device";
import { deviceRoute } from "../_util";

const schema = z.object({
  id: z.string().uuid(),
  ok: z.boolean(),
  response: z.string().max(2000).nullish(),
  error: z.string().max(500).nullish(),
});

export const POST = deviceRoute(schema, async (device, body) => {
  await commandResult(device, body);
  return { ok: true };
});
