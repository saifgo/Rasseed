import Image from "next/image";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { ChapterHeader } from "@/components/landing/chapter-header";
import { FittedName } from "@/components/landing/fitted-name";
import { LandingMotion } from "@/components/landing/landing-motion";
import { NUMBER_MASK } from "@/components/landing/number-mask";
import { RateTicket, type TicketOperator } from "@/components/landing/rate-ticket";
import { OperatorLogo } from "@/components/app/operator-badge";
import { InstallLink } from "@/components/pwa/install-button";
import { brand } from "@/config/brand";
import { formatDt, formatPercent, grossPayout } from "@/lib/money";
import { listOperators, listPayoutMethods } from "@/lib/queries";
import { getCurrentUser } from "@/lib/session";
import { getSettings } from "@/lib/settings";
import notes10 from "../../../public/landing/10-dinars.jpg";
import notes5 from "../../../public/landing/5-dinars.jpg";
import coins from "../../../public/landing/coins.jpg";
import laPoste from "../../../public/landing/la-poste.jpg";
import taxiphone from "../../../public/landing/taxiphone.jpg";

export const dynamic = "force-dynamic";

/** Picks black or white text for a flat operator colour. */
function inkFor(hex: string) {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return (1.05 / (lum + 0.05)) >= 4.5 ? "#ffffff" : "#111111";
}

const PAYOUT_LOGOS: Record<string, string> = { d17: "/payout/d17.png", flouci: "/payout/flouci.svg" };

const CREDITS = [
  { title: "10 Dinars TND Tawhida Ben Cheikh", by: "DrRachT", licence: "CC BY-SA 4.0", href: "https://commons.wikimedia.org/w/index.php?curid=122516725" },
  { title: "5 Dinars, Aqueducs de Zaghouan", by: "DrRachT", licence: "CC BY-SA 4.0", href: "https://commons.wikimedia.org/w/index.php?curid=122516726" },
  { title: "Plaque montrant un Taxiphone", by: "Sami Mlouhi", licence: "CC BY-SA 4.0", href: "https://commons.wikimedia.org/w/index.php?curid=50384136" },
  { title: "File d’attente, La Poste tunisienne, Sayada", by: "Habib M’henni", licence: "CC BY-SA 4.0", href: "https://commons.wikimedia.org/w/index.php?curid=61969825" },
  { title: "Tunisian Dinars", by: "josbert.lonnee", licence: "public domain", href: "https://www.flickr.com/photos/98552965@N05/27209936693" },
];

