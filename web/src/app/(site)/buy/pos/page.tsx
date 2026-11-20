import { ArrowLeftIcon, DownloadIcon, MonitorIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { listPosTerminals, posSpentToday } from "@/lib/engine/pos";
import { requireSpender } from "@/lib/market-queries";
import { DailyLimitForm, NewTerminalForm, TerminalActions } from "./pos-forms";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Shop PCs" };

export default async function PosTerminalsPage() {
  const { user } = await requireSpender();
  const t = await getTranslations("market");
  const format = await getFormatter();
  const terminals = await listPosTerminals(user.id);
  const spent = await Promise.all(terminals.map((pc) => posSpentToday(pc.id)));

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8">
      <Button variant="ghost" className="-ms-2 -mb-2 h-10 self-start text-base text-muted-foreground" render={<Link href="/buy" />}>
        <ArrowLeftIcon aria-hidden="true" className="rtl:rotate-180" />
        {t("buyHome.title")}
      </Button>
      <div className="flex flex-col gap-1">
        <h1 className="font-heading font-bold text-3xl tracking-tight">{t("pos.title")}</h1>
        <p className="text-muted-foreground">{t("pos.subtitle")}</p>
      </div>
      <p className="rounded-xl bg-muted/60 p-3 text-sm">{t("pos.steps")}</p>
      <Button variant="outline" className="h-12 self-start text-base" render={<a href="/downloads/sarfli-pos.exe" download />}>
        <DownloadIcon aria-hidden="true" />
        {t("pos.download")}
      </Button>

      <NewTerminalForm />

      {terminals.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <MonitorIcon aria-hidden="true" className="size-10 text-muted-foreground/60" />
          <p className="text-muted-foreground">{t("pos.none")}</p>
        </div>
      ) : (
        <ul className="flex flex-col divide-y overflow-hidden rounded-2xl border bg-card">
          {terminals.map((pc, i) => (
            <li key={pc.id} className="flex flex-wrap items-center gap-4 p-4">
              <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-muted">
                <MonitorIcon aria-hidden="true" className="size-6 text-muted-foreground" />
              </span>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="font-semibold">{pc.name}</span>
                <span className="text-muted-foreground text-sm">
                  {pc.lastSeenAt
                    ? t("pos.lastSeen", { when: format.relativeTime(pc.lastSeenAt) })
                    : t("pos.neverSeen")}
                  {pc.deviceName && <span dir="ltr"> · {pc.deviceName}</span>}
                </span>
              </div>
              <TerminalActions id={pc.id} name={pc.name} paired={Boolean(pc.tokenHash)} />
              <DailyLimitForm id={pc.id} limitMillimes={pc.dailyLimitMillimes} spentMillimes={spent[i]} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
