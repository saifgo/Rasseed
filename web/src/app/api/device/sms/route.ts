import { z } from "zod";
import { ingestSms } from "@/lib/engine/device";
import { deviceRoute } from "../_util";

const schema = z.object({
  messages: z
    .array(
      z.object({
        localId: z.string().min(1).max(100),
        subscriptionId: z.number().int().nullish(),
        slotIndex: z.number().int().nullish(),
        from: z.string().max(64),
        body: z.string().max(5000),
        sentAt: z.number().int().nullish(),
        receivedAt: z.number().int().nullish(),
      }),
    )
    .max(100),
});

export const POST = deviceRoute(schema, async (device, body) => ({ accepted: await ingestSms(device, body.messages) }));
