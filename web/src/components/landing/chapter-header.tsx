"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { LocaleSwitcher } from "@/components/app/locale-switcher";

type NavLink = { href: string; label: string };

/**
 * Plain bar that takes the colours of the chapter passing under it.
 * Each chapter element carries data-chapter="<name>" (colours from CSS tokens),
 * or data-chapter="custom" with data-bg / data-ink for the operator-coloured ticket.
 */
export function ChapterHeader({
  brandName,
  nav,
  navLabel,
  account,
  cta,
}: {
  brandName: string;
  nav: NavLink[];
  navLabel: string;
  account: NavLink;
  cta: NavLink;
}) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const header = ref.current;
    if (!header) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const y = header.offsetHeight - 2;
      const x = Math.round(window.innerWidth / 2);
      for (const el of document.elementsFromPoint(x, y)) {
        if (header.contains(el)) continue;
        const chapter = (el as HTMLElement).closest<HTMLElement>("[data-chapter]");
        if (!chapter) continue;
        const name = chapter.dataset.chapter!;
        const bg = name === "custom" ? chapter.dataset.bg! : `var(--ch-${name})`;
        const ink = name === "custom" ? chapter.dataset.ink! : `var(--ch-${name}-ink)`;
        header.style.setProperty("--hdr-bg", bg);
        header.style.setProperty("--hdr-ink", ink);
        return;
      }
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    window.addEventListener("lp:chapter", schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("lp:chapter", schedule);
    };
  }, []);

  return (
    <header ref={ref} className="lp-hdr">
      <div className="lp-hdr__in">
        <Link href="/" className="lp-hdr__brand">
          {brandName}
        </Link>
        <nav aria-label={navLabel} className="lp-hdr__nav">
          {nav.map((n) => (
            <a key={n.href} href={n.href} className="lp-link">
              {n.label}
            </a>
          ))}
        </nav>
        <div className="lp-hdr__end">
          <span className="lp-hdr__locale">
            <LocaleSwitcher />
          </span>
          <Link href={account.href} className="lp-link lp-hdr__account">
            {account.label}
          </Link>
          <Link href={cta.href} className="lp-btn lp-btn--hdr">
            {cta.label}
          </Link>
        </div>
      </div>
    </header>
  );
}
