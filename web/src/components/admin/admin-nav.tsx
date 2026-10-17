"use client";

import {
  ArrowLeftIcon,
  BanknoteIcon,
  CoinsIcon,
  GaugeIcon,
  ListChecksIcon,
  PercentIcon,
  ReceiptTextIcon,
  SettingsIcon,
  SmartphoneIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/app/logo";
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

export type AdminCounts = { review: number; payouts: number; credits: number; numbersAlert: number };

const groups = [
  {
    label: "Operations",
    items: [
      { href: "/admin", label: "Overview", icon: GaugeIcon, exact: true },
      { href: "/admin/review", label: "Review queue", icon: ListChecksIcon, count: "review" as const },
      { href: "/admin/payouts", label: "Payouts", icon: BanknoteIcon, count: "payouts" as const },
      { href: "/admin/sales", label: "All sales", icon: ReceiptTextIcon },
      { href: "/admin/credits", label: "Unmatched credits", icon: CoinsIcon, count: "credits" as const },
    ],
  },
  {
    label: "Setup",
    items: [
      { href: "/admin/numbers", label: "Numbers & phones", icon: SmartphoneIcon, count: "numbersAlert" as const },
      { href: "/admin/operators", label: "Operators & rates", icon: PercentIcon },
      { href: "/admin/settings", label: "Settings", icon: SettingsIcon },
    ],
  },
];

export function AdminSidebar({ counts }: { counts: AdminCounts }) {
  const pathname = usePathname();
  return (
    <Sidebar>
      <SidebarHeader className="px-4 py-3">
        <Link href="/admin">
          <Logo />
        </Link>
      </SidebarHeader>
      <SidebarContent>
        {groups.map((g) => (
          <SidebarGroup key={g.label}>
            <SidebarGroupLabel>{g.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {g.items.map((item) => {
                  const active = "exact" in item && item.exact ? pathname === item.href : pathname.startsWith(item.href);
                  const n = "count" in item && item.count ? counts[item.count] : 0;
                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton isActive={active} render={<Link href={item.href} />}>
                        <item.icon aria-hidden="true" />
                        <span>{item.label}</span>
                      </SidebarMenuButton>
                      {n > 0 && <SidebarMenuBadge>{n}</SidebarMenuBadge>}
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter>
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
