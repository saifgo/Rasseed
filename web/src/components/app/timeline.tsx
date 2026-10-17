"use client";

import { useFormatter, useTranslations } from "next-intl";
import { formatDinars } from "@/lib/money";
import { formatMsisdn } from "@/lib/phone";
import { cn } from "@/lib/utils";

export type TimelineEvent = {
  id: string;
  type: string;
  actor: string;
  data: Record<string, unknown>;
  internal: boolean;
  createdAt: string;
};

const tone: Record<string, string> = {
  confirmed: "bg-success",
  paid: "bg-success",
  credit_confirmed: "bg-success",
  admin_confirmed: "bg-success",
  partial: "bg-warning",
  review: "bg-warning",
  late_credit: "bg-warning",
  rejected: "bg-destructive",
  expired: "bg-muted-foreground",
  cancelled: "bg-muted-foreground",
};

function params(data: Record<string, unknown>) {
  const dt = (k: string) => (typeof data[k] === "number" ? formatDinars(data[k] as number) : "");
  return {
    amount: dt("amountMillimes"),
    missing: dt("missingMillimes"),
    net: dt("netMillimes"),
    msisdn: typeof data.msisdn === "string" ? formatMsisdn(data.msisdn) : "",
  };
}

/** Seller-facing timeline. With `showInternal`, also lists raw internal events (admin view). */
export function Timeline({ events, showInternal = false }: { events: TimelineEvent[]; showInternal?: boolean }) {
  const t = useTranslations("events");
  const format = useFormatter();
  const visible = events.filter((e) => showInternal || (!e.internal && t.has(e.type)));
  return (
    <ol className="flex flex-col gap-4">
      {visible
        .slice()
        .reverse()
        .map((e) => (
          <li key={e.id} className="flex gap-3">
            <span
              aria-hidden="true"
              className={cn("mt-1.5 size-2 shrink-0 rounded-full", tone[e.type] ?? (e.internal ? "bg-border" : "bg-info"))}
            />
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className={cn("text-sm", e.internal && "text-muted-foreground")}>
                {t.has(e.type) ? t(e.type, params(e.data)) : e.type}
                {showInternal && (
                  <span className="ms-2 font-mono text-muted-foreground text-xs">
                    {e.actor}
                    {e.internal ? " · internal" : ""}
                  </span>
                )}
              </span>
              {showInternal && Object.keys(e.data).length > 0 && (
                <code className="break-all text-muted-foreground text-xs">{JSON.stringify(e.data)}</code>
              )}
              <time className="text-muted-foreground text-xs" dateTime={e.createdAt}>
                {format.dateTime(new Date(e.createdAt), { dateStyle: "medium", timeStyle: "medium" })}
              </time>
            </div>
          </li>
        ))}
    </ol>
  );
}
