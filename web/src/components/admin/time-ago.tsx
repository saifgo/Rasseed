"use client";

import { useEffect, useState } from "react";

export function TimeAgo({ date, className }: { date: Date | string | null | undefined; className?: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(id);
  }, []);
  if (!date) return <span className={className}>never</span>;
  const d = new Date(date);
  const s = Math.round((now - d.getTime()) / 1000);
  const text =
    s < 5 ? "just now" : s < 60 ? `${s}s ago` : s < 3600 ? `${Math.floor(s / 60)}m ago` : s < 86400 ? `${Math.floor(s / 3600)}h ago` : d.toLocaleDateString("en-GB");
  return (
    <time className={className} dateTime={d.toISOString()} title={d.toLocaleString("en-GB")} suppressHydrationWarning>
      {text}
    </time>
  );
}