export default async function HomePage() {
  const [t, locale, user, allOps, methods, settings] = await Promise.all([
    getTranslations("landing"),
    getLocale(),
    getCurrentUser(),
    listOperators(),
    listPayoutMethods(),
    getSettings(),
  ]);
  const ops = allOps.filter((o) => o.active);
  const lang = (locale === "ar" || locale === "en" ? locale : "fr") as "fr" | "ar" | "en";
  const loginFor = (target: string) => (user ? target : `/login?callbackUrl=${encodeURIComponent(target)}`);
  const sellHref = loginFor("/sell");
  const minWithdraw = formatDt(settings.minWithdrawalMillimes);

  const ticketOps: TicketOperator[] = ops.map((o) => ({
    code: o.code,
    name: o.name,
    color: o.color,
    ink: inkFor(o.color),
    rateBps: o.rateBps,
    template: o.transferUssdTemplate,
    href: loginFor(`/sell?op=${o.code}`),
  }));

  const codeFor = (template: string) => template.replaceAll("{number}", NUMBER_MASK).replaceAll("{millimes}", "10000").replaceAll("{dinars}", "10");
  const methodName = (m: (typeof methods)[number]) => m.name[lang] ?? m.name.fr;
  const methodFee = (m: (typeof methods)[number]) =>
    m.feeBps > 0
      ? t("works.feePercent", { percent: formatPercent(m.feeBps) })
      : m.feeMillimes > 0
        ? t("works.fee", { amount: formatDt(m.feeMillimes) })
        : t("works.free");
  const methodsText = methods
    .map((m) =>
      m.feeBps > 0
        ? t("faq.feePercent", { method: methodName(m), percent: formatPercent(m.feeBps) })
        : m.feeMillimes > 0
          ? t("faq.fee", { method: methodName(m), amount: formatDt(m.feeMillimes) })
          : t("faq.free", { method: methodName(m) }),
    )
    .join(` ${t("faq.or")} `);
  const operatorNames = ops.map((o) => o.name).join(", ");
  // Each code is wrapped in left-to-right isolate marks so it reads correctly inside Arabic text.
  const codes = ops.map((o) => `${o.name} ⁦${codeFor(o.transferUssdTemplate)}⁩`).join(", ");

  const first = ops[0];
  const sample = first ? { name: first.name, code: codeFor(first.transferUssdTemplate).replace(NUMBER_MASK, "27123456"), get: grossPayout(10_000, first.rateBps) } : null;

  const steps = [
    { time: t("how.s1Time"), text: t("how.s1"), grow: 2, tone: "charcoal" },
    { time: t("how.s2Time"), text: t("how.s2"), grow: 3, tone: "blue" },
    { time: t("how.s3Time"), text: t("how.s3"), grow: 4, tone: "red" },
    { time: t("how.s4Time"), text: t("how.s4"), grow: 2, tone: "green" },
  ];

  const rules = [
    { title: t("rules.lockedT"), text: t("rules.locked") },
    { title: t("rules.twiceT"), text: t("rules.twice") },
    { title: t("rules.windowT", { minutes: settings.holdMinutes }), text: t("rules.window") },
    { title: t("rules.lessT"), text: t("rules.less") },
    { title: t("rules.lateT"), text: t("rules.late") },
    { title: t("rules.limitT"), text: t("rules.limit") },
  ];

  const faqs = [
    { q: t("faq.q1"), a: t("faq.a1", { operators: operatorNames }) },
    { q: t("faq.q2"), a: t("faq.a2", { codes }) },
    { q: t("faq.q3"), a: t("faq.a3") },
    { q: t("faq.q4"), a: t("faq.a4", { methods: methodsText, min: minWithdraw }) },
    { q: t("faq.q5"), a: t("faq.a5") },
    { q: t("faq.q6"), a: t("faq.a6") },
  ];

  // The board is four tiles wide; the heading tile takes two. Fill the last row with the coins photograph.
  const used = 2 + ops.length + methods.length;
  const showCoins = used % 4 !== 0;

  const nav = [
    { href: "#rates", label: t("nav.rates") },
    { href: "#how", label: t("nav.how") },
    { href: "#questions", label: t("nav.faq") },
  ];

  return (
    <div className="lp" id="top">
      <LandingMotion />
      <ChapterHeader
        brandName={brand.name}
        nav={nav}
        navLabel={t("nav.menu")}
        account={user ? { href: "/wallet", label: t("nav.balance") } : { href: "/login", label: t("nav.signIn") }}
        cta={{ href: sellHref, label: t("nav.sell") }}
      />

      <main>
        {/* Hero: credit on paper above the seam, cash on green below it. */}
        <section className="lp-hero" aria-labelledby="hero-title">
          <div className="lp-hero__top" data-chapter="paper" aria-hidden="true" />
          <div className="lp-hero__bottom" data-chapter="green" aria-hidden="true" />
          <div className="lp-hero__title">
            {/* Two copies of the same words: one inked for the paper, one for the green. */}
            <h1 id="hero-title" className="lp-hero__h">
              <span className="lp-hero__ink lp-hero__ink--top">
                <span>{t("hero.line1")}</span> <span>{t("hero.line2")}</span>
              </span>
              <span className="lp-hero__ink lp-hero__ink--bottom" aria-hidden="true">
                <span>{t("hero.line1")}</span> <span>{t("hero.line2")}</span>
              </span>
            </h1>
          </div>
          <div className="lp-hero__foot">
            <p className="lp-hero__sub">{t("hero.sub")}</p>
            <div className="lp-hero__actions">
              <Link href={sellHref} className="lp-btn lp-btn--paper lp-hero__cta">
                {t("nav.sell")}
              </Link>
              <InstallLink className="lp-link lp-hero__install" />
            </div>
          </div>
        </section>

        <div className="lp-notes" data-chapter="green">
          <figure className="lp-notes__fig" aria-label={t("hero.notesAlt")}>
            <Image src={notes10} alt="" className="lp-notes__a" data-drift="-1" sizes="(max-width: 700px) 80vw, 46vw" priority />
            <Image src={notes5} alt="" className="lp-notes__b" data-drift="1" sizes="(max-width: 700px) 70vw, 40vw" />
          </figure>
        </div>

        <RateTicket
          operators={ticketOps}
          holdMinutes={settings.holdMinutes}
          minWithdraw={minWithdraw}
        />

        <section id="how" className="lp-how" data-chapter="yellow" aria-labelledby="how-title">
          <div className="lp-wrap">
            <h2 id="how-title" className="lp-h2" data-reveal>
              {t("how.title")}
            </h2>
            <ol className="lp-bar" data-ui>
              {steps.map((s) => (
                <li key={s.time} className="lp-bar__stage" style={{ flexGrow: s.grow, ["--g" as string]: s.grow }} data-reveal>
                  <span className={`lp-bar__seg lp-bar__seg--${s.tone}`}>{s.time}</span>
                  <span className="lp-bar__text">{s.text}</span>
                </li>
              ))}
            </ol>

            {sample && (
              <div className="lp-frags">
                <figure className="lp-frag-fig" data-reveal>
                  <div className="lp-frag lp-frag--dial" data-ui>
                    <span className="lp-frag__label">{t("how.f1Label")}</span>
                    <span className="lp-frag__code" dir="ltr">{sample.code}</span>
                    <span className="lp-frag__call">{t("how.f1Call")}</span>
                    <span className="lp-frag__hold">
                      {t("how.f1Hold")} <b dir="ltr">14:32</b>
                    </span>
                  </div>
                  <figcaption>{t("how.c1")}</figcaption>
                </figure>
                <figure className="lp-frag-fig" data-reveal>
                  <div className="lp-frag lp-frag--sms" data-ui>
                    <span className="lp-frag__label">{t("how.f2From", { operator: sample.name })}</span>
                    <span className="lp-frag__bubble" dir="ltr" lang="fr">
                      Vous avez recu 10000 Millimes de la part du numéro 2xxxxxxx
                    </span>
                    <span className="lp-frag__time" dir="ltr">14:21</span>
                  </div>
                  <figcaption>{t("how.c2")}</figcaption>
                </figure>
                <figure className="lp-frag-fig" data-reveal>
                  <div className="lp-frag lp-frag--wallet" data-ui>
                    <span className="lp-frag__label">{t("how.f3Label")}</span>
                    <span className="lp-frag__money" dir="ltr">
                      +{formatDt(sample.get)} <small>DT</small>
                    </span>
                    <span className="lp-frag__line">{t("how.f3Line", { operator: sample.name, amount: "10" })}</span>
                    <span className="lp-frag__btn">{t("how.f3Withdraw")}</span>
                  </div>
                  <figcaption>{t("how.c3")}</figcaption>
                </figure>
              </div>
            )}
          </div>
        </section>

        <section className="lp-rules" data-chapter="charcoal" aria-labelledby="rules-title">
          <div className="lp-wrap lp-rules__list">
            <h2 id="rules-title" className="lp-rules__head" data-reveal>
              {t("rules.title")}
            </h2>
            {rules.map((r) => (
              <div key={r.title} className="lp-rules__row" data-reveal>
                <h3 className="lp-rules__name">{r.title}</h3>
                <p className="lp-rules__text">{r.text}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="lp-works" data-chapter="paper" aria-labelledby="works-title">
          <div className="lp-wrap lp-board">
            <div className="lp-tile lp-tile--head" data-reveal>
              <h2 id="works-title" className="lp-tile__title">
                {t("works.title")}
              </h2>
            </div>
            {ops.map((o) => (
              <div key={o.code} className="lp-tile" data-reveal>
                <OperatorLogo code={o.code} name={o.name} color={o.color} className="lp-tile__logo" />
                <div className="lp-tile__meta">
                  <h3>{o.name}</h3>
                  <p>{t("works.operator", { amount: formatDt(grossPayout(10_000, o.rateBps)) })}</p>
                </div>
              </div>
            ))}
            {methods.map((m) =>
              PAYOUT_LOGOS[m.code] ? (
                <div key={m.code} className="lp-tile" data-reveal>
                  {/* eslint-disable-next-line @next/next/no-img-element -- small brand marks */}
                  <img src={PAYOUT_LOGOS[m.code]} alt="" className="lp-tile__mark" />
                  <div className="lp-tile__meta">
                    <h3>{methodName(m)}</h3>
                    <p>{methodFee(m)}</p>
                  </div>
                </div>
              ) : (
                <div key={m.code} className="lp-tile lp-tile--photo" data-reveal>
                  <Image src={laPoste} alt={t("works.posteAlt")} sizes="(max-width: 700px) 50vw, 25vw" />
                  <div className="lp-tile__label">
                    <h3>{methodName(m)}</h3>
                    <p>{methodFee(m)}</p>
                  </div>
                </div>
              ),
            )}
            {showCoins && (
              <div className="lp-tile lp-tile--photo" data-reveal>
                <Image src={coins} alt={t("works.coinsAlt")} sizes="(max-width: 700px) 50vw, 25vw" />
                <div className="lp-tile__label">
                  <h3>{t("works.cash")}</h3>
                </div>
              </div>
            )}
          </div>
        </section>

        <section id="questions" className="lp-faq" aria-labelledby="faq-title">
          <div className="lp-faq__head" data-chapter="blue">
            <div className="lp-wrap lp-faq__head-in">
              <h2 id="faq-title" className="lp-h2" data-reveal>
                {t("faq.title")}
              </h2>
              <div className="lp-faq__sign" data-reveal>
                <Image src={taxiphone} alt={t("faq.signAlt")} sizes="(max-width: 700px) 100vw, 46vw" data-drift="1" />
              </div>
            </div>
          </div>
          {faqs.map((f, i) => (
            <div key={f.q} className={`lp-faq__band ${i % 2 ? "lp-faq__band--alt" : ""}`} data-chapter={i % 2 ? "surface" : "charcoal"}>
              <div className="lp-wrap lp-faq__row" data-reveal>
                <h3 className="lp-faq__q">{f.q}</h3>
                <p className="lp-faq__a">{f.a}</p>
              </div>
            </div>
          ))}
        </section>
      </main>

      <footer className="lp-foot" data-chapter="green">
        <div className="lp-wrap">
          <FittedName text={brand.name} />
          <div className="lp-foot__row">
            <ul className="lp-foot__big">
              <li>
                <Link href={sellHref} className="lp-link">
                  {t("nav.sell")}
                </Link>
              </li>
              <li>
                <Link href={user ? "/wallet" : "/login"} className="lp-link">
                  {user ? t("nav.balance") : t("nav.signIn")}
                </Link>
              </li>
              <li lang="ar" className="lp-foot__ar">
                {brand.nameAr}
              </li>
            </ul>
            <ul className="lp-foot__small">
              {nav.map((n) => (
                <li key={n.href}>
                  <a href={n.href} className="lp-link">
                    {n.label}
                  </a>
                </li>
              ))}
            </ul>
            <p className="lp-foot__credits">
              {t("footer.pictures")}:{" "}
              {CREDITS.map((c, i) => (
                <span key={c.href}>
                  <a href={c.href} className="lp-link" rel="noopener" target="_blank">
                    {c.title}
                  </a>{" "}
                  ({c.by}, {c.licence}){i < CREDITS.length - 1 ? "; " : "."}
                </span>
              ))}
            </p>
          </div>
          <div className="lp-foot__legal">
            <span>{t("footer.rights", { year: new Date().getFullYear() })}</span>
            <a href="#top" className="lp-link">
              {t("footer.top")}
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
