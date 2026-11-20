import { cancelRecharge, getBuyerRecharge } from "@/lib/engine/recharge";
import { posRoute, publicRecharge } from "../../../_util";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const POST = posRoute<{ id: string }, null>(null, async ({ user }, _body, { id }) => {
  if (!UUID.test(id)) return null;
  await cancelRecharge(user.id, id);
  const r = await getBuyerRecharge(user.id, id);
  return r && { recharge: publicRecharge(r) };
});
