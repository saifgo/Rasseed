import { devLoginEnabled } from "@/auth";
import { PageHeader } from "@/components/admin/page-header";
import { requireAdmin } from "@/lib/session";
import { listOperators, listPayoutMethods } from "@/lib/queries";
import { DEFAULT_SETTINGS, getSettings } from "@/lib/settings";
import { DevResetCard } from "./dev-reset";
import { PayoutMethodsForm, PosRechargeLimitsForm, SettingsForm } from "./settings-forms";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  await requireAdmin();
  const [settings, methods, ops] = await Promise.all([getSettings(), listPayoutMethods(false), listOperators()]);
  return (
    <>
      <PageHeader title="Settings" description="Timings of the transaction engine, withdrawal minimum, SarfliPOS limits and payout methods." />
      <SettingsForm values={settings} defaults={DEFAULT_SETTINGS} />
      <PosRechargeLimitsForm
        operators={ops.map((o) => ({
          code: o.code,
          name: o.name,
          max: o.posMaxRechargeMillimes ? String(o.posMaxRechargeMillimes / 1000) : "",
        }))}
      />
      <PayoutMethodsForm
        methods={methods.map((m) => ({
          code: m.code,
          name: m.name.en,
          active: m.active,
          feeType: m.feeBps > 0 ? "percent" : "fixed",
          fee: m.feeBps > 0 ? String(m.feeBps / 100) : (m.feeMillimes / 1000).toFixed(3),
        }))}
      />
      {devLoginEnabled && <DevResetCard />}
    </>
  );
}
