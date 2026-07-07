import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { z } from "zod";
import {
  Plus,
  Pencil,
  Trash2,
  Search,
  Filter,
  X,
  Power,
  PowerOff,
  Boxes,
  Wallet,
  Inbox,
  ExternalLink,
  Plug,
  Sparkles,
  Server,
  Mic,
  Image as ImageIcon,
  Wrench,
  Cloud,
  Bot,
  Upload,
  Wand2,
  Copy,
  Check,
} from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { discoverGcp } from "@/lib/gcp-discover.functions";

import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { KpiCard as Kpi, LoadingState } from "@/components/ui-kit";
import { fmtBRL, fmtNumber } from "@/lib/format";

const STATUSES = ["active", "inactive"] as const;

const searchSchema = z.object({
  status: z.enum(STATUSES).optional().catch(undefined),
  category: z.string().optional().catch(undefined),
  q: z.string().optional().catch(undefined),
});

export const Route = createFileRoute("/_authenticated/providers")({
  head: () => ({ meta: [{ title: "Fornecedores — Quiwi Cost Center" }] }),
  validateSearch: searchSchema,
  component: ProvidersPage,
});

type Provider = {
  id: string;
  name: string;
  category: string | null;
  website: string | null;
  status: string;
  created_at: string;
  updated_at: string;
};

const CATEGORY_META: Record<string, { icon: any; color: string }> = {
  AI: { icon: Sparkles, color: "#8b5cf6" },
  Voice: { icon: Mic, color: "#f97316" },
  Image: { icon: ImageIcon, color: "#ec4899" },
  Infrastructure: { icon: Server, color: "#0ea5e9" },
  Cloud: { icon: Cloud, color: "#06b6d4" },
  Automation: { icon: Bot, color: "#22c55e" },
  Tools: { icon: Wrench, color: "#64748b" },
};

const CATEGORY_OPTIONS = Object.keys(CATEGORY_META);

function metaFor(category: string | null) {
  if (!category) return { icon: Boxes, color: "#64748b" };
  return CATEGORY_META[category] ?? { icon: Boxes, color: "#64748b" };
}

// ---------- Per-provider connection schemas ----------

type ConfigField = {
  key: string;
  label: string;
  placeholder?: string;
  helper?: string;
  type?: "text" | "textarea" | "password";
  required?: boolean;
  defaultValue?: string;
};

type ConnectionSchema = {
  apiKeyLabel: string;
  apiKeyPlaceholder?: string;
  apiKeyHelper?: string;
  apiKeyType: "password" | "textarea";
  configFields: ConfigField[];
  docsUrl?: string;
  setupSteps?: string[];
};

const DEFAULT_SCHEMA: ConnectionSchema = {
  apiKeyLabel: "API Key",
  apiKeyPlaceholder: "sk-...",
  apiKeyType: "password",
  apiKeyHelper: "A chave é armazenada com segurança no backend.",
  configFields: [],
};

const CONNECTION_SCHEMAS: Record<string, ConnectionSchema> = {
  Firecrawl: {
    apiKeyLabel: "API Key",
    apiKeyPlaceholder: "fc-...",
    apiKeyType: "password",
    apiKeyHelper: "Encontre em Firecrawl → Settings → API Keys.",
    configFields: [],
    docsUrl: "https://www.firecrawl.dev/app/api-keys",
  },
  OpenAI: {
    apiKeyLabel: "Admin key",
    apiKeyPlaceholder: "sk-admin-...",
    apiKeyType: "password",
    apiKeyHelper: "Precisa ser uma Admin key (sk-admin-...) — Settings → Admin keys.",
    configFields: [
      {
        key: "org_id",
        label: "Organization ID (opcional)",
        placeholder: "org-...",
        helper: "Só necessário se você usa múltiplas organizações na conta.",
      },
    ],
    docsUrl: "https://platform.openai.com/settings/organization/admin-keys",
  },
  Gemini: {
    apiKeyLabel: "Service Account JSON",
    apiKeyPlaceholder: '{\n  "type": "service_account",\n  "project_id": "...",\n  ...\n}',
    apiKeyType: "textarea",
    apiKeyHelper: "Cole o conteúdo completo do arquivo JSON da service account.",
    configFields: [
      {
        key: "gcp.gcp_project",
        label: "GCP Project ID (Vertex AI)",
        placeholder: "meu-projeto",
        helper: "Projeto onde o Vertex AI/Gemini é usado.",
        required: true,
      },
      {
        key: "gcp.bq_project",
        label: "BigQuery Project ID",
        placeholder: "meu-projeto-billing",
        helper: "Projeto onde está o dataset do billing export (pode ser o mesmo).",
        required: true,
      },
      {
        key: "gcp.bq_dataset",
        label: "BigQuery Dataset",
        placeholder: "billing_export",
        required: true,
      },
      {
        key: "gcp.billing_account_id",
        label: "Billing Account ID",
        placeholder: "012345-ABCDEF-789012",
        helper: "Formato XXXXXX-XXXXXX-XXXXXX (com hífens).",
        required: true,
      },
      {
        key: "gcp.bq_location",
        label: "Location do dataset",
        placeholder: "US",
        defaultValue: "US",
      },
    ],
    docsUrl: "https://cloud.google.com/billing/docs/how-to/export-data-bigquery",
    setupSteps: [
      "Habilite o BigQuery billing export (Standard usage cost) no console GCP.",
      "Crie o dataset em multi-região US ou EU (para backfill retroativo).",
      "Crie uma service account e dê os papéis: BigQuery Data Viewer no dataset, BigQuery Job User no projeto, Monitoring Viewer no projeto Vertex.",
      "Faça download da chave JSON e cole aqui.",
    ],
  },
  "Google Gemini": {
    apiKeyLabel: "Service Account JSON",
    apiKeyPlaceholder: "{...}",
    apiKeyType: "textarea",
    configFields: [],
  },
};
CONNECTION_SCHEMAS["Google Gemini"] = CONNECTION_SCHEMAS.Gemini;

