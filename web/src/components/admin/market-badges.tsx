import { Badge } from "@/components/ui/badge";
import type { OrderStatus, RechargeStatus } from "@/db/schema";

type Variant = "info" | "success" | "warning" | "error" | "secondary";

const orderMap: Record<OrderStatus, { label: string; variant: Variant }> = {
  funding: { label: "Funding", variant: "info" },
  funded: { label: "Funded · waiting payment", variant: "info" },
  proof_uploaded: { label: "Proof uploaded", variant: "warning" },
  admin_review: { label: "Admin review", variant: "error" },
  released: { label: "Released", variant: "success" },
  cancelled: { label: "Cancelled", variant: "secondary" },
};

export const orderStatusLabel = (s: OrderStatus) => orderMap[s].label;

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const s = orderMap[status];
  return <Badge variant={s.variant}>{s.label}</Badge>;
}

const rechargeMap: Record<RechargeStatus, { label: string; variant: Variant }> = {
  queued: { label: "Queued", variant: "secondary" },
  sending: { label: "Sending", variant: "info" },
  succeeded: { label: "Succeeded", variant: "success" },
  failed: { label: "Failed · refunded", variant: "secondary" },
  review: { label: "Review", variant: "warning" },
};

export function RechargeStatusBadge({ status }: { status: RechargeStatus }) {
  const s = rechargeMap[status];
  return <Badge variant={s.variant}>{s.label}</Badge>;
}

export const rechargeReviewReasons: Record<string, string> = {
  balance_unchanged: "The phone reported a send but the SIM balance did not go down.",
  balance_mismatch: "The SIM balance changed by an unexpected amount after the send.",
  balance_check_failed: "The SIM balance could not be read several times after the send.",
  sim_missing: "The SIM that sent the recharge is no longer available.",
};

export const bucketLabels: Record<string, string> = {
  order: "Order funds",
  seller_stock: "Seller stock",
  buyer: "Buyer balance",
  recharge: "Recharge in progress",
  sarfli: "Sarfli credit",
  external: "Outside (SIM in/out)",
};

/** "0.85" from basis points. */
export const formatPrice = (bps: number) => (bps / 10000).toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
