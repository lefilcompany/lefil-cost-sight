import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, CheckCircle2, History, Loader2, RotateCcw, XCircle } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { fmtDateTime } from "@/lib/format";
import { runConnectionBackfillFn } from "@/lib/sync.functions";

type Job = {
  id: string;
  status: string;
  period_start: string | null;
  period_end: string | null;
  started_at: string | null;
  finished_at: string | null;
  records_read: number;
  records_inserted: number;
  records_updated: number;
  records_skipped: number;
  error_count: number;
  error_message: string | null;
  metadata: any;
};

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

const PRESETS: Record<string, () => { start: string; end: string }> = {
  "current-month": () => {
    const now = new Date();
    return { start: isoDay(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))), end: isoDay(now) };
  },
  "30d": () => ({ start: isoDay(new Date(Date.now() - 30 * 86_400_000)), end: isoDay(new Date()) }),
  "90d": () => ({ start: isoDay(new Date(Date.now() - 90 * 86_400_000)), end: isoDay(new Date()) }),
  "12m": () => ({ start: isoDay(new Date(Date.now() - 365 * 86_400_000)), end: isoDay(new Date()) }),
};

const STATUS_META: Record<string, { label: string; className: string; icon: typeof CheckCircle2 }> = {
  success: { label: "Concluído", className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300", icon: CheckCircle2 },
  partial: { label: "Parcial", className: "bg-amber-500/10 text-amber-700 dark:text-amber-300", icon: AlertTriangle },
  error: { label: "Falhou", className: "bg-rose-500/10 text-rose-700 dark:text-rose-300", icon: XCircle },
  running: { label: "Executando", className: "bg-sky-500/10 text-sky-700 dark:text-sky-300", icon: Loader2 },
};

export function BackfillDialog({ connectionId }: { connectionId: string }) {
  const qc = useQueryClient();
  const runBackfill = useServerFn(runConnectionBackfillFn);
  const [open, setOpen] = useState(false);
  const [preset, setPreset] = useState("current-month");
  const initial = useMemo(() => PRESETS["current-month"]!(), []);
  const [start, setStart] = useState(initial.start);
  const [end, setEnd] = useState(initial.end);
  const [purge, setPurge] = useState(true);
  const [reconcile, setReconcile] = useState(true);


  const { data: jobs = [] } = useQuery({
    queryKey: ["backfill-jobs", connectionId],
    enabled: open,
    refetchInterval: open ? 5_000 : false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sync_jobs")
        .select(
          "id,status,period_start,period_end,started_at,finished_at,records_read,records_inserted,records_updated,records_skipped,error_count,error_message,metadata",
        )
        .eq("provider_connection_id", connectionId)
        .eq("sync_type", "backfill")
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return (data ?? []) as Job[];
    },
  });

  const runningJob = useMemo(
    () =>
      jobs.find(
        (j) =>
          j.status === "running" &&
          (j.period_start ?? "") <= end &&
          (j.period_end ?? "") >= start,
      ) ?? null,
    [jobs, start, end],
  );

  const applyPreset = (value: string) => {
    setPreset(value);
    const fn = PRESETS[value];
    if (fn) {
      const p = fn();
      setStart(p.start);
      setEnd(p.end);
    }
  };


  const run = useMutation({
    mutationFn: () => {
      if (runningJob) {
        throw new Error(
          "Já existe um backfill em execução nesta conexão para um período sobreposto. Aguarde a conclusão antes de tentar novamente.",
        );
      }
      return runBackfill({
        data: { connection_id: connectionId, period_start: start, period_end: end, purge, reconcile },
      });
    },

    onSuccess: (res: any) => {
      const failed = (res?.steps ?? []).filter((s: any) => !s.ok).length;
      if (res?.status === "success") {
        toast.success(
          `Backfill concluído · ${res.records_imported} registro(s) reprocessado(s), ${res.deleted_usage_rows + res.deleted_cost_entries} removido(s)`,
        );
      } else {
        toast.warning(`Backfill finalizado com ${failed} etapa(s) com erro. Veja os logs abaixo.`);
      }
      const rec = res?.reconciliation;
      if (rec) {
        if (rec.divergent > 0) {
          toast.warning(
            `Reconciliação: ${rec.divergent} mês(es) com divergência acima de ${rec.tolerance_pct}% · ${rec.created_events} alerta(s) gerado(s)`,
          );
        } else {
          toast.success(`Reconciliação sem divergências acima de ${rec.tolerance_pct}%`);
        }
      }
      qc.invalidateQueries({ queryKey: ["backfill-jobs", connectionId] });
      qc.invalidateQueries({ queryKey: ["conn-audit"] });
      qc.invalidateQueries({ queryKey: ["sync_logs"] });
      qc.invalidateQueries({ queryKey: ["reconciliation"] });
      qc.invalidateQueries({ queryKey: ["alert_events"] });
    },

    onError: (err: any) => toast.error(err?.message ?? "Falha ao executar o backfill"),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2">
          <History className="h-4 w-4" />
          Backfill
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[90vh] max-w-2xl flex-col gap-0 p-0">
        <DialogHeader className="border-b p-6">
          <DialogTitle>Backfill sob demanda</DialogTitle>
          <DialogDescription>
            Reprocessa o uso, os snapshots e as faturas desta conexão no período escolhido. Cada execução fica
            registrada com status e logs por etapa.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 space-y-5 overflow-y-auto p-6">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Período</Label>
              <Select value={preset} onValueChange={applyPreset}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="current-month">Mês atual</SelectItem>
                  <SelectItem value="30d">Últimos 30 dias</SelectItem>
                  <SelectItem value="90d">Últimos 90 dias</SelectItem>
                  <SelectItem value="12m">Últimos 12 meses</SelectItem>
                  <SelectItem value="custom">Personalizado</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bf-start">Início</Label>
              <Input
                id="bf-start"
                type="date"
                value={start}
                onChange={(e) => {
                  setStart(e.target.value);
                  setPreset("custom");
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bf-end">Fim</Label>
              <Input
                id="bf-end"
                type="date"
                value={end}
                onChange={(e) => {
                  setEnd(e.target.value);
                  setPreset("custom");
                }}
              />
            </div>
          </div>

          <label className="flex items-start gap-3 rounded-lg border p-3 text-sm">
            <Checkbox checked={purge} onCheckedChange={(v) => setPurge(Boolean(v))} className="mt-0.5" />
            <span>
              <span className="font-medium">Limpar dados importados do período antes de reprocessar</span>
              <span className="block text-xs text-muted-foreground">
                Remove uso diário e lançamentos de origem API desta conexão no intervalo. Lançamentos manuais não são
                afetados.
              </span>
            </span>
          </label>

          {runningJob ? (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
              <Loader2 className="mt-0.5 h-4 w-4 animate-spin" />
              <span>
                <span className="font-medium">Backfill em execução nesta conexão</span>
                <span className="block text-xs">
                  Período {runningJob.period_start ?? "—"} a {runningJob.period_end ?? "—"}
                  {runningJob.started_at
                    ? ` · iniciado às ${new Date(runningJob.started_at).toLocaleTimeString("pt-BR")}`
                    : ""}
                  . Aguarde a conclusão ou escolha um período que não se sobreponha.
                </span>
              </span>
            </div>
          ) : null}


          {run.data ? (
            <div className="space-y-2 rounded-lg border p-3">
              <div className="text-sm font-medium">Última execução</div>
              {((run.data as any).steps ?? []).map((s: any, i: number) => (
                <div key={i} className="flex items-start gap-2 text-xs">
                  {s.ok ? (
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 text-emerald-500" />
                  ) : (
                    <XCircle className="mt-0.5 h-3.5 w-3.5 text-rose-500" />
                  )}
                  <span className="flex-1">
                    {s.step}
                    {s.records != null ? ` · ${s.records} registro(s)` : ""}
                    {s.message ? <span className="block text-muted-foreground">{s.message}</span> : null}
                  </span>
                </div>
              ))}
            </div>
          ) : null}

          <div className="space-y-2">
            <div className="text-sm font-medium">Histórico de backfills</div>
            {jobs.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nenhum backfill executado nesta conexão ainda.</p>
            ) : (
              <div className="space-y-2">
                {jobs.map((j) => {
                  const meta = STATUS_META[j.status] ?? {
                    label: j.status,
                    className: "bg-muted text-muted-foreground",
                    icon: History,
                  };
                  const steps = (j.metadata?.steps ?? []) as any[];
                  return (
                    <div key={j.id} className="rounded-lg border p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-xs">
                          <div className="font-medium">
                            {j.period_start} → {j.period_end}
                          </div>
                          <div className="text-muted-foreground">
                            {fmtDateTime(j.started_at)}
                            {j.finished_at ? ` · fim ${fmtDateTime(j.finished_at)}` : ""}
                          </div>
                        </div>
                        <Badge variant="secondary" className={meta.className}>
                          {meta.label}
                        </Badge>
                      </div>
                      <div className="mt-2 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
                        <span>
                          Reprocessados: {j.records_read} · inseridos {j.records_inserted} · atualizados{" "}
                          {j.records_updated}
                        </span>
                        <span>Removidos na limpeza: {j.records_skipped}</span>
                      </div>
                      {j.error_message ? (
                        <p className="mt-1 text-xs text-rose-600 dark:text-rose-400">{j.error_message}</p>
                      ) : null}
                      {steps.length > 0 ? (
                        <ul className="mt-2 space-y-0.5 text-xs">
                          {steps.map((s, i) => (
                            <li key={i} className={s.ok ? "text-muted-foreground" : "text-rose-600 dark:text-rose-400"}>
                              {s.ok ? "✓" : "✕"} {s.step}
                              {s.records != null ? ` (${s.records})` : ""}
                              {s.message ? ` — ${s.message}` : ""}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="border-t p-4">
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Fechar
          </Button>
          <Button
            onClick={() => run.mutate()}
            disabled={run.isPending || !start || !end || Boolean(runningJob)}
            className="gap-2"
          >
            {run.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
            {runningJob ? "Backfill em execução" : "Executar backfill"}

          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
