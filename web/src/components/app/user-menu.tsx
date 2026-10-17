"use client";

import { LogOutIcon, ReceiptTextIcon, ShieldIcon } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Menu, MenuGroup, MenuGroupLabel, MenuItem, MenuLinkItem, MenuPopup, MenuSeparator, MenuTrigger } from "@/components/ui/menu";

type Props = { name: string | null; email: string | null; image: string | null; isAdmin: boolean; signOutAction: () => Promise<void> };

export function UserMenu({ name, email, image, isAdmin, signOutAction }: Props) {
  const t = useTranslations();
  const initials = (name ?? email ?? "?").slice(0, 2).toUpperCase();
  return (
    <Menu>
      <MenuTrigger render={<Button variant="ghost" size="icon" aria-label={name ?? email ?? "Account"} className="rounded-full" />}>
        <Avatar className="size-7">
          {image && <AvatarImage src={image} alt="" />}
          <AvatarFallback className="text-xs">{initials}</AvatarFallback>
        </Avatar>
      </MenuTrigger>
      <MenuPopup align="end" className="min-w-56">
        <MenuGroup>
          <MenuGroupLabel>
            <span className="block truncate font-medium text-foreground">{name}</span>
            <span className="block truncate font-normal">{email}</span>
          </MenuGroupLabel>
        </MenuGroup>
        <MenuSeparator />
        <MenuLinkItem render={<Link href="/sales" />}>
          <ReceiptTextIcon aria-hidden="true" />
          {t("nav.mySales")}
        </MenuLinkItem>
        {isAdmin && (
          <MenuLinkItem render={<Link href="/admin" />}>
            <ShieldIcon aria-hidden="true" />
            {t("common.admin")}
          </MenuLinkItem>
        )}
        <MenuSeparator />
        <MenuItem closeOnClick onClick={() => void signOutAction()}>
          <LogOutIcon aria-hidden="true" />
          {t("common.signOut")}
        </MenuItem>
      </MenuPopup>
    </Menu>
  );
}
