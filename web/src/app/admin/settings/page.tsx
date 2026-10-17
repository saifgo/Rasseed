import { PageHeader } from "@/components/admin/page-header";
import { listPayoutMethods } from "@/lib/queries";
import { DEFAULT_SETTINGS, getSettings } from "@/lib/settings";
import { PayoutMethodsForm, SettingsForm } from "./settings-forms";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const [settings, methods] = await Promise.all([getSettings(), listPayoutMethods(false)]);
  return (
    <>
      <PageHeader title="Settings" description="Timings of the transaction engine and payout methods." />
      <SettingsForm values={settings} defaults={DEFAULT_SETTINGS} />
      <PayoutMethodsForm
        methods={methods.map((m) => ({ code: m.code, name: m.name.en, active: m.active, fee: (m.feeMillimes / 1000).toFixed(3) }))}
      />
    </>
  );
}
