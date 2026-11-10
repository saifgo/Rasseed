"use client";

import {
  BanIcon,
  CircleCheckBigIcon,
  ClockIcon,
  HourglassIcon,
  LoaderIcon,
  type LucideIcon,
  SearchIcon,
  SendIcon,
  TriangleAlertIcon,
  XCircleIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import type { TxStatus } from "@/db/schema";
import { cn } from "@/lib/utils";

type Variant = "info" | "success" | "warning" | "error" | "secondary";

const styles: Record<TxStatus, { variant: Variant; icon: LucideIcon; spin?: boolean }> = {
  queued: { variant: "secondary", icon: HourglassIcon },
  assigning: { variant: "info", icon: LoaderIcon, spin: true },
  awaiting_transfer: { variant: "info", icon: SendIcon },
  verifying: { variant: "info", icon: LoaderIcon, spin: true },
  partial: { variant: "warning", icon: TriangleAlertIcon },
  review: { variant: "warning", icon: SearchIcon },
  confirmed: { variant: "success", icon: CircleCheckBigIcon },
  paid: { variant: "success", icon: CircleCheckBigIcon },
  expired: { variant: "secondary", icon: ClockIcon },
  cancelled: { variant: "secondary", icon: BanIcon },
  rejected: { variant: "error", icon: XCircleIcon },
};

/** `toOrder`: the transfer was deposited to a buyer order, so "confirmed" means the order got the credit, not cash. */
export function StatusBadge({ status, toOrder = false, className }: { status: TxStatus; toOrder?: boolean; className?: string }) {
  const t = useTranslations("status");
  const s = styles[status];
  return (
    <Badge variant={s.variant} size="lg" className={cn("gap-1.5 rounded-full px-2.5", className)}>
      <s.icon aria-hidden="true" className={cn("size-3.5", s.spin && "animate-spin")} />
      {toOrder && status === "confirmed" ? t("confirmedToOrder") : t(status)}
    </Badge>
  );
}
