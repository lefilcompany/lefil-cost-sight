import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
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
  Plug,
  RefreshCw,
  KeyRound,
  Inbox,
  CheckCircle2,
  AlertCircle,
  Clock,
} from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { KpiCard as Kpi, LoadingState } from "@/components/ui-kit";
import { fmtDateTime, fmtNumber } from "@/lib/format";
import { runProviderSync, runSyncAllFn } from "@/lib/sync.functions";

const STATUSES = ["active", "inactive", "error"] as const;

type PresetField = {
  key: string;
  label: string;
  placeholder?: string;
  default?: string;
  required?: boolean;
  wide?: boolean;
  options?: string[];
};
type Preset = { label: string; description: string; fields: PresetField[]; extra?: Record<string, any> };

const CONFIG_PRESETS: Record<string, Preset> = {
  none: {
    label: "Sem configuração",
    description: "Nenhum metadado será salvo. Use quando o fornecedor não precisa de parâmetros extras.",
    fields: [],
  },
  openai: {
    label: "OpenAI — Uso por organização",
    description: "Sincroniza custos da API OpenAI usando organização e versão.",
    fields: [
      { key: "org_id", label: "Organization ID", placeholder: "org-xxxxxxxxxxxxxxxx", required: true },
      { key: "api_version", label: "API version", options: ["v1"], default: "v1" },
      { key: "include_usage", label: "Incluir usage detalhado", options: ["true", "false"], default: "true" },
    ],
  },
  anthropic: {
    label: "Anthropic — Console billing",
    description: "Sincroniza billing do Anthropic Console (workspaces).",
    fields: [
      { key: "workspace_id", label: "Workspace ID", placeholder: "wrkspc_xxx", required: true },
      { key: "api_version", label: "API version", options: ["2023-06-01"], default: "2023-06-01" },
    ],
  },
  aws: {
    label: "AWS — Cost Explorer",
    description: "Consulta AWS Cost Explorer por conta e serviços.",
    fields: [
      { key: "account_id", label: "Account ID", placeholder: "123456789012", required: true },
      {
        key: "region",
        label: "Região",
        options: ["us-east-1", "us-east-2", "us-west-2", "sa-east-1", "eu-west-1", "eu-central-1"],
        default: "us-east-1",
        required: true,
      },
      {
        key: "granularity",
        label: "Granularidade",
        options: ["DAILY", "MONTHLY", "HOURLY"],
        default: "DAILY",
      },
    ],
  },
  gcp: {
    label: "Google Cloud — Billing",
    description: "Consulta billing account do Google Cloud.",
    fields: [
      { key: "billing_account", label: "Billing account", placeholder: "XXXXXX-XXXXXX-XXXXXX", required: true },
      { key: "project_id", label: "Project ID", placeholder: "meu-projeto-123", required: true },
      { key: "dataset", label: "BigQuery dataset (opcional)", placeholder: "billing_export" },
    ],
  },
  azure: {
    label: "Azure — Cost Management",
    description: "Consulta Azure Cost Management por subscription.",
    fields: [
      { key: "subscription_id", label: "Subscription ID", placeholder: "00000000-0000-0000-0000-000000000000", required: true },
      { key: "tenant_id", label: "Tenant ID", placeholder: "00000000-0000-0000-0000-000000000000", required: true },
      { key: "scope", label: "Escopo", options: ["Subscription", "ResourceGroup", "BillingAccount"], default: "Subscription" },
    ],
  },
  meta_ads: {
    label: "Meta Ads — Marketing API",
    description: "Sincroniza gastos de campanhas do Meta Ads.",
    fields: [
      { key: "ad_account_id", label: "Ad Account ID", placeholder: "act_1234567890", required: true },
      { key: "api_version", label: "API version", options: ["v19.0", "v20.0", "v21.0"], default: "v20.0" },
    ],
  },
  google_ads: {
    label: "Google Ads — API",
    description: "Sincroniza gastos de campanhas do Google Ads.",
    fields: [
      { key: "customer_id", label: "Customer ID", placeholder: "123-456-7890", required: true },
      { key: "login_customer_id", label: "Login customer ID (MCC)", placeholder: "opcional" },
      { key: "api_version", label: "API version", options: ["v16", "v17"], default: "v17" },
    ],
  },
  stripe: {
    label: "Stripe — Billing",
    description: "Sincroniza faturas e assinaturas do Stripe.",
    fields: [
      { key: "account_id", label: "Account ID", placeholder: "acct_xxx", required: true },
      { key: "api_version", label: "API version", options: ["2024-06-20", "2024-11-20"], default: "2024-11-20" },
    ],
  },
  webhook: {
    label: "Webhook genérico",
    description: "Recebe eventos via URL. Use quando o fornecedor entrega dados por push.",
    fields: [
      { key: "endpoint_url", label: "URL do endpoint", placeholder: "https://api.exemplo.com/hook", required: true, wide: true },
      { key: "method", label: "Método", options: ["POST", "GET", "PUT"], default: "POST" },
      { key: "auth_type", label: "Autenticação", options: ["none", "bearer", "basic", "hmac"], default: "bearer" },
    ],
  },
};

