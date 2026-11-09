"use client";

import {
  ArrowLeftIcon,
  BanknoteIcon,
  CalendarCheckIcon,
  CoinsIcon,
  GaugeIcon,
  ListChecksIcon,
  PercentIcon,
  ReceiptTextIcon,
  SettingsIcon,
  SmartphoneIcon,
  UsersIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ConfidentialToggle, Secret } from "@/components/app/confidential";
import { Logo } from "@/components/app/logo";
import { Badge } from "@/components/ui/badge";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import type { UserRole } from "@/db/schema";

export type AdminCounts = { review: number; withdrawals: number; credits: number; numbersAlert: number };

type Item = { href: string; label: string; icon: typeof GaugeIcon; exact?: boolean; count?: keyof AdminCounts };

const operations: Item[] = [
  { href: "/admin", label: "Overview", icon: GaugeIcon, exact: true },
  { href: "/admin/review", label: "Review queue", icon: ListChecksIcon, count: "review" },
  { href: "/admin/withdrawals", label: "Withdrawals", icon: BanknoteIcon, count: "withdrawals" },
  { href: "/admin/sales", label: "All sales", icon: ReceiptTextIcon },
  { href: "/admin/credits", label: "Unmatched credits", icon: CoinsIcon, count: "credits" },
  { href: "/admin/users", label: "Sellers & balances", icon: UsersIcon },
  { href: "/admin/closing", label: "Day closing", icon: CalendarCheckIcon },
];

// Admin only.
const setup: Item[] = [
  { href: "/admin/numbers", label: "Numbers & phones", icon: SmartphoneIcon, count: "numbersAlert" },
  { href: "/admin/operators", label: "Operators & rates", icon: PercentIcon },
  { href: "/admin/settings", label: "Settings", icon: SettingsIcon },
];

export function AdminSidebar({ counts, role, name }: { counts: AdminCounts; role: UserRole; name: string }) {
  const pathname = usePathname();
  const groups = role === "admin" ? [{ label: "Operations", items: operations }, { label: "Setup", items: setup }] : [{ label: "Operations", items: operations }];
  return (
    <Sidebar>
      <SidebarHeader className="flex-row items-center justify-between px-4 py-3">
        <Link href="/admin">
          <Logo />
        </Link>
        <ConfidentialToggle className="hidden md:inline-flex" showLabel="Show numbers" hideLabel="Hide numbers" />
      </SidebarHeader>
      <SidebarContent>
        {groups.map((g) => (
          <SidebarGroup key={g.label}>
            <SidebarGroupLabel>{g.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {g.items.map((item) => {
                  const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
                  const n = item.count ? counts[item.count] : 0;
                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton isActive={active} render={<Link href={item.href} />}>
                        <item.icon aria-hidden="true" />
                        <span>{item.label}</span>
                      </SidebarMenuButton>
                      {n > 0 && <SidebarMenuBadge><Secret>{n}</Secret></SidebarMenuBadge>}
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter>
        <div className="flex items-center justify-between gap-2 px-2 py-1 text-xs">
          <span className="truncate text-muted-foreground" title={name}>
            {name}
          </span>
          <Badge variant={role === "admin" ? "default" : "info"}>{role}</Badge>
        </div>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton render={<Link href="/" />}>
              <ArrowLeftIcon aria-hidden="true" />
              <span>Back to site</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
