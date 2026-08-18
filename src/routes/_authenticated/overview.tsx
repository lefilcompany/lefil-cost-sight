import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowRight,
  Bell,
  CircleDollarSign,
  FileWarning,
  Layers,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  WalletCards,
} from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CollapsibleSection, EmptyState, KpiCard, LoadingState } from "@/components/ui-kit";
import { supabase } from "@/integrations/supabase/client";
import {
  entriesForMonth,
  latestByKey,
  percentageChange,
  previousMonth,
  projectMonthEnd,
  sumCostBrl,
} from "@/lib/financial-metrics";
import { fmtBRL, fmtDate } from "@/lib/format";
import { useAutoSync } from "@/hooks/use-auto-sync";

export const Route = createFileRoute("/_authenticated/overview")({
  head: () => ({ meta: [{ title: "Visão geral — Quiwi Cost Center" }] }),
  component: OverviewPage,
});

type CostEntry = {
  id: string;
  entry_date: string;
  cost_brl: number | null;
  cost_usd: number | null;
  description: string | null;
  platform_id: string | null;
  provider_id: string | null;
  client_id: string | null;
  providers?: { name: string } | null;
  platforms?: { name: string; color: string | null } | null;
  clients?: { name: string } | null;
};

type BillingSnapshot = {
  id: string;
  connection_id: string;
  projected_cost_usd: number | null;
  cost_period_usd: number | null;
  captured_at: string;
};

type Invoice = {
  id: string;
  status: string;
  amount_brl: number;
  issued_at: string | null;
  providers?: { name: string } | null;
};

type AlertEvent = {
  id: string;
  severity: string;
  title: string;
  status: string;
  created_at: string;
};

type SyncLog = {
  id: string;
  connection_id: string | null;
  status: string;
  started_at: string;
  error_message: string | null;
  provider_connections?: { name: string } | null;
  providers?: { name: string } | null;
};

async function fetchOverviewData() {
  const [costs, snapshots, invoices, alerts, syncs] = await Promise.all([
    supabase
      .from("cost_entries")
      .select("*, providers(name), platforms(name,color), clients(name)")
      .order("entry_date", { ascending: false })
      .limit(10000),
    supabase
      .from("provider_billing_snapshots")
      .select("id,connection_id,projected_cost_usd,cost_period_usd,captured_at")
      .order("captured_at", { ascending: false })
      .limit(500),
    supabase
      .from("provider_invoices")
      .select("id,status,amount_brl,issued_at,providers(name)")
      .order("issued_at", { ascending: false, nullsFirst: false })
      .limit(500),
    supabase
      .from("alert_events")
      .select("id,severity,title,status,created_at")
      .neq("status", "resolved")
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("sync_logs")
      .select("id,connection_id,status,started_at,error_message,provider_connections(name),providers(name)")
      .order("started_at", { ascending: false })
      .limit(500),
  ]);

  for (const result of [costs, snapshots, invoices, alerts, syncs]) {
    if (result.error) throw result.error;
  }

  return {
    costs: (costs.data ?? []) as CostEntry[],
    snapshots: (snapshots.data ?? []) as BillingSnapshot[],
    invoices: (invoices.data ?? []) as Invoice[],
    alerts: (alerts.data ?? []) as AlertEvent[],
    syncs: (syncs.data ?? []) as SyncLog[],
  };
}

