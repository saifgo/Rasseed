"use client";

import { LanguagesIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Menu, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "@/components/ui/menu";
import { localeNames, locales } from "@/i18n/config";
import { setLocale } from "@/i18n/actions";

export function LocaleSwitcher() {
  const t = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Menu>
      <MenuTrigger render={<Button variant="ghost" size="sm" aria-label={t("language")} disabled={pending} />}>
        <LanguagesIcon aria-hidden="true" />
        <span className="hidden sm:inline">{localeNames[locale as keyof typeof localeNames]}</span>
      </MenuTrigger>
      <MenuPopup align="end">
        <MenuRadioGroup
          value={locale}
          onValueChange={(value) =>
            startTransition(async () => {
              await setLocale(String(value));
              router.refresh();
            })
          }
        >
          {locales.map((l) => (
            <MenuRadioItem key={l} value={l}>
              {localeNames[l]}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuPopup>
    </Menu>
  );
}
