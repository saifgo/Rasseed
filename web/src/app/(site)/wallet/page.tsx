import { FileCheckIcon, PlusIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { Dt } from "@/components/app/money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardPanel, CardTitle } from "@/components/ui/card";
import { Frame } from "@/components/ui/frame";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { db } from "@/db";
import type { LocalizedText, WithdrawalStatus } from "@/db/schema";
import { getBalance, listUserEntries, listUserWithdrawals, pendingWithdrawalTotal } from "@/lib/engine/wallet";
import { formatMsisdn } from "@/lib/phone";
import { getSavedPayoutDetails, listPayoutMethods } from "@/lib/queries";
import { requireUser } from "@/lib/session";
import { getSettings } from "@/lib/settings";
import { WithdrawForm } from "./withdraw-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Balance" };

const statusVariant: Record<WithdrawalStatus, "warning" | "success" | "error"> = { pending: "warning", paid: "success", rejected: "error" };

export default async function WalletPage() {
  const user = await requireUser();
  const t = await getTranslations("wallet");
  const format = await getFormatter();
  const locale = (await getLocale()) as keyof LocalizedText;
  const [balance, pendingTotal, withdrawals, entries, methods, saved, settings] = await Promise.all([
    getBalance(db, user.id),
    pendingWithdrawalTotal(user.id),
    listUserWithdrawals(user.id),
    listUserEntries(user.id),
    listPayoutMethods(),
    getSavedPayoutDetails(user.id),
    getSettings(),
  ]);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="font-heading font-semibold text-2xl tracking-tight">{t("title")}</h1>
          <p className="text-muted-foreground">{t("subtitle")}</p>
        </div>
        <Button render={<Link href="/sell" />}>
          <PlusIcon aria-hidden="true" />
          {t("sellMore")}
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardDescription>{t("available")}</CardDescription>
            <CardTitle className="text-3xl">
              <Dt millimes={balance} />
            </CardTitle>
          </CardHeader>
          <CardPanel className="text-muted-foreground text-sm">{t("availableHint")}</CardPanel>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>{t("pending")}</CardDescription>
            <CardTitle className="text-3xl">
              <Dt millimes={pendingTotal} />
            </CardTitle>
          </CardHeader>
          <CardPanel className="text-muted-foreground text-sm">{t("pendingHint")}</CardPanel>
        </Card>
      </div>

      <WithdrawForm
        balanceMillimes={balance}
        minMillimes={settings.minWithdrawalMillimes}
        methods={methods.map((m) => ({ code: m.code, name: m.name, feeMillimes: m.feeMillimes, fields: m.fields }))}
        saved={saved}
      />

      <section className="flex flex-col gap-3">
        <h2 className="font-heading font-semibold text-lg">{t("withdrawals")}</h2>
        {withdrawals.length === 0 ? (
          <div className="rounded-xl border p-8 text-center text-muted-foreground text-sm">{t("noWithdrawals")}</div>
        ) : (
          <Frame>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("ref")}</TableHead>
                  <TableHead>{t("method")}</TableHead>
                  <TableHead className="text-end">{t("amount")}</TableHead>
                  <TableHead className="text-end">{t("youGet")}</TableHead>
                  <TableHead>{t("status")}</TableHead>
                  <TableHead>{t("date")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {withdrawals.map(({ w, method }) => (
                  <TableRow key={w.id}>
                    <TableCell className="font-mono font-medium">{w.ref}</TableCell>
                    <TableCell>
                      <div>{method.name[locale] ?? method.name.en}</div>
                      <div className="text-muted-foreground text-xs" dir="ltr">
                        {Object.entries(w.details)
                          .map(([k, v]) => (k === "phone" ? formatMsisdn(v) : v))
                          .join(" · ")}
                      </div>
                    </TableCell>
                    <TableCell className="text-end">
                      <Dt millimes={w.grossMillimes} />
                    </TableCell>
                    <TableCell className="text-end">
                      <Dt millimes={w.netMillimes} />
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <Badge variant={statusVariant[w.status]}>{t(`statuses.${w.status}`)}</Badge>
                        {w.status === "paid" && w.reference && <span className="font-mono text-xs">{w.reference}</span>}
                        {w.status === "paid" && w.note && <span className="text-muted-foreground text-xs">{w.note}</span>}
                        {w.status === "rejected" && w.rejectReason && <span className="text-muted-foreground text-xs">{w.rejectReason}</span>}
                        {w.status === "paid" && w.proofPath && (
                          <Button
                            size="xs"
                            variant="outline"
                            className="self-start"
                            render={<a href={`/api/withdrawals/${w.id}/proof`} target="_blank" rel="noreferrer" />}
                          >
                            <FileCheckIcon aria-hidden="true" />
                            {t("proof")}
                          </Button>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {format.dateTime(w.paidAt ?? w.rejectedAt ?? w.createdAt, { dateStyle: "medium", timeStyle: "short" })}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Frame>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-heading font-semibold text-lg">{t("statement")}</h2>
        {entries.length === 0 ? (
          <div className="rounded-xl border p-8 text-center text-muted-foreground text-sm">{t("noEntries")}</div>
        ) : (
          <Frame>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("date")}</TableHead>
                  <TableHead>{t("description")}</TableHead>
                  <TableHead className="text-end">{t("amount")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="text-muted-foreground text-xs">
                      {format.dateTime(e.createdAt, { dateStyle: "medium", timeStyle: "short" })}
                    </TableCell>
                    <TableCell>
                      {e.txId ? (
                        <Link href={`/sales/${e.txId}`} className="underline-offset-4 hover:underline">
                          {t(`kinds.${e.kind}`)}
                        </Link>
                      ) : (
                        t(`kinds.${e.kind}`)
                      )}
                      {e.note && <div className="text-muted-foreground text-xs">{e.note}</div>}
                    </TableCell>
                    <TableCell className="text-end">
                      <Dt millimes={e.amountMillimes} className={e.amountMillimes < 0 ? "text-destructive-foreground" : "text-success-foreground"} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Frame>
        )}
      </section>
    </div>
  );
}
