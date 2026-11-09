"use client";

import { EyeIcon, EyeOffIcon } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Confidential mode: every number wrapped in <Secret> is blurred until clicked.
// The mode lives on <html data-confidential>, set before paint by CONFIDENTIAL_INIT so numbers never flash,
// and is remembered per device in localStorage. The blur itself is plain CSS (see globals.css).

const KEY = "confidential";
const EVENT = "confidential-change";

/** Inline <head> script: turns the mode on before the page paints if it was left on. */
export const CONFIDENTIAL_INIT = `try{if(localStorage.getItem("${KEY}")==="1")document.documentElement.dataset.confidential=""}catch(e){}`;

function isOn() {
  return typeof document !== "undefined" && document.documentElement.dataset.confidential !== undefined;
}

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  return () => window.removeEventListener(EVENT, cb);
}

export function useConfidential() {
  return useSyncExternalStore(subscribe, isOn, () => false);
}

function setConfidential(on: boolean) {
  if (on) document.documentElement.dataset.confidential = "";
  else delete document.documentElement.dataset.confidential;
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch {}
  window.dispatchEvent(new Event(EVENT));
}

/** A number that is blurred in confidential mode. Clicking it toggles its blur (and does not follow links). */
export function Secret({ children, className, dir }: { children: React.ReactNode; className?: string; dir?: "ltr" | "rtl" }) {
  const on = useConfidential();
  const [revealed, setRevealed] = useState(false);
  // Turning the mode off resets reveals, so turning it on again hides everything.
  const [prevOn, setPrevOn] = useState(on);
  if (on !== prevOn) {
    setPrevOn(on);
    if (!on) setRevealed(false);
  }
  const toggle = (e: React.SyntheticEvent) => {
    if (!isOn()) return;
    e.preventDefault();
    e.stopPropagation();
    setRevealed((r) => !r);
  };
  return (
    <span
      data-secret=""
      data-revealed={revealed ? "" : undefined}
      dir={dir}
      className={className}
      onClickCapture={toggle}
      onKeyDownCapture={(e) => {
        if (e.key === "Enter" || e.key === " ") toggle(e);
      }}
      role={on ? "button" : undefined}
      tabIndex={on ? 0 : undefined}
      aria-pressed={on ? revealed : undefined}
    >
      {children}
    </span>
  );
}

/** Eye button that turns confidential mode on and off. */
export function ConfidentialToggle({ showLabel, hideLabel, className }: { showLabel: string; hideLabel: string; className?: string }) {
  const on = useConfidential();
  const label = on ? showLabel : hideLabel;
  return (
    <Button variant="ghost" size="sm" className={cn(className)} aria-label={label} title={label} aria-pressed={on} onClick={() => setConfidential(!on)}>
      {on ? <EyeOffIcon aria-hidden="true" /> : <EyeIcon aria-hidden="true" />}
    </Button>
  );
}
