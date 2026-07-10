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
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";
import { explainAlert } from "@/lib/gemini-ai.functions";

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

function AlertsPage() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<"all" | "open" | "acknowledged" | "resolved">("open");

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

  const filtered = useMemo(
    () => (statusFilter === "all" ? events : events.filter((e) => e.status === statusFilter)),
    [events, statusFilter],
  );

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

  return (
    <AppShell
      eyebrow="Sistema"
      title="Alertas"
      actions={
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => evaluateNow.mutate()} disabled={evaluateNow.isPending} className="gap-1.5">
            <Radio className="h-3.5 w-3.5" /> {evaluateNow.isPending ? "Avaliando..." : "Avaliar agora"}
          </Button>
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
          <CardHeader className="flex flex-row items-center justify-between gap-3 pb-3">
            <div>
              <CardTitle className="font-display text-base">Eventos</CardTitle>
              <p className="text-xs text-muted-foreground">Reconheça ou resolva conforme forem tratados.</p>
            </div>
            <div className="flex items-center gap-2">
              <Filter className="h-3.5 w-3.5 text-muted-foreground" />
              <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
                <SelectTrigger className="h-8 w-[160px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="open">Abertos</SelectItem>
                  <SelectItem value="acknowledged">Reconhecidos</SelectItem>
                  <SelectItem value="resolved">Resolvidos</SelectItem>
                  <SelectItem value="all">Todos</SelectItem>
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
              <div className="divide-y divide-border/60">
                {filtered.map((ev) => (
                  <EventRow key={ev.id} ev={ev} onAck={() => ack.mutate(ev.id)} onResolve={() => resolve.mutate(ev.id)} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="font-display text-base">Regras</CardTitle>
            <p className="text-xs text-muted-foreground">Cada regra é avaliada pelo cron ou pelo botão "Avaliar agora".</p>
          </CardHeader>
          <CardContent className="space-y-2">
            {rules.length === 0 ? (
              <EmptyState title="Sem regras" description="Crie uma regra para começar a monitorar." icon={<Bell className="h-5 w-5" />} />
            ) : (
              rules.map((r) => <RuleRow key={r.id} rule={r} />)
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

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

function NewRuleDialog() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: "",
    scope: "global" as AlertRule["scope"],
    metric: "monthly_cost" as AlertRule["metric"],
    comparison: ">" as AlertRule["comparison"],
    threshold: 1000,
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
        channel: "in_app",
        enabled: true,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Regra criada");
      qc.invalidateQueries({ queryKey: ["alert-rules"] });
      setOpen(false);
      setForm({ name: "", scope: "global", metric: "monthly_cost", comparison: ">", threshold: 1000 });
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
