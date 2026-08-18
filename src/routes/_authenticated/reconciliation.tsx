import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock, RefreshCw, Scale } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, KpiCard, LoadingState } from "@/components/ui-kit";
import { supabase } from "@/integrations/supabase/client";
import {
  getReconciliationSettings,
  runCostReconciliation,
  updateReconciliationTolerance,
} from "@/lib/reconciliation.functions";

export const Route = createFileRoute("/_authenticated/reconciliation")({
  head: () => ({
    meta: [
      { title: "Reconciliação de custos — Quiwi Cost Center" },
      {
        name: "description",
        content:
          "Compare o custo estimado pelo uso com o custo confirmado em faturas e billing, com alertas de divergência.",
      },
      { property: "og:title", content: "Reconciliação de custos — Quiwi Cost Center" },
      {
        property: "og:description",
        content: "Auditoria de divergências entre uso estimado e custo confirmado por fornecedor e mês.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ReconciliationPage,
});

type Reconciliation = {
  id: string;
  reconciliation_date: string;
  model: string | null;
  sku_id: string | null;
  estimated_cost: number | null;
  confirmed_cost: number | null;
  difference_amount: number | null;
  difference_percentage: number | null;
  status: string;
  explanation: string | null;
  reconciled_at: string | null;
};

const STATUS_META: Record<string, { label: string; className: string }> = {
  matched: { label: "Conferido", className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" },
  divergent: { label: "Divergente", className: "bg-rose-500/10 text-rose-700 dark:text-rose-300" },
  pending: { label: "Aguardando fatura", className: "bg-amber-500/10 text-amber-700 dark:text-amber-300" },
};

const usd = (v: number | null | undefined) =>
  v == null
    ? "—"
    : v.toLocaleString("pt-BR", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

const monthLabel = (value: string) =>
  new Date(`${value}T00:00:00Z`).toLocaleDateString("pt-BR", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

function ReconciliationPage() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState("all");
  const [term, setTerm] = useState("");
  const [months, setMonths] = useState("3");
  const [toleranceDraft, setToleranceDraft] = useState("");

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["cost-reconciliations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cost_reconciliations")
        .select(
          "id, reconciliation_date, model, sku_id, estimated_cost, confirmed_cost, difference_amount, difference_percentage, status, explanation, reconciled_at",
        )
        .order("reconciliation_date", { ascending: false })
        .limit(1000);
      if (error) throw error;
      return (data ?? []) as Reconciliation[];
    },
    refetchInterval: 120_000,
  });

  const { data: settings } = useQuery({
    queryKey: ["reconciliation-settings"],
    queryFn: () => getReconciliationSettings({ data: undefined as never }),
  });

  const tolerance = settings?.tolerance_pct ?? 5;

  const run = useMutation({
    mutationFn: () => runCostReconciliation({ data: { months: Number(months) } }),
    onSuccess: (res: any) => {
      toast.success(
        `Reconciliação concluída: ${res?.rows?.length ?? 0} período(s), ${res?.divergent ?? 0} divergente(s), ${res?.created_events ?? 0} alerta(s) criado(s)`,
      );
      queryClient.invalidateQueries({ queryKey: ["cost-reconciliations"] });
    },
    onError: (err: any) => toast.error(err?.message ?? "Falha ao reconciliar"),
  });

  const saveTolerance = useMutation({
    mutationFn: () => updateReconciliationTolerance({ data: { tolerance_pct: Number(toleranceDraft) } }),
    onSuccess: (res: any) => {
      toast.success(`Tolerância atualizada para ${res?.tolerance_pct}%`);
      setToleranceDraft("");
      queryClient.invalidateQueries({ queryKey: ["reconciliation-settings"] });
    },
    onError: (err: any) => toast.error(err?.message ?? "Falha ao salvar a tolerância"),
  });

  const filtered = useMemo(() => {
    const q = term.trim().toLowerCase();
    return rows.filter((r) => {
      if (status !== "all" && r.status !== status) return false;
      if (!q) return true;
      return [r.model, r.explanation, r.reconciliation_date]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [rows, status, term]);

  const summary = useMemo(() => {
    const count = (s: string) => filtered.filter((r) => r.status === s).length;
    const estimated = filtered.reduce((a, r) => a + Number(r.estimated_cost ?? 0), 0);
    const confirmed = filtered.reduce((a, r) => a + Number(r.confirmed_cost ?? 0), 0);
    return {
      estimated,
      confirmed,
      diff: estimated - confirmed,
      matched: count("matched"),
      divergent: count("divergent"),
      pending: count("pending"),
    };
  }, [filtered]);

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Reconciliação de custos</h1>
            <p className="text-sm text-muted-foreground">
              Uso estimado x custo confirmado (fatura ou billing do provedor) por fornecedor e mês. Divergências acima de{" "}
              {tolerance}% geram alerta.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={months} onValueChange={setMonths}>
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">Mês atual</SelectItem>
                <SelectItem value="3">3 meses</SelectItem>
                <SelectItem value="6">6 meses</SelectItem>
                <SelectItem value="12">12 meses</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" asChild>
              <Link to="/alerts">Ver alertas</Link>
            </Button>
            <Button size="sm" onClick={() => run.mutate()} disabled={run.isPending}>
              <RefreshCw className={`mr-2 h-4 w-4 ${run.isPending ? "animate-spin" : ""}`} />
              Reconciliar agora
            </Button>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            label="Estimado"
            value={usd(summary.estimated)}
            sub="Soma do uso diário"
            icon={<Scale className="h-4 w-4" />}
          />
          <KpiCard label="Confirmado" value={usd(summary.confirmed)} sub="Faturas e billing" tone="good" />
          <KpiCard
            label="Diferença"
            value={usd(summary.diff)}
            sub={`${summary.divergent} divergente(s)`}
            tone={summary.divergent > 0 ? "bad" : "neutral"}
            icon={<AlertTriangle className="h-4 w-4" />}
          />
          <KpiCard
            label="Situação"
            value={`${summary.matched} ok`}
            sub={`${summary.pending} aguardando fatura`}
            icon={<CheckCircle2 className="h-4 w-4" />}
          />
        </div>

        <Card>
          <CardHeader className="gap-3">
            <CardTitle className="text-sm font-medium">Limite de divergência</CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                className="w-32"
                type="number"
                min={0.1}
                max={100}
                step={0.5}
                placeholder={String(tolerance)}
                value={toleranceDraft}
                onChange={(e) => setToleranceDraft(e.target.value)}
              />
              <span className="text-sm text-muted-foreground">
                % — atual: <strong>{tolerance}%</strong>
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={!toleranceDraft || saveTolerance.isPending}
                onClick={() => saveTolerance.mutate()}
              >
                Salvar limite
              </Button>
            </div>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader className="gap-3">
            <CardTitle className="text-sm font-medium">Períodos reconciliados</CardTitle>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              <Input
                placeholder="Buscar fornecedor, mês ou explicação"
                value={term}
                onChange={(e) => setTerm(e.target.value)}
              />
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger>
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os status</SelectItem>
                  <SelectItem value="divergent">Divergentes</SelectItem>
                  <SelectItem value="matched">Conferidos</SelectItem>
                  <SelectItem value="pending">Aguardando fatura</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            {isLoading ? (
              <LoadingState label="Carregando reconciliações..." />
            ) : filtered.length === 0 ? (
              <EmptyState
                icon={<Clock className="h-5 w-5" />}
                title="Nenhuma reconciliação encontrada"
                description="Clique em “Reconciliar agora” para comparar o uso estimado com as faturas e o billing dos fornecedores."
              />
            ) : (
              <div className="w-full overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Mês</TableHead>
                      <TableHead>Fornecedor / conexão</TableHead>
                      <TableHead className="text-right">Estimado</TableHead>
                      <TableHead className="text-right">Confirmado</TableHead>
                      <TableHead className="text-right">Diferença</TableHead>
                      <TableHead className="text-right">%</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="min-w-[240px]">Explicação</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((r) => {
                      const meta = STATUS_META[r.status] ?? {
                        label: r.status,
                        className: "bg-muted text-muted-foreground",
                      };
                      const pct = Number(r.difference_percentage ?? 0);
                      return (
                        <TableRow key={r.id}>
                          <TableCell className="whitespace-nowrap">{monthLabel(r.reconciliation_date)}</TableCell>
                          <TableCell className="font-medium">
                            {r.sku_id ? (
                              <Link
                                to="/connections/$id"
                                params={{ id: r.sku_id }}
                                className="hover:underline"
                              >
                                {r.model ?? "Conexão"}
                              </Link>
                            ) : (
                              (r.model ?? "—")
                            )}
                          </TableCell>
                          <TableCell className="text-right font-numeric">{usd(r.estimated_cost)}</TableCell>
                          <TableCell className="text-right font-numeric">{usd(r.confirmed_cost)}</TableCell>
                          <TableCell className="text-right font-numeric">{usd(r.difference_amount)}</TableCell>
                          <TableCell
                            className={`text-right font-numeric ${
                              Math.abs(pct) > tolerance ? "text-rose-600 dark:text-rose-400" : ""
                            }`}
                          >
                            {r.confirmed_cost == null ? "—" : `${pct.toFixed(1)}%`}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={meta.className}>
                              {meta.label}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">{r.explanation ?? "—"}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
