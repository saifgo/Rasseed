import { formatPrice } from "@/components/admin/market-badges";
import { PageHeader } from "@/components/admin/page-header";
import { getSarfliListings } from "@/lib/market-admin-queries";
import { requireAdmin } from "@/lib/session";
import { SarfliListingForm } from "./sarfli-forms";

export const metadata = { title: "Sarfli listing" };

export default async function SarfliListingPage() {
  await requireAdmin();
  const rows = await getSarfliListings();
  return (
    <>
      <PageHeader
        title="Sarfli listing"
        description="Sarfli sells its own credit to buyers like any seller. Orders are funded at once from Sarfli credit; buyers pay Sarfli and upload proof, and you confirm the payment on the order. A price change applies to new orders only."
      />
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {rows.map(({ op, listing, sarfliMillimes }) => (
          <SarfliListingForm
            key={op.code}
            code={op.code}
            name={op.name}
            color={op.color}
            operatorActive={op.active}
            price={listing ? formatPrice(listing.priceBps) : ""}
            paymentInfo={listing?.paymentInfo ?? ""}
            active={listing?.active ?? false}
            sarfliMillimes={sarfliMillimes}
          />
        ))}
      </div>
    </>
  );
}
