import { ArrowRightIcon, ChevronDownIcon } from "lucide-react";
import Link from "next/link";
import { OrderStatusBadge } from "@/components/app/market-badges";
import { Dt } from "@/components/app/money";
import { OperatorLogo } from "@/components/app/operator-badge";
import { Button } from "@/components/ui/button";
import type { OrderStatus } from "@/db/schema";

type Op = { code: string; name: string; color: string };

/** One order in a list: operator, amount, the other person, status. Opens the order. */
export function OrderRow({
  href,
  op,
  amountMillimes,
  who,
  status,
  when,
  orderRef,
  children,
}: {
  href: string;
  op: Op;
  amountMillimes: number;
  who: React.ReactNode;
  status: OrderStatus;
  when: string;
  orderRef: string;
  children?: React.ReactNode;
}) {
  return (
    <li>
      <Link href={href} className="flex items-center gap-4 p-4 transition-colors hover:bg-accent/60">
        <OperatorLogo code={op.code} name={op.name} color={op.color} className="size-12 rounded-xl" />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <Dt compact millimes={amountMillimes} className="font-semibold text-lg" />
            <span className="text-muted-foreground text-sm">· {who}</span>
          </div>
          {children}
          <div className="flex flex-wrap items-center gap-2">
            <OrderStatusBadge status={status} />
            <span className="text-muted-foreground text-xs">
              {when} · <span className="font-mono">{orderRef}</span>
            </span>
          </div>
        </div>
        <ArrowRightIcon aria-hidden="true" className="size-5 shrink-0 text-muted-foreground rtl:rotate-180" />
      </Link>
    </li>
  );
}

/** An order waiting for the viewer: what to do in one line and one big button. */
export function ActionOrderCard({
  href,
  op,
  amountMillimes,
  who,
  todo,
  cta,
  icon,
}: {
  href: string;
  op: Op;
  amountMillimes: number;
  who: React.ReactNode;
  todo: React.ReactNode;
  cta: string;
  icon: React.ReactNode;
}) {
  return (
    <li className="flex flex-col gap-3 rounded-2xl border-2 border-amber-500/50 bg-amber-500/6 p-4">
      <div className="flex items-center gap-3">
        <OperatorLogo code={op.code} name={op.name} color={op.color} className="size-11 rounded-xl" />
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <Dt compact millimes={amountMillimes} className="font-bold text-lg" />
            <span className="text-muted-foreground text-sm">· {who}</span>
          </div>
          <span className="font-semibold">{todo}</span>
        </div>
      </div>
      <Button variant="go" className="h-12 w-full text-base sm:h-12" render={<Link href={href} />}>
        {icon}
        {cta}
        <ArrowRightIcon aria-hidden="true" className="ms-auto rtl:rotate-180" />
      </Button>
    </li>
  );
}

/** A collapsed list (e.g. finished orders) with its count in the title. */
export function CollapsedList({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <details className="group rounded-2xl border bg-card">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 font-semibold [&::-webkit-details-marker]:hidden">
        <span>
          {title} <span className="font-normal text-muted-foreground">({count})</span>
        </span>
        <ChevronDownIcon aria-hidden="true" className="size-5 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <ul className="flex flex-col divide-y border-t">{children}</ul>
    </details>
  );
}

/** Section title with an optional short hint. */
export function SectionTitle({ title, hint, action }: { title: React.ReactNode; hint?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="font-heading font-semibold text-xl">{title}</h2>
        {hint && <p className="text-muted-foreground text-sm">{hint}</p>}
      </div>
      {action}
    </div>
  );
}
