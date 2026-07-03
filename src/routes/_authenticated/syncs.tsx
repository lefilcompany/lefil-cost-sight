import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo } from "react";
import { z } from "zod";
import {
  RefreshCw,
  CheckCircle2,
  XCircle,
  Loader2,
  Clock,
  Activity,
  Filter,
  X,
  Inbox,
  Zap,
  Play,
} from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

import { AppShell } from "@/components/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { fmtDateTime, fmtNumber } from "@/lib/format";
import { runProviderSync } from "@/lib/sync.functions";

const PERIODS = ["24h", "7d", "30d", "all"] as const;
const STATUSES = ["success", "error", "running"] as const;

const searchSchema = z.object({
  period: z.enum(PERIODS).catch("7d"),
  platform: z.string().optional().catch(undefined),
  provider: z.string().optional().catch(undefined),
  status: z.enum(STATUSES).optional().catch(undefined),
});

export const Route = createFileRoute("/_authenticated/syncs")({
  head: () => ({ meta: [{ title: "Sincronizações — LeFil Cost Center" }] }),
  validateSearch: searchSchema,
  component: SyncsPage,
});

type Log = {
  id: string;
  provider_id: string | null;
  connection_id: string | null;
  started_at: string;
  finished_at: string | null;
  status: string;
  duration_ms: number | null;
  records_imported: number | null;
  error_message: string | null;
  providers?: { name: string } | null;
  provider_connections?: { id: string; name: string; platform_id: string | null } | null;
};

type Conn = {
  id: string;
  name: string;
  status: string;
  provider_id: string;
  platform_id: string | null;
  last_sync_at: string | null;
  providers?: { name: string } | null;
  platforms?: { name: string; color: string | null } | null;
};

function periodStart(p: string): Date | null {
  const d = new Date();
  switch (p) {
    case "24h": d.setHours(d.getHours() - 24); return d;
    case "7d": d.setDate(d.getDate() - 7); return d;
    case "30d": d.setDate(d.getDate() - 30); return d;
    default: return null;
  }
}

function SyncsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate({ from: "/syncs" });
  const search = Route.useSearch();
  const sync = useServerFn(runProviderSync);

  const { data: dims } = useQuery({
    queryKey: ["sync-dims"],
    queryFn: async () => {
      const [{ data: p }, { data: pr }] = await Promise.all([
        supabase.from("platforms").select("id,name,color").order("name"),
        supabase.from("providers").select("id,name").order("name"),
      ]);
      return { platforms: p ?? [], providers: pr ?? [] };
    },
  });

  const { data: connections = [] } = useQuery({
    queryKey: ["sync-connections"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("provider_connections")
        .select("*, providers(name), platforms(name,color)")
        .order("last_sync_at", { ascending: false, nullsFirst: false });
      if (error) throw error;
      return (data ?? []) as Conn[];
    },
  });

  const { data: logs = [], isLoading } = useQuery({
    queryKey: ["sync_logs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sync_logs")
        .select("*, providers(name), provider_connections(id,name,platform_id)")
        .order("started_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as Log[];
    },
    refetchInterval: 15000,
  });

  const filtered = useMemo(() => {
    const start = periodStart(search.period);
    return logs.filter((l) => {
      if (start && new Date(l.started_at) < start) return false;
      if (search.status && l.status !== search.status) return false;
      if (search.provider && l.provider_id !== search.provider) return false;
      if (search.platform) {
        const platId = l.provider_connections?.platform_id ?? null;
        if (platId !== search.platform) return false;
      }
      return true;
    });
  }, [logs, search]);

  const stats = useMemo(() => {
    const total = filtered.length;
    const success = filtered.filter((l) => l.status === "success").length;
    const errors = filtered.filter((l) => l.status === "error").length;
    const running = filtered.filter((l) => l.status === "running").length;
    const records = filtered.reduce((a, l) => a + Number(l.records_imported ?? 0), 0);
    const successRate = total > 0 ? (success / total) * 100 : 0;
    const avgDuration =
      total > 0
        ? Math.round(
            filtered.reduce((a, l) => a + Number(l.duration_ms ?? 0), 0) / total,
          )
        : 0;
    return { total, success, errors, running, records, successRate, avgDuration };
  }, [filtered]);

  const setSearch = (patch: Partial<z.infer<typeof searchSchema>>) =>
    navigate({ search: (prev: z.infer<typeof searchSchema>) => ({ ...prev, ...patch }) });

  const activeFilters =
    Number(!!search.platform) + Number(!!search.provider) + Number(!!search.status) + Number(search.period !== "7d");

  const clearFilters = () => navigate({ search: { period: "7d" } as any });

  const retry = useMutation({
    mutationFn: async (connection_id: string) => sync({ data: { connection_id } }),
    onSuccess: () => {
      toast.success("Sincronização iniciada");
      qc.invalidateQueries({ queryKey: ["sync_logs"] });
      qc.invalidateQueries({ queryKey: ["sync-connections"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <AppShell eyebrow="Análise" title="Sincronizações">
      <div className="space-y-6">
        {/* KPIs */}
        <div className="grid gap-3 md:grid-cols-4">
          <Kpi
            label="Execuções"
            value={fmtNumber(stats.total)}
            sub={`${fmtNumber(stats.records)} registros importados`}
            icon={<Activity className="h-4 w-4" />}
          />
          <Kpi
            label="Taxa de sucesso"
            value={`${stats.successRate.toFixed(1)}%`}
            sub={`${stats.success} de ${stats.total}`}
            tone={stats.successRate >= 95 ? "good" : stats.successRate >= 80 ? "warn" : "bad"}
            icon={<CheckCircle2 className="h-4 w-4" />}
          />
          <Kpi
            label="Falhas"
            value={fmtNumber(stats.errors)}
            sub={stats.errors > 0 ? "Ver detalhes abaixo" : "Nenhuma no período"}
            tone={stats.errors > 0 ? "bad" : "neutral"}
            icon={<XCircle className="h-4 w-4" />}
          />
          <Kpi
            label="Duração média"
            value={stats.avgDuration ? `${fmtNumber(stats.avgDuration)} ms` : "—"}
            sub={stats.running > 0 ? `${stats.running} em execução` : "Sem jobs ativos"}
            icon={stats.running > 0 ? <Loader2 className="h-4 w-4 animate-spin" /> : <Clock className="h-4 w-4" />}
          />
        </div>

        {/* Connection cards */}
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Conexões
            </h2>
            <Badge variant="outline" className="border-border/60 font-normal">{connections.length}</Badge>
          </div>
          {connections.length === 0 ? (
            <Card className="surface-elevated">
              <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
                <div className="grid h-10 w-10 place-items-center rounded-full bg-muted text-muted-foreground">
                  <Zap className="h-4 w-4" />
                </div>
                <p className="font-display text-sm font-medium">Nenhuma conexão configurada</p>
                <p className="text-xs text-muted-foreground">Adicione uma integração para começar a sincronizar.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {connections.map((c) => {
                const lastLog = logs.find((l) => l.connection_id === c.id);
                return (
                  <ConnectionCard
                    key={c.id}
                    conn={c}
                    lastLog={lastLog}
                    onRun={() => retry.mutate(c.id)}
                    running={retry.isPending && retry.variables === c.id}
                  />
                );
              })}
            </div>
          )}
        </div>

        {/* Filters + history */}
        <Card className="surface-elevated">
          <CardContent className="pt-6">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <div className="mr-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                <Filter className="h-3.5 w-3.5" /> Histórico
                {activeFilters > 0 && (
                  <Badge variant="outline" className="border-border/60 font-normal">{activeFilters}</Badge>
                )}
              </div>

              <Select value={search.period} onValueChange={(v) => setSearch({ period: v as any })}>
                <SelectTrigger className="h-9 w-[140px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="24h">Últimas 24h</SelectItem>
                  <SelectItem value="7d">Últimos 7 dias</SelectItem>
                  <SelectItem value="30d">Últimos 30 dias</SelectItem>
                  <SelectItem value="all">Tudo</SelectItem>
                </SelectContent>
              </Select>

              <Select value={search.platform ?? "__all"} onValueChange={(v) => setSearch({ platform: v === "__all" ? undefined : v })}>
                <SelectTrigger className="h-9 w-[170px]"><SelectValue placeholder="Plataforma" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all">Todas plataformas</SelectItem>
                  {dims?.platforms.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>

              <Select value={search.provider ?? "__all"} onValueChange={(v) => setSearch({ provider: v === "__all" ? undefined : v })}>
                <SelectTrigger className="h-9 w-[170px]"><SelectValue placeholder="Fornecedor" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all">Todos fornecedores</SelectItem>
                  {dims?.providers.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>

              <Select value={search.status ?? "__all"} onValueChange={(v) => setSearch({ status: v === "__all" ? undefined : (v as any) })}>
                <SelectTrigger className="h-9 w-[140px]"><SelectValue placeholder="Status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all">Todos status</SelectItem>
                  <SelectItem value="success">Sucesso</SelectItem>
                  <SelectItem value="error">Falha</SelectItem>
                  <SelectItem value="running">Em execução</SelectItem>
                </SelectContent>
              </Select>

              {activeFilters > 0 && (
                <Button variant="ghost" size="sm" className="h-9 gap-1 text-muted-foreground" onClick={clearFilters}>
                  <X className="h-3.5 w-3.5" /> Limpar
                </Button>
              )}
            </div>

            <div className="overflow-hidden rounded-lg border border-border/60">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Fornecedor</TableHead>
                    <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Conexão</TableHead>
                    <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Início</TableHead>
                    <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Status</TableHead>
                    <TableHead className="text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Duração</TableHead>
                    <TableHead className="text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Registros</TableHead>
                    <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Mensagem</TableHead>
                    <TableHead className="w-28" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading && (
                    <TableRow>
                      <TableCell colSpan={8} className="py-10 text-center text-sm text-muted-foreground">
                        Carregando execuções...
                      </TableCell>
                    </TableRow>
                  )}
                  {!isLoading && filtered.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={8} className="py-16 text-center">
                        <div className="mx-auto max-w-sm space-y-3">
                          <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-muted text-muted-foreground">
                            <Inbox className="h-5 w-5" />
                          </div>
                          <p className="font-display text-sm font-medium">
                            {activeFilters > 0 || logs.length > 0 ? "Nada nesse filtro" : "Nenhuma sincronização ainda"}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {activeFilters > 0 || logs.length > 0
                              ? "Ajuste o período ou limpe os filtros."
                              : "Execute uma conexão acima para começar."}
                          </p>
                          {activeFilters > 0 && (
                            <Button variant="outline" size="sm" onClick={clearFilters} className="gap-1.5">
                              <X className="h-3.5 w-3.5" /> Limpar filtros
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                  {filtered.map((l) => (
                    <TableRow key={l.id} className="border-border/50">
                      <TableCell className="font-medium">{l.providers?.name ?? "—"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{l.provider_connections?.name ?? "—"}</TableCell>
                      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">{fmtDateTime(l.started_at)}</TableCell>
                      <TableCell><StatusBadge status={l.status} /></TableCell>
                      <TableCell className="text-right font-numeric text-sm">{l.duration_ms ? `${fmtNumber(l.duration_ms)} ms` : "—"}</TableCell>
                      <TableCell className="text-right font-numeric text-sm">{fmtNumber(l.records_imported ?? 0)}</TableCell>
                      <TableCell className="max-w-md truncate text-xs text-muted-foreground" title={l.error_message ?? ""}>
                        {l.error_message ?? "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        {l.connection_id && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 gap-1.5"
                            onClick={() => retry.mutate(l.connection_id!)}
                            disabled={retry.isPending}
                          >
                            <RefreshCw className={`h-3.5 w-3.5 ${retry.isPending && retry.variables === l.connection_id ? "animate-spin" : ""}`} />
                            Re-executar
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "success")
    return (
      <Badge className="gap-1 bg-emerald-600/15 text-emerald-700 hover:bg-emerald-600/20 dark:text-emerald-400" variant="secondary">
        <CheckCircle2 className="h-3 w-3" /> Sucesso
      </Badge>
    );
  if (status === "error")
    return (
      <Badge variant="destructive" className="gap-1">
        <XCircle className="h-3 w-3" /> Falha
      </Badge>
    );
  if (status === "running")
    return (
      <Badge variant="secondary" className="gap-1">
        <Loader2 className="h-3 w-3 animate-spin" /> Executando
      </Badge>
    );
  return <Badge variant="outline" className="capitalize">{status}</Badge>;
}

function ConnectionCard({
  conn,
  lastLog,
  onRun,
  running,
}: {
  conn: Conn;
  lastLog?: Log;
  onRun: () => void;
  running: boolean;
}) {
  const relative = conn.last_sync_at
    ? formatDistanceToNow(new Date(conn.last_sync_at), { addSuffix: true, locale: ptBR })
    : "nunca";
  const status = lastLog?.status ?? (conn.status === "active" ? "idle" : conn.status);

  return (
    <Card className="surface-elevated">
      <CardContent className="space-y-3 pt-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              {conn.platforms?.color && (
                <span className="h-2 w-2 rounded-full" style={{ background: conn.platforms.color }} />
              )}
              <p className="truncate font-display text-sm font-semibold">{conn.name}</p>
            </div>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {conn.providers?.name ?? "Fornecedor"} · {conn.platforms?.name ?? "—"}
            </p>
          </div>
          {status === "running" ? (
            <Badge variant="secondary" className="gap-1"><Loader2 className="h-3 w-3 animate-spin" />Executando</Badge>
          ) : status === "error" ? (
            <Badge variant="destructive" className="gap-1"><XCircle className="h-3 w-3" />Falha</Badge>
          ) : status === "success" ? (
            <Badge className="gap-1 bg-emerald-600/15 text-emerald-700 hover:bg-emerald-600/20 dark:text-emerald-400" variant="secondary">
              <CheckCircle2 className="h-3 w-3" />OK
            </Badge>
          ) : (
            <Badge variant="outline" className="capitalize">{status}</Badge>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3 rounded-md border border-border/60 bg-muted/30 p-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Última</p>
            <p className="mt-0.5 text-sm font-medium">{relative}</p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Registros</p>
            <p className="mt-0.5 font-numeric text-sm font-medium">{fmtNumber(lastLog?.records_imported ?? 0)}</p>
          </div>
        </div>

        {lastLog?.error_message && (
          <p className="line-clamp-2 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-[11px] text-destructive">
            {lastLog.error_message}
          </p>
        )}

        <Button size="sm" variant="outline" className="w-full gap-1.5" onClick={onRun} disabled={running}>
          {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          Sincronizar agora
        </Button>
      </CardContent>
    </Card>
  );
}

function Kpi({
  label,
  value,
  sub,
  icon,
  tone = "neutral",
}: {
  label: string;
  value: string;
  sub?: string;
  icon?: React.ReactNode;
  tone?: "neutral" | "good" | "warn" | "bad";
}) {
  const toneCls =
    tone === "good"
      ? "text-emerald-600 dark:text-emerald-400"
      : tone === "bad"
      ? "text-destructive"
      : tone === "warn"
      ? "text-amber-600 dark:text-amber-400"
      : "";
  return (
    <Card className="surface-elevated">
      <CardContent className="flex items-center justify-between pt-6">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
          <p className={`mt-1 font-display text-2xl font-semibold tracking-tight ${toneCls}`}>{value}</p>
          {sub && <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{sub}</p>}
        </div>
        {icon && (
          <div className="grid h-9 w-9 place-items-center rounded-full border border-border/60 bg-muted/40 text-muted-foreground">
            {icon}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
