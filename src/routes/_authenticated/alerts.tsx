import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import {
  Bell,
  BellOff,
  CheckCircle2,
  Trash2,
  Plus,
  Radio,
  AlertTriangle,
  Filter,
  Sparkles,
  Loader2,
  ShieldCheck,
  Send,
  BellRing,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";
import { explainAlert } from "@/lib/gemini-ai.functions";
import { runDataQualityCheck } from "@/lib/data-quality.functions";
import {
  getAlertNotificationSettings,
  saveAlertNotificationSettings,
  sendTestAlertNotification,
} from "@/lib/alert-notify.functions";
import {
  listAlertDeliveries,
  retryAlertDelivery,
  processAlertNotificationQueue,
} from "@/lib/notification-queue.functions";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  buildEmailContent,
  sampleNotification,
  severityEmoji,
  fmtBRLNotify,
} from "@/lib/alert-notify-format";

import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { KpiCard, EmptyState, LoadingState } from "@/components/ui-kit";
import { supabase } from "@/integrations/supabase/client";
import { fmtDateTime, fmtBRL, fmtNumber } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/alerts")({
  head: () => ({ meta: [{ title: "Alertas — Quiwi Cost Center" }] }),
  component: AlertsPage,
});

type AlertRule = {
  id: string;
  name: string;
  scope: "global" | "client" | "platform" | "provider";
  scope_id: string | null;
  metric: "monthly_cost" | "daily_cost" | "variance_pct" | "no_sync_days";
  comparison: ">" | ">=" | "<" | "<=";
  threshold: number;
  channel: string;
  enabled: boolean;
  last_evaluated_at: string | null;
};

type AlertEvent = {
  id: string;
  alert_id: string | null;
  severity: "info" | "warning" | "critical";
  title: string;
  message: string | null;
  metric_value: number | null;
  threshold: number | null;
  scope: string | null;
  scope_id: string | null;
  scope_label: string | null;
  status: "open" | "acknowledged" | "resolved";
  created_at: string;
};

const METRIC_LABEL: Record<string, string> = {
  monthly_cost: "Custo mensal (BRL)",
  daily_cost: "Custo diário (BRL)",
  variance_pct: "Variação % mês",
  no_sync_days: "Dias sem sincronização",
};

const EVENTS_PAGE_SIZE = 20;
const RULES_PAGE_SIZE = 10;

