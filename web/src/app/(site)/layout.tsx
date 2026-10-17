import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { signOut } from "@/auth";
import { LocaleSwitcher } from "@/components/app/locale-switcher";
import { Logo } from "@/components/app/logo";
import { UserMenu } from "@/components/app/user-menu";
import { Button } from "@/components/ui/button";
import { brand } from "@/config/brand";
import { getCurrentUser } from "@/lib/session";

export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  const t = await getTranslations();
  const locale = (await getLocale()) as keyof typeof brand.tagline;

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
          {user && (
            <nav className="hidden items-center gap-1 sm:flex">
              <Button variant="ghost" size="sm" render={<Link href="/sell" />}>
                {t("nav.sell")}
              </Button>
              <Button variant="ghost" size="sm" render={<Link href="/sales" />}>
                {t("nav.mySales")}
              </Button>
            </nav>
          )}
          <div className="ms-auto flex items-center gap-1">
            <LocaleSwitcher />
            {user ? (
              <UserMenu
                name={user.name}
                email={user.email}
                image={user.image}
                isAdmin={user.role === "admin"}
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
      <main className="flex-1">{children}</main>
      <footer className="border-t">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-6 text-muted-foreground text-sm">
          <span>
            © {new Date().getFullYear()} {brand.name}
          </span>
          <span>{brand.tagline[locale]}</span>
        </div>
      </footer>
    </>
  );
}
