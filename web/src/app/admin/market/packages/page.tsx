import { PageHeader } from "@/components/admin/page-header";
import { OperatorName } from "@/components/app/operator-badge";
import { listPackages } from "@/lib/engine/packages";
import { formatDinars } from "@/lib/money";
import { listOperators } from "@/lib/queries";
import { requireAdmin } from "@/lib/session";
import { PackageForm } from "./package-forms";

export const metadata = { title: "Data packages" };
export const dynamic = "force-dynamic";

export default async function PackagesPage() {
  await requireAdmin();
  const [ops, packages] = await Promise.all([listOperators(), listPackages()]);
  return (
    <>
      <PageHeader
        title="Data packages"
        description="Packages buyers can activate for a customer number, paid from their balance for that operator. An agent phone dials the USSD from one of Sarfli's SIMs; the SIM's balance must drop by exactly the price, otherwise the request goes to Recharges review. A change applies to new requests only."
      />
      <div className="flex flex-col gap-8">
        {ops.map((op) => {
          const list = packages.filter((p) => p.operatorCode === op.code);
          return (
            <section key={op.code} className="flex flex-col gap-3">
              <h2 className="font-heading font-semibold text-lg">
                <OperatorName name={op.name} color={op.color} />
                <span className="ms-2 font-normal text-muted-foreground text-sm">
                  {list.length} package{list.length === 1 ? "" : "s"}
                  {!op.active && " · operator disabled"}
                </span>
              </h2>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {list.map((p) => (
                  <PackageForm
                    key={p.id}
                    id={p.id}
                    operatorCode={op.code}
                    initial={{
                      name: p.name,
                      price: formatDinars(p.priceMillimes, "en-US").replace(/,/g, ""),
                      ussdTemplate: p.ussdTemplate,
                      ussdSteps: p.ussdSteps.join("\n"),
                      active: p.active,
                      sortOrder: String(p.sortOrder),
                    }}
                  />
                ))}
                <PackageForm operatorCode={op.code} operatorName={op.name} />
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}
