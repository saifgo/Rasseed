"use client";

import { useSyncExternalStore } from "react";

// Chrome/Edge fire `beforeinstallprompt` when the site can be installed. An inline script in the root
// layout (INSTALL_PROMPT_CAPTURE) stores it on window.__sarfliInstall in case it fires before React loads.

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

declare global {
  interface Window {
    __sarfliInstall?: InstallPromptEvent | null;
  }
}

export const INSTALL_PROMPT_CAPTURE = `addEventListener("beforeinstallprompt",function(e){e.preventDefault();window.__sarfliInstall=e;dispatchEvent(new Event("sarfli-install"))});addEventListener("appinstalled",function(){window.__sarfliInstall=null;dispatchEvent(new Event("sarfli-install"))});`;

function subscribe(onChange: () => void) {
  window.addEventListener("sarfli-install", onChange);
  return () => window.removeEventListener("sarfli-install", onChange);
}

const getSnapshot = () => window.__sarfliInstall ?? null;
const getServerSnapshot = () => null;

/** Returns an install function while the app can be installed, otherwise null. */
export function useInstallPrompt() {
  const event = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  if (!event) return null;
  return async () => {
    await event.prompt();
    const { outcome } = await event.userChoice;
    // A prompt can only be used once.
    window.__sarfliInstall = null;
    window.dispatchEvent(new Event("sarfli-install"));
    return outcome === "accepted";
  };
}
