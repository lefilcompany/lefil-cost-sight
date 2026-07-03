import type { ReactNode } from "react";
import { Inbox, Loader2 } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";

/**
 * Unified UI kit shared by every authenticated page.
 *
 * Goals:
 * - Consistent KPI card visuals across dashboard / costs / syncs / CRUD.
 * - Single empty & loading state so filters, first-run and errors read the same.
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
      <CardContent className="pt-5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {label}
          </p>
          {icon && (
            <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-border/60 bg-muted/40 text-muted-foreground">
              {icon}
            </div>
          )}
        </div>
        <p
          className={`mt-2 font-numeric text-2xl font-semibold tracking-tight ${TONE_CLS[tone]}`}
        >
          {value}
        </p>
        {sub && <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
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
    <div className={`py-16 text-center ${className ?? ""}`}>
      <div className="mx-auto max-w-sm space-y-3">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-muted text-muted-foreground">
          {icon ?? <Inbox className="h-5 w-5" />}
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
