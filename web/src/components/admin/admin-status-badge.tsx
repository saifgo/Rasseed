import { Badge } from "@/components/ui/badge";
import type { TxStatus } from "@/db/schema";

const map: Record<TxStatus, { label: string; variant: "info" | "success" | "warning" | "error" | "secondary" }> = {
  queued: { label: "Queued", variant: "secondary" },
  assigning: { label: "Assigning", variant: "info" },
  awaiting_transfer: { label: "Awaiting transfer", variant: "info" },
  verifying: { label: "Verifying", variant: "info" },
  partial: { label: "Partial", variant: "warning" },
  review: { label: "Review", variant: "warning" },
  confirmed: { label: "Confirmed · credited", variant: "success" },
  paid: { label: "Paid (legacy)", variant: "success" },
  expired: { label: "Expired", variant: "secondary" },
  cancelled: { label: "Cancelled", variant: "secondary" },
  rejected: { label: "Rejected", variant: "error" },
};

export function AdminStatusBadge({ status }: { status: TxStatus }) {
  const s = map[status];
  return <Badge variant={s.variant}>{s.label}</Badge>;
}

export const reviewReasons: Record<string, string> = {
  balance_without_sms: "Balance increased but no matching operator SMS arrived.",
  sms_not_in_balance: "An SMS announced a credit that the balance does not show (possible fake SMS).",
  balance_check_failed: "The balance could not be read several times in a row.",
  sim_changed: "The SIM card in the slot changed while the sale was active.",
};
