"use client";

import { DownloadIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { useInstallPrompt } from "./install-prompt";

/** Header button; only shown when the browser says the app can be installed. */
export function InstallButton() {
  const t = useTranslations("common");
  const install = useInstallPrompt();
  if (!install) return null;
  return (
    <Button variant="ghost" size="sm" onClick={() => void install()} aria-label={t("installApp")}>
      <DownloadIcon aria-hidden="true" />
      <span className="hidden sm:inline">{t("installApp")}</span>
    </Button>
  );
}

/** Plain text link variant for pages with their own styling (the landing page). */
export function InstallLink({ className }: { className?: string }) {
  const t = useTranslations("common");
  const install = useInstallPrompt();
  if (!install) return null;
  return (
    <button type="button" className={className} onClick={() => void install()}>
      <DownloadIcon aria-hidden="true" className="size-[1.1em]" />
      {t("installApp")}
    </button>
  );
}
