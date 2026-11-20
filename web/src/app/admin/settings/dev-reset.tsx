"use client";

import { DatabaseZapIcon } from "lucide-react";
import { useTransition } from "react";
import { errorMessage } from "@/components/admin/use-admin-action";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { toastManager } from "@/components/ui/toast";
import { devResetDatabaseAction } from "../actions";

/** Dev only: wipe the database and load demo data. Rendered only when the dev login is on. */
export function DevResetCard() {
  const [pending, startTransition] = useTransition();
  function reset() {
    startTransition(async () => {
      const res = await devResetDatabaseAction(); // redirects to /login on success
      if (res && !res.ok) toastManager.add({ type: "error", title: errorMessage(res.error) });
    });
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Developer tools</CardTitle>
        <CardDescription>
          Deletes everything (users included), seeds operators, payout methods and demo data — users, listings, balances
          and orders in every state — then signs you out. Log in again with the dev login. Only available in development.
        </CardDescription>
      </CardHeader>
      <CardFooter>
        <AlertDialog>
          <AlertDialogTrigger render={<Button variant="destructive" disabled={pending} />}>
            <DatabaseZapIcon aria-hidden="true" />
            {pending ? "Resetting…" : "Reset & seed database"}
          </AlertDialogTrigger>
          <AlertDialogPopup>
            <AlertDialogHeader>
              <AlertDialogTitle>Reset the database?</AlertDialogTitle>
              <AlertDialogDescription>
                All data is deleted and replaced by demo data. You will be signed out. This cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogClose render={<Button variant="ghost" />}>Cancel</AlertDialogClose>
              <AlertDialogClose render={<Button variant="destructive" onClick={reset} />}>Reset & seed</AlertDialogClose>
            </AlertDialogFooter>
          </AlertDialogPopup>
        </AlertDialog>
      </CardFooter>
    </Card>
  );
}
