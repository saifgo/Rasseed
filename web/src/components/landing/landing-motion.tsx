"use client";

import { useEffect } from "react";

/**
 * Motion for the landing page.
 * - [data-reveal]: rises into place once, staggered among siblings. Without JS the content
 *   is simply there (the hiding CSS sits behind `@media (scripting: enabled)`).
 * - [data-drift="1|-1"]: pictures that drift slowly against the scroll.
 */
export function LandingMotion() {
  useEffect(() => {
    const root = document.querySelector(".lp");
    if (!root) return;

    // Stagger children that share a parent: heading, then text, then pictures.
    const groups = new Map<Element, number>();
    const items = Array.from(root.querySelectorAll<HTMLElement>("[data-reveal]"));
    for (const el of items) {
      const parent = el.parentElement!;
      const n = groups.get(parent) ?? 0;
      groups.set(parent, n + 1);
      el.style.setProperty("--stagger", `${Math.min(n, 8) * 80}ms`);
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          e.target.classList.add("is-in");
          io.unobserve(e.target);
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.05 },
    );
    for (const el of items) io.observe(el);
    root.classList.add("lp--ready");

    const still = window.matchMedia("(prefers-reduced-motion: reduce)");
    const drifters = Array.from(root.querySelectorAll<HTMLElement>("[data-drift]"));
    let frame = 0;
    const drift = () => {
      frame = 0;
      if (still.matches) return;
      const vh = window.innerHeight;
      for (const el of drifters) {
        const r = el.getBoundingClientRect();
        if (r.bottom < -200 || r.top > vh + 200) continue;
        const offset = (r.top + r.height / 2 - vh / 2) / vh; // -1 … 1 around the middle of the screen
        el.style.setProperty("--drift", `${(offset * 48 * Number(el.dataset.drift)).toFixed(1)}px`);
      }
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(drift);
    };
    drift();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      io.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, []);

  return null;
}