function getConnectionSchema(providerName: string): ConnectionSchema {
  return CONNECTION_SCHEMAS[providerName] ?? DEFAULT_SCHEMA;
}

function setDeepKey(obj: Record<string, any>, path: string, value: any) {
  const parts = path.split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (typeof cur[p] !== "object" || cur[p] == null) cur[p] = {};
    cur = cur[p];
  }
  cur[parts[parts.length - 1]] = value;
}



function ProvidersPage() {
  const qc = useQueryClient();
  const navigate = useNavigate({ from: "/providers" });
  const search = Route.useSearch();

  const { data: providers = [], isLoading } = useQuery({
    queryKey: ["providers"],
    queryFn: async () => {
      const { data, error } = await supabase.from("providers").select("*").order("name");
      if (error) throw error;
      return (data ?? []) as Provider[];
    },
  });

  const { data: costs = [] } = useQuery({
    queryKey: ["providers-costs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cost_entries")
        .select("provider_id, cost_brl")
        .not("provider_id", "is", null)
        .limit(20000);
      if (error) throw error;
      return (data ?? []) as { provider_id: string; cost_brl: number | null }[];
    },
  });

  const { data: connections = [] } = useQuery({
    queryKey: ["providers-connections"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("provider_connections")
        .select("provider_id");
      if (error) throw error;
      return (data ?? []) as { provider_id: string }[];
    },
  });

  const costByProvider = useMemo(() => {
    const m = new Map<string, { total: number; count: number }>();
    for (const c of costs) {
      const cur = m.get(c.provider_id) ?? { total: 0, count: 0 };
      cur.total += Number(c.cost_brl ?? 0);
      cur.count += 1;
      m.set(c.provider_id, cur);
    }
    return m;
  }, [costs]);

  const connByProvider = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of connections) m.set(c.provider_id, (m.get(c.provider_id) ?? 0) + 1);
    return m;
  }, [connections]);

  const categoriesInUse = useMemo(() => {
    const set = new Set<string>();
    providers.forEach((p) => p.category && set.add(p.category));
    CATEGORY_OPTIONS.forEach((c) => set.add(c));
    return Array.from(set).sort();
  }, [providers]);

  const filtered = useMemo(() => {
    const q = (search.q ?? "").toLowerCase().trim();
    return providers.filter((p) => {
      if (search.status && p.status !== search.status) return false;
      if (search.category && (p.category ?? "") !== search.category) return false;
      if (q && !`${p.name} ${p.category ?? ""} ${p.website ?? ""}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [providers, search]);

  const stats = useMemo(() => {
    const active = providers.filter((p) => p.status === "active").length;
    const inactive = providers.length - active;
    const totalBrl = costs.reduce((a, c) => a + Number(c.cost_brl ?? 0), 0);
    return { total: providers.length, active, inactive, totalBrl };
  }, [providers, costs]);

  const setSearch = (patch: Partial<z.infer<typeof searchSchema>>) =>
    navigate({ search: (prev: z.infer<typeof searchSchema>) => ({ ...prev, ...patch }) });

  const activeFilters =
    Number(!!search.status) + Number(!!search.category) + Number(!!search.q);
  const clearFilters = () => navigate({ search: {} as any });

  const { data: platforms = [] } = useQuery({
    queryKey: ["providers-platforms"],
    queryFn: async () => {
      const { data, error } = await supabase.from("platforms").select("id,name").order("name");
      if (error) throw error;
      return (data ?? []) as { id: string; name: string }[];
    },
  });

  // form
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Provider | null>(null);
  const [form, setForm] = useState<any>({});

  // connect dialog
  const [connectOpen, setConnectOpen] = useState(false);
  const [connectProvider, setConnectProvider] = useState<Provider | null>(null);
  const [connectForm, setConnectForm] = useState<{
    name: string;
    platform_id: string;
    api_key: string;
    config: Record<string, string>;
  }>({ name: "", platform_id: "", api_key: "", config: {} });

  const openConnect = (p: Provider) => {
    setConnectProvider(p);
    const schema = getConnectionSchema(p.name);
    const config: Record<string, string> = {};
    schema.configFields.forEach((f) => (config[f.key] = f.defaultValue ?? ""));
    setConnectForm({ name: `${p.name} — Produção`, platform_id: "", api_key: "", config });
    setConnectOpen(true);
  };


  const emptyForm = () => ({
    name: "",
    category: "AI",
    website: "",
    status: "active",
  });

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm());
    setOpen(true);
  };
  const openEdit = (p: Provider) => {
    setEditing(p);
    setForm({
      name: p.name,
      category: p.category ?? "",
      website: p.website ?? "",
      status: p.status,
    });
    setOpen(true);
  };

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        name: form.name?.trim(),
        category: form.category?.trim() || null,
        website: form.website?.trim() || null,
        status: form.status || "active",
      };
      if (!payload.name) throw new Error("Nome é obrigatório");
      if (editing) {
        const { error } = await supabase.from("providers").update(payload).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("providers").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(editing ? "Fornecedor atualizado" : "Fornecedor criado");
      qc.invalidateQueries({ queryKey: ["providers"] });
      setOpen(false);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const toggleStatus = useMutation({
    mutationFn: async ({ p, connections }: { p: Provider; connections: number }) => {
      const next = p.status === "active" ? "inactive" : "active";
      if (next === "active" && connections === 0) {
        throw new Error("Conecte uma API deste fornecedor antes de ativá-lo.");
      }
      const { error } = await supabase.from("providers").update({ status: next }).eq("id", p.id);
      if (error) throw error;
      return next;
    },
    onSuccess: (next) => {
      toast.success(next === "active" ? "Fornecedor ativado" : "Fornecedor desativado");
      qc.invalidateQueries({ queryKey: ["providers"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const connect = useMutation({
    mutationFn: async () => {
      if (!connectProvider) throw new Error("Fornecedor inválido");
      const schema = getConnectionSchema(connectProvider.name);
      const name = connectForm.name.trim();
      const apiKey = connectForm.api_key.trim();
      if (!name) throw new Error("Nome da conexão é obrigatório");
      if (!apiKey) throw new Error(`${schema.apiKeyLabel} é obrigatório`);
      for (const f of schema.configFields) {
        if (f.required && !(connectForm.config[f.key] ?? "").trim()) {
          throw new Error(`${f.label} é obrigatório`);
        }
      }
      const configObj: Record<string, any> = {};
      for (const f of schema.configFields) {
        const v = (connectForm.config[f.key] ?? "").trim();
        if (v) setDeepKey(configObj, f.key, v);
      }
      const { data: insertedConnection, error } = await supabase.from("provider_connections").insert({
        provider_id: connectProvider.id,
        platform_id: connectForm.platform_id || null,
        name,
        status: "active",
        config: configObj as any,
      }).select("id").single();
      if (error) throw error;
      if (!insertedConnection) throw new Error("Não foi possível criar a conexão");


      const { error: keyError } = await supabase.rpc("set_connection_api_key", {
        _connection_id: insertedConnection.id,
        _api_key: apiKey,
      });
      if (keyError) {
        await supabase.from("provider_connections").delete().eq("id", insertedConnection.id);
        throw keyError;
      }

      if (connectProvider.status !== "active") {
        const { error: upErr } = await supabase
          .from("providers")
          .update({ status: "active" })
          .eq("id", connectProvider.id);
        if (upErr) throw upErr;
      }
    },
    onSuccess: () => {
      toast.success("Conexão criada e fornecedor ativado");
      qc.invalidateQueries({ queryKey: ["providers"] });
      qc.invalidateQueries({ queryKey: ["providers-connections"] });
      setConnectOpen(false);
    },
    onError: (e: any) => toast.error(e.message),
  });


  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("providers").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Removido");
      qc.invalidateQueries({ queryKey: ["providers"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <AppShell
      eyebrow="Cadastros"
      title="Fornecedores"
      actions={
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button onClick={openCreate} className="gap-1.5">
              <Plus className="h-4 w-4" /> Novo fornecedor
            </Button>
          </DialogTrigger>
          <ProviderDialog
            editing={editing}
            form={form}
            setForm={setForm}
            onSubmit={() => save.mutate()}
            pending={save.isPending}
          />
        </Dialog>
      }
    >
      <div className="space-y-6">
        {/* KPIs */}
        <div className="grid gap-3 md:grid-cols-4">
          <Kpi label="Total" value={fmtNumber(stats.total)} icon={<Boxes className="h-4 w-4" />} />
          <Kpi label="Ativos" value={fmtNumber(stats.active)} tone="good" icon={<Power className="h-4 w-4" />} />
          <Kpi label="Inativos" value={fmtNumber(stats.inactive)} tone={stats.inactive ? "warn" : "neutral"} icon={<PowerOff className="h-4 w-4" />} />
          <Kpi label="Custo total (BRL)" value={fmtBRL(stats.totalBrl)} icon={<Wallet className="h-4 w-4" />} />
        </div>

        {/* Filters */}
        <Card className="surface-elevated">
          <CardContent className="pt-6">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <div className="mr-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                <Filter className="h-3.5 w-3.5" /> Filtros
                {activeFilters > 0 && (
                  <Badge variant="outline" className="border-border/60 font-normal">{activeFilters}</Badge>
                )}
              </div>

              <Select value={search.status ?? "__all"} onValueChange={(v) => setSearch({ status: v === "__all" ? undefined : (v as any) })}>
                <SelectTrigger className="h-9 w-[150px]"><SelectValue placeholder="Status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all">Todos status</SelectItem>
                  <SelectItem value="active">Ativos</SelectItem>
                  <SelectItem value="inactive">Inativos</SelectItem>
                </SelectContent>
              </Select>

              <Select value={search.category ?? "__all"} onValueChange={(v) => setSearch({ category: v === "__all" ? undefined : v })}>
                <SelectTrigger className="h-9 w-[170px]"><SelectValue placeholder="Categoria" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all">Todas categorias</SelectItem>
                  {categoriesInUse.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search.q ?? ""}
                  onChange={(e) => setSearch({ q: e.target.value || undefined })}
                  placeholder="Buscar fornecedor..."
                  className="h-9 w-64 border-border/70 bg-muted/30 pl-9 text-sm"
                />
              </div>

              {activeFilters > 0 && (
                <Button variant="ghost" size="sm" className="h-9 gap-1 text-muted-foreground" onClick={clearFilters}>
                  <X className="h-3.5 w-3.5" /> Limpar
                </Button>
              )}

              <span className="ml-auto text-xs text-muted-foreground">
                {fmtNumber(filtered.length)} de {fmtNumber(providers.length)}
              </span>
            </div>

            {isLoading ? (
              <LoadingState label="Carregando fornecedores..." />
            ) : filtered.length === 0 ? (
              <div className="py-16 text-center">
                <div className="mx-auto max-w-sm space-y-3">
                  <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-muted text-muted-foreground">
                    <Inbox className="h-5 w-5" />
                  </div>
                  <p className="font-display text-sm font-medium">
                    {activeFilters > 0 || providers.length > 0 ? "Nenhum fornecedor nesse filtro" : "Cadastre seu primeiro fornecedor"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {activeFilters > 0 || providers.length > 0
                      ? "Ajuste os filtros ou limpe a busca."
                      : "Fornecedores são serviços externos (OpenAI, Anthropic, Google, etc.) consumidos pelas plataformas."}
                  </p>
                  {activeFilters > 0 ? (
                    <Button variant="outline" size="sm" onClick={clearFilters} className="gap-1.5">
                      <X className="h-3.5 w-3.5" /> Limpar filtros
                    </Button>
                  ) : (
                    <Button size="sm" onClick={openCreate} className="gap-1.5">
                      <Plus className="h-3.5 w-3.5" /> Novo fornecedor
                    </Button>
                  )}
                </div>
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {filtered.map((p) => {
                  const agg = costByProvider.get(p.id) ?? { total: 0, count: 0 };
                  return (
                    <ProviderCard
                      key={p.id}
                      provider={p}
                      totalBrl={agg.total}
                      entriesCount={agg.count}
                      connectionsCount={connByProvider.get(p.id) ?? 0}
                      onEdit={() => openEdit(p)}
                      onConnect={() => openConnect(p)}
                      onToggle={() => toggleStatus.mutate({ p, connections: connByProvider.get(p.id) ?? 0 })}
                      onDelete={() => {
                        if (confirm(`Excluir "${p.name}"? Custos e conexões associadas perderão o vínculo.`)) remove.mutate(p.id);
                      }}
                    />
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={connectOpen} onOpenChange={setConnectOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display">
              Conectar {connectProvider?.name ?? "fornecedor"}
            </DialogTitle>
            <DialogDescription>
              Crie uma conexão segura para sincronizar custos deste fornecedor.
            </DialogDescription>
          </DialogHeader>
          {(() => {
            const schema = connectProvider ? getConnectionSchema(connectProvider.name) : DEFAULT_SCHEMA;
            const setConfig = (k: string, v: string) =>
              setConnectForm({ ...connectForm, config: { ...connectForm.config, [k]: v } });
            return (
              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  connect.mutate();
                }}
              >
                {schema.setupSteps && schema.setupSteps.length > 0 && (
                  <div className="rounded-md border border-border/60 bg-muted/30 p-3 text-xs">
                    <p className="mb-1.5 font-medium text-foreground">Antes de conectar</p>
                    <ol className="list-decimal space-y-0.5 pl-4 text-muted-foreground">
                      {schema.setupSteps.map((s, i) => <li key={i}>{s}</li>)}
                    </ol>
                    {schema.docsUrl && (
                      <a href={schema.docsUrl} target="_blank" rel="noreferrer" className="mt-1.5 inline-flex items-center gap-1 text-primary hover:underline">
                        <ExternalLink className="h-3 w-3" /> Documentação oficial
                      </a>
                    )}
                  </div>
                )}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Nome da conexão *</label>
                  <Input
                    value={connectForm.name}
                    onChange={(e) => setConnectForm({ ...connectForm, name: e.target.value })}
                    placeholder="Ex: Produção"
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Plataforma (opcional)</label>
                  <Select
                    value={connectForm.platform_id || "__none"}
                    onValueChange={(v) => setConnectForm({ ...connectForm, platform_id: v === "__none" ? "" : v })}
                  >
                    <SelectTrigger className="h-9"><SelectValue placeholder="Nenhuma" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none">Nenhuma</SelectItem>
                      {platforms.map((pl) => (
                        <SelectItem key={pl.id} value={pl.id}>{pl.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium text-muted-foreground">{schema.apiKeyLabel} *</label>
                    {schema.apiKeyType === "textarea" && (
                      <label className="inline-flex cursor-pointer items-center gap-1 text-[11px] text-primary hover:underline">
                        <Upload className="h-3 w-3" /> Enviar arquivo .json
                        <input
                          type="file"
                          accept="application/json,.json"
                          className="hidden"
                          onChange={async (e) => {
                            const f = e.target.files?.[0];
                            if (!f) return;
                            if (f.size > 32_000) {
                              toast.error("Arquivo muito grande (máx. 32KB).");
                              return;
                            }
                            const text = await f.text();
                            try {
                              const j = JSON.parse(text);
                              if (j.type !== "service_account" || !j.private_key || !j.client_email) {
                                toast.error("JSON inválido: não parece uma service account.");
                                return;
                              }
                            } catch {
                              toast.error("Arquivo não é JSON válido.");
                              return;
                            }
                            setConnectForm((prev) => ({ ...prev, api_key: text }));
                            e.target.value = "";
                          }}
                        />
                      </label>
                    )}
                  </div>
                  {schema.apiKeyType === "textarea" ? (
                    <textarea
                      className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs min-h-[140px]"
                      value={connectForm.api_key}
                      onChange={(e) => setConnectForm({ ...connectForm, api_key: e.target.value })}
                      placeholder={schema.apiKeyPlaceholder}
                      autoComplete="off"
                      spellCheck={false}
                      required
                    />
                  ) : (
                    <Input
                      type="password"
                      value={connectForm.api_key}
                      onChange={(e) => setConnectForm({ ...connectForm, api_key: e.target.value })}
                      placeholder={schema.apiKeyPlaceholder}
                      autoComplete="off"
                      required
                    />
                  )}
                  {schema.apiKeyHelper && (
                    <p className="text-[11px] text-muted-foreground">{schema.apiKeyHelper}</p>
                  )}
                </div>

                {connectProvider && /gemini/i.test(connectProvider.name) ? (
                  <GeminiAutoDiscover
                    saJson={connectForm.api_key}
                    config={connectForm.config}
                    setConfig={setConfig}
                  />
                ) : (
                  schema.configFields.map((f) => (
                    <div key={f.key} className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground">
                        {f.label} {f.required && "*"}
                      </label>
                      <Input
                        value={connectForm.config[f.key] ?? ""}
                        onChange={(e) => setConfig(f.key, e.target.value)}
                        placeholder={f.placeholder}
                        required={f.required}
                      />
                      {f.helper && <p className="text-[11px] text-muted-foreground">{f.helper}</p>}
                    </div>
                  ))
                )}

                <DialogFooter>
                  <Button type="button" variant="ghost" onClick={() => setConnectOpen(false)}>Cancelar</Button>
                  <Button type="submit" disabled={connect.isPending} className="gap-1.5">
                    <Plug className="h-4 w-4" />
                    {connect.isPending ? "Conectando..." : "Conectar"}
                  </Button>
                </DialogFooter>
              </form>
            );
          })()}
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}



function ProviderCard({
  provider,
  totalBrl,
  entriesCount,
  connectionsCount,
  onEdit,
  onConnect,
  onToggle,
  onDelete,
}: {
  provider: Provider;
  totalBrl: number;
  entriesCount: number;
  connectionsCount: number;
  onEdit: () => void;
  onConnect: () => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const meta = metaFor(provider.category);
  const Icon = meta.icon;
  const active = provider.status === "active";
  const hasConnections = connectionsCount > 0;
  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={onConnect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onConnect();
        }
      }}
      className={`surface-elevated cursor-pointer transition hover:border-primary/50 hover:shadow-md ${active ? "" : "opacity-80"}`}
    >
      <CardContent className="space-y-3 pt-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <div
              className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-white shadow-sm"
              style={{ background: meta.color }}
            >
              <Icon className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="truncate font-display text-sm font-semibold">{provider.name}</p>
              <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                {provider.category ? (
                  <Badge variant="outline" className="border-border/60 px-1.5 py-0 text-[10px] font-normal">
                    {provider.category}
                  </Badge>
                ) : (
                  <span className="text-[11px]">Sem categoria</span>
                )}
                {provider.website && (
                  <a
                    href={provider.website}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="inline-flex items-center gap-0.5 truncate hover:text-foreground"
                  >
                    <ExternalLink className="h-3 w-3" />
                    <span className="truncate">{prettyHost(provider.website)}</span>
                  </a>
                )}
              </div>
            </div>
          </div>
          {active ? (
            <Badge className="gap-1 bg-emerald-600/15 text-emerald-700 hover:bg-emerald-600/20 dark:text-emerald-400" variant="secondary">
              Conectado
            </Badge>
          ) : (
            <Badge variant="outline" className="border-border/60 text-muted-foreground">Desconectado</Badge>
          )}
        </div>

        <div className="grid grid-cols-3 gap-3 rounded-md border border-border/60 bg-muted/30 p-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Custo BRL</p>
            <p className="mt-0.5 font-numeric text-sm font-semibold">{fmtBRL(totalBrl)}</p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Lançamentos</p>
            <p className="mt-0.5 font-numeric text-sm font-medium">{fmtNumber(entriesCount)}</p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Conexões</p>
            <p className="mt-0.5 flex items-center gap-1 font-numeric text-sm font-medium">
              <Plug className="h-3 w-3 text-muted-foreground" />
              {fmtNumber(connectionsCount)}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
          <Button
            size="sm"
            className="h-8 flex-1 gap-1.5"
            variant={hasConnections ? "outline" : "default"}
            onClick={onConnect}
          >
            <Plug className="h-3.5 w-3.5" />
            {hasConnections ? "Nova conexão" : "Conectar"}
          </Button>
          {hasConnections && (
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5"
              onClick={onToggle}
              title={active ? "Desativar" : "Ativar"}
            >
              {active ? <PowerOff className="h-3.5 w-3.5" /> : <Power className="h-3.5 w-3.5" />}
              {active ? "Desativar" : "Ativar"}
            </Button>
          )}
          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={onEdit} title="Editar">
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button size="icon" variant="ghost" className="h-8 w-8 hover:text-destructive" onClick={onDelete} title="Excluir">
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}


function ProviderDialog({
  editing,
  form,
  setForm,
  onSubmit,
  pending,
}: {
  editing: Provider | null;
  form: any;
  setForm: (v: any) => void;
  onSubmit: () => void;
  pending: boolean;
}) {
  const meta = metaFor(form.category || null);
  const Icon = meta.icon;
  const inputCls = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm";
  return (
    <DialogContent className="max-w-lg">
      <DialogHeader>
        <DialogTitle className="font-display">{editing ? "Editar fornecedor" : "Novo fornecedor"}</DialogTitle>
        <DialogDescription>
          Informe os dados básicos do fornecedor usado pelas plataformas.
        </DialogDescription>
      </DialogHeader>

      <div className="mb-2 flex items-center gap-3 rounded-md border border-border/60 bg-muted/30 p-3">
        <div
          className="grid h-11 w-11 place-items-center rounded-lg text-white shadow-sm"
          style={{ background: meta.color }}
        >
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="truncate font-display text-sm font-semibold">{form.name || "Nome do fornecedor"}</p>
          <p className="truncate text-xs text-muted-foreground">
            {form.category || "Sem categoria"}
            {form.website ? ` · ${prettyHost(form.website)}` : ""}
          </p>
        </div>
      </div>

      <form
        className="grid grid-cols-2 gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        <div className="col-span-2 space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Nome *</label>
          <input className={inputCls} value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Categoria</label>
          <Select value={form.category || "__none"} onValueChange={(v) => setForm({ ...form, category: v === "__none" ? "" : v })}>
            <SelectTrigger className="h-9"><SelectValue placeholder="Categoria" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none">Sem categoria</SelectItem>
              {CATEGORY_OPTIONS.map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Status</label>
          <Select value={form.status || "active"} onValueChange={(v) => setForm({ ...form, status: v })}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Ativo</SelectItem>
              <SelectItem value="inactive">Inativo</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="col-span-2 space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Website</label>
          <input
            className={inputCls}
            type="url"
            placeholder="https://openai.com"
            value={form.website ?? ""}
            onChange={(e) => setForm({ ...form, website: e.target.value })}
          />
        </div>

        <DialogFooter className="col-span-2 mt-2">
          <Button type="submit" disabled={pending} className="gap-1.5">
            {pending ? "Salvando..." : editing ? "Salvar alterações" : "Criar fornecedor"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}


function prettyHost(url: string) {
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    return u.host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

// ---------- Gemini autodiscover + gcloud script block ----------

function GeminiAutoDiscover({
  saJson,
  config,
  setConfig,
}: {
  saJson: string;
  config: Record<string, string>;
  setConfig: (k: string, v: string) => void;
}) {
  const discover = useServerFn(discoverGcp);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any | null>(null);
  const [copied, setCopied] = useState(false);

  const gcpProject = config["gcp.gcp_project"] ?? "";
  const billingId = config["gcp.billing_account_id"] ?? "";
  const bqProject = config["gcp.bq_project"] ?? "";
  const bqDataset = config["gcp.bq_dataset"] ?? "";
  const bqLocation = config["gcp.bq_location"] ?? "US";

  const runDiscover = async () => {
    if (!saJson.trim()) {
      toast.error("Cole ou envie o Service Account JSON primeiro.");
      return;
    }
    setLoading(true);
    try {
      const r: any = await discover({ data: { service_account_json: saJson } });
      setResult(r);
      // Auto-fill obvious defaults
      if (!gcpProject && r.service_account?.project_id) {
        setConfig("gcp.gcp_project", r.service_account.project_id);
      }
      if (!bqProject && r.service_account?.project_id) {
        setConfig("gcp.bq_project", r.service_account.project_id);
      }
      if (r.billing_accounts?.length === 1 && !billingId) {
        setConfig("gcp.billing_account_id", r.billing_accounts[0].id);
      }
      if (r.detected_tables?.length === 1) {
        const d = r.detected_tables[0];
        setConfig("gcp.bq_project", d.bq_project);
        setConfig("gcp.bq_dataset", d.bq_dataset);
        setConfig("gcp.billing_account_id", d.billing_account_id);
        const loc = r.datasets?.find(
          (x: any) => x.projectId === d.bq_project && x.datasetId === d.bq_dataset,
        )?.location;
        if (loc) setConfig("gcp.bq_location", loc);
        toast.success("Billing export detectado automaticamente.");
      } else if (r.detected_tables?.length > 1) {
        toast.info(`${r.detected_tables.length} exports encontrados — escolha um abaixo.`);
      } else {
        toast.info("Nenhum billing export encontrado. Use o script gcloud abaixo.");
      }
    } catch (e: any) {
      toast.error(e.message ?? "Falha na autodescoberta");
    } finally {
      setLoading(false);
    }
  };

  const applyDetected = (d: any) => {
    setConfig("gcp.bq_project", d.bq_project);
    setConfig("gcp.bq_dataset", d.bq_dataset);
    setConfig("gcp.billing_account_id", d.billing_account_id);
    const loc = result?.datasets?.find(
      (x: any) => x.projectId === d.bq_project && x.datasetId === d.bq_dataset,
    )?.location;
    if (loc) setConfig("gcp.bq_location", loc);
  };

  const script = buildGcloudScript({
    gcpProject: gcpProject || "MEU-PROJETO-GCP",
    billingId: billingId || "XXXXXX-XXXXXX-XXXXXX",
    bqProject: bqProject || gcpProject || "MEU-PROJETO-GCP",
    bqDataset: bqDataset || "billing_export",
    bqLocation: bqLocation || "US",
  });

  const copyScript = async () => {
    try {
      await navigator.clipboard.writeText(script);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Falha ao copiar");
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={runDiscover}
          disabled={loading}
          className="gap-1.5"
        >
          <Wand2 className="h-3.5 w-3.5" />
          {loading ? "Detectando..." : "Autodetectar do JSON"}
        </Button>
        {result?.service_account?.client_email && (
          <span className="truncate text-[11px] text-muted-foreground">
            SA: {result.service_account.client_email}
          </span>
        )}
      </div>

      {/* GCP Project */}
      <FieldSelect
        label="GCP Project (Vertex/Gemini)"
        required
        value={gcpProject}
        onChange={(v) => setConfig("gcp.gcp_project", v)}
        options={(result?.projects ?? []).map((p: any) => ({ value: p.projectId, label: `${p.name} (${p.projectId})` }))}
        placeholder="meu-projeto"
      />

      {/* Billing account */}
      <FieldSelect
        label="Billing Account"
        required
        value={billingId}
        onChange={(v) => setConfig("gcp.billing_account_id", v)}
        options={(result?.billing_accounts ?? []).map((b: any) => ({
          value: b.id,
          label: `${b.displayName} — ${b.id}${b.open ? "" : " (fechada)"}`,
        }))}
        placeholder="012345-ABCDEF-789012"
      />

      {/* Detected exports */}
      {result?.detected_tables?.length > 0 && (
        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-2 text-xs">
          <p className="mb-1 font-medium text-emerald-700 dark:text-emerald-400">
            Exports encontrados:
          </p>
          <div className="space-y-1">
            {result.detected_tables.map((d: any, i: number) => {
              const selected =
                d.bq_project === bqProject && d.bq_dataset === bqDataset && d.billing_account_id === billingId;
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => applyDetected(d)}
                  className={`flex w-full items-center justify-between rounded border px-2 py-1 text-left transition ${
                    selected ? "border-primary bg-primary/10" : "border-border/60 hover:bg-muted"
                  }`}
                >
                  <span className="truncate">
                    {d.bq_project}.{d.bq_dataset} · {d.billing_account_id}
                  </span>
                  {selected && <Check className="h-3 w-3 shrink-0 text-primary" />}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* BQ Project + Dataset */}
      <div className="grid grid-cols-2 gap-2">
        <FieldSelect
          label="BQ Project"
          required
          value={bqProject}
          onChange={(v) => setConfig("gcp.bq_project", v)}
          options={Array.from(new Set((result?.datasets ?? []).map((d: any) => d.projectId))).map((p: any) => ({
            value: p,
            label: p,
          }))}
          placeholder="projeto-billing"
        />
        <FieldSelect
          label="BQ Dataset"
          required
          value={bqDataset}
          onChange={(v) => setConfig("gcp.bq_dataset", v)}
          options={(result?.datasets ?? [])
            .filter((d: any) => !bqProject || d.projectId === bqProject)
            .map((d: any) => ({ value: d.datasetId, label: `${d.datasetId}${d.location ? ` (${d.location})` : ""}` }))}
          placeholder="billing_export"
        />
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">Location</label>
        <Input
          value={bqLocation}
          onChange={(e) => setConfig("gcp.bq_location", e.target.value)}
          placeholder="US"
          className="h-8"
        />
      </div>

      {/* gcloud script */}
      <details className="rounded-md border border-border/60 bg-muted/30 p-2 text-xs">
        <summary className="cursor-pointer font-medium">
          Não tem service account ainda? Script gcloud pronto ↓
        </summary>
        <div className="mt-2 space-y-2">
          <p className="text-muted-foreground">
            Cole os campos acima, copie e execute no Cloud Shell — cria SA, dá roles e baixa o JSON.
          </p>
          <div className="relative">
            <pre className="max-h-52 overflow-auto rounded bg-background p-2 font-mono text-[10.5px] leading-tight">
              {script}
            </pre>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={copyScript}
              className="absolute right-1 top-1 h-6 gap-1 px-2 text-[10px]"
            >
              {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              {copied ? "Copiado" : "Copiar"}
            </Button>
          </div>
        </div>
      </details>

      {result?.warnings?.length > 0 && (
        <details className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-[11px]" open>
          <summary className="cursor-pointer text-amber-700 dark:text-amber-400">
            {result.warnings.length} aviso(s) da autodescoberta
          </summary>
          <ul className="mt-2 space-y-2 pl-1 text-muted-foreground">
            {result.warnings.map((w: string, i: number) => {
              const parsed = parseGcpWarning(w);
              return (
                <li key={i} className="rounded border border-border/50 bg-background/50 p-2">
                  <div className="font-medium text-foreground">{parsed.title}</div>
                  {parsed.detail && <div className="mt-0.5">{parsed.detail}</div>}
                  {parsed.actions.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {parsed.actions.map((a, j) => (
                        <a
                          key={j}
                          href={a.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 rounded bg-primary/10 px-2 py-0.5 text-primary hover:bg-primary/20"
                        >
                          {a.label} ↗
                        </a>
                      ))}
                    </div>
                  )}
                  <details className="mt-1">
                    <summary className="cursor-pointer text-[10px] text-muted-foreground/70">Mensagem original</summary>
                    <pre className="mt-1 whitespace-pre-wrap break-all text-[10px] opacity-70">{w}</pre>
                  </details>
                </li>
              );
            })}
          </ul>
        </details>
      )}
    </div>
  );
}

function parseGcpWarning(w: string): { title: string; detail?: string; actions: { label: string; url: string }[] } {
  const actions: { label: string; url: string }[] = [];
  const urlMatch = w.match(/https?:\/\/[^\s"')]+/g);
  if (urlMatch) {
    for (const u of urlMatch) {
      if (u.includes("console.developers.google.com") || u.includes("console.cloud.google.com")) {
        actions.push({ label: "Abrir no Console", url: u });
      }
    }
  }
  const apiDisabled = w.match(/([\w.-]+\.googleapis\.com) API has not been used in project (\d+)/);
  if (apiDisabled) {
    const api = apiDisabled[1];
    const proj = apiDisabled[2];
    if (!actions.length) {
      actions.push({
        label: `Ativar ${api}`,
        url: `https://console.developers.google.com/apis/api/${api}/overview?project=${proj}`,
      });
    }
    return {
      title: `API desativada: ${api}`,
      detail: `Ative essa API no projeto ${proj} e aguarde alguns minutos antes de tentar novamente.`,
      actions,
    };
  }
  if (/\b403\b/.test(w)) {
    const label = w.split(":")[0] || "Permissão negada";
    return {
      title: `Permissão negada em ${label}`,
      detail: "A service account não tem permissão suficiente. Rode o script gcloud acima ou conceda os papéis manualmente.",
      actions,
    };
  }
  if (/\b404\b/.test(w)) {
    return { title: "Recurso não encontrado", detail: w.slice(0, 200), actions };
  }
  const label = w.split(":")[0] || "Aviso";
  return { title: label, detail: w.slice(label.length + 1, label.length + 240).trim(), actions };
}

