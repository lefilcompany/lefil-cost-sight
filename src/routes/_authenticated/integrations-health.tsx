import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  HeartPulse,
  KeyRound,
  RefreshCw,
  XCircle,
} from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CollapsibleSection, EmptyState, KpiCard as Kpi, LoadingState } from "@/components/ui-kit";
import { supabase } from "@/integrations/supabase/client";
import { fmtDateTime } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/integrations-health")({
  head: () => ({
    meta: [
      { title: "Saúde das integrações — Quiwi Cost Center" },
      {
        name: "description",
        content:
          "Monitore última sincronização, falhas recorrentes e credenciais próximas de expirar em todas as integrações de custos.",
      },
      { property: "og:title", content: "Saúde das integrações — Quiwi Cost Center" },
      {
        property: "og:description",
        content: "Painel operacional com status de sync, erros recorrentes e tokens a vencer por conexão.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: IntegrationsHealthPage,
});

type Conn = {
  id: string;
  name: string;
  status: string;
  provider_id: string;
  last_sync_at: string | null;
  providers?: { name: string } | null;
  platforms?: { name: string } | null;
};

type Log = {
  id: string;
  connection_id: string | null;
  provider_id: string | null;
  started_at: string;
  status: string;
  error_message: string | null;
};

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

type Health = "ok" | "warn" | "bad" | "idle";

const HEALTH_META: Record<Health, { label: string; className: string }> = {
  ok: { label: "Saudável", className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" },
  warn: { label: "Atenção", className: "bg-amber-500/10 text-amber-700 dark:text-amber-300" },
  bad: { label: "Crítico", className: "bg-rose-500/10 text-rose-700 dark:text-rose-300" },
  idle: { label: "Sem execuções", className: "bg-muted text-muted-foreground" },
};

function ageLabel(iso: string | null) {
  if (!iso) return "nunca";
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < HOUR) return `${Math.max(1, Math.round(diff / 60_000))} min atrás`;
  if (diff < DAY) return `${Math.round(diff / HOUR)} h atrás`;
  return `${Math.round(diff / DAY)} d atrás`;
}

function IntegrationsHealthPage() {
  const [term, setTerm] = useState("");
  const [health, setHealth] = useState<"all" | Health>("all");

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["integrations-health"],
    refetchInterval: 60_000,
    queryFn: async () => {
      const since = new Date(Date.now() - 7 * DAY).toISOString();
      const [conns, logs, tokens, keys] = await Promise.all([
        supabase
          .from("provider_connections")
          .select("id,name,status,provider_id,last_sync_at, providers(name), platforms(name)")
          .order("name"),
        supabase
          .from("sync_logs")
          .select("id,connection_id,provider_id,started_at,status,error_message")
          .gte("started_at", since)
          .order("started_at", { ascending: false })
          .limit(2000),
        supabase
          .from("monitor_news_connections")
          .select("client_id,status,expires_at,expired_at,last_error,updated_at"),
        supabase
          .from("integration_api_keys")
          .select("id,name,environment,status,expires_at,last_used_at")
          .not("expires_at", "is", null)
          .order("expires_at"),
      ]);
      if (conns.error) throw conns.error;
      if (logs.error) throw logs.error;
      return {
        connections: (conns.data ?? []) as Conn[],
        logs: (logs.data ?? []) as Log[],
        tokens: tokens.data ?? [],
        keys: keys.data ?? [],
      };
    },
  });

  const rows = useMemo(() => {
    const connections = data?.connections ?? [];
    const logs = data?.logs ?? [];
    return connections.map((c) => {
      const own = logs.filter((l) => l.connection_id === c.id);
      const failures = own.filter((l) => l.status === "error");
      let streak = 0;
      for (const l of own) {
        if (l.status === "error") streak += 1;
        else if (l.status === "success") break;
      }
      const lastError = failures[0] ?? null;
      const failureRate = own.length ? failures.length / own.length : 0;
      const staleMs = c.last_sync_at ? Date.now() - new Date(c.last_sync_at).getTime() : null;

      let state: Health = "ok";
      if (!own.length && !c.last_sync_at) state = "idle";
      if (failureRate >= 0.3 || (staleMs != null && staleMs > 2 * DAY)) state = "warn";
      if (streak >= 3 || c.status === "error" || (staleMs != null && staleMs > 7 * DAY)) state = "bad";

      return {
        conn: c,
        runs: own.length,
        failures: failures.length,
        streak,
        failureRate,
        lastError,
        state,
      };
    });
  }, [data]);

  const filtered = useMemo(() => {
    const q = term.trim().toLowerCase();
    return rows.filter((r) => {
      if (health !== "all" && r.state !== health) return false;
      if (!q) return true;
      return [r.conn.name, r.conn.providers?.name, r.conn.platforms?.name, r.lastError?.error_message]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [rows, health, term]);

  const summary = useMemo(() => {
    const count = (s: Health) => rows.filter((r) => r.state === s).length;
    const totalFailures = rows.reduce((a, r) => a + r.failures, 0);
    const recurring = rows.filter((r) => r.streak >= 2).length;
    return { ok: count("ok"), warn: count("warn"), bad: count("bad"), idle: count("idle"), totalFailures, recurring };
  }, [rows]);

  const expiring = useMemo(() => {
    const items: {
      key: string;
      label: string;
      kind: string;
      expiresAt: string | null;
      status: string;
      note?: string | null;
    }[] = [];
    for (const t of (data?.tokens ?? []) as any[]) {
      items.push({
        key: `mn-${t.client_id}`,
        label: "Monitor News (OAuth)",
        kind: "Token de acesso",
        expiresAt: t.expires_at ?? t.expired_at ?? null,
        status: t.status ?? "unknown",
        note: t.last_error,
      });
    }
    for (const k of (data?.keys ?? []) as any[]) {
      items.push({
        key: `key-${k.id}`,
        label: k.name,
        kind: `Chave de API (${k.environment})`,
        expiresAt: k.expires_at,
        status: k.status,
      });
    }
    return items
      .map((i) => {
        const ms = i.expiresAt ? new Date(i.expiresAt).getTime() - Date.now() : null;
        return { ...i, ms, days: ms == null ? null : Math.floor(ms / DAY) };
      })
      .sort((a, b) => (a.ms ?? Infinity) - (b.ms ?? Infinity));
  }, [data]);

  const atRisk = expiring.filter((i) => i.days != null && i.days <= 7).length;

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Saúde das integrações</h1>
            <p className="text-sm text-muted-foreground">
              Última sincronização, falhas recorrentes (7 dias) e credenciais próximas de expirar, com atalho para o
              detalhe do erro.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link to="/syncs">Histórico de syncs</Link>
            </Button>
            <Button size="sm" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
              Atualizar
            </Button>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Kpi
            label="Integrações saudáveis"
            value={String(summary.ok)}
            sub={`${rows.length} conexão(ões) monitorada(s)`}
            tone="good"
            icon={<CheckCircle2 className="h-4 w-4" />}
          />
          <Kpi
            label="Em atenção"
            value={String(summary.warn)}
            sub={`${summary.idle} sem execuções`}
            icon={<Clock className="h-4 w-4" />}
          />
          <Kpi
            label="Críticas"
            value={String(summary.bad)}
            sub={`${summary.recurring} com falha recorrente`}
            tone={summary.bad > 0 ? "bad" : "neutral"}
            icon={<AlertTriangle className="h-4 w-4" />}
          />
          <Kpi
            label="Credenciais a vencer"
            value={String(atRisk)}
            sub={`${summary.totalFailures} falha(s) em 7 dias`}
            tone={atRisk > 0 ? "bad" : "neutral"}
            icon={<KeyRound className="h-4 w-4" />}
          />
        </div>

        <Card>
          <CardHeader className="gap-3">
            <CardTitle className="text-sm font-medium">Conexões</CardTitle>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              <Input
                placeholder="Buscar conexão, fornecedor ou erro"
                value={term}
                onChange={(e) => setTerm(e.target.value)}
              />
              <Select value={health} onValueChange={(v) => setHealth(v as typeof health)}>
                <SelectTrigger>
                  <SelectValue placeholder="Saúde" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas</SelectItem>
                  <SelectItem value="bad">Críticas</SelectItem>
                  <SelectItem value="warn">Em atenção</SelectItem>
                  <SelectItem value="ok">Saudáveis</SelectItem>
                  <SelectItem value="idle">Sem execuções</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent className="px-0 sm:px-6">
            {isLoading ? (
              <LoadingState />
            ) : filtered.length === 0 ? (
              <EmptyState
                icon={<HeartPulse className="h-5 w-5" />}
                title="Nenhuma integração encontrada"
                description="Ajuste os filtros ou conecte um fornecedor para começar o monitoramento."
              />
            ) : (
              <div className="w-full overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Integração</TableHead>
                      <TableHead>Saúde</TableHead>
                      <TableHead>Última sync</TableHead>
                      <TableHead className="text-right">Execuções (7d)</TableHead>
                      <TableHead className="text-right">Falhas</TableHead>
                      <TableHead>Último erro</TableHead>
                      <TableHead className="text-right">Detalhes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((r) => {
                      const meta = HEALTH_META[r.state];
                      return (
                        <TableRow key={r.conn.id}>
                          <TableCell>
                            <div className="font-medium">{r.conn.name}</div>
                            <div className="text-xs text-muted-foreground">
                              {r.conn.providers?.name ?? "—"}
                              {r.conn.platforms?.name ? ` · ${r.conn.platforms.name}` : ""}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary" className={meta.className}>
                              {meta.label}
                            </Badge>
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-sm">
                            <div>{ageLabel(r.conn.last_sync_at)}</div>
                            <div className="text-xs text-muted-foreground">
                              {r.conn.last_sync_at ? fmtDateTime(r.conn.last_sync_at) : "—"}
                            </div>
                          </TableCell>
                          <TableCell className="text-right text-sm">{r.runs}</TableCell>
                          <TableCell className="text-right text-sm">
                            <div className="flex items-center justify-end gap-1">
                              {r.failures > 0 ? (
                                <XCircle className="h-3.5 w-3.5 text-rose-500" />
                              ) : (
                                <Activity className="h-3.5 w-3.5 text-muted-foreground" />
                              )}
                              {r.failures}
                              {r.streak >= 2 ? (
                                <span className="ml-1 text-xs text-rose-600 dark:text-rose-400">
                                  ({r.streak} seguidas)
                                </span>
                              ) : null}
                            </div>
                          </TableCell>
                          <TableCell className="max-w-[280px]">
                            {r.lastError ? (
                              <div className="truncate text-xs text-muted-foreground" title={r.lastError.error_message ?? ""}>
                                {r.lastError.error_message ?? "Erro sem mensagem"}
                                <div>{fmtDateTime(r.lastError.started_at)}</div>
                              </div>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              <Button variant="ghost" size="sm" asChild>
                                <Link to="/connections/$id" params={{ id: r.conn.id }}>
                                  Auditoria
                                </Link>
                              </Button>
                              <Button variant="ghost" size="sm" asChild>
                                <Link to="/syncs" search={{ period: "7d", status: "error" }}>
                                  Erros
                                </Link>
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <CollapsibleSection
          title="Credenciais e tokens"
          description={`${atRisk} a vencer em 7 dias`}
        >
          <div className="p-4">
          {expiring.length === 0 ? (
              <EmptyState
                icon={<KeyRound className="h-5 w-5" />}
                title="Nenhuma credencial com validade definida"
                description="Tokens OAuth e chaves de API com data de expiração aparecem aqui."
              />
            ) : (
              <div className="w-full overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Credencial</TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Expira em</TableHead>
                      <TableHead>Observação</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {expiring.map((i) => {
                      const expired = i.ms != null && i.ms <= 0;
                      const soon = i.days != null && i.days >= 0 && i.days <= 7;
                      return (
                        <TableRow key={i.key}>
                          <TableCell className="font-medium">{i.label}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{i.kind}</TableCell>
                          <TableCell>
                            <Badge
                              variant="secondary"
                              className={
                                expired
                                  ? "bg-rose-500/10 text-rose-700 dark:text-rose-300"
                                  : soon
                                    ? "bg-amber-500/10 text-amber-700 dark:text-amber-300"
                                    : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                              }
                            >
                              {expired ? "Expirado" : soon ? "Expira em breve" : (i.status ?? "ativo")}
                            </Badge>
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-sm">
                            {i.expiresAt ? (
                              <>
                                <div>{expired ? "vencido" : `${i.days} dia(s)`}</div>
                                <div className="text-xs text-muted-foreground">{fmtDateTime(i.expiresAt)}</div>
                              </>
                            ) : (
                              "—"
                            )}
                          </TableCell>
                          <TableCell className="max-w-[280px] truncate text-xs text-muted-foreground">
                            {i.note ?? "—"}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </CollapsibleSection>
      </div>
    </AppShell>
  );
}
