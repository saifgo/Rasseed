"use client";

import {
  BanIcon,
  CircleCheckBigIcon,
  FileCheckIcon,
  HourglassIcon,
  LoaderIcon,
  type LucideIcon,
  PackageCheckIcon,
  SearchIcon,
  StarIcon,
  XCircleIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import type { OrderStatus, RechargeStatus } from "@/db/schema";
import { cn } from "@/lib/utils";

type Variant = "info" | "success" | "warning" | "error" | "secondary";
type Style = { variant: Variant; icon: LucideIcon; spin?: boolean };

const orderStyles: Record<OrderStatus, Style> = {
  funding: { variant: "info", icon: HourglassIcon },
  funded: { variant: "info", icon: PackageCheckIcon },
  proof_uploaded: { variant: "warning", icon: FileCheckIcon },
  admin_review: { variant: "warning", icon: SearchIcon },
  released: { variant: "success", icon: CircleCheckBigIcon },
  cancelled: { variant: "secondary", icon: BanIcon },
};

const rechargeStyles: Record<RechargeStatus, Style> = {
  queued: { variant: "secondary", icon: HourglassIcon },
  sending: { variant: "info", icon: LoaderIcon, spin: true },
  succeeded: { variant: "success", icon: CircleCheckBigIcon },
  failed: { variant: "error", icon: XCircleIcon },
  review: { variant: "warning", icon: SearchIcon },
};

function StyledBadge({ s, label, className }: { s: Style; label: string; className?: string }) {
  return (
    <Badge variant={s.variant} size="lg" className={cn("gap-1.5 rounded-full px-2.5", className)}>
      <s.icon aria-hidden="true" className={cn("size-3.5", s.spin && "animate-spin")} />
      {label}
    </Badge>
  );
}

export function OrderStatusBadge({ status, className }: { status: OrderStatus; className?: string }) {
  const t = useTranslations("market.orderStatus");
  return <StyledBadge s={orderStyles[status]} label={t(status)} className={className} />;
}

export function RechargeStatusBadge({ status, className }: { status: RechargeStatus; className?: string }) {
  const t = useTranslations("market.rechargeStatus");
  return <StyledBadge s={rechargeStyles[status]} label={t(status)} className={className} />;
}

/** Average stars and number of ratings, e.g. ★ 4.5 (12). */
export function Rating({ rating, className }: { rating: { avg: number; count: number } | null; className?: string }) {
  const t = useTranslations("market");
  if (!rating || rating.count === 0) return <span className={cn("text-muted-foreground text-xs", className)}>{t("noRatings")}</span>;
  return (
    <span className={cn("inline-flex items-center gap-1 text-sm", className)} title={t("ratingTitle", { count: rating.count })}>
      <StarIcon aria-hidden="true" className="size-4 fill-amber-400 text-amber-500" />
      <span dir="ltr" className="font-semibold tabular-nums">
        {rating.avg.toFixed(1)}
      </span>
      <span className="text-muted-foreground text-xs">({t("ratingCount", { count: rating.count })})</span>
    </span>
  );
}
