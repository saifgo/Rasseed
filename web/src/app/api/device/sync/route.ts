import { z } from "zod";
import { syncDevice } from "@/lib/engine/device";
import { clientIp, deviceRoute } from "../_util";

const schema = z.object({
  sims: z
    .array(z.object({ slotIndex: z.number().int().min(0).max(7), subscriptionId: z.number().int(), carrierName: z.string().max(64).nullish() }))
    .max(8),
  batteryPct: z.number().int().min(0).max(100).optional(),
  charging: z.boolean().optional(),
  model: z.string().max(100).optional(),
  androidVersion: z.string().max(20).optional(),
  appVersion: z.string().max(20).optional(),
});

export const POST = deviceRoute(schema, (device, body, req) => syncDevice(device, body, clientIp(req)));
