import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Fragment, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  ArrowLeft,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Clock,
  Calculator,
  Database,
  Activity,
  Wallet,
  ChevronDown,
  ChevronRight,
} from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { KpiCard as Kpi, LoadingState } from "@/components/ui-kit";
import { fmtBRL, fmtUSD, fmtNumber, fmtDate, fmtDateTime } from "@/lib/format";
import { runProviderSync } from "@/lib/sync.functions";

export const Route = createFileRoute("/_authenticated/connections/$id")({
  head: () => ({
    meta: [
      { title: "Auditoria da conexão — Quiwi Cost Center" },
      {
        name: "description",
        content:
          "Auditoria por conexão: logs de sincronização, snapshots de billing e o cálculo de créditos consumidos e custo em BRL.",
      },
      { property: "og:title", content: "Auditoria da conexão — Quiwi Cost Center" },
      {
        property: "og:description",
        content: "Rastreie como créditos e custo em reais foram calculados para cada conexão de fornecedor.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ConnectionAuditPage,
});

type Snapshot = {
  id: string;
  captured_at: string;
  plan_name: string | null;
  plan_tier: string | null;
  billing_cycle: string | null;
  cycle_start: string | null;
  cycle_end: string | null;
  included_quantity: number | null;
  included_unit: string | null;
  used_quantity: number | null;
  remaining_quantity: number | null;
  cost_period_usd: number | null;
  projected_cost_usd: number | null;
  currency: string;
  raw: any;
};

type UsageRow = {
  id: string;
  usage_date: string;
  model: string;
  endpoint: string;
  input_tokens: number;
  output_tokens: number;
  requests: number;
  quantity: number;
  unit: string | null;
  cost_usd: number;
  exchange_rate: number;
  cost_brl: number;
  synced_at: string;
};

type SyncLog = {
  id: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  records_imported: number | null;
  error_message: string | null;
  metadata: any;
};

function StatusBadge({ status }: { status: string }) {
  if (status === "success")
    return (
      <Badge variant="secondary" className="gap-1 bg-emerald-600/15 text-emerald-700 dark:text-emerald-400">
        <CheckCircle2 className="h-3 w-3" /> Sucesso
      </Badge>
    );
  if (status === "error")
    return (
      <Badge variant="secondary" className="gap-1 bg-red-600/15 text-red-700 dark:text-red-400">
        <XCircle className="h-3 w-3" /> Erro
      </Badge>
    );
  return (
    <Badge variant="outline" className="gap-1">
      <Clock className="h-3 w-3" /> {status}
    </Badge>
  );
}

function ConnectionAuditPage() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const syncFn = useServerFn(runProviderSync);
  const [openLog, setOpenLog] = useState<string | null>(null);
  const [openSnap, setOpenSnap] = useState<string | null>(null);

  const { data: conn, isLoading } = useQuery({
    queryKey: ["connection-audit", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("provider_connections")
        .select("*, providers(name), platforms(name)")
        .eq("id", id)
        .single();
      if (error) throw error;
      return data as any;
    },
  });

  const { data: logs = [] } = useQuery({
    queryKey: ["connection-audit-logs", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sync_logs")
        .select("id, status, started_at, finished_at, duration_ms, records_imported, error_message, metadata")
        .eq("connection_id", id)
        .order("started_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as SyncLog[];
    },
    refetchInterval: 20_000,
  });

  const { data: snapshots = [] } = useQuery({
    queryKey: ["connection-audit-snapshots", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("provider_billing_snapshots")
        .select("*")
        .eq("connection_id", id)
        .order("captured_at", { ascending: false })
        .limit(60);
      if (error) throw error;
      return (data ?? []) as Snapshot[];
    },
  });

  const { data: usage = [] } = useQuery({
    queryKey: ["connection-audit-usage", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("provider_usage_daily")
        .select(
          "id, usage_date, model, endpoint, input_tokens, output_tokens, requests, quantity, unit, cost_usd, exchange_rate, cost_brl, synced_at",
        )
        .eq("connection_id", id)
        .order("usage_date", { ascending: false })
        .limit(120);
      if (error) throw error;
      return (data ?? []) as UsageRow[];
    },
  });

  const config = (conn?.config ?? {}) as Record<string, any>;
  const planName = config.plan_name ?? snapshots[0]?.plan_name ?? null;
  const monthlyCostBrl = Number(config.monthly_cost_brl ?? config.plan_monthly_brl ?? 0) || 0;
  const monthlyCostUsd = Number(config.monthly_cost_usd ?? 0) || 0;

  // Deltas de créditos entre snapshots consecutivos (ordem crescente)
  const deltas = useMemo(() => {
    const asc = [...snapshots].sort(
      (a, b) => new Date(a.captured_at).getTime() - new Date(b.captured_at).getTime(),
    );
    const out: {
      id: string;
      captured_at: string;
      used: number;
      delta: number;
      reset: boolean;
      cycle: string;
    }[] = [];
    let prev: Snapshot | null = null;
    for (const s of asc) {
      const used = Number(s.used_quantity ?? 0);
      const prevUsed = prev ? Number(prev.used_quantity ?? 0) : 0;
      const cycleChanged = !!prev && (prev.cycle_start ?? "") !== (s.cycle_start ?? "");
      const reset = !!prev && (used < prevUsed || cycleChanged);
      const delta = !prev ? used : reset ? used : used - prevUsed;
      out.push({
        id: s.id,
        captured_at: s.captured_at,
        used,
        delta,
        reset,
        cycle: s.cycle_start ? `${fmtDate(s.cycle_start)} → ${fmtDate(s.cycle_end)}` : "—",
      });
      prev = s;
    }
    return out.reverse();
  }, [snapshots]);

  const totals = useMemo(() => {
    const usd = usage.reduce((a, r) => a + Number(r.cost_usd ?? 0), 0);
    const brl = usage.reduce((a, r) => a + Number(r.cost_brl ?? 0), 0);
    const qty = usage.reduce((a, r) => a + Number(r.quantity ?? 0), 0);
    const rates = usage.map((r) => Number(r.exchange_rate ?? 0)).filter((r) => r > 0);
    const avgRate = rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : 0;
    const mismatches = usage.filter((r) => {
      const expected = Number(r.cost_usd ?? 0) * Number(r.exchange_rate ?? 0);
      return Math.abs(expected - Number(r.cost_brl ?? 0)) > 0.01;
    });
    return { usd, brl, qty, avgRate, mismatches };
  }, [usage]);

  const sync = useMutation({
    mutationFn: async () => syncFn({ data: { connection_id: id } }),
    onSuccess: () => {
      toast.success("Sincronização disparada");
      qc.invalidateQueries({ queryKey: ["connection-audit-logs", id] });
      qc.invalidateQueries({ queryKey: ["connection-audit-snapshots", id] });
      qc.invalidateQueries({ queryKey: ["connection-audit-usage", id] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Falha ao sincronizar"),
  });

  if (isLoading) {
    return (
      <AppShell>
        <div className="p-6">
          <LoadingState label="Carregando conexão..." />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <Link
              to="/providers/$id"
              params={{ id: conn?.provider_id ?? "" }}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-3 w-3" /> Voltar ao fornecedor
            </Link>
            <h1 className="truncate text-2xl font-semibold tracking-tight">
              Auditoria · {conn?.name ?? "Conexão"}
            </h1>
            <p className="text-sm text-muted-foreground">
              {conn?.providers?.name ?? "Fornecedor"}
              {conn?.platforms?.name ? ` · ${conn.platforms.name}` : ""}
              {planName ? ` · Plano ${planName}` : ""} · Último sync {fmtDateTime(conn?.last_sync_at)}
            </p>
          </div>
          <Button onClick={() => sync.mutate()} disabled={sync.isPending} className="gap-2">
            <RefreshCw className={`h-4 w-4 ${sync.isPending ? "animate-spin" : ""}`} />
            Sincronizar agora
          </Button>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Kpi
            label="Consumo registrado (BRL)"
            value={fmtBRL(totals.brl)}
            icon={<Wallet className="h-4 w-4" />}
            sub={`${fmtUSD(totals.usd)} em USD`}
          />
          <Kpi
            label="Cotação média aplicada"
            value={totals.avgRate ? totals.avgRate.toFixed(4) : "—"}
            icon={<Calculator className="h-4 w-4" />}
            sub="USD → BRL nas linhas de uso"
          />
          <Kpi
            label="Quantidade / créditos"
            value={fmtNumber(totals.qty)}
            icon={<Database className="h-4 w-4" />}
            sub={`${usage.length} linhas de uso`}
          />
          <Kpi
            label="Divergências detectadas"
            value={fmtNumber(totals.mismatches.length)}
            icon={<Activity className="h-4 w-4" />}
            sub="cost_usd × cotação ≠ cost_brl"
          />
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Como os valores são calculados</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>
              <strong className="text-foreground">credits_used / quantidade:</strong> cada sync grava um snapshot
              com o total acumulado do ciclo (<code>used_quantity</code>). O consumo do dia é o delta entre o
              snapshot atual e o anterior; quando o ciclo virou ou o contador caiu, o valor acumulado é usado como
              delta inicial (marcado como “reset” abaixo).
            </p>
            <p>
              <strong className="text-foreground">cost_usd:</strong> vem do provedor quando existe custo medido
              (<code>cost_period_usd</code>) ou do rateio do plano fixo
              {monthlyCostBrl ? ` (${fmtBRL(monthlyCostBrl)}/mês)` : ""}
              {monthlyCostUsd ? ` (${fmtUSD(monthlyCostUsd)}/mês)` : ""} proporcional ao consumo de cada dia do
              ciclo.
            </p>
            <p>
              <strong className="text-foreground">cost_brl:</strong> <code>cost_usd × exchange_rate</code>, com a
              cotação USD/BRL vigente no momento do sync (atualizada automaticamente por hora).
            </p>
          </CardContent>
        </Card>

        <Tabs defaultValue="logs">
          <TabsList>
            <TabsTrigger value="logs">Logs de sync ({logs.length})</TabsTrigger>
            <TabsTrigger value="snapshots">Snapshots ({snapshots.length})</TabsTrigger>
            <TabsTrigger value="usage">Uso e cálculo ({usage.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="logs" className="mt-4">
            <Card>
              <CardContent className="overflow-x-auto p-0">
                {logs.length === 0 ? (
                  <div className="p-10 text-center text-sm text-muted-foreground">Nenhum sync registrado.</div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-8" />
                        <TableHead>Início</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Duração</TableHead>
                        <TableHead className="text-right">Registros</TableHead>
                        <TableHead>Erro</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {logs.map((l) => (
                        <Fragment key={l.id}>
                          <TableRow
                            className="cursor-pointer"
                            onClick={() => setOpenLog(openLog === l.id ? null : l.id)}
                          >
                            <TableCell>
                              {openLog === l.id ? (
                                <ChevronDown className="h-4 w-4" />
                              ) : (
                                <ChevronRight className="h-4 w-4" />
                              )}
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-xs">{fmtDateTime(l.started_at)}</TableCell>
                            <TableCell>
                              <StatusBadge status={l.status} />
                            </TableCell>
                            <TableCell className="text-right text-xs">
                              {l.duration_ms ? `${fmtNumber(l.duration_ms)} ms` : "—"}
                            </TableCell>
                            <TableCell className="text-right text-xs">{fmtNumber(l.records_imported ?? 0)}</TableCell>
                            <TableCell className="max-w-[280px] truncate text-xs text-muted-foreground">
                              {l.error_message ?? "—"}
                            </TableCell>
                          </TableRow>
                          {openLog === l.id && (
                            <TableRow>
                              <TableCell colSpan={6} className="bg-muted/40">
                                <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all text-[11px] leading-relaxed">
                                  {JSON.stringify(l.metadata ?? {}, null, 2)}
                                </pre>
                              </TableCell>
                            </TableRow>
                          )}
                        </Fragment>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="snapshots" className="mt-4 space-y-4">
            <Card>
              <CardContent className="overflow-x-auto p-0">
                {snapshots.length === 0 ? (
                  <div className="p-10 text-center text-sm text-muted-foreground">
                    Nenhum snapshot de billing capturado ainda.
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-8" />
                        <TableHead>Capturado</TableHead>
                        <TableHead>Ciclo</TableHead>
                        <TableHead className="text-right">Usado</TableHead>
                        <TableHead className="text-right">Delta</TableHead>
                        <TableHead className="text-right">Incluído</TableHead>
                        <TableHead className="text-right">Custo ciclo</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {snapshots.map((s) => {
                        const d = deltas.find((x) => x.id === s.id);
                        return (
                          <Fragment key={s.id}>
                            <TableRow
                              className="cursor-pointer"
                              onClick={() => setOpenSnap(openSnap === s.id ? null : s.id)}
                            >
                              <TableCell>
                                {openSnap === s.id ? (
                                  <ChevronDown className="h-4 w-4" />
                                ) : (
                                  <ChevronRight className="h-4 w-4" />
                                )}
                              </TableCell>
                              <TableCell className="whitespace-nowrap text-xs">{fmtDateTime(s.captured_at)}</TableCell>
                              <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                                {d?.cycle ?? "—"}
                              </TableCell>
                              <TableCell className="text-right text-xs">{fmtNumber(s.used_quantity ?? 0)}</TableCell>
                              <TableCell className="text-right text-xs">
                                <span className="font-medium">{fmtNumber(d?.delta ?? 0)}</span>
                                {d?.reset && (
                                  <Badge variant="outline" className="ml-2 text-[10px]">
                                    reset
                                  </Badge>
                                )}
                              </TableCell>
                              <TableCell className="text-right text-xs text-muted-foreground">
                                {s.included_quantity ? `${fmtNumber(s.included_quantity)} ${s.included_unit ?? ""}` : "—"}
                              </TableCell>
                              <TableCell className="text-right text-xs">{fmtUSD(s.cost_period_usd ?? 0)}</TableCell>
                            </TableRow>
                            {openSnap === s.id && (
                              <TableRow>
                                <TableCell colSpan={7} className="bg-muted/40">
                                  <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all text-[11px] leading-relaxed">
                                    {JSON.stringify(s.raw ?? {}, null, 2)}
                                  </pre>
                                </TableCell>
                              </TableRow>
                            )}
                          </Fragment>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="usage" className="mt-4 space-y-4">
            {totals.mismatches.length > 0 && (
              <Card className="border-amber-500/40 bg-amber-500/5">
                <CardContent className="p-4 text-sm">
                  {fmtNumber(totals.mismatches.length)} linha(s) com <code>cost_brl</code> diferente de{" "}
                  <code>cost_usd × exchange_rate</code> (tolerância R$ 0,01). Reveja a cotação usada nesses dias.
                </CardContent>
              </Card>
            )}
            <Card>
              <CardContent className="overflow-x-auto p-0">
                {usage.length === 0 ? (
                  <div className="p-10 text-center text-sm text-muted-foreground">
                    Nenhuma linha em provider_usage_daily para esta conexão.
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Dia</TableHead>
                        <TableHead>Modelo / endpoint</TableHead>
                        <TableHead className="text-right">Qtd.</TableHead>
                        <TableHead className="text-right">Tokens</TableHead>
                        <TableHead className="text-right">USD</TableHead>
                        <TableHead className="text-right">Cotação</TableHead>
                        <TableHead className="text-right">BRL</TableHead>
                        <TableHead className="text-right">Conferência</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {usage.map((r) => {
                        const expected = Number(r.cost_usd ?? 0) * Number(r.exchange_rate ?? 0);
                        const ok = Math.abs(expected - Number(r.cost_brl ?? 0)) <= 0.01;
                        return (
                          <TableRow key={r.id}>
                            <TableCell className="whitespace-nowrap text-xs">{fmtDate(r.usage_date)}</TableCell>
                            <TableCell className="text-xs">
                              <div className="font-medium">{r.model || "—"}</div>
                              <div className="text-muted-foreground">{r.endpoint || "—"}</div>
                            </TableCell>
                            <TableCell className="text-right text-xs">
                              {fmtNumber(r.quantity)} {r.unit ?? ""}
                            </TableCell>
                            <TableCell className="text-right text-xs text-muted-foreground">
                              {fmtNumber(Number(r.input_tokens ?? 0) + Number(r.output_tokens ?? 0))}
                            </TableCell>
                            <TableCell className="text-right text-xs">{fmtUSD(r.cost_usd)}</TableCell>
                            <TableCell className="text-right text-xs">
                              {Number(r.exchange_rate ?? 0).toFixed(4)}
                            </TableCell>
                            <TableCell className="text-right text-xs font-medium">{fmtBRL(r.cost_brl)}</TableCell>
                            <TableCell className="text-right text-xs">
                              {ok ? (
                                <span className="text-emerald-600 dark:text-emerald-400">ok</span>
                              ) : (
                                <span className="text-amber-600 dark:text-amber-400">
                                  esperado {fmtBRL(expected)}
                                </span>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}