function OverviewPage() {
  useAutoSync(["overview-financial-data", "cost_entries", "provider_invoices", "alert_events"]);
  const { data, isLoading } = useQuery({
    queryKey: ["overview-financial-data"],
    queryFn: fetchOverviewData,
  });

  const metrics = useMemo(() => {
    const now = new Date();
    const costs = data?.costs ?? [];
    const monthEntries = entriesForMonth(costs, now);
    const previousEntries = entriesForMonth(costs, previousMonth(now));
    const currentCost = sumCostBrl(monthEntries);
    const previousCost = sumCostBrl(previousEntries);
    const projectedCost = projectMonthEnd(currentCost, now);
    const change = percentageChange(currentCost, previousCost);

    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const currentInvoices = (data?.invoices ?? []).filter((invoice) =>
      invoice.issued_at?.startsWith(currentMonth),
    );
    const pendingInvoices = currentInvoices.filter((invoice) =>
      !["paid", "cancelled", "canceled"].includes(invoice.status.toLowerCase()),
    );
    const pendingInvoiceValue = pendingInvoices.reduce(
      (total, invoice) => total + Number(invoice.amount_brl ?? 0),
      0,
    );

    const unallocated = monthEntries.filter((entry) => !entry.platform_id || !entry.client_id);
    const criticalAlerts = (data?.alerts ?? []).filter((alert) => alert.severity === "critical");
    const latestSyncs = latestByKey(
      (data?.syncs ?? []).filter((sync) => sync.connection_id),
      (sync) => sync.connection_id ?? sync.id,
    );
    const failedSyncs = latestSyncs.filter((sync) => sync.status === "error");

    const providerMap = new Map<string, number>();
    const centerMap = new Map<string, { name: string; value: number; color?: string | null }>();
    for (const entry of monthEntries) {
      const provider = entry.providers?.name ?? "Sem fornecedor";
      providerMap.set(provider, (providerMap.get(provider) ?? 0) + Number(entry.cost_brl ?? 0));

      const centerKey = entry.platform_id ?? "unallocated";
      const current = centerMap.get(centerKey) ?? {
        name: entry.platforms?.name ?? "Sem centro de custo",
        value: 0,
        color: entry.platforms?.color,
      };
      current.value += Number(entry.cost_brl ?? 0);
      centerMap.set(centerKey, current);
    }

    const byProvider = [...providerMap.entries()]
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
    const byCenter = [...centerMap.values()].sort((a, b) => b.value - a.value);

    return {
      monthEntries,
      currentCost,
      previousCost,
      projectedCost,
      change,
      pendingInvoices,
      pendingInvoiceValue,
      unallocated,
      criticalAlerts,
      failedSyncs,
      byProvider,
      byCenter,
    };
  }, [data]);

  if (isLoading) {
    return (
      <AppShell title="Visão geral">
        <LoadingState label="Consolidando custos, faturas e alertas..." />
      </AppShell>
    );
  }

  const actions = [
    {
      title: "Custos sem alocação",
      value: metrics.unallocated.length,
      description: "Lançamentos sem cliente ou centro de custo.",
      url: "/costs",
      icon: Layers,
      tone: metrics.unallocated.length > 0 ? "warn" : "ok",
    },
    {
      title: "Faturas pendentes",
      value: metrics.pendingInvoices.length,
      description: metrics.pendingInvoiceValue > 0 ? fmtBRL(metrics.pendingInvoiceValue) : "Nenhuma cobrança pendente.",
      url: "/invoices",
      icon: FileWarning,
      tone: metrics.pendingInvoices.length > 0 ? "warn" : "ok",
    },
    {
      title: "Alertas críticos",
      value: metrics.criticalAlerts.length,
      description: "Eventos abertos que exigem revisão.",
      url: "/alerts",
      icon: Bell,
      tone: metrics.criticalAlerts.length > 0 ? "bad" : "ok",
    },
    {
      title: "Integrações com falha",
      value: metrics.failedSyncs.length,
      description: "Última execução da conexão terminou com erro.",
      url: "/syncs",
      icon: RefreshCw,
      tone: metrics.failedSyncs.length > 0 ? "bad" : "ok",
    },
  ];

  const pending = actions.filter((action) => action.value > 0);

  return (
    <AppShell
      title="Visão geral"
      actions={
        <Link to="/costs">
          <Button size="sm" variant="outline" className="gap-1.5">
            Lançamentos <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </Link>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 md:grid-cols-3">
          <KpiCard
            label="Gasto no mês"
            value={fmtBRL(metrics.currentCost)}
            sub={`${metrics.change >= 0 ? "+" : ""}${metrics.change.toFixed(1)}% vs. mês anterior`}
            icon={metrics.change >= 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
            tone={metrics.change > 15 ? "bad" : metrics.change < -5 ? "good" : "neutral"}
          />
          <KpiCard
            label="Projeção do mês"
            value={fmtBRL(metrics.projectedCost)}
            icon={<CircleDollarSign className="h-4 w-4" />}
            tone={metrics.projectedCost > metrics.currentCost * 1.25 ? "warn" : "neutral"}
          />
          <KpiCard
            label="Faturas pendentes"
            value={fmtBRL(metrics.pendingInvoiceValue)}
            sub={`${metrics.pendingInvoices.length} documento(s)`}
            icon={<WalletCards className="h-4 w-4" />}
            tone={metrics.pendingInvoices.length > 0 ? "warn" : "good"}
          />
        </div>

        {pending.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            {pending.map((action) => (
              <Link
                key={action.title}
                to={action.url}
                className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/60 px-3 py-1.5 text-xs transition hover:border-primary/40"
              >
                <action.icon className={`h-3.5 w-3.5 ${action.tone === "bad" ? "text-rose-500" : "text-amber-500"}`} />
                <span className="font-medium">{action.title}</span>
                <span className="font-numeric text-muted-foreground">{action.value}</span>
              </Link>
            ))}
          </div>
        )}

        <Card className="surface-elevated">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Gasto por fornecedor</CardTitle>
          </CardHeader>
          <CardContent>
            {metrics.byProvider.length === 0 ? (
              <EmptyState title="Sem custos no mês" description="Sincronize uma integração ou registre um lançamento." />
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={metrics.byProvider.slice(0, 6)} layout="vertical" margin={{ left: 18, right: 12 }}>
                  <CartesianGrid strokeDasharray="2 4" stroke="var(--color-border)" horizontal={false} />
                  <XAxis type="number" stroke="var(--color-muted-foreground)" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis type="category" dataKey="name" width={110} stroke="var(--color-muted-foreground)" fontSize={11} tickLine={false} axisLine={false} />
                  <Tooltip
                    formatter={(value: number) => fmtBRL(value)}
                    contentStyle={{ background: "var(--color-popover)", border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 12 }}
                  />
                  <Bar dataKey="value" fill="var(--color-primary)" radius={[0, 6, 6, 0]} maxBarSize={22} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <CollapsibleSection title="Centros de custo" description="Onde o gasto do mês está concentrado">
          <div className="space-y-2 p-4">
            {metrics.byCenter.length === 0 ? (
              <EmptyState title="Sem alocações" />
            ) : (
              metrics.byCenter.slice(0, 7).map((center) => {
                const share = metrics.currentCost > 0 ? (center.value / metrics.currentCost) * 100 : 0;
                return (
                  <div key={center.name}>
                    <div className="flex items-center justify-between gap-3">
                      <span className="flex min-w-0 items-center gap-2 text-sm">
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: center.color ?? "var(--color-primary)" }} />
                        <span className="truncate">{center.name}</span>
                      </span>
                      <span className="font-numeric text-xs">{fmtBRL(center.value)}</span>
                    </div>
                    <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, share)}%` }} />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </CollapsibleSection>

        <CollapsibleSection
          title="Lançamentos recentes"
          description={`${metrics.monthEntries.length} no mês`}
          actions={
            <Link to="/costs" className="text-xs font-medium text-primary hover:underline">
              Ver todos
            </Link>
          }
        >
          {metrics.monthEntries.length === 0 ? (
            <div className="p-4"><EmptyState title="Nenhum lançamento no mês" /></div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Fornecedor</TableHead>
                    <TableHead>Centro de custo</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {metrics.monthEntries.slice(0, 8).map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell className="whitespace-nowrap text-xs">{fmtDate(entry.entry_date)}</TableCell>
                      <TableCell className="text-xs">{entry.providers?.name ?? "—"}</TableCell>
                      <TableCell className="text-xs">{entry.platforms?.name ?? <Badge variant="outline">Sem alocação</Badge>}</TableCell>
                      <TableCell className="text-right font-numeric text-sm">{fmtBRL(entry.cost_brl)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CollapsibleSection>
      </div>
    </AppShell>
  );
}

