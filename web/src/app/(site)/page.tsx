import { ArrowRightIcon, CheckCircle2Icon, SendIcon, ShieldCheckIcon, SmartphoneIcon, WalletIcon } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Dt } from "@/components/app/money";
import { OperatorName } from "@/components/app/operator-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardPanel, CardTitle } from "@/components/ui/card";
import { formatDinars, formatRate } from "@/lib/money";
import { listOperators } from "@/lib/queries";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const t = await getTranslations("home");
  const user = await getCurrentUser();
  const ops = (await listOperators()).filter((o) => o.active);
  const ctaHref = user ? "/sell" : "/login";

  const steps = [
    { icon: SmartphoneIcon, title: t("step1Title"), text: t("step1Text") },
    { icon: SendIcon, title: t("step2Title"), text: t("step2Text") },
    { icon: WalletIcon, title: t("step3Title"), text: t("step3Text") },
  ];

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-16 px-4 py-12 sm:py-20">
      <section className="flex flex-col items-start gap-6">
        <Badge variant="outline" size="lg">
          {t("badge")}
        </Badge>
        <h1 className="max-w-2xl text-balance font-heading font-semibold text-4xl tracking-tight sm:text-5xl">{t("title")}</h1>
        <p className="max-w-xl text-pretty text-lg text-muted-foreground">{t("subtitle")}</p>
        <Button size="xl" render={<Link href={ctaHref} />}>
          {t("cta")}
          <ArrowRightIcon aria-hidden="true" className="rtl:rotate-180" />
        </Button>
      </section>

      <section className="flex flex-col gap-4" aria-labelledby="rates-title">
        <div className="flex flex-col gap-1">
          <h2 id="rates-title" className="font-heading font-semibold text-xl">
            {t("ratesTitle")}
          </h2>
          <p className="text-muted-foreground text-sm">{t("ratesHint")}</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          {ops.map((op) => (
            <Card key={op.code}>
              <CardHeader>
                <CardDescription>
                  <OperatorName name={op.name} color={op.color} />
                </CardDescription>
                <CardTitle className="flex items-baseline gap-2 text-3xl">
                  <Dt millimes={Math.floor(op.rateBps / 10)} />
                </CardTitle>
              </CardHeader>
              <CardPanel className="text-muted-foreground text-sm">
                {formatRate(op.rateBps)} · {t("youGet", { amount: formatDinars(Math.floor(op.rateBps / 10)) })}
              </CardPanel>
            </Card>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-6" aria-labelledby="how-title">
        <h2 id="how-title" className="font-heading font-semibold text-xl">
          {t("howTitle")}
        </h2>
        <ol className="grid gap-4 sm:grid-cols-3">
          {steps.map((s, i) => (
            <li key={s.title} className="flex flex-col gap-3 rounded-xl border p-5">
              <div className="flex items-center gap-3">
                <span className="flex size-9 items-center justify-center rounded-lg bg-muted">
                  <s.icon aria-hidden="true" className="size-4.5" />
                </span>
                <span className="font-mono text-muted-foreground text-sm">0{i + 1}</span>
              </div>
              <h3 className="font-medium">{s.title}</h3>
              <p className="text-muted-foreground text-sm">{s.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="flex flex-col gap-3 rounded-2xl border bg-muted/50 p-6 sm:flex-row sm:items-center sm:gap-6">
        <ShieldCheckIcon aria-hidden="true" className="size-10 shrink-0 text-success" />
        <div className="flex flex-col gap-1">
          <h2 className="flex items-center gap-2 font-medium">
            {t("trustTitle")}
            <CheckCircle2Icon aria-hidden="true" className="size-4 text-success" />
          </h2>
          <p className="text-muted-foreground text-sm">{t("trustText")}</p>
        </div>
      </section>
    </div>
  );
}