function buildConfig(preset: string, fields: Record<string, string>) {
  const p = CONFIG_PRESETS[preset];
  if (!p || preset === "none") return null;
  const out: Record<string, any> = { _preset: preset };
  for (const f of p.fields) {
    const raw = fields[f.key];
    if (raw === undefined || raw === "") continue;
    if (raw === "true") out[f.key] = true;
    else if (raw === "false") out[f.key] = false;
    else if (/^-?\d+(\.\d+)?$/.test(raw)) out[f.key] = Number(raw);
    else out[f.key] = raw;
  }
  return out;
}

function detectPreset(config: any): { preset: string; fields: Record<string, string> } {
  if (!config || typeof config !== "object") return { preset: "none", fields: {} };
  const preset = typeof config._preset === "string" && CONFIG_PRESETS[config._preset] ? config._preset : "none";
  if (preset === "none") return { preset: "none", fields: {} };
  const fields: Record<string, string> = {};
  for (const f of CONFIG_PRESETS[preset].fields) {
    const v = config[f.key];
    if (v === undefined || v === null) fields[f.key] = "";
    else fields[f.key] = String(v);
  }
  return { preset, fields };
}


const searchSchema = z.object({
  status: z.enum(STATUSES).optional().catch(undefined),
  provider: z.string().optional().catch(undefined),
  platform: z.string().optional().catch(undefined),
  q: z.string().optional().catch(undefined),
});

export const Route = createFileRoute("/_authenticated/integrations")({
  head: () => ({ meta: [{ title: "Integrações — Quiui Cost Center" }] }),
  validateSearch: searchSchema,
  component: IntegrationsPage,
});

type Connection = {
  id: string;
  provider_id: string;
  platform_id: string | null;
  name: string;
  status: string;
  secret_ref: string | null;
  config: any;
  api_key_secret_id: string | null;
  last_sync_at: string | null;
  created_at: string;
  updated_at: string;
};

type Provider = { id: string; name: string; category: string | null; status: string };
type Platform = { id: string; name: string; color: string; icon: string; status: string };

function IntegrationsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate({ from: "/integrations" });
  const search = Route.useSearch();
  const syncFn = useServerFn(runProviderSync);
  const syncAllFn = useServerFn(runSyncAllFn);

  const { data: isAdmin = false } = useQuery({
    queryKey: ["is-admin"],
    queryFn: async () => {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      if (!uid) return false;
      const { data, error } = await supabase.rpc("has_role", { _user_id: uid, _role: "admin" });
      if (error) return false;
      return !!data;
    },
  });

  const { data: connections = [], isLoading } = useQuery({
    queryKey: ["connections"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("provider_connections")
        .select("*")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Connection[];
    },
  });

  const { data: providers = [] } = useQuery({
    queryKey: ["providers", "for-integrations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("providers")
        .select("id, name, category, status")
        .order("name");
      if (error) throw error;
      return (data ?? []) as Provider[];
    },
  });

  const { data: platforms = [] } = useQuery({
    queryKey: ["platforms", "for-integrations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("platforms")
        .select("id, name, color, icon, status")
        .order("name");
      if (error) throw error;
      return (data ?? []) as Platform[];
    },
  });

  const providerMap = useMemo(() => new Map(providers.map((p) => [p.id, p])), [providers]);
  const platformMap = useMemo(() => new Map(platforms.map((p) => [p.id, p])), [platforms]);

  const filtered = useMemo(() => {
    const q = (search.q ?? "").toLowerCase().trim();
    return connections.filter((c) => {
      if (search.status && c.status !== search.status) return false;
      if (search.provider && c.provider_id !== search.provider) return false;
      if (search.platform && c.platform_id !== search.platform) return false;
      if (q) {
        const provName = providerMap.get(c.provider_id)?.name ?? "";
        const platName = c.platform_id ? platformMap.get(c.platform_id)?.name ?? "" : "";
        if (!`${c.name} ${provName} ${platName}`.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [connections, search, providerMap, platformMap]);

  const stats = useMemo(() => {
    const active = connections.filter((c) => c.status === "active").length;
    const errored = connections.filter((c) => c.status === "error").length;
    const inactive = connections.length - active - errored;
    const withSecret = connections.filter((c) => c.api_key_secret_id).length;
    return { total: connections.length, active, inactive, errored, withSecret };
  }, [connections]);

  const setSearch = (patch: Partial<z.infer<typeof searchSchema>>) =>
    navigate({ search: (prev: z.infer<typeof searchSchema>) => ({ ...prev, ...patch }) });

  const activeFilters =
    Number(!!search.status) + Number(!!search.provider) + Number(!!search.platform) + Number(!!search.q);
  const clearFilters = () => navigate({ search: {} as any });

  // form
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Connection | null>(null);
  const [form, setForm] = useState<any>({});

  const emptyForm = () => ({
    name: "",
    provider_id: providers[0]?.id ?? "",
    platform_id: "",
    status: "active",
    secret_ref: "",
    config_preset: "none",
    config_fields: {} as Record<string, string>,
    api_key: "",
    remove_api_key: false,
  });

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm());
    setOpen(true);
  };
  const openEdit = (c: Connection) => {
    const detected = detectPreset(c.config);
    setEditing(c);
    setForm({
      name: c.name,
      provider_id: c.provider_id,
      platform_id: c.platform_id ?? "",
      status: c.status,
      secret_ref: c.secret_ref ?? "",
      config_preset: detected.preset,
      config_fields: detected.fields,
      api_key: "",
      remove_api_key: false,
    });
    setOpen(true);
  };

  const save = useMutation({
    mutationFn: async () => {
      if (!form.name?.trim()) throw new Error("Nome é obrigatório");
      if (!form.provider_id) throw new Error("Fornecedor é obrigatório");
      const config = buildConfig(form.config_preset, form.config_fields);
      const payload = {
        name: form.name.trim(),
        provider_id: form.provider_id,
        platform_id: form.platform_id || null,
        status: form.status || "active",
        secret_ref: form.secret_ref?.trim() || null,
        config,
      };
      let connectionId: string;
      if (editing) {
        const { error } = await supabase.from("provider_connections").update(payload).eq("id", editing.id);
        if (error) throw error;
        connectionId = editing.id;
      } else {
        const { data, error } = await supabase
          .from("provider_connections")
          .insert(payload)
          .select("id")
          .single();
        if (error) throw error;
        connectionId = data.id;
      }
      // Vault ops (admin only). Silently skip if not admin.
      if (isAdmin) {
        const key = (form.api_key ?? "").trim();
        if (key) {
          const { error } = await supabase.rpc("set_connection_api_key", {
            _connection_id: connectionId,
            _api_key: key,
          });
          if (error) throw new Error("Falha ao salvar API key: " + error.message);
        } else if (form.remove_api_key && editing?.api_key_secret_id) {
          const { error } = await supabase.rpc("clear_connection_api_key", {
            _connection_id: connectionId,
          });
          if (error) throw new Error("Falha ao remover API key: " + error.message);
        }
      }
    },
    onSuccess: () => {
      toast.success(editing ? "Integração atualizada" : "Integração criada");
      qc.invalidateQueries({ queryKey: ["connections"] });
      qc.invalidateQueries({ queryKey: ["providers-connections"] });
      setOpen(false);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const toggleStatus = useMutation({
    mutationFn: async (c: Connection) => {
      const next = c.status === "active" ? "inactive" : "active";
      const { error } = await supabase.from("provider_connections").update({ status: next }).eq("id", c.id);
      if (error) throw error;
      return next;
    },
    onSuccess: (next) => {
      toast.success(next === "active" ? "Integração ativada" : "Integração desativada");
      qc.invalidateQueries({ queryKey: ["connections"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("provider_connections").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Removida");
      qc.invalidateQueries({ queryKey: ["connections"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const sync = useMutation({
    mutationFn: async (id: string) => syncFn({ data: { connection_id: id } }),
    onSuccess: (res: any) => {
      toast.success(res?.message ?? "Sincronização concluída");
      qc.invalidateQueries({ queryKey: ["connections"] });
      qc.invalidateQueries({ queryKey: ["sync-logs"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const syncAll = useMutation({
    mutationFn: async () => syncAllFn(),
    onSuccess: (res: any) => {
      const ok = (res?.results ?? []).filter((r: any) => r.ok).length;
      toast.success(`Sincronização em lote: ${ok}/${res?.total ?? 0} com sucesso`);
      qc.invalidateQueries({ queryKey: ["connections"] });
      qc.invalidateQueries({ queryKey: ["sync-logs"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <AppShell
      eyebrow="Cadastros"
      title="Integrações"
      actions={
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            className="gap-1.5"
            disabled={syncAll.isPending || stats.active === 0}
            onClick={() => syncAll.mutate()}
          >
            <RefreshCw className={`h-4 w-4 ${syncAll.isPending ? "animate-spin" : ""}`} />
            Sincronizar todas
          </Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button onClick={openCreate} className="gap-1.5" disabled={providers.length === 0}>
                <Plus className="h-4 w-4" /> Nova integração
              </Button>
            </DialogTrigger>
            <ConnectionDialog
              editing={editing}
              form={form}
              setForm={setForm}
              providers={providers}
              platforms={platforms}
              isAdmin={isAdmin}
              onSubmit={() => save.mutate()}
              pending={save.isPending}
            />
          </Dialog>
        </div>
      }
    >
      <div className="space-y-6">
        {/* KPIs */}
        <div className="grid gap-3 md:grid-cols-4">
          <Kpi label="Total" value={fmtNumber(stats.total)} icon={<Plug className="h-4 w-4" />} />
          <Kpi label="Ativas" value={fmtNumber(stats.active)} tone="good" icon={<CheckCircle2 className="h-4 w-4" />} />
          <Kpi label="Com erro" value={fmtNumber(stats.errored)} tone={stats.errored ? "bad" : "neutral"} icon={<AlertCircle className="h-4 w-4" />} />
          <Kpi label="Com credencial" value={fmtNumber(stats.withSecret)} icon={<KeyRound className="h-4 w-4" />} />
        </div>

        {/* Filters + list */}
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
                  <SelectItem value="active">Ativas</SelectItem>
                  <SelectItem value="inactive">Inativas</SelectItem>
                  <SelectItem value="error">Com erro</SelectItem>
                </SelectContent>
              </Select>

              <Select value={search.provider ?? "__all"} onValueChange={(v) => setSearch({ provider: v === "__all" ? undefined : v })}>
                <SelectTrigger className="h-9 w-[180px]"><SelectValue placeholder="Fornecedor" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all">Todos fornecedores</SelectItem>
                  {providers.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={search.platform ?? "__all"} onValueChange={(v) => setSearch({ platform: v === "__all" ? undefined : v })}>
                <SelectTrigger className="h-9 w-[180px]"><SelectValue placeholder="Plataforma" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all">Todas plataformas</SelectItem>
                  {platforms.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search.q ?? ""}
                  onChange={(e) => setSearch({ q: e.target.value || undefined })}
                  placeholder="Buscar integração..."
                  className="h-9 w-64 border-border/70 bg-muted/30 pl-9 text-sm"
                />
              </div>

              {activeFilters > 0 && (
                <Button variant="ghost" size="sm" className="h-9 gap-1 text-muted-foreground" onClick={clearFilters}>
                  <X className="h-3.5 w-3.5" /> Limpar
                </Button>
              )}

              <span className="ml-auto text-xs text-muted-foreground">
                {fmtNumber(filtered.length)} de {fmtNumber(connections.length)}
              </span>
            </div>

            {isLoading ? (
              <LoadingState label="Carregando integrações..." />
            ) : filtered.length === 0 ? (
              <div className="space-y-4">
                <div className="text-center">
                  <p className="font-display text-sm font-medium">
                    {activeFilters > 0 ? "Nenhuma integração nesse filtro" : "Escolha uma ferramenta para conectar"}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {activeFilters > 0
                      ? "Ajuste os filtros ou limpe a busca."
                      : providers.length === 0
                      ? "Cadastre fornecedores antes de criar integrações."
                      : "Selecione um preset abaixo — abrimos o formulário já configurado."}
                  </p>
                  {activeFilters > 0 && (
                    <Button variant="outline" size="sm" onClick={clearFilters} className="mt-3 gap-1.5">
                      <X className="h-3.5 w-3.5" /> Limpar filtros
                    </Button>
                  )}
                </div>
                {activeFilters === 0 && (
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {Object.entries(CONFIG_PRESETS).map(([key, p]) => {
                      const initials = p.label.replace(/^[^A-Za-z0-9]+/, "").slice(0, 2).toUpperCase();
                      return (
                        <button
                          key={key}
                          type="button"
                          disabled={providers.length === 0}
                          onClick={() => {
                            const fields: Record<string, string> = {};
                            for (const f of p.fields) fields[f.key] = f.default ?? "";
                            setEditing(null);
                            setForm({
                              ...emptyForm(),
                              config_preset: key,
                              config_fields: fields,
                              name: key === "none" ? "" : p.label.split("—")[0].trim(),
                            });
                            setOpen(true);
                          }}
                          className="group relative flex h-full items-center gap-4 rounded-xl border border-border/70 bg-card p-4 text-left shadow-[0_2px_6px_-2px_oklch(0.30_0.08_165/0.08)] transition-all duration-300 hover:border-gold/50 hover:bg-[oklch(0.99_0.01_90)] hover:shadow-gold disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-emerald-deep to-emerald font-display text-sm font-semibold text-white shadow-[inset_0_1px_0_oklch(1_0_0/0.15)] ring-1 ring-emerald-deep/20 group-hover:ring-gold/40">
                            {initials || "—"}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-display text-sm font-semibold text-card-foreground">{p.label}</p>
                            <p className="line-clamp-2 text-[11px] leading-snug text-muted-foreground">{p.description}</p>
                          </div>
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border/80 bg-muted/40 text-muted-foreground transition-all duration-300 group-hover:border-gold/40 group-hover:bg-gold group-hover:text-gold-foreground group-hover:shadow-[0_0_12px_-2px_oklch(0.78_0.13_85/0.5)]">
                            <Plus className="h-4 w-4" />
                          </div>
                          <div className="pointer-events-none absolute inset-x-4 top-0 h-px bg-gradient-to-r from-transparent via-gold/20 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {filtered.map((c) => (
                  <ConnectionCard
                    key={c.id}
                    conn={c}
                    provider={providerMap.get(c.provider_id)}
                    platform={c.platform_id ? platformMap.get(c.platform_id) : undefined}
                    onEdit={() => openEdit(c)}
                    onToggle={() => toggleStatus.mutate(c)}
                    onSync={() => sync.mutate(c.id)}
                    syncing={sync.isPending && sync.variables === c.id}
                    onDelete={() => {
                      if (confirm(`Excluir integração "${c.name}"?`)) remove.mutate(c.id);
                    }}
                  />
                ))}
              </div>
            )}

          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

function statusBadge(status: string) {
  if (status === "active")
    return (
      <Badge className="gap-1 bg-emerald-600/15 text-emerald-700 hover:bg-emerald-600/20 dark:text-emerald-400" variant="secondary">
        <CheckCircle2 className="h-3 w-3" /> Ativa
      </Badge>
    );
  if (status === "error")
    return (
      <Badge className="gap-1 bg-rose-600/15 text-rose-700 hover:bg-rose-600/20 dark:text-rose-400" variant="secondary">
        <AlertCircle className="h-3 w-3" /> Erro
      </Badge>
    );
  return <Badge variant="outline" className="border-border/60 text-muted-foreground">Inativa</Badge>;
}

function ConnectionCard({
  conn,
  provider,
  platform,
  onEdit,
  onToggle,
  onSync,
  syncing,
  onDelete,
}: {
  conn: Connection;
  provider?: Provider;
  platform?: Platform;
  onEdit: () => void;
  onToggle: () => void;
  onSync: () => void;
  syncing: boolean;
  onDelete: () => void;
}) {
  const active = conn.status === "active";
  const hasVault = !!conn.api_key_secret_id;
  const initials = (provider?.name ?? conn.name).slice(0, 2).toUpperCase();
  return (
    <Card className={`group/card relative overflow-hidden border-border/70 bg-card transition-all duration-300 hover:border-gold/50 hover:bg-[oklch(0.99_0.01_90)] hover:shadow-gold ${active ? "" : "opacity-80"}`}>
      <div className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-gold/20 to-transparent opacity-0 transition-opacity duration-300 group-hover/card:opacity-100" />
      <CardContent className="space-y-4 pt-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-4">
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-emerald-deep to-emerald font-display text-sm font-semibold text-white shadow-[inset_0_1px_0_oklch(1_0_0/0.15)] ring-1 ring-emerald-deep/20 group-hover/card:ring-gold/40">
              {initials}
            </div>
            <div className="min-w-0">
              <p className="truncate font-display text-sm font-semibold text-card-foreground">{conn.name}</p>
              <p className="truncate text-xs text-muted-foreground">
                {provider?.name ?? "Fornecedor removido"}
                {provider?.category ? ` · ${provider.category}` : ""}
              </p>
            </div>
          </div>
          {statusBadge(conn.status)}
        </div>

        <div className="space-y-2 rounded-xl border border-border/60 bg-muted/30 p-3 text-xs">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <span className="text-[10px] font-semibold uppercase tracking-wider">Plataforma</span>
            <span className="ml-auto truncate">{platform?.name ?? "—"}</span>
          </div>
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <KeyRound className="h-3 w-3" />
            <span className="truncate">
              {hasVault ? "API key no cofre" : "Sem API key"}
              {conn.secret_ref ? ` · ${conn.secret_ref}` : ""}
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Clock className="h-3 w-3" />
            <span>{conn.last_sync_at ? `Sync: ${fmtDateTime(conn.last_sync_at)}` : "Nunca sincronizado"}</span>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="outline" className="h-9 gap-1.5 border-border/70 hover:border-gold/40 hover:bg-gold/5 hover:text-gold-foreground" onClick={onSync} disabled={syncing || !active}>
            <RefreshCw className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? "Sincronizando" : "Sincronizar"}
          </Button>
          <Button size="sm" variant="outline" className="h-9 flex-1 gap-1.5 border-border/70 hover:border-gold/40 hover:bg-gold/5 hover:text-gold-foreground" onClick={onEdit}>
            <Pencil className="h-3.5 w-3.5" /> Editar
          </Button>
          <Button size="icon" variant="outline" className="h-9 w-9 border-border/70 hover:border-gold/40 hover:bg-gold/5 hover:text-gold-foreground" onClick={onToggle} title={active ? "Desativar" : "Ativar"}>
            {active ? <PowerOff className="h-3.5 w-3.5" /> : <Power className="h-3.5 w-3.5" />}
          </Button>
          <Button size="icon" variant="ghost" className="h-9 w-8 hover:text-destructive" onClick={onDelete}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ConnectionDialog({
  editing,
  form,
  setForm,
  providers,
  platforms,
  isAdmin,
  onSubmit,
  pending,
}: {
  editing: Connection | null;
  form: any;
  setForm: (v: any) => void;
  providers: Provider[];
  platforms: Platform[];
  isAdmin: boolean;
  onSubmit: () => void;
  pending: boolean;
}) {
  const inputCls = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm";
  return (
    <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
      <DialogHeader>
        <DialogTitle className="font-display">{editing ? "Editar integração" : "Nova integração"}</DialogTitle>
      </DialogHeader>

      <form
        className="grid grid-cols-2 gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        <div className="col-span-2 space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Nome *</label>
          <input
            className={inputCls}
            value={form.name ?? ""}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="OpenAI Produção"
            required
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Fornecedor *</label>
          <Select value={form.provider_id || ""} onValueChange={(v) => setForm({ ...form, provider_id: v })}>
            <SelectTrigger className="h-9"><SelectValue placeholder="Selecione" /></SelectTrigger>
            <SelectContent>
              {providers.map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Plataforma</label>
          <Select value={form.platform_id || "__none"} onValueChange={(v) => setForm({ ...form, platform_id: v === "__none" ? "" : v })}>
            <SelectTrigger className="h-9"><SelectValue placeholder="Nenhuma" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none">Nenhuma</SelectItem>
              {platforms.map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Status</label>
          <Select value={form.status || "active"} onValueChange={(v) => setForm({ ...form, status: v })}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Ativa</SelectItem>
              <SelectItem value="inactive">Inativa</SelectItem>
              <SelectItem value="error">Com erro</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Rótulo da credencial</label>
          <input
            className={inputCls}
            value={form.secret_ref ?? ""}
            onChange={(e) => setForm({ ...form, secret_ref: e.target.value })}
            placeholder="Ex.: OpenAI Produção"
          />
        </div>

        {isAdmin && (
          <div className="col-span-2 space-y-1.5 rounded-md border border-border/60 bg-muted/20 p-3">
            <div className="flex items-center justify-between gap-2">
              <label className="text-xs font-semibold text-foreground">
                API key
                {editing?.api_key_secret_id ? (
                  <span className="ml-2 rounded-full bg-emerald-600/15 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
                    Configurada no cofre
                  </span>
                ) : (
                  <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                    Não configurada
                  </span>
                )}
              </label>
              {editing?.api_key_secret_id && (
                <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={!!form.remove_api_key}
                    onChange={(e) => setForm({ ...form, remove_api_key: e.target.checked, api_key: "" })}
                  />
                  Remover
                </label>
              )}
            </div>
            <input
              type="password"
              className={inputCls}
              autoComplete="new-password"
              value={form.api_key ?? ""}
              onChange={(e) => setForm({ ...form, api_key: e.target.value, remove_api_key: false })}
              placeholder={editing?.api_key_secret_id ? "Deixe em branco para manter a atual" : "sk-... / cole a chave"}
              disabled={!!form.remove_api_key}
            />
            <p className="text-[11px] text-muted-foreground">
              Guardada criptografada no Supabase Vault. Apenas admins podem gravar/ler. Nunca é retornada para o navegador.
            </p>
          </div>
        )}

        <div className="col-span-2 space-y-2">
          <label className="text-xs font-medium text-muted-foreground">Ferramenta / preset</label>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {Object.entries(CONFIG_PRESETS).map(([key, p]) => {
              const selected = (form.config_preset ?? "none") === key;
              const initials = p.label.replace(/^[^A-Za-z0-9]+/, "").slice(0, 2).toUpperCase();
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    const fields: Record<string, string> = {};
                    for (const f of p.fields) fields[f.key] = f.default ?? "";
                    setForm({ ...form, config_preset: key, config_fields: fields });
                  }}
                  className={`group flex h-full flex-col items-start gap-2 rounded-lg border p-3 text-left transition ${
                    selected
                      ? "border-primary bg-primary/5 shadow-sm ring-1 ring-primary/40"
                      : "border-border/60 bg-muted/20 hover:border-border hover:bg-muted/40"
                  }`}
                >
                  <div className="flex w-full items-center gap-2">
                    <div className={`grid h-8 w-8 shrink-0 place-items-center rounded-md font-display text-[10px] font-semibold ${
                      selected ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground"
                    }`}>
                      {initials || "—"}
                    </div>
                    <span className="truncate font-display text-xs font-semibold">{p.label}</span>
                    {selected && <CheckCircle2 className="ml-auto h-3.5 w-3.5 text-primary" />}
                  </div>
                  <p className="line-clamp-2 text-[11px] leading-snug text-muted-foreground">{p.description}</p>
                </button>
              );
            })}
          </div>
        </div>


        {(CONFIG_PRESETS[form.config_preset ?? "none"]?.fields ?? []).map((f) => (
          <div key={f.key} className={f.wide ? "col-span-2 space-y-1.5" : "space-y-1.5"}>
            <label className="text-xs font-medium text-muted-foreground">
              {f.label}
              {f.required ? " *" : ""}
            </label>
            {f.options ? (
              <Select
                value={form.config_fields?.[f.key] ?? ""}
                onValueChange={(v) => setForm({ ...form, config_fields: { ...form.config_fields, [f.key]: v } })}
              >
                <SelectTrigger className="h-9"><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {f.options.map((o) => (
                    <SelectItem key={o} value={o}>{o}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <input
                className={inputCls}
                value={form.config_fields?.[f.key] ?? ""}
                onChange={(e) => setForm({ ...form, config_fields: { ...form.config_fields, [f.key]: e.target.value } })}
                placeholder={f.placeholder}
              />
            )}
          </div>
        ))}

        <DialogFooter className="col-span-2 mt-2">
          <Button type="submit" disabled={pending} className="gap-1.5">
            {pending ? "Salvando..." : editing ? "Salvar alterações" : "Criar integração"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