function FieldSelect({
  label,
  value,
  onChange,
  options,
  placeholder,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-muted-foreground">
        {label} {required && "*"}
      </label>
      {options.length > 0 ? (
        <Select value={value || "__none"} onValueChange={(v) => onChange(v === "__none" ? "" : v)}>
          <SelectTrigger className="h-8"><SelectValue placeholder={placeholder} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__none">— {placeholder ?? "selecionar"} —</SelectItem>
            {options.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="h-8"
          required={required}
        />
      )}
    </div>
  );
}

function buildGcloudScript(v: {
  gcpProject: string;
  billingId: string;
  bqProject: string;
  bqDataset: string;
  bqLocation: string;
}) {
  return `# Rode no Google Cloud Shell (console.cloud.google.com) — leva ~1 min.
export PROJECT_ID="${v.gcpProject}"
export BILLING_ID="${v.billingId}"
export BQ_PROJECT="${v.bqProject}"
export BQ_DATASET="${v.bqDataset}"
export BQ_LOCATION="${v.bqLocation}"
export SA_NAME="billing-os"

gcloud config set project "$PROJECT_ID"
gcloud services enable bigquery.googleapis.com cloudbilling.googleapis.com \\
  cloudresourcemanager.googleapis.com monitoring.googleapis.com

# 1) Cria a service account
gcloud iam service-accounts create "$SA_NAME" \\
  --display-name="Billing OS"
export SA_EMAIL="$SA_NAME@$PROJECT_ID.iam.gserviceaccount.com"

# 2) Cria o dataset (caso ainda não exista) e permissões no BigQuery
bq --location="$BQ_LOCATION" mk -d "$BQ_PROJECT:$BQ_DATASET" || true
gcloud projects add-iam-policy-binding "$BQ_PROJECT" \\
  --member="serviceAccount:$SA_EMAIL" --role="roles/bigquery.jobUser"
bq add-iam-policy-binding \\
  --member="serviceAccount:$SA_EMAIL" --role="roles/bigquery.dataViewer" \\
  "$BQ_PROJECT:$BQ_DATASET"

# 3) Permissões de billing (para descoberta + budgets)
gcloud billing accounts add-iam-policy-binding "$BILLING_ID" \\
  --member="serviceAccount:$SA_EMAIL" --role="roles/billing.viewer"

# 4) Monitoring (métricas do Vertex)
gcloud projects add-iam-policy-binding "$PROJECT_ID" \\
  --member="serviceAccount:$SA_EMAIL" --role="roles/monitoring.viewer"

# 5) Baixa a chave JSON
gcloud iam service-accounts keys create billing-os-key.json \\
  --iam-account="$SA_EMAIL"

echo ""
echo "==> Chave salva em billing-os-key.json"
echo "==> Faça download (menu 'Download File' do Cloud Shell) e envie no Billing OS."
echo ""
echo "IMPORTANTE: habilite o Billing Export para BigQuery no console:"
echo "  https://console.cloud.google.com/billing/$BILLING_ID/export/bigquery"
echo "  → Dataset: $BQ_PROJECT.$BQ_DATASET"
`;
}

