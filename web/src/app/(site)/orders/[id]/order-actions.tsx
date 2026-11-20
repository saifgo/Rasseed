"use client";

import { BanIcon, CheckIcon, FlagIcon, HandCoinsIcon, PackageIcon, StarIcon, UploadIcon, XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Dt } from "@/components/app/money";
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
import { Textarea } from "@/components/ui/textarea";
import { toastManager } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import {
  acceptExcessAction,
  cancelByBuyerAction,
  cancelBySellerAction,
  chooseLeftoverAction,
  confirmPaymentAction,
  flagToAdminAction,
  rateSellerAction,
  refuseExcessAction,
  reportNotPaidAction,
  takePartialAction,
  uploadProofsAction,
} from "../../_market/actions";

type Result = { ok: boolean; error?: string };

/** Runs a server action, shows an error toast if it fails, then refreshes the page. */
function useAct() {
  const te = useTranslations("errors");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  function act(fn: () => Promise<Result>, success?: string) {
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) toastManager.add({ type: "error", title: te.has(res.error ?? "") ? te(res.error!) : te("unknown") });
      else if (success) toastManager.add({ type: "success", title: success });
      router.refresh();
    });
  }
  return { act, pending };
}

const bigButton = "h-12 text-base sm:h-12";

/** Confirmation dialog, optionally asking for a reason. */
function ConfirmDialog({
  trigger,
  title,
  text,
  confirm,
  onConfirm,
  reason,
  reasonRequired,
  destructive,
  disabled,
}: {
  trigger: { variant: React.ComponentProps<typeof Button>["variant"]; className?: string; content: React.ReactNode };
  title: string;
  text: React.ReactNode;
  confirm: string;
  onConfirm: (reason: string) => void;
  reason?: string;
  reasonRequired?: boolean;
  destructive?: boolean;
  disabled?: boolean;
}) {
  const t = useTranslations("market");
  const [value, setValue] = useState("");
  const blocked = reasonRequired && !value.trim();
  return (
    <AlertDialog>
      <AlertDialogTrigger disabled={disabled} render={<Button variant={trigger.variant} className={trigger.className} />}>
        {trigger.content}
      </AlertDialogTrigger>
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription render={<div />}>{text}</AlertDialogDescription>
          {reason !== undefined && (
            <label className="mt-2 flex flex-col gap-1.5 text-sm">
              <span className="font-medium">{reason}</span>
              <Textarea value={value} onChange={(e) => setValue(e.target.value)} maxLength={1000} />
            </label>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="ghost" />}>{t("goBack")}</AlertDialogClose>
          <AlertDialogClose
            disabled={blocked}
            render={<Button variant={destructive ? "destructive" : "go"} onClick={() => onConfirm(value)} />}
          >
            {confirm}
          </AlertDialogClose>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}

// Buyer ----------------------------------------------------------------------

export function TakePartialButton({ orderId, fundedMillimes }: { orderId: string; fundedMillimes: number }) {
  const t = useTranslations("market");
  const { act, pending } = useAct();
  return (
    <ConfirmDialog
      trigger={{
        variant: "outline",
        className: bigButton,
        content: (
          <>
            {t("partialTake")}
            <Dt compact millimes={fundedMillimes} className="font-semibold" />
          </>
        ),
      }}
      disabled={pending}
      title={t("partialConfirmTitle")}
      text={t("partialConfirmText")}
      confirm={t("partialConfirm")}
      onConfirm={() => act(() => takePartialAction(orderId))}
    />
  );
}

export function BuyerCancelButton({ orderId, badMark }: { orderId: string; badMark: boolean }) {
  const t = useTranslations("market");
  const { act, pending } = useAct();
  return (
    <ConfirmDialog
      trigger={{
        variant: "ghost",
        className: "self-center text-destructive-foreground",
        content: (
          <>
            <BanIcon aria-hidden="true" />
            {t("cancelOrder")}
          </>
        ),
      }}
      disabled={pending}
      title={t("cancelOrderTitle")}
      text={badMark ? <span className="font-medium text-destructive-foreground">{t("cancelBadMarkWarning")}</span> : t("cancelOrderText")}
      confirm={t("cancelOrder")}
      destructive
      onConfirm={() => act(() => cancelByBuyerAction(orderId))}
    />
  );
}

export function ExcessChoice({ orderId, excessMillimes }: { orderId: string; excessMillimes: number }) {
  const t = useTranslations("market");
  const { act, pending } = useAct();
  return (
    <span className="flex flex-col gap-2">
      <Button variant="go" className={bigButton} disabled={pending} onClick={() => act(() => acceptExcessAction(orderId))}>
        <CheckIcon aria-hidden="true" />
        {t("excessAccept")}
      </Button>
      <Button variant="outline" className={bigButton} disabled={pending} onClick={() => act(() => refuseExcessAction(orderId))}>
        <XIcon aria-hidden="true" />
        {t("excessRefuse")}
        <Dt compact millimes={excessMillimes} className="text-muted-foreground" />
      </Button>
    </span>
  );
}

const MAX_FILE = 5 * 1024 * 1024;
// Server actions accept up to 6 MB per request, so bigger selections are sent in several parts.
const MAX_BATCH = 5.5 * 1024 * 1024;
const ACCEPT = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

export function ProofUpload({ orderId, first }: { orderId: string; first: boolean }) {
  const t = useTranslations("market");
  const te = useTranslations("errors");
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function pick(list: FileList | null) {
    setError(null);
    const chosen = Array.from(list ?? []);
    if (chosen.some((f) => !ACCEPT.includes(f.type))) return setError(te("unsupported_file_type"));
    if (chosen.some((f) => f.size > MAX_FILE)) return setError(te("file_too_large"));
    setFiles(chosen);
  }

  function send() {
    if (files.length === 0) return setError(te("proof_required"));
    const batches: File[][] = [];
    let size = 0;
    for (const f of files) {
      if (batches.length === 0 || size + f.size > MAX_BATCH) {
        batches.push([]);
        size = 0;
      }
      batches[batches.length - 1].push(f);
      size += f.size;
    }
    startTransition(async () => {
      for (const batch of batches) {
        const fd = new FormData();
        fd.set("orderId", orderId);
        for (const f of batch) fd.append("files", f);
        const res = await uploadProofsAction(fd);
        if (!res.ok) {
          setError(te.has(res.error) ? te(res.error) : te("unknown"));
          router.refresh();
          return;
        }
      }
      setFiles([]);
      if (inputRef.current) inputRef.current.value = "";
      toastManager.add({ type: "success", title: t("proofSent") });
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <label
        className={cn(
          "flex cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed p-5 text-center transition-colors hover:bg-accent/50",
          files.length > 0 && "border-emerald-600 bg-emerald-600/6",
        )}
      >
        <UploadIcon aria-hidden="true" className="size-7 text-muted-foreground" />
        <span className="font-semibold">{first ? t("proofPick") : t("proofPickMore")}</span>
        <span className="text-muted-foreground text-sm">{t("proofHint")}</span>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT.join(",")}
          className="sr-only"
          onChange={(e) => pick(e.target.files)}
        />
      </label>
      {files.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm">
          {files.map((f) => (
            <li key={f.name + f.size} className="truncate">
              {f.name}
            </li>
          ))}
        </ul>
      )}
      {error && <p className="font-medium text-destructive-foreground">{error}</p>}
      <Button variant={first ? "go" : "outline"} className={bigButton} loading={pending} disabled={files.length === 0} onClick={send}>
        <UploadIcon aria-hidden="true" />
        {first ? t("proofSend") : t("proofSendMore")}
      </Button>
    </div>
  );
}

export function FlagButton({ orderId }: { orderId: string }) {
  const t = useTranslations("market");
  const { act, pending } = useAct();
  return (
    <ConfirmDialog
      trigger={{
        variant: "outline",
        className: bigButton,
        content: (
          <>
            <FlagIcon aria-hidden="true" />
            {t("flag")}
          </>
        ),
      }}
      disabled={pending}
      title={t("flagTitle")}
      text={t("flagText")}
      reason={t("flagReason")}
      confirm={t("flagConfirm")}
      onConfirm={(reason) => act(() => flagToAdminAction(orderId, reason), t("flagDone"))}
    />
  );
}

export function RateForm({ orderId }: { orderId: string }) {
  const t = useTranslations("market");
  const { act, pending } = useAct();
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState("");
  return (
    <form
      className="flex flex-col gap-3 rounded-2xl border bg-card p-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (stars > 0) act(() => rateSellerAction(orderId, stars, comment), t("rateDone"));
      }}
    >
      <h2 className="font-heading font-bold text-xl">{t("rateTitle")}</h2>
      <div className="flex gap-1" role="radiogroup" aria-label={t("rateTitle")}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={stars === n}
            aria-label={t("starsLabel", { count: n })}
            onClick={() => setStars(n)}
            className="rounded-lg p-1 transition-colors hover:bg-accent"
          >
            <StarIcon aria-hidden="true" className={cn("size-9", n <= stars ? "fill-amber-400 text-amber-500" : "text-muted-foreground/50")} />
          </button>
        ))}
      </div>
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">{t("rateComment")}</span>
        <Textarea value={comment} onChange={(e) => setComment(e.target.value)} maxLength={500} />
      </label>
      <Button type="submit" variant="go" className={bigButton} loading={pending} disabled={stars === 0}>
        {t("rateSend")}
      </Button>
    </form>
  );
}

