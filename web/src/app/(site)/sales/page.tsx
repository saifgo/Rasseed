import { PlusIcon, ReceiptTextIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { Dt } from "@/components/app/money";
import { OperatorName } from "@/components/app/operator-badge";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Frame } from "@/components/ui/frame";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { grossPayout } from "@/lib/money";
import { listUserSales } from "@/lib/queries";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sales" };

export default async function SalesPage() {
  const user = await requireUser();
  const t = await getTranslations();
  const format = await getFormatter();
  const rows = await listUserSales(user.id);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="font-heading font-semibold text-2xl tracking-tight">{t("sales.title")}</h1>
          <p className="text-muted-foreground">{t("sales.subtitle")}</p>
        </div>
        <Button render={<Link href="/sell" />}>
          <PlusIcon aria-hidden="true" />
          {t("sale.newSale")}
        </Button>
      </div>

      {rows.length === 0 ? (
        <Empty className="rounded-xl border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ReceiptTextIcon aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>{t("sales.empty")}</EmptyTitle>
            <EmptyDescription>{t("sales.emptyText")}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button render={<Link href="/sell" />}>{t("nav.sell")}</Button>
          </EmptyContent>
        </Empty>
      ) : (
        <Frame>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("sales.ref")}</TableHead>
                <TableHead>{t("sales.operator")}</TableHead>
                <TableHead className="text-end">{t("sales.amount")}</TableHead>
                <TableHead className="text-end">{t("sales.credited")}</TableHead>
                <TableHead>{t("sales.status")}</TableHead>
                <TableHead>{t("sales.date")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ tx, op }) => (
                <TableRow key={tx.id}>
                  <TableCell>
                    <Link href={`/sales/${tx.id}`} className="font-mono font-medium underline-offset-4 hover:underline">
                      {tx.ref}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <OperatorName name={op.name} color={op.color} />
                  </TableCell>
                  <TableCell className="text-end">
                    <Dt millimes={tx.finalMillimes ?? tx.declaredMillimes} />
                  </TableCell>
                  <TableCell className="text-end">
                    <Dt millimes={tx.payoutNetMillimes ?? grossPayout(tx.declaredMillimes, tx.rateBps)} />
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={tx.status} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {format.dateTime(tx.createdAt, { dateStyle: "medium", timeStyle: "short" })}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Frame>
      )}
    </div>
  );
}
