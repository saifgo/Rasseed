"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toastManager } from "@/components/ui/toast";

const messages: Record<string, string> = {
  forbidden: "You are not allowed to do this.",
  invalid_amount: "Enter a valid amount.",
  invalid_rate: "Enter a rate between 0 and 1 (e.g. 0.82) or a percentage (82%).",
  invalid_state: "This item changed meanwhile — refresh and try again.",
  not_found: "Not found.",
  payout_already_paid: "This payout is already marked as paid.",
  invalid_msisdn: "Enter a valid 8-digit number.",
  msisdn_in_use: "This number is already assigned to another SIM.",
  sim_incomplete: "Set operator and number before activating.",
  sim_busy: "This SIM is holding an active sale. Wait until it ends.",
  invalid_regex: "One of the regular expressions is invalid.",
  sms_regex_needs_amount_and_sender: "The SMS regex needs (?<amount>…) and (?<sender>…) groups.",
  balance_regex_needs_amount: "The balance regex needs an (?<amount>…) group.",
  template_needs_number: "The transfer template must contain {number}.",
  unsupported_file_type: "Proof must be a JPG, PNG, WEBP or PDF.",
  file_too_large: "Proof file is larger than 5 MB.",
  file_missing: "Choose a file first.",
};

export function errorMessage(code: string) {
  return messages[code] ?? "Something went wrong.";
}

/** Runs an admin server action, toasts the outcome and refreshes the page data. */
export function useAdminAction() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  function run<T>(
    action: () => Promise<{ ok: true; data: T } | { ok: false; error: string }>,
    opts: { success?: string; onSuccess?: (data: T) => void } = {},
  ) {
    startTransition(async () => {
      const res = await action();
      if (res.ok) {
        if (opts.success) toastManager.add({ type: "success", title: opts.success });
        opts.onSuccess?.(res.data);
        router.refresh();
      } else {
        toastManager.add({ type: "error", title: errorMessage(res.error) });
      }
    });
  }
  return { pending, run };
}
