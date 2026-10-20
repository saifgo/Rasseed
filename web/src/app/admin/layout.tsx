import type { Metadata } from "next";
import { AdminSidebar } from "@/components/admin/admin-nav";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { getAdminCounts } from "@/lib/admin-queries";
import { requireStaff } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: { default: "Admin", template: "%s · Admin" } };

// The admin console is English-only and always left-to-right.
// Managers see the operations pages; setup pages and user management are admin-only.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireStaff();
  const counts = await getAdminCounts();
  return (
    <div dir="ltr" lang="en" className="contents">
      <SidebarProvider>
        <AdminSidebar counts={counts} role={user.role} name={user.name ?? user.email ?? ""} />
        <SidebarInset>
          <header className="flex h-12 items-center gap-2 border-b px-4 md:hidden">
            <SidebarTrigger />
          </header>
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 sm:p-6">{children}</div>
        </SidebarInset>
      </SidebarProvider>
    </div>
  );
}
