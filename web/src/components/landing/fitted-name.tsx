"use client";

import { useEffect, useRef } from "react";

/** The wordmark set to exactly the width of its container, measured rather than guessed. */
export function FittedName({ text }: { text: string }) {
  const box = useRef<HTMLDivElement>(null);
  const word = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = box.current;
    const w = word.current;
    if (!el || !w) return;
    const fit = () => {
      w.style.fontSize = "100px";
      const natural = w.getBoundingClientRect().width;
      if (natural > 0) w.style.fontSize = `${(100 * el.clientWidth) / natural}px`;
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    document.fonts?.ready.then(fit);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={box} className="lp-fit" aria-hidden="true">
      <span ref={word} className="lp-fit__word">
        {text}
      </span>
    </div>
  );
}
