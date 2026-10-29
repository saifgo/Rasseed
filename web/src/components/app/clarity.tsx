"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { clarityConfig } from "@/config/clarity";

declare global {
  interface Window {
    clarity?: (command: string, ...args: unknown[]) => void;
  }
}

// Same rules as Google Analytics: production only, and only once the project ID is filled in.
const enabled = process.env.NODE_ENV === "production" && Boolean(clarityConfig.projectId);

let started = false;
let paused = false;

/** Loads Microsoft Clarity on the public site and pauses recording while on admin pages. */
export function Clarity() {
  const pathname = usePathname();
  useEffect(() => {
    if (!enabled || !pathname) return;
    const isAdmin = pathname.startsWith("/admin");

    if (isAdmin) {
      // Coming from a public page in the same tab: stop recording until we leave admin.
      if (started && !paused) {
        window.clarity?.("stop");
        paused = true;
      }
      return;
    }

    if (!started) {
      started = true;
      import("@microsoft/clarity").then(({ default: clarity }) => clarity.init(clarityConfig.projectId)).catch(() => {});
    } else if (paused) {
      window.clarity?.("start");
      paused = false;
    }
  }, [pathname]);
  return null;
}
