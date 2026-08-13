import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock, Mail, RefreshCw, Send, Slack } from "lucide-react";
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
  processAlertNotificationQueue,
  retryAlertDelivery,
} from "@/lib/notification-queue.functions";

export const Route = createFileRoute("/_authenticated/notifications")({
  head: () => ({
    meta: [
      { title: "Histórico de notificações — Quiwi Cost Center" },
      {
        name: "description",
        content:
          "Histórico de envios de alertas por regra e por evento, com status, horários e motivo de falha.",
      },
      { property: "og:title", content: "Histórico de notificações — Quiwi Cost Center" },
      {
        property: "og:description",
        content: "Auditoria dos envios de alertas em Slack e e-mail, com status e erros.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  validateSearch: (search: Record<string, unknown>) => ({
    rule: typeof search.rule === "string" ? search.rule : undefined,
    event: typeof search.event === "string" ? search.event : undefined,
  }),
  component: NotificationsPage,
});

type Delivery = {
  id: string;
  alert_id: string | null;
  alert_event_id: string | null;
  rule_name: string | null;
  channel: string;
  target: string | null;
  severity: string | null;
  title: string | null;
  period_label: string | null;
  status: string;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  next_attempt_at: string | null;
  sent_at: string | null;
  created_at: string;
};

const PAGE_SIZE = 25;

const statusMeta: Record<string, { label: string; className: string }> = {
  sent: { label: "Enviada", className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" },
  pending: { label: "Na fila", className: "bg-amber-500/10 text-amber-700 dark:text-amber-300" },
  failed: { label: "Falhou", className: "bg-red-500/10 text-red-700 dark:text-red-300" },
  skipped: { label: "Ignorada", className: "bg-muted text-muted-foreground" },
};

function fmtDateTime(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function ChannelIcon({ channel }: { channel: string }) {
  if (channel === "slack") return <Slack className="h-3.5 w-3.5" />;
  if (channel === "email") return <Mail className="h-3.5 w-3.5" />;
  return <Send className="h-3.5 w-3.5" />;
}

function NotificationsPage() {
  const search = Route.useSearch();
  const queryClient = useQueryClient();

  const [status, setStatus] = useState("all");
  const [channel, setChannel] = useState("all");
  const [rule, setRule] = useState(search.rule ?? "all");
  const [term, setTerm] = useState(search.event ?? "");
  const [page, setPage] = useState(0);

  const { data: deliveries = [], isLoading } = useQuery({
    queryKey: ["notification-deliveries"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("alert_notification_deliveries")
        .select(
          "id, alert_id, alert_event_id, rule_name, channel, target, severity, title, period_label, status, attempts, max_attempts, last_error, next_attempt_at, sent_at, created_at",
        )
        .order("created_at", { ascending: false })
        .limit(2000);
      if (error) throw error;
      return (data ?? []) as Delivery[];
    },
    refetchInterval: 60_000,
  });

  const retry = useMutation({
    mutationFn: (id: string) => retryAlertDelivery({ data: { id } }),
    onSuccess: () => {
      toast.success("Entrega reprocessada");
      queryClient.invalidateQueries({ queryKey: ["notification-deliveries"] });
    },
    onError: (err: any) => toast.error(err?.message ?? "Falha ao reenviar"),
  });

  const processQueue = useMutation({
    mutationFn: () => processAlertNotificationQueue({ data: undefined as never }),
    onSuccess: (res: any) => {
      toast.success(`Fila processada: ${res?.sent ?? 0} enviada(s), ${res?.failed ?? 0} falha(s)`);
      queryClient.invalidateQueries({ queryKey: ["notification-deliveries"] });
    },
    onError: (err: any) => toast.error(err?.message ?? "Falha ao processar a fila"),
  });

  const rules = useMemo(() => {
    const map = new Map<string, string>();
    for (const d of deliveries) {
      if (d.alert_id) map.set(d.alert_id, d.rule_name ?? "Regra sem nome");
    }
    return [...map.entries()];
  }, [deliveries]);

  const filtered = useMemo(() => {
    const q = term.trim().toLowerCase();
    return deliveries.filter((d) => {
      if (status !== "all" && d.status !== status) return false;
      if (channel !== "all" && d.channel !== channel) return false;
      if (rule !== "all" && d.alert_id !== rule) return false;
      if (!q) return true;
      return [d.rule_name, d.title, d.target, d.period_label, d.alert_event_id, d.last_error]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [deliveries, status, channel, rule, term]);

  const summary = useMemo(() => {
    const count = (s: string) => filtered.filter((d) => d.status === s).length;
    const events = new Set(filtered.map((d) => d.alert_event_id).filter(Boolean)).size;
    return { total: filtered.length, sent: count("sent"), pending: count("pending"), failed: count("failed"), events };
  }, [filtered]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pageCount - 1);
  const rows = filtered.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE);

  const reset = (fn: () => void) => {
    fn();
    setPage(0);
  };

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Histórico de notificações</h1>
            <p className="text-sm text-muted-foreground">
              Envios de alertas por regra e por evento, com status, horários e motivo do erro.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link to="/alerts">Ver alertas</Link>
            </Button>
            <Button
              size="sm"
              onClick={() => processQueue.mutate()}
              disabled={processQueue.isPending}
            >
              <RefreshCw className={`mr-2 h-4 w-4 ${processQueue.isPending ? "animate-spin" : ""}`} />
              Processar fila
            </Button>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard label="Envios" value={String(summary.total)} sub={`${summary.events} evento(s)`} icon={<Send className="h-4 w-4" />} />
          <KpiCard label="Enviadas" value={String(summary.sent)} tone="positive" icon={<CheckCircle2 className="h-4 w-4" />} />
          <KpiCard label="Na fila" value={String(summary.pending)} icon={<Clock className="h-4 w-4" />} />
          <KpiCard label="Falhas" value={String(summary.failed)} tone="negative" icon={<AlertTriangle className="h-4 w-4" />} />
        </div>

        <Card>
          <CardHeader className="gap-3">
            <CardTitle className="text-base">Entregas</CardTitle>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              <Input
                placeholder="Buscar regra, evento, destino ou erro"
                value={term}
                onChange={(e) => reset(() => setTerm(e.target.value))}
              />
              <Select value={rule} onValueChange={(v) => reset(() => setRule(v))}>
                <SelectTrigger><SelectValue placeholder="Regra" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas as regras</SelectItem>
                  {rules.map(([id, name]) => (
                    <SelectItem key={id} value={id}>{name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={status} onValueChange={(v) => reset(() => setStatus(v))}>
                <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os status</SelectItem>
                  <SelectItem value="sent">Enviada</SelectItem>
                  <SelectItem value="pending">Na fila</SelectItem>
                  <SelectItem value="failed">Falhou</SelectItem>
                </SelectContent>
              </Select>
              <Select value={channel} onValueChange={(v) => reset(() => setChannel(v))}>
                <SelectTrigger><SelectValue placeholder="Canal" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os canais</SelectItem>
                  <SelectItem value="slack">Slack</SelectItem>
                  <SelectItem value="email">E-mail</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <LoadingState />
            ) : rows.length === 0 ? (
              <EmptyState
                title="Nenhuma notificação encontrada"
                description="Ajuste os filtros ou aguarde o próximo disparo de alerta."
              />
            ) : (
              <>
                <div className="w-full overflow-x-auto">
                  <Table className="min-w-[900px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Regra / evento</TableHead>
                        <TableHead>Canal</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Criada</TableHead>
                        <TableHead>Enviada</TableHead>
                        <TableHead>Próxima tentativa</TableHead>
                        <TableHead className="text-right">Ações</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((d) => {
                        const meta = statusMeta[d.status] ?? { label: d.status, className: "bg-muted" };
                        return (
                          <TableRow key={d.id} className="align-top">
                            <TableCell className="max-w-[340px]">
                              <div className="font-medium">{d.rule_name ?? "Regra removida"}</div>
                              <div className="text-xs text-muted-foreground">{d.title ?? "—"}</div>
                              {d.period_label ? (
                                <div className="text-xs text-muted-foreground">Período: {d.period_label}</div>
                              ) : null}
                              {d.alert_event_id ? (
                                <div className="mt-1 font-mono text-[11px] text-muted-foreground">
                                  evento {d.alert_event_id.slice(0, 8)}
                                </div>
                              ) : null}
                              {d.last_error ? (
                                <div className="mt-1 rounded-md bg-red-500/10 px-2 py-1 text-xs text-red-700 dark:text-red-300">
                                  {d.last_error}
                                </div>
                              ) : null}
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className="gap-1">
                                <ChannelIcon channel={d.channel} />
                                {d.channel === "email" ? "E-mail" : d.channel === "slack" ? "Slack" : d.channel}
                              </Badge>
                              <div className="mt-1 text-xs text-muted-foreground break-all">{d.target ?? "—"}</div>
                            </TableCell>
                            <TableCell>
                              <Badge className={meta.className}>{meta.label}</Badge>
                              <div className="mt-1 text-xs text-muted-foreground">
                                {d.attempts}/{d.max_attempts} tentativa(s)
                              </div>
                            </TableCell>
                            <TableCell className="text-xs">{fmtDateTime(d.created_at)}</TableCell>
                            <TableCell className="text-xs">{fmtDateTime(d.sent_at)}</TableCell>
                            <TableCell className="text-xs">
                              {d.status === "sent" ? "—" : fmtDateTime(d.next_attempt_at)}
                            </TableCell>
                            <TableCell className="text-right">
                              {d.status === "sent" ? (
                                <span className="text-xs text-muted-foreground">—</span>
                              ) : (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={retry.isPending}
                                  onClick={() => retry.mutate(d.id)}
                                >
                                  Reenviar
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
                  <span>
                    {filtered.length} envio(s) · página {current + 1} de {pageCount}
                  </span>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" disabled={current === 0} onClick={() => setPage(current - 1)}>
                      Anterior
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={current >= pageCount - 1}
                      onClick={() => setPage(current + 1)}
                    >
                      Próxima
                    </Button>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
