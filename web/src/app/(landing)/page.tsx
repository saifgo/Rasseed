import { ArrowRightIcon, ShieldCheckIcon } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Dt } from "@/components/app/money";
import { OperatorLogo } from "@/components/app/operator-badge";
import { Button } from "@/components/ui/button";
import { grossPayout } from "@/lib/money";
import { listOperators } from "@/lib/queries";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

const EXAMPLE_MILLIMES = 10_000;

export default async function HomePage() {
  const t = await getTranslations("home");
  const user = await getCurrentUser();
  const ops = (await listOperators()).filter((o) => o.active);
  const sellHref = (op?: string) => {
    const target = op ? `/sell?op=${op}` : "/sell";
    return user ? target : `/login?callbackUrl=${encodeURIComponent(target)}`;
  };

  const steps = [
    { title: t("step1Title"), text: t("step1Text") },
    { title: t("step2Title"), text: t("step2Text") },
    { title: t("step3Title"), text: t("step3Text") },
  ];

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-16 px-4 py-12 sm:py-20">
      <section className="flex flex-col items-start gap-5">
        <h1 className="max-w-2xl text-balance font-heading font-bold text-4xl tracking-tight sm:text-6xl">{t("title")}</h1>
        <p className="max-w-xl text-pretty text-lg text-muted-foreground">{t("subtitle")}</p>
        <Button variant="go" className="mt-2 h-14 w-full px-7 text-lg sm:h-14 sm:w-auto sm:text-lg" render={<Link href={sellHref()} />}>
          {t("cta")}
          <ArrowRightIcon aria-hidden="true" className="size-5 rtl:rotate-180" />
        </Button>
      </section>

      <section className="flex flex-col gap-5" aria-labelledby="rates-title">
        <div className="flex flex-col gap-1">
          <h2 id="rates-title" className="font-heading font-bold text-2xl">
            {t("ratesTitle")}
          </h2>
          <p className="text-muted-foreground">{t("ratesLine", { amount: "10" })}</p>
        </div>
        <ul className="flex flex-col divide-y overflow-hidden rounded-2xl border bg-card">
          {ops.map((op) => (
            <li key={op.code}>
              <Link href={sellHref(op.code)} className="flex items-center gap-4 p-4 transition-colors hover:bg-accent/60 sm:p-5">
                <OperatorLogo code={op.code} name={op.name} color={op.color} className="size-14 rounded-2xl" />
                <span className="min-w-0 flex-1 font-heading font-semibold text-lg leading-tight">{op.name}</span>
                <Dt compact millimes={grossPayout(EXAMPLE_MILLIMES, op.rateBps)} className="font-bold text-2xl sm:text-3xl" />
                <span
                  className="hidden h-10 items-center gap-1.5 rounded-xl px-4 font-semibold text-sm text-white sm:inline-flex"
                  style={{ backgroundColor: op.color }}
                >
                  {t("sell")}
                  <ArrowRightIcon aria-hidden="true" className="size-4 rtl:rotate-180" />
                </span>
                <span
                  aria-hidden="true"
                  className="flex size-9 shrink-0 items-center justify-center rounded-full text-white sm:hidden"
                  style={{ backgroundColor: op.color }}
                >
                  <ArrowRightIcon className="size-4.5 rtl:rotate-180" />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-8" aria-labelledby="how-title">
        <h2 id="how-title" className="font-heading font-bold text-2xl">
          {t("howTitle")}
        </h2>
        <ol className="grid gap-8 sm:grid-cols-3 sm:gap-6">
          {steps.map((s, i) => (
            <li key={s.title} className="flex gap-4 sm:flex-col sm:gap-3">
              <span className="font-heading font-bold text-4xl text-muted-foreground/50 leading-none tabular-nums" aria-hidden="true">
                {i + 1}
              </span>
              <div className="flex flex-col gap-1">
                <h3 className="font-semibold text-lg leading-snug">{s.title}</h3>
                <p className="text-muted-foreground">{s.text}</p>
              </div>
            </li>
          ))}
        </ol>
        <p className="flex items-start gap-3 border-t pt-6 text-muted-foreground">
          <ShieldCheckIcon aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-foreground" />
          <span>
            <span className="font-semibold text-foreground">{t("trustTitle")}.</span> {t("trustText")}
          </span>
        </p>
      </section>
    </div>
  );
}
