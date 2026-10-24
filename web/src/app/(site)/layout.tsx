import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { signOut } from "@/auth";
import { LocaleSwitcher } from "@/components/app/locale-switcher";
import { Logo } from "@/components/app/logo";
import { SellerBottomNav, SellerTopNav } from "@/components/app/seller-nav";
import { UserMenu } from "@/components/app/user-menu";
import { InstallButton } from "@/components/pwa/install-button";
import { Button } from "@/components/ui/button";
import { brand } from "@/config/brand";
import { getCurrentUser, isStaff } from "@/lib/session";

export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  const t = await getTranslations();

  async function signOutAction() {
    "use server";
    await signOut({ redirectTo: "/" });
  }

  return (
    <>
      <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-4 px-4">
          <Link href="/" aria-label={brand.name}>
            <Logo />
          </Link>
          {user && <SellerTopNav />}
          <div className="ms-auto flex items-center gap-1">
            <InstallButton />
            <LocaleSwitcher />
            {user ? (
              <UserMenu
                name={user.name}
                email={user.email}
                image={user.image}
                isAdmin={isStaff(user)}
                signOutAction={signOutAction}
              />
            ) : (
              <Button size="sm" render={<Link href="/login" />}>
                {t("common.signIn")}
              </Button>
            )}
          </div>
        </div>
      </header>
      <main className="flex-1 caret-emerald-600 selection:bg-emerald-600/20 selection:text-foreground">{children}</main>
      {user && <SellerBottomNav />}
      <footer className={user ? "border-t pb-20 sm:pb-0" : "border-t"}>
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-6 text-muted-foreground text-sm">
          <span>
            © {new Date().getFullYear()} {brand.name}
          </span>
        </div>
      </footer>
    </>
  );
}
