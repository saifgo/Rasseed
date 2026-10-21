"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useId, useState } from "react";
import { formatDt, grossPayout, MILLIMES_PER_DINAR } from "@/lib/money";
import { NUMBER_MASK } from "./number-mask";

export type TicketOperator = {
  code: string;
  name: string;
  color: string;
  ink: string;
  rateBps: number;
  template: string;
  href: string;
};

const PRESETS = [5, 10, 20, 50];
const MAX_DT = 500;

/** The exchange ticket: pick an operator and an amount, read exactly what you get and the code you will dial. */
export function RateTicket({ operators, holdMinutes, minWithdraw }: { operators: TicketOperator[]; holdMinutes: number; minWithdraw: string }) {
  const t = useTranslations("landing.rates");
  const tNav = useTranslations("landing.nav");
  const id = useId();
  const [code, setCode] = useState(operators[0]?.code);
  const [dinars, setDinars] = useState(10);
  const [other, setOther] = useState("");

  const op = operators.find((o) => o.code === code) ?? operators[0];

  useEffect(() => {
    window.dispatchEvent(new Event("lp:chapter"));
  }, [code]);

  if (!op) return null;

  const otherValue = other.trim() === "" ? null : Number(other.replace(",", "."));
  const otherValid = otherValue !== null && Number.isFinite(otherValue) && otherValue >= 1 && otherValue <= MAX_DT;
  const amount = otherValue !== null ? (otherValid ? otherValue : null) : dinars;
  const millimes = amount === null ? null : Math.round(amount * MILLIMES_PER_DINAR);
  const get = millimes === null ? null : grossPayout(millimes, op.rateBps);
  const dial = op.template
    .replaceAll("{number}", NUMBER_MASK)
    .replaceAll("{millimes}", String(millimes ?? 10_000))
    .replaceAll("{dinars}", String(amount ?? 10));

  return (
    <section
      id="rates"
      className="lp-rates"
      data-chapter="custom"
      data-bg={op.color}
      data-ink={op.ink}
      style={{ "--ground": op.color, "--ground-ink": op.ink } as React.CSSProperties}
      aria-labelledby={`${id}-title`}
    >
      <div className="lp-wrap lp-rates__in">
        <div className="lp-rates__intro" data-reveal>
          <h2 id={`${id}-title`} className="lp-h2">
            {t("title")}
          </h2>
          <p>{t("intro")}</p>
        </div>

        <div className="lp-ticket" data-reveal>
          <div className="lp-ticket__main">
            <h3 className="lp-ticket__title">{t("ticketTitle", { operator: op.name })}</h3>
            <fieldset className="lp-choice">
              <legend className="lp-sr">{t("operator")}</legend>
              {operators.map((o) => (
                <label key={o.code} className="lp-choice__opt" style={{ "--opt": o.color, "--opt-ink": o.ink } as React.CSSProperties}>
                  <input type="radio" name={`${id}-op`} value={o.code} checked={o.code === op.code} onChange={() => setCode(o.code)} />
                  <span className="lp-choice__name">{o.name}</span>
                  <span className="lp-choice__rate">{t("per10", { amount: formatDt(grossPayout(10_000, o.rateBps)) })}</span>
                </label>
              ))}
            </fieldset>

            <fieldset className="lp-amounts">
              <legend className="lp-ticket__label">{t("amount")}</legend>
              {PRESETS.map((p) => (
                <label key={p} className="lp-amounts__opt">
                  <input
                    type="radio"
                    name={`${id}-amount`}
                    value={p}
                    checked={otherValue === null && dinars === p}
                    onChange={() => {
                      setDinars(p);
                      setOther("");
                    }}
                  />
                  <span dir="ltr">{p} DT</span>
                </label>
              ))}
              <label className="lp-amounts__other">
                <span className="lp-sr">{t("other")}</span>
                <input
                  inputMode="decimal"
                  placeholder={t("other")}
                  value={other}
                  onChange={(e) => setOther(e.target.value)}
                  aria-invalid={otherValue !== null && !otherValid}
                  aria-describedby={`${id}-err`}
                />
              </label>
            </fieldset>
            <p id={`${id}-err`} className="lp-ticket__err" aria-live="polite">
              {otherValue !== null && !otherValid ? t("invalid") : ""}
            </p>
          </div>

          <ul className="lp-ticket__terms">
            <li>
              {t("dial", { code: "" })}
              <bdi dir="ltr">
                <b>{dial}</b>
              </bdi>
            </li>
            <li>{t("locked")}</li>
            <li>{t("window", { minutes: holdMinutes })}</li>
            <li>{t("withdraw", { amount: minWithdraw })}</li>
          </ul>

          <div className="lp-ticket__stub">
            <output className="lp-ticket__price" key={`${op.code}-${get}`} dir="ltr" aria-live="polite">
              {get === null ? "–" : formatDt(get)}
              <small> DT</small>
            </output>
            <span className="lp-ticket__for">{amount === null ? "" : t("forAmount", { amount: formatDt(millimes!) })}</span>
            <Link href={op.href} className="lp-btn lp-btn--accent lp-ticket__cta">
              {tNav("sell")}
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
