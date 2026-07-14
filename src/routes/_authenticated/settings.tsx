import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import {
  Plus,
  Pencil,
  Trash2,
  Search,
  Filter,
  X,
  Save,
  RefreshCw,
  Inbox,
  Settings2,
  Coins,
  Clock,
  ShieldAlert,
  Info,
} from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { KpiCard as Kpi, LoadingState } from "@/components/ui-kit";
import { fmtDateTime } from "@/lib/format";
import { getUsdRate } from "@/lib/sync.functions";

const searchSchema = z.object({
  q: z.string().optional().catch(undefined),
});

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({ meta: [{ title: "Configurações — Quiwi Cost Center" }] }),
  validateSearch: searchSchema,
  component: SettingsPage,
});

type SettingRow = {
  key: string;
  value: any;
  updated_at: string | null;
};

const KEY_REGEX = /^[a-z0-9_]+$/;
const KEY_META: Record<string, { label: string; description: string; icon: any }> = {
  usd_brl_rate: {
    label: "Cotação USD → BRL",
    description: "Fator de conversão aplicado a lançamentos em dólar.",
    icon: Coins,
  },
  sync_interval_minutes: {
    label: "Intervalo de sincronização",
    description: "Frequência (min) padrão para jobs recorrentes.",
    icon: Clock,
  },
  alert_threshold_brl: {
    label: "Alerta de custo (BRL)",
    description: "Dispara aviso quando um cliente ultrapassa este valor no mês.",
    icon: ShieldAlert,
  },
};

function metaFor(key: string) {
  return KEY_META[key] ?? { label: key, description: "Configuração customizada.", icon: Settings2 };
}

function SettingsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate({ from: "/settings" });
  const search = Route.useSearch();
  const refreshRate = useServerFn(getUsdRate);

  const { data: settings = [], isLoading } = useQuery({
    queryKey: ["system_settings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("system_settings")
        .select("*")
        .order("key");
      if (error) throw error;
      return (data ?? []) as SettingRow[];
    },
  });

  const rateSetting = useMemo(() => settings.find((s) => s.key === "usd_brl_rate"), [settings]);
  const rateValue = (rateSetting?.value as any)?.rate;
  const rateUpdatedAt = (rateSetting?.value as any)?.updated_at ?? rateSetting?.updated_at;
  const rateSource = (rateSetting?.value as any)?.source as string | undefined;
  const rateManual = (rateSetting?.value as any)?.manual === true;
  const sourceLabel = rateManual
    ? "Manual (fixo pelo admin)"
    : rateSource === "awesomeapi"
      ? "AwesomeAPI (tempo real)"
      : rateSource === "bcb"
        ? "Banco Central (fallback)"
        : rateSource === "fallback"
          ? "Último valor conhecido"
          : "—";

  const [rate, setRate] = useState("");
  useEffect(() => {
    if (typeof rateValue === "number") setRate(String(rateValue));
  }, [rateValue]);

  const filtered = useMemo(() => {
    const q = (search.q ?? "").toLowerCase().trim();
    if (!q) return settings;
    return settings.filter((s) => {
      const label = metaFor(s.key).label.toLowerCase();
      const val = JSON.stringify(s.value ?? "").toLowerCase();
      return s.key.toLowerCase().includes(q) || label.includes(q) || val.includes(q);
    });
  }, [settings, search]);

  const setSearch = (patch: Partial<z.infer<typeof searchSchema>>) =>
    navigate({ search: (prev: z.infer<typeof searchSchema>) => ({ ...prev, ...patch }) });

  const activeFilters = Number(!!search.q);
  const clearFilters = () => navigate({ search: {} as any });

  const saveRate = useMutation({
    mutationFn: async () => {
      const n = Number(rate);
      if (!Number.isFinite(n)) throw new Error("Cotação deve ser um número");
      if (n <= 0) throw new Error("Cotação deve ser maior que zero");
      if (n > 1000) throw new Error("Cotação parece inválida (> 1000)");
      const value = { rate: n, updated_at: new Date().toISOString(), manual: true, source: "manual" };
      const { error } = await supabase.from("system_settings").upsert({ key: "usd_brl_rate", value });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Cotação atualizada");
      qc.invalidateQueries({ queryKey: ["system_settings"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const fetchAuto = useMutation({
    mutationFn: async () => refreshRate({}),
    onSuccess: (res: any) => {
      const src = res?.source === "awesomeapi" ? "AwesomeAPI" : res?.source === "bcb" ? "Banco Central" : res?.source ?? "";
      toast.success(`Cotação atualizada: R$ ${Number(res.rate).toFixed(4)} · ${src}`);
      qc.invalidateQueries({ queryKey: ["system_settings"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  // Generic setting CRUD
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<SettingRow | null>(null);
  const [form, setForm] = useState<{ key: string; value_json: string }>({ key: "", value_json: "" });

  const openCreate = () => {
    setEditing(null);
    setForm({ key: "", value_json: "{\n  \n}" });
    setOpen(true);
  };
  const openEdit = (s: SettingRow) => {
    setEditing(s);
    setForm({ key: s.key, value_json: JSON.stringify(s.value, null, 2) });
    setOpen(true);
  };

  const saveSetting = useMutation({
    mutationFn: async () => {
      const key = form.key?.trim();
      if (!key) throw new Error("Chave é obrigatória");
      if (!KEY_REGEX.test(key)) throw new Error("Use apenas letras minúsculas, números e _");
      if (key.length > 60) throw new Error("Chave muito longa (máx 60)");
      let value: any;
      try {
        value = JSON.parse(form.value_json || "null");
      } catch {
        throw new Error("Valor JSON inválido");
      }
      const { error } = await supabase.from("system_settings").upsert({ key, value });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(editing ? "Configuração atualizada" : "Configuração criada");
      qc.invalidateQueries({ queryKey: ["system_settings"] });
      setOpen(false);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const removeSetting = useMutation({
    mutationFn: async (key: string) => {
      const { error } = await supabase.from("system_settings").delete().eq("key", key);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Removida");
      qc.invalidateQueries({ queryKey: ["system_settings"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <AppShell
      eyebrow="Sistema"
      title="Configurações"
      actions={
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button onClick={openCreate} className="gap-1.5">
              <Plus className="h-4 w-4" /> Nova configuração
            </Button>
          </DialogTrigger>
          <SettingDialog
            editing={editing}
            form={form}
            setForm={setForm}
            onSubmit={() => saveSetting.mutate()}
            pending={saveSetting.isPending}
          />
        </Dialog>
      }
    >
      <div className="space-y-6">
        {/* Featured: USD → BRL */}
        <div className="grid gap-6 md:grid-cols-2">
          <Card className="surface-elevated">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 font-display text-base">
                <Coins className="h-4 w-4 text-[color:var(--color-gold)]" />
                Cotação USD → BRL
              </CardTitle>
              <p className="text-xs text-muted-foreground">Usada para converter automaticamente lançamentos em dólar.</p>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="rounded-lg border border-border/60 bg-muted/30 p-4">
                <div className="font-numeric text-3xl font-semibold tracking-tight text-[color:var(--color-gold)]">
                  {typeof rateValue === "number" ? `R$ ${Number(rateValue).toFixed(4)}` : "—"}
                </div>
                <div className="mt-1 text-[11px] uppercase tracking-wider text-muted-foreground">
                  Atualizada em {rateUpdatedAt ? fmtDateTime(rateUpdatedAt) : "—"}
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Cotação manual
                </Label>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    step="any"
                    min="0"
                    value={rate}
                    onChange={(e) => setRate(e.target.value)}
                    className="h-10 font-numeric"
                    placeholder="5.0000"
                  />
                  <Button onClick={() => saveRate.mutate()} disabled={saveRate.isPending} className="gap-1.5">
                    <Save className="h-4 w-4" /> Salvar
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground">Aceita valores entre 0 e 1000.</p>
              </div>
              <Button
                variant="outline"
                className="w-full gap-1.5"
                onClick={() => fetchAuto.mutate()}
                disabled={fetchAuto.isPending}
              >
                <RefreshCw className={`h-4 w-4 ${fetchAuto.isPending ? "animate-spin" : ""}`} />
                {fetchAuto.isPending ? "Buscando..." : "Buscar cotação automática"}
              </Button>
            </CardContent>
          </Card>

          <Card className="surface-elevated">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 font-display text-base">
                <Info className="h-4 w-4" />
                Sobre
              </CardTitle>
              <p className="text-xs text-muted-foreground">Quiwi Cost Center · versão MVP</p>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <p>
                Centro de inteligência de custos das plataformas Quiwi. Consolida consumo de IA, infraestrutura
                e serviços em um único painel executivo.
              </p>
              <p>
                Configurações abaixo controlam parâmetros globais consumidos por jobs de sincronização,
                cálculos de rateio e alertas.
              </p>
              <div className="rounded-md border border-border/60 bg-muted/30 p-3 text-xs">
                Total de configurações: <span className="font-numeric font-semibold text-foreground">{settings.length}</span>
        </div>





            </CardContent>
          </Card>
        </div>

        {/* Generic settings list */}
        <Card className="surface-elevated">
          <CardHeader>
            <CardTitle className="font-display text-base">Todas as configurações</CardTitle>
            <p className="text-xs text-muted-foreground">
              Entradas <code className="rounded bg-muted px-1 font-numeric text-[10px]">system_settings</code> em JSON.
            </p>
          </CardHeader>
          <CardContent className="pt-2">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <div className="mr-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                <Filter className="h-3.5 w-3.5" /> Filtros
                {activeFilters > 0 && (
                  <Badge variant="outline" className="border-border/60 font-normal">{activeFilters}</Badge>
                )}
              </div>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search.q ?? ""}
                  onChange={(e) => setSearch({ q: e.target.value || undefined })}
                  placeholder="Buscar chave ou valor..."
                  className="h-9 w-72 border-border/70 bg-muted/30 pl-9 text-sm"
                />
              </div>
              {activeFilters > 0 && (
                <Button variant="ghost" size="sm" className="h-9 gap-1 text-muted-foreground" onClick={clearFilters}>
                  <X className="h-3.5 w-3.5" /> Limpar
                </Button>
              )}
              <span className="ml-auto text-xs text-muted-foreground">
                {filtered.length} de {settings.length}
              </span>
            </div>

            {isLoading ? (
              <LoadingState label="Carregando configurações..." />
            ) : filtered.length === 0 ? (
              <div className="py-16 text-center">
                <div className="mx-auto max-w-sm space-y-3">
                  <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-muted text-muted-foreground">
                    <Inbox className="h-5 w-5" />
                  </div>
                  <p className="font-display text-sm font-medium">
                    {activeFilters > 0 ? "Nenhuma configuração nesse filtro" : "Nenhuma configuração cadastrada"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {activeFilters > 0
                      ? "Ajuste os filtros ou limpe a busca."
                      : "Crie uma configuração para expor parâmetros ao sistema."}
                  </p>
                  {activeFilters > 0 ? (
                    <Button variant="outline" size="sm" onClick={clearFilters} className="gap-1.5">
                      <X className="h-3.5 w-3.5" /> Limpar filtros
                    </Button>
                  ) : (
                    <Button size="sm" onClick={openCreate} className="gap-1.5">
                      <Plus className="h-3.5 w-3.5" /> Nova configuração
                    </Button>
                  )}
                </div>
              </div>
            ) : (
              <div className="divide-y divide-border/60 rounded-md border border-border/60">
                {filtered.map((s) => {
                  const meta = metaFor(s.key);
                  const Icon = meta.icon;
                  return (
                    <div key={s.key} className="flex flex-col gap-3 p-4 md:flex-row md:items-start">
                      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-display text-sm font-semibold">{meta.label}</p>
                          <code className="rounded bg-muted px-1.5 py-0.5 font-numeric text-[10px] text-muted-foreground">
                            {s.key}
                          </code>
                        </div>
                        <p className="text-xs text-muted-foreground">{meta.description}</p>
                        <pre className="mt-1 max-h-40 overflow-auto rounded-md border border-border/60 bg-muted/30 p-2 font-numeric text-[11px] text-foreground/90">
{JSON.stringify(s.value, null, 2)}
                        </pre>
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          Atualizada em {s.updated_at ? fmtDateTime(s.updated_at) : "—"}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 md:flex-col">
                        <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => openEdit(s)}>
                          <Pencil className="h-3.5 w-3.5" /> Editar
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 gap-1.5 hover:text-destructive"
                          onClick={() => {
                            if (confirm(`Excluir configuração "${s.key}"?`)) removeSetting.mutate(s.key);
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" /> Excluir
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

function SettingDialog({
  editing,
  form,
  setForm,
  onSubmit,
  pending,
}: {
  editing: SettingRow | null;
  form: { key: string; value_json: string };
  setForm: (v: { key: string; value_json: string }) => void;
  onSubmit: () => void;
  pending: boolean;
}) {
  const inputCls = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm";
  let parseError: string | null = null;
  try {
    JSON.parse(form.value_json || "null");
  } catch (e: any) {
    parseError = e?.message ?? "JSON inválido";
  }
  return (
    <DialogContent className="max-w-lg">
      <DialogHeader>
        <DialogTitle className="font-display">{editing ? "Editar configuração" : "Nova configuração"}</DialogTitle>
      </DialogHeader>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Chave *</label>
          <input
            className={`${inputCls} font-numeric`}
            value={form.key}
            onChange={(e) => setForm({ ...form, key: e.target.value.toLowerCase() })}
            placeholder="usd_brl_rate"
            maxLength={60}
            disabled={!!editing}
            required
          />
          <p className="text-[11px] text-muted-foreground">
            Minúsculas, números e _ (máx 60). Chave é imutável após a criação.
          </p>
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Valor (JSON) *</label>
          <textarea
            className={`${inputCls} font-numeric text-xs`}
            rows={10}
            value={form.value_json}
            onChange={(e) => setForm({ ...form, value_json: e.target.value })}
            spellCheck={false}
          />
          {parseError ? (
            <p className="text-[11px] text-destructive">JSON inválido: {parseError}</p>
          ) : (
            <p className="text-[11px] text-muted-foreground">Objetos, arrays, números, strings ou null.</p>
          )}
        </div>
        <DialogFooter>
          <Button type="submit" disabled={pending || !!parseError} className="gap-1.5">
            {pending ? "Salvando..." : editing ? "Salvar alterações" : "Criar configuração"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

