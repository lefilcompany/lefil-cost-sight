import { useState, type ReactNode } from "react";
import { ChevronDown, Inbox, Loader2 } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";

/**
 * Unified UI kit shared by every authenticated page.
 *
 * Goals:
 * - Consistent KPI card visuals across dashboard / costs / syncs / CRUD.
 * - Single empty & loading state so filters, first-run and errors read the same.
 * - CollapsibleSection keeps secondary detail available without visual noise.
 */

// ---------- KpiCard ---------------------------------------------------------

export type KpiTone = "neutral" | "good" | "warn" | "bad";

const TONE_CLS: Record<KpiTone, string> = {
  neutral: "text-foreground",
  good: "text-emerald-600 dark:text-emerald-400",
  warn: "text-amber-600 dark:text-amber-400",
  bad: "text-rose-600 dark:text-rose-400",
};

export function KpiCard({
  label,
  value,
  sub,
  icon,
  tone = "neutral",
}: {
  label: string;
  value: string;
  sub?: string;
  icon?: ReactNode;
  tone?: KpiTone;
}) {
  return (
    <Card className="surface-elevated">
      <CardContent className="px-5 py-5">
        <div className="flex items-center gap-2">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {label}
          </p>
          {icon && <span className="ml-auto text-muted-foreground/70">{icon}</span>}
        </div>
        <p
          className={`mt-3 font-numeric text-[28px] font-semibold leading-none tracking-tight ${TONE_CLS[tone]}`}
        >
          {value}
        </p>
        {sub && <p className="mt-2 text-[11px] text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}

// ---------- CollapsibleSection ---------------------------------------------

/**
 * Secondary content wrapper: collapsed by default so pages stay calm,
 * expandable when the user actually wants the detail.
 */
export function CollapsibleSection({
  title,
  description,
  defaultOpen = false,
  actions,
  children,
  className,
}: {
  title: string;
  description?: string;
  defaultOpen?: boolean;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section
      className={`overflow-hidden rounded-xl border border-border/60 bg-card/50 ${className ?? ""}`}
    >
      <div className="flex items-center gap-3 px-4 py-3">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <ChevronDown
            className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "" : "-rotate-90"}`}
          />
          <span className="truncate text-sm font-medium">{title}</span>
          {description && (
            <span className="hidden truncate text-xs text-muted-foreground md:inline">
              {description}
            </span>
          )}
        </button>
        {actions}
      </div>
      {open && <div className="border-t border-border/60">{children}</div>}
    </section>
  );
}

// ---------- EmptyState ------------------------------------------------------

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`py-14 text-center ${className ?? ""}`}>
      <div className="mx-auto max-w-sm space-y-3">
        <div className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-muted text-muted-foreground">
          {icon ?? <Inbox className="h-4 w-4" />}
        </div>
        <p className="font-display text-sm font-medium">{title}</p>
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
        {action && <div className="flex justify-center pt-1">{action}</div>}
      </div>
    </div>
  );
}

// ---------- LoadingState ----------------------------------------------------

export function LoadingState({
  label = "Carregando...",
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <div
      className={`flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground ${className ?? ""}`}
    >
      <Loader2 className="h-4 w-4 animate-spin" />
      <span>{label}</span>
    </div>
  );
}
