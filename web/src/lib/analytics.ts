"use client";

import type { Analytics } from "firebase/analytics";
import { firebaseConfig } from "@/config/firebase";

// Only production builds with a filled-in config send data, so local testing doesn't pollute the stats.
const enabled = process.env.NODE_ENV === "production" && Boolean(firebaseConfig.measurementId);

let analyticsPromise: Promise<Analytics | null> | null = null;

/** Loads Firebase lazily (keeps it out of the main bundle) and returns null when analytics is unavailable. */
function getAnalyticsInstance(): Promise<Analytics | null> {
  if (!enabled || typeof window === "undefined") return Promise.resolve(null);
  analyticsPromise ??= (async () => {
    const [{ initializeApp, getApps }, { initializeAnalytics, isSupported }] = await Promise.all([
      import("firebase/app"),
      import("firebase/analytics"),
    ]);
    if (!(await isSupported())) return null;
    const app = getApps()[0] ?? initializeApp(firebaseConfig);
    // Page views are sent by hand (see trackPageView) so admin pages can be skipped.
    return initializeAnalytics(app, { config: { send_page_view: false } });
  })().catch(() => null);
  return analyticsPromise;
}

export async function trackPageView(path: string) {
  const analytics = await getAnalyticsInstance();
  if (!analytics) return;
  const { logEvent } = await import("firebase/analytics");
  logEvent(analytics, "page_view", {
    page_path: path,
    page_location: window.location.href,
    page_title: document.title,
  });
}

/** Sends a custom event, e.g. trackEvent("sale_started", { operator: "ooredoo" }). */
export async function trackEvent(name: string, params?: Record<string, unknown>) {
  const analytics = await getAnalyticsInstance();
  if (!analytics) return;
  const { logEvent } = await import("firebase/analytics");
  logEvent(analytics, name, params);
}