// Seller ---------------------------------------------------------------------

export function SellerCancelButton({ orderId }: { orderId: string }) {
  const t = useTranslations("market");
  const { act, pending } = useAct();
  return (
    <ConfirmDialog
      trigger={{
        variant: "ghost",
        className: "self-center text-destructive-foreground",
        content: (
          <>
            <BanIcon aria-hidden="true" />
            {t("cancelOrder")}
          </>
        ),
      }}
      disabled={pending}
      title={t("cancelOrderTitle")}
      text={t("sellerCancelText")}
      reason={t("cancelReason")}
      confirm={t("cancelOrder")}
      destructive
      onConfirm={(reason) => act(() => cancelBySellerAction(orderId, reason))}
    />
  );
}

export function ConfirmPaidButton({ orderId, payMillimes }: { orderId: string; payMillimes: number }) {
  const t = useTranslations("market");
  const { act, pending } = useAct();
  return (
    <ConfirmDialog
      trigger={{
        variant: "go",
        className: bigButton,
        content: (
          <>
            <CheckIcon aria-hidden="true" />
            {t("confirmPaid")}
          </>
        ),
      }}
      disabled={pending}
      title={t("confirmPaidTitle")}
      text={t.rich("confirmPaidText", { pay: () => <Dt compact millimes={payMillimes} className="font-semibold text-foreground" /> })}
      confirm={t("confirmPaid")}
      onConfirm={() => act(() => confirmPaymentAction(orderId), t("confirmPaidDone"))}
    />
  );
}