function AlertsPage() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<"all" | "open" | "acknowledged" | "resolved">("open");
  const [severityFilter, setSeverityFilter] = useState<"all" | "info" | "warning" | "critical">("all");
  const [eventSearch, setEventSearch] = useState("");
  const [eventPage, setEventPage] = useState(0);
  const [ruleSearch, setRuleSearch] = useState("");
  const [ruleMetric, setRuleMetric] = useState("all");
  const [ruleState, setRuleState] = useState<"all" | "enabled" | "disabled">("all");
  const [rulePage, setRulePage] = useState(0);


  const { data: events = [], isLoading } = useQuery({
    queryKey: ["alert-events"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("alert_events")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as AlertEvent[];
    },
  });

  const { data: rules = [] } = useQuery({
    queryKey: ["alert-rules"],
    queryFn: async () => {
      const { data, error } = await supabase.from("cost_alerts").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as AlertRule[];
    },
  });

  // Realtime: refresh on new events
  useEffect(() => {
    const ch = supabase
      .channel("alert-events-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "alert_events" }, () => {
        qc.invalidateQueries({ queryKey: ["alert-events"] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [qc]);

  const filtered = useMemo(() => {
    const term = eventSearch.trim().toLowerCase();
    return events.filter((e) => {
      if (statusFilter !== "all" && e.status !== statusFilter) return false;
      if (severityFilter !== "all" && e.severity !== severityFilter) return false;
      if (term) {
        const hay = [e.title, e.message, e.scope, e.scope_label].filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [events, statusFilter, severityFilter, eventSearch]);

  const eventPageCount = Math.max(1, Math.ceil(filtered.length / EVENTS_PAGE_SIZE));
  const currentEventPage = Math.min(eventPage, eventPageCount - 1);
  const eventRows = filtered.slice(currentEventPage * EVENTS_PAGE_SIZE, currentEventPage * EVENTS_PAGE_SIZE + EVENTS_PAGE_SIZE);

  // Link vindo da notificação: /alerts?rule=<id> foca a regra correspondente.
  const [focusRuleId, setFocusRuleId] = useState<string | null>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const id = new URLSearchParams(window.location.search).get("rule");
    if (id && id !== "teste") setFocusRuleId(id);
  }, []);

  const filteredRules = useMemo(() => {
    const term = ruleSearch.trim().toLowerCase();
    return rules.filter((r) => {
      if (focusRuleId && r.id !== focusRuleId) return false;
      if (ruleMetric !== "all" && r.metric !== ruleMetric) return false;
      if (ruleState === "enabled" && !r.enabled) return false;
      if (ruleState === "disabled" && r.enabled) return false;
      if (term && !`${r.name} ${r.scope} ${r.metric}`.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [rules, ruleSearch, ruleMetric, ruleState, focusRuleId]);


  const rulePageCount = Math.max(1, Math.ceil(filteredRules.length / RULES_PAGE_SIZE));
  const currentRulePage = Math.min(rulePage, rulePageCount - 1);
  const ruleRows = filteredRules.slice(currentRulePage * RULES_PAGE_SIZE, currentRulePage * RULES_PAGE_SIZE + RULES_PAGE_SIZE);


  const stats = useMemo(() => {
    const open = events.filter((e) => e.status === "open").length;
    const critical = events.filter((e) => e.status !== "resolved" && e.severity === "critical").length;
    const last24 = events.filter((e) => Date.now() - new Date(e.created_at).getTime() < 86400000).length;
    return { total: events.length, open, critical, last24 };
  }, [events]);

  const ack = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("alert_events")
        .update({ status: "acknowledged", acknowledged_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["alert-events"] }),
    onError: (e: any) => toast.error(e.message),
  });

  const resolve = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("alert_events")
        .update({ status: "resolved", resolved_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["alert-events"] }),
    onError: (e: any) => toast.error(e.message),
  });

  const evaluateNow = useMutation({
    mutationFn: async () => {
      const url = `/api/public/cron/evaluate-alerts`;
      const apikey = (import.meta as any).env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
      const res = await fetch(url, { method: "POST", headers: { apikey, "Content-Type": "application/json" }, body: "{}" });
      if (!res.ok) throw new Error(`Falha ao avaliar: ${res.status}`);
      return (await res.json()) as { evaluated: number; triggered: number };
    },
    onSuccess: (r) => {
      toast.success(`Avaliadas ${r.evaluated} regras · ${r.triggered} novos alertas`);
      qc.invalidateQueries({ queryKey: ["alert-events"] });
      qc.invalidateQueries({ queryKey: ["alert-rules"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const validateData = useServerFn(runDataQualityCheck);

  const runValidation = useMutation({
    mutationFn: async () => (await validateData()) as { checked_connections: number; issues: number; created_events: number },
    onSuccess: (r) => {
      if (r.issues === 0) toast.success(`Validação concluída · ${r.checked_connections} conexões sem divergências`);
      else toast.warning(`${r.issues} inconsistência(s) encontradas · ${r.created_events} novo(s) alerta(s)`);
      qc.invalidateQueries({ queryKey: ["alert-events"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <AppShell
      eyebrow="Sistema"
      title="Alertas"
      actions={
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => runValidation.mutate()} disabled={runValidation.isPending} className="gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5" /> {runValidation.isPending ? "Validando..." : "Validar dados"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => evaluateNow.mutate()} disabled={evaluateNow.isPending} className="gap-1.5">
            <Radio className="h-3.5 w-3.5" /> {evaluateNow.isPending ? "Avaliando..." : "Avaliar agora"}
          </Button>
          <NotificationSettingsDialog />
          <NewRuleDialog />
        </div>
      }
    >
      <div className="space-y-6">
        <div className="grid gap-3 md:grid-cols-4">
          <KpiCard label="Abertos" value={fmtNumber(stats.open)} icon={<Bell className="h-4 w-4" />} tone={stats.open > 0 ? "warn" : undefined} />
          <KpiCard label="Críticos" value={fmtNumber(stats.critical)} icon={<AlertTriangle className="h-4 w-4" />} tone={stats.critical > 0 ? "bad" : undefined} />
          <KpiCard label="Últimas 24h" value={fmtNumber(stats.last24)} icon={<Radio className="h-4 w-4" />} />
          <KpiCard label="Total" value={fmtNumber(stats.total)} icon={<Bell className="h-4 w-4" />} />
        </div>

        <Card>
          <CardHeader className="gap-3 pb-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="font-display text-base">Eventos</CardTitle>
                <p className="text-xs text-muted-foreground">Reconheça ou resolva conforme forem tratados.</p>
              </div>
              <span className="text-xs text-muted-foreground">{filtered.length} evento(s)</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Filter className="h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Buscar por título, mensagem ou escopo..."
                value={eventSearch}
                onChange={(e) => {
                  setEventSearch(e.target.value);
                  setEventPage(0);
                }}
                className="h-8 w-full sm:w-[260px]"
              />
              <Select
                value={statusFilter}
                onValueChange={(v) => {
                  setStatusFilter(v as any);
                  setEventPage(0);
                }}
              >
                <SelectTrigger className="h-8 w-[160px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="open">Abertos</SelectItem>
                  <SelectItem value="acknowledged">Reconhecidos</SelectItem>
                  <SelectItem value="resolved">Resolvidos</SelectItem>
                  <SelectItem value="all">Todos</SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={severityFilter}
                onValueChange={(v) => {
                  setSeverityFilter(v as any);
                  setEventPage(0);
                }}
              >
                <SelectTrigger className="h-8 w-[150px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Toda severidade</SelectItem>
                  <SelectItem value="critical">Crítico</SelectItem>
                  <SelectItem value="warning">Atenção</SelectItem>
                  <SelectItem value="info">Informativo</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <LoadingState label="Carregando eventos..." />
            ) : filtered.length === 0 ? (
              <EmptyState title="Nenhum evento" description="Nenhum alerta disparado com esse filtro." icon={<BellOff className="h-5 w-5" />} />
            ) : (
              <>
                <div className="divide-y divide-border/60">
                  {eventRows.map((ev) => (
                    <EventRow key={ev.id} ev={ev} onAck={() => ack.mutate(ev.id)} onResolve={() => resolve.mutate(ev.id)} />
                  ))}
                </div>
                {eventPageCount > 1 && (
                  <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
                    <span className="mr-auto text-xs text-muted-foreground">
                      {currentEventPage * EVENTS_PAGE_SIZE + 1}–
                      {Math.min((currentEventPage + 1) * EVENTS_PAGE_SIZE, filtered.length)} de {filtered.length}
                    </span>
                    <Button variant="outline" size="sm" disabled={currentEventPage === 0} onClick={() => setEventPage((p) => Math.max(0, p - 1))}>
                      Anterior
                    </Button>
                    <span className="text-xs text-muted-foreground">Página {currentEventPage + 1} de {eventPageCount}</span>
                    <Button variant="outline" size="sm" disabled={currentEventPage + 1 >= eventPageCount} onClick={() => setEventPage((p) => p + 1)}>
                      Próxima
                    </Button>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="gap-3 pb-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="font-display text-base">Regras</CardTitle>
                <p className="text-xs text-muted-foreground">Cada regra é avaliada pelo cron ou pelo botão "Avaliar agora".</p>
              </div>
              <span className="text-xs text-muted-foreground">{filteredRules.length} regra(s)</span>
            </div>
            {focusRuleId && (
              <div className="flex items-center justify-between gap-2 rounded-md border border-primary/40 bg-primary/5 px-3 py-2 text-xs">
                <span>Exibindo apenas a regra indicada na notificação.</span>
                <Button size="sm" variant="outline" className="h-7" onClick={() => setFocusRuleId(null)}>
                  Ver todas
                </Button>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">

              <Input
                placeholder="Buscar regra..."
                value={ruleSearch}
                onChange={(e) => {
                  setRuleSearch(e.target.value);
                  setRulePage(0);
                }}
                className="h-8 w-full sm:w-[240px]"
              />
              <Select
                value={ruleMetric}
                onValueChange={(v) => {
                  setRuleMetric(v);
                  setRulePage(0);
                }}
              >
                <SelectTrigger className="h-8 w-[190px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas as métricas</SelectItem>
                  {Object.entries(METRIC_LABEL).map(([value, label]) => (
                    <SelectItem key={value} value={value}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={ruleState}
                onValueChange={(v) => {
                  setRuleState(v as any);
                  setRulePage(0);
                }}
              >
                <SelectTrigger className="h-8 w-[150px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Ativas e inativas</SelectItem>
                  <SelectItem value="enabled">Somente ativas</SelectItem>
                  <SelectItem value="disabled">Somente inativas</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {filteredRules.length === 0 ? (
              <EmptyState
                title={rules.length === 0 ? "Sem regras" : "Nenhuma regra encontrada"}
                description={rules.length === 0 ? "Crie uma regra para começar a monitorar." : "Ajuste a busca ou os filtros."}
                icon={<Bell className="h-5 w-5" />}
              />
            ) : (
              <>
                {ruleRows.map((r) => <RuleRow key={r.id} rule={r} />)}
                {rulePageCount > 1 && (
                  <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                    <span className="mr-auto text-xs text-muted-foreground">
                      {currentRulePage * RULES_PAGE_SIZE + 1}–
                      {Math.min((currentRulePage + 1) * RULES_PAGE_SIZE, filteredRules.length)} de {filteredRules.length}
                    </span>
                    <Button variant="outline" size="sm" disabled={currentRulePage === 0} onClick={() => setRulePage((p) => Math.max(0, p - 1))}>
                      Anterior
                    </Button>
                    <span className="text-xs text-muted-foreground">Página {currentRulePage + 1} de {rulePageCount}</span>
                    <Button variant="outline" size="sm" disabled={currentRulePage + 1 >= rulePageCount} onClick={() => setRulePage((p) => p + 1)}>
                      Próxima
                    </Button>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

      </div>
    </AppShell>
  );
}

const CHANNEL_LABEL: Record<string, string> = {
  in_app: "No app",
  slack: "Slack",
  email: "E-mail",
  slack_email: "Slack + e-mail",
  all: "Todos os canais",
};

function SeverityDot({ severity }: { severity: string }) {
  const cls =
    severity === "critical"
      ? "bg-red-500"
      : severity === "warning"
      ? "bg-amber-500"
      : "bg-sky-500";
  return <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${cls}`} />;
}

function StatusBadge({ status }: { status: string }) {
  if (status === "open") return <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-300" variant="secondary">Aberto</Badge>;
  if (status === "acknowledged") return <Badge variant="secondary" className="bg-sky-500/15 text-sky-700 dark:text-sky-300">Reconhecido</Badge>;
  return <Badge variant="outline" className="border-border/60 text-muted-foreground">Resolvido</Badge>;
}

function RuleRow({ rule }: { rule: AlertRule }) {
  const qc = useQueryClient();
  const toggle = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("cost_alerts").update({ enabled: !rule.enabled }).eq("id", rule.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["alert-rules"] }),
    onError: (e: any) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("cost_alerts").delete().eq("id", rule.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Regra removida");
      qc.invalidateQueries({ queryKey: ["alert-rules"] });
    },
    onError: (e: any) => toast.error(e.message),
  });
  const isCurrency = rule.metric === "monthly_cost" || rule.metric === "daily_cost";
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border border-border/60 bg-muted/20 px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate font-display text-sm font-semibold">{rule.name}</p>
          {!rule.enabled && <Badge variant="outline" className="text-[10px]">Desativada</Badge>}
          {rule.channel && rule.channel !== "in_app" && (
            <Badge variant="secondary" className="text-[10px] capitalize">{CHANNEL_LABEL[rule.channel] ?? rule.channel}</Badge>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground">
          {METRIC_LABEL[rule.metric] ?? rule.metric} · escopo {rule.scope} · {rule.comparison}{" "}
          {isCurrency ? fmtBRL(rule.threshold) : `${rule.threshold}${rule.metric === "variance_pct" ? "%" : rule.metric === "no_sync_days" ? "d" : ""}`}
          {rule.last_evaluated_at && <> · avaliada em {fmtDateTime(rule.last_evaluated_at)}</>}
        </p>
      </div>
      <Button size="sm" variant="outline" className="h-8" onClick={() => toggle.mutate()}>
        {rule.enabled ? "Desativar" : "Ativar"}
      </Button>
      <Button size="icon" variant="ghost" className="h-8 w-8 hover:text-destructive" onClick={() => remove.mutate()}>
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

function NotificationSettingsDialog() {
  const qcSettings = useQueryClient();
  const [open, setOpen] = useState(false);

  const [emails, setEmails] = useState("");
  const [previewMetric, setPreviewMetric] = useState("monthly_cost");
  const [previewTab, setPreviewTab] = useState("slack");
  const loadSettings = useServerFn(getAlertNotificationSettings);
  const save = useServerFn(saveAlertNotificationSettings);
  const test = useServerFn(sendTestAlertNotification);

  const settings = useQuery({
    queryKey: ["alert-notification-settings"],
    queryFn: async () => (await loadSettings()) as { emails: string[]; slack_configured: boolean },
    enabled: open,
  });

  useEffect(() => {
    if (settings.data) setEmails(settings.data.emails.join(", "));
  }, [settings.data]);

  const saveMut = useMutation({
    mutationFn: async () => await save({ data: { emails: emails.split(/[,;\n]/) } }),
    onSuccess: (res: any) => toast.success(`Destinatários salvos (${res?.emails?.length ?? 0})`),
    onError: (e: any) => toast.error(e?.message ?? "Falha ao salvar"),
  });

  const preview = useMemo(() => {
    const sample = sampleNotification(previewMetric);
    const origin = typeof window === "undefined" ? "" : window.location.origin;
    const ruleUrl = `${origin}/alerts?rule=${encodeURIComponent(sample.ruleId)}`;
    return { sample, ruleUrl, email: buildEmailContent(sample, ruleUrl) };
  }, [previewMetric]);

  const processQueue = useServerFn(processAlertNotificationQueue);
  const queueMut = useMutation({
    mutationFn: async () =>
      (await processQueue()) as { processed: number; sent: number; pending: number; failed: number },
    onSuccess: (res) => {
      toast.success(
        `Fila processada — ${res.sent} enviado(s), ${res.pending} aguardando retry, ${res.failed} falha(s)`,
      );
      qcSettings.invalidateQueries({ queryKey: ["alert-deliveries"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Falha ao processar fila"),
  });

  const testMut = useMutation({
    mutationFn: async () =>
      (await test()) as { queued: number; sent: number; pending: number; failed: number },
    onSuccess: (res) =>
      toast.success(
        `Teste enfileirado — ${res.sent} enviado(s), ${res.pending} na fila para retry, ${res.failed} falha(s)`,
      ),
    onError: (e: any) => toast.error(e?.message ?? "Falha no envio de teste"),
  });


  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <BellRing className="h-3.5 w-3.5" /> Notificações
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display">Notificações de alertas</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Destinatários de e-mail</label>
            <textarea
              className="min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              placeholder="financeiro@lefil.com.br, ops@lefil.com.br"
              value={emails}
              onChange={(e) => setEmails(e.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">
              Separe por vírgula. Cada alerta enviado inclui a regra, o período afetado e o link direto.
            </p>
          </div>
          <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-xs">

            Slack:{" "}
            {settings.data?.slack_configured ? (
              <span className="font-medium text-emerald-600 dark:text-emerald-400">webhook configurado</span>
            ) : (
              <span className="text-muted-foreground">
                sem webhook — adicione o segredo SLACK_WEBHOOK_URL para ativar o canal Slack.
              </span>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="text-xs font-medium text-muted-foreground">
                Prévia do conteúdo (exemplo)
              </label>
              <Select value={previewMetric} onValueChange={setPreviewMetric}>
                <SelectTrigger className="h-8 w-[220px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="monthly_cost">Custo mensal</SelectItem>
                  <SelectItem value="daily_cost">Custo diário</SelectItem>
                  <SelectItem value="variance_pct">Variação %</SelectItem>
                  <SelectItem value="no_sync_days">Dias sem sync</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Tabs value={previewTab} onValueChange={setPreviewTab}>
              <TabsList className="h-8">
                <TabsTrigger value="slack" className="text-xs">Slack</TabsTrigger>
                <TabsTrigger value="email" className="text-xs">E-mail</TabsTrigger>
              </TabsList>
              <TabsContent value="slack" className="mt-2">
                <div className="space-y-2 rounded-md border border-border/60 bg-background p-3 text-xs">
                  <div className="font-semibold">
                    {severityEmoji(preview.sample.severity)} {preview.sample.title}
                  </div>
                  <p className="text-muted-foreground">{preview.sample.message}</p>
                  <div className="grid grid-cols-2 gap-2">
                    <div><span className="font-medium">Regra:</span> {preview.sample.ruleName}</div>
                    <div><span className="font-medium">Escopo:</span> {preview.sample.scopeLabel}</div>
                    <div className="col-span-2">
                      <span className="font-medium">Período afetado:</span> {preview.sample.periodLabel}
                    </div>
                    <div><span className="font-medium">Limite:</span> {fmtBRLNotify(preview.sample.threshold)}</div>
                  </div>
                  <div className="inline-flex items-center rounded bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground">
                    Ver regra no Quiwi
                  </div>
                  <p className="break-all text-[10px] text-muted-foreground">{preview.ruleUrl}</p>
                </div>
              </TabsContent>
              <TabsContent value="email" className="mt-2">
                <div className="space-y-2 rounded-md border border-border/60 bg-background p-3 text-xs">
                  <div>
                    <span className="text-muted-foreground">Assunto: </span>
                    <span className="font-medium">{preview.email.subject}</span>
                  </div>
                  <div className="text-muted-foreground">
                    Para: {emails.trim() ? emails : "nenhum destinatário configurado"}
                  </div>
                  <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/40 p-2 text-[11px] leading-relaxed">
                    {preview.email.body}
                  </pre>
                </div>
              </TabsContent>
            </Tabs>
            <p className="text-[11px] text-muted-foreground">
              O teste enviado usa este mesmo formato, com o período do mês corrente.
            </p>
          </div>

          <DialogFooter className="gap-2 sm:justify-between">
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => testMut.mutate()} disabled={testMut.isPending}>
                {testMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                Enviar teste
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => queueMut.mutate()}
                disabled={queueMut.isPending}
              >
                {queueMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BellRing className="h-3.5 w-3.5" />}
                Processar fila
              </Button>
            </div>

            <Button size="sm" onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
              {saveMut.isPending ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function NewRuleDialog() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: "",
    scope: "global" as AlertRule["scope"],
    metric: "monthly_cost" as AlertRule["metric"],
    comparison: ">" as AlertRule["comparison"],
    threshold: 1000,
    channel: "in_app",
  });

  const create = useMutation({
    mutationFn: async () => {
      if (!form.name.trim()) throw new Error("Nome é obrigatório");
      const { error } = await supabase.from("cost_alerts").insert({
        name: form.name.trim(),
        scope: form.scope,
        metric: form.metric,
        comparison: form.comparison,
        threshold: Number(form.threshold),
        channel: form.channel,
        enabled: true,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Regra criada");
      qc.invalidateQueries({ queryKey: ["alert-rules"] });
      setOpen(false);
      setForm({ name: "", scope: "global", metric: "monthly_cost", comparison: ">", threshold: 1000, channel: "in_app" });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const inputCls = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm";
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5"><Plus className="h-3.5 w-3.5" /> Nova regra</Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display">Nova regra de alerta</DialogTitle>
        </DialogHeader>
        <form
          className="grid grid-cols-2 gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <div className="col-span-2 space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Nome *</label>
            <input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Escopo</label>
            <Select value={form.scope} onValueChange={(v) => setForm({ ...form, scope: v as any })}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="global">Global</SelectItem>
                <SelectItem value="client">Cliente</SelectItem>
                <SelectItem value="platform">Plataforma</SelectItem>
                <SelectItem value="provider">Fornecedor</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Métrica</label>
            <Select value={form.metric} onValueChange={(v) => setForm({ ...form, metric: v as any })}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="monthly_cost">Custo mensal (BRL)</SelectItem>
                <SelectItem value="daily_cost">Custo diário (BRL)</SelectItem>
                <SelectItem value="variance_pct">Variação % mês</SelectItem>
                <SelectItem value="no_sync_days">Dias sem sincronização</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Comparador</label>
            <Select value={form.comparison} onValueChange={(v) => setForm({ ...form, comparison: v as any })}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value=">">maior que</SelectItem>
                <SelectItem value=">=">maior ou igual</SelectItem>
                <SelectItem value="<">menor que</SelectItem>
                <SelectItem value="<=">menor ou igual</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Limite</label>
            <Input type="number" step="any" value={form.threshold} onChange={(e) => setForm({ ...form, threshold: Number(e.target.value) })} />
          </div>
          <div className="col-span-2 space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Notificações</label>
            <Select value={form.channel} onValueChange={(v) => setForm({ ...form, channel: v })}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="in_app">Somente no app</SelectItem>
                <SelectItem value="slack">No app + Slack</SelectItem>
                <SelectItem value="email">No app + e-mail</SelectItem>
                <SelectItem value="slack_email">No app + Slack + e-mail</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              A notificação inclui o link da regra e o período afetado. Configure os destinatários em “Notificações”.
            </p>
          </div>

          <DialogFooter className="col-span-2 mt-2">
            <Button type="submit" disabled={create.isPending}>{create.isPending ? "Criando..." : "Criar regra"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EventRow({ ev, onAck, onResolve }: { ev: AlertEvent; onAck: () => void; onResolve: () => void }) {
  const [open, setOpen] = useState(false);
  const [explanation, setExplanation] = useState<string | null>(null);
  const explain = useServerFn(explainAlert);
  const mut = useMutation({
    mutationFn: async () => {
      const res: any = await explain({ data: { event_id: ev.id } });
      return res.explanation as string;
    },
    onSuccess: (text) => {
      setExplanation(text);
      setOpen(true);
    },
    onError: (e: any) => toast.error(e?.message ?? "Falha ao explicar alerta"),
  });

  return (
    <div className="py-3">
      <div className="flex items-start gap-3">
        <SeverityDot severity={ev.severity} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate font-display text-sm font-semibold">{ev.title}</p>
            <StatusBadge status={ev.status} />
            {ev.scope_label && <Badge variant="outline" className="text-[10px]">{ev.scope_label}</Badge>}
          </div>
          {ev.message && <p className="mt-0.5 text-xs text-muted-foreground">{ev.message}</p>}
          <p className="mt-1 text-[11px] text-muted-foreground">
            {fmtDateTime(ev.created_at)}
            {ev.metric_value != null && ev.threshold != null && (
              <> · valor {fmtNumber(ev.metric_value, 1)} / limite {fmtNumber(ev.threshold, 1)}</>
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1"
            onClick={() => (explanation ? setOpen((v) => !v) : mut.mutate())}
            disabled={mut.isPending}
            title="Explicar com IA (Gemini)"
          >
            {mut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            Explicar
          </Button>
          {ev.status === "open" && (
            <Button size="sm" variant="outline" className="h-8" onClick={onAck}>
              Reconhecer
            </Button>
          )}
          {ev.status !== "resolved" && (
            <Button size="sm" variant="outline" className="h-8 gap-1" onClick={onResolve}>
              <CheckCircle2 className="h-3.5 w-3.5" /> Resolver
            </Button>
          )}
        </div>
      </div>
      <DeliveryStatus eventId={ev.id} />
      {open && explanation && (
        <div className="ml-6 mt-2 rounded-lg border border-border/60 bg-muted/40 p-3">
          <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            <Sparkles className="h-3 w-3" /> Análise Gemini
          </div>
          <div className="prose prose-sm max-w-none dark:prose-invert prose-p:my-1 prose-ul:my-1">
            <ReactMarkdown>{explanation}</ReactMarkdown>
          </div>
        </div>
      )}
    </div>
  );
}

type Delivery = {
  id: string;
  channel: string;
  target: string | null;
  status: string;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  next_attempt_at: string | null;
  sent_at: string | null;
};

const deliveryLabel: Record<string, string> = {
  sent: "enviado",
  pending: "na fila",
  failed: "falhou",
  cancelled: "cancelado",
};

function DeliveryStatus({ eventId }: { eventId: string }) {
  const qc = useQueryClient();
  const list = useServerFn(listAlertDeliveries);
  const retry = useServerFn(retryAlertDelivery);

  const { data } = useQuery({
    queryKey: ["alert-deliveries", eventId],
    queryFn: async () => {
      const res: any = await list({ data: { event_id: eventId } });
      return (res.deliveries ?? []) as Delivery[];
    },
  });

  const retryMut = useMutation({
    mutationFn: async (id: string) => retry({ data: { id } }),
    onSuccess: (res: any) => {
      toast.success(`Reenvio: ${deliveryLabel[res?.status] ?? res?.status}`);
      qc.invalidateQueries({ queryKey: ["alert-deliveries", eventId] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Falha ao reenviar"),
  });

  const deliveries = data ?? [];
  if (deliveries.length === 0) return null;

  return (
    <div className="ml-6 mt-2 flex flex-wrap items-center gap-2">
      {deliveries.map((d) => (
        <div
          key={d.id}
          className="flex items-center gap-1.5 rounded-md border border-border/60 bg-muted/30 px-2 py-1"
          title={d.last_error ?? undefined}
        >
          <Badge
            variant={d.status === "sent" ? "secondary" : d.status === "failed" ? "destructive" : "outline"}
            className="text-[10px]"
          >
            {d.channel === "slack" ? "Slack" : "E-mail"} · {deliveryLabel[d.status] ?? d.status}
          </Badge>
          <span className="max-w-[180px] truncate text-[10px] text-muted-foreground">
            {d.channel === "email" ? d.target : "webhook"}
            {d.attempts > 0 && ` · ${d.attempts}/${d.max_attempts} tentativa(s)`}
            {d.status === "pending" && d.next_attempt_at && ` · próx. ${fmtDateTime(d.next_attempt_at)}`}
          </span>
          {d.status !== "sent" && (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 gap-1 px-1.5 text-[10px]"
              onClick={() => retryMut.mutate(d.id)}
              disabled={retryMut.isPending}
            >
              {retryMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
              Reenviar
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}
