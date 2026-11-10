import { notFound } from "next/navigation";
import { PageHeader } from "@/components/admin/page-header";
import { requireAdmin } from "@/lib/session";
import { ensureTestPhone, getTestPhoneView, testPhoneEnabled } from "@/lib/test-phone";
import { TestPhonePanel } from "./test-phone-panel";

export const metadata = { title: "Test phone" };

// Dev only (AUTH_DEV_LOGIN=true): the page does not exist otherwise.
export default async function TestPhonePage() {
  if (!testPhoneEnabled()) notFound();
  await requireAdmin();
  await ensureTestPhone();
  const view = await getTestPhoneView();
  if (!view) notFound();
  return (
    <>
      <PageHeader
        title="Test phone"
        description="A simulated agent phone for trying sales, order deposits and recharges in the browser. Dev only — this page does not exist in production."
      />
      <TestPhonePanel initial={view} />
    </>
  );
}