export function NotPaidButton({ orderId }: { orderId: string }) {
  const t = useTranslations("market");
  const { act, pending } = useAct();
  return (
    <ConfirmDialog
      trigger={{
        variant: "destructive-outline",
        className: bigButton,
        content: (
          <>
            <FlagIcon aria-hidden="true" />
            {t("notPaid")}
          </>
        ),
      }}
      disabled={pending}
      title={t("notPaidTitle")}
      text={t("notPaidText")}
      reason={t("notPaidReason")}
      confirm={t("notPaid")}
      destructive
      onConfirm={(reason) => act(() => reportNotPaidAction(orderId, reason))}
    />
  );
}

export function LeftoverChoice({ orderId, cashMillimes }: { orderId: string; cashMillimes: number }) {
  const t = useTranslations("market");
  const { act, pending } = useAct();
  return (
    <span className="flex flex-col gap-2">
      <Button variant="outline" className={bigButton} disabled={pending} onClick={() => act(() => chooseLeftoverAction(orderId, "stock"))}>
        <PackageIcon aria-hidden="true" />
        {t("leftoverKeep")}
      </Button>
      <ConfirmDialog
        trigger={{
        variant: "go",
        className: bigButton,
        content: (
          <>
              <HandCoinsIcon aria-hidden="true" />
              {t("leftoverSell")}
              <Dt compact millimes={cashMillimes} className="[&_span]:text-white/80" />
          </>
        ),
      }}
        disabled={pending}
        title={t("leftoverSellTitle")}
        text={t.rich("leftoverSellText", { cash: () => <Dt compact millimes={cashMillimes} className="font-semibold text-foreground" /> })}
        confirm={t("leftoverSell")}
        onConfirm={() => act(() => chooseLeftoverAction(orderId, "sarfli"), t("leftoverSold"))}
      />
    </span>
  );
}
