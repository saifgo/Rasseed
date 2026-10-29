"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { trackPageView } from "@/lib/analytics";

/** Sends a Google Analytics page view on every route change, except admin pages. */
export function Analytics() {
  const pathname = usePathname();
  useEffect(() => {
    if (!pathname || pathname.startsWith("/admin")) return;
    void trackPageView(pathname);
  }, [pathname]);
  return null;
}
