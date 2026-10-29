import { PageHeader } from "@/components/admin/page-header";
import { requireAdmin } from "@/lib/session";
import { listPayoutMethods } from "@/lib/queries";
import { DEFAULT_SETTINGS, getSettings } from "@/lib/settings";
import { PayoutMethodsForm, SettingsForm } from "./settings-forms";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  await requireAdmin();
  const [settings, methods] = await Promise.all([getSettings(), listPayoutMethods(false)]);
  return (
    <>
      <PageHeader title="Settings" description="Timings of the transaction engine, withdrawal minimum and payout methods." />
      <SettingsForm values={settings} defaults={DEFAULT_SETTINGS} />
      <PayoutMethodsForm
        methods={methods.map((m) => ({
          code: m.code,
          name: m.name.en,
          active: m.active,
          feeType: m.feeBps > 0 ? "percent" : "fixed",
          fee: m.feeBps > 0 ? String(m.feeBps / 100) : (m.feeMillimes / 1000).toFixed(3),
        }))}
      />
    </>
  );
}
