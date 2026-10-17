"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import type { TxStatus } from "@/db/schema";

const variants: Record<TxStatus, "default" | "info" | "success" | "warning" | "error" | "secondary" | "outline"> = {
  queued: "secondary",
  assigning: "info",
  awaiting_transfer: "info",
  verifying: "info",
  partial: "warning",
  review: "warning",
  confirmed: "success",
  paid: "success",
  expired: "secondary",
  cancelled: "secondary",
  rejected: "error",
};

export function StatusBadge({ status }: { status: TxStatus }) {
  const t = useTranslations("status");
  return <Badge variant={variants[status]}>{t(status)}</Badge>;
}
