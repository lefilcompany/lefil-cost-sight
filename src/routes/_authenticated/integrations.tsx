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
import { runProviderSync } from "@/lib/sync.functions";

const STATUSES = ["active", "inactive", "error"] as const;

const searchSchema = z.object({
  status: z.enum(STATUSES).optional().catch(undefined),
  provider: z.string().optional().catch(undefined),
  platform: z.string().optional().catch(undefined),
  q: z.string().optional().catch(undefined),
});

export const Route = createFileRoute("/_authenticated/integrations")({
  head: () => ({ meta: [{ title: "Integrações — LeFil Cost Center" }] }),
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
    const withSecret = connections.filter((c) => c.secret_ref).length;
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
    config_json: "",
  });

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm());
    setOpen(true);
  };
  const openEdit = (c: Connection) => {
    setEditing(c);
    setForm({
      name: c.name,
      provider_id: c.provider_id,
      platform_id: c.platform_id ?? "",
      status: c.status,
      secret_ref: c.secret_ref ?? "",
      config_json: c.config ? JSON.stringify(c.config, null, 2) : "",
    });
    setOpen(true);
  };

  const save = useMutation({
    mutationFn: async () => {
      if (!form.name?.trim()) throw new Error("Nome é obrigatório");
      if (!form.provider_id) throw new Error("Fornecedor é obrigatório");
      let config: any = null;
      if (form.config_json?.trim()) {
        try {
          config = JSON.parse(form.config_json);
        } catch {
          throw new Error("Config JSON inválido");
        }
      }
      const payload = {
        name: form.name.trim(),
        provider_id: form.provider_id,
        platform_id: form.platform_id || null,
        status: form.status || "active",
        secret_ref: form.secret_ref?.trim() || null,
        config,
      };
      if (editing) {
        const { error } = await supabase.from("provider_connections").update(payload).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("provider_connections").insert(payload);
        if (error) throw error;
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
    onSuccess: () => {
      toast.success("Sincronização iniciada");
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
            onSubmit={() => save.mutate()}
            pending={save.isPending}
          />
        </Dialog>
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
              <div className="py-16 text-center">
                <div className="mx-auto max-w-sm space-y-3">
                  <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-muted text-muted-foreground">
                    <Inbox className="h-5 w-5" />
                  </div>
                  <p className="font-display text-sm font-medium">
                    {activeFilters > 0 || connections.length > 0 ? "Nenhuma integração nesse filtro" : "Conecte seu primeiro fornecedor"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {activeFilters > 0 || connections.length > 0
                      ? "Ajuste os filtros ou limpe a busca."
                      : providers.length === 0
                      ? "Cadastre fornecedores antes de criar integrações."
                      : "Integrações mantêm credenciais e configuração para sincronizar custos automaticamente."}
                  </p>
                  {activeFilters > 0 ? (
                    <Button variant="outline" size="sm" onClick={clearFilters} className="gap-1.5">
                      <X className="h-3.5 w-3.5" /> Limpar filtros
                    </Button>
                  ) : (
                    <Button size="sm" onClick={openCreate} className="gap-1.5" disabled={providers.length === 0}>
                      <Plus className="h-3.5 w-3.5" /> Nova integração
                    </Button>
                  )}
                </div>
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
  const hasSecret = !!conn.secret_ref;
  const initials = (provider?.name ?? conn.name).slice(0, 2).toUpperCase();
  return (
    <Card className={`surface-elevated transition ${active ? "" : "opacity-80"}`}>
      <CardContent className="space-y-3 pt-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary/10 font-display text-xs font-semibold text-primary shadow-sm">
              {initials}
            </div>
            <div className="min-w-0">
              <p className="truncate font-display text-sm font-semibold">{conn.name}</p>
              <p className="truncate text-xs text-muted-foreground">
                {provider?.name ?? "Fornecedor removido"}
                {provider?.category ? ` · ${provider.category}` : ""}
              </p>
            </div>
          </div>
          {statusBadge(conn.status)}
        </div>

        <div className="space-y-1.5 rounded-md border border-border/60 bg-muted/30 p-3 text-xs">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <span className="text-[10px] font-semibold uppercase tracking-wider">Plataforma</span>
            <span className="ml-auto truncate">{platform?.name ?? "—"}</span>
          </div>
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <KeyRound className="h-3 w-3" />
            <span className="truncate">{hasSecret ? conn.secret_ref : "Sem credencial"}</span>
          </div>
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Clock className="h-3 w-3" />
            <span>{conn.last_sync_at ? `Sync: ${fmtDateTime(conn.last_sync_at)}` : "Nunca sincronizado"}</span>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={onSync} disabled={syncing || !active}>
            <RefreshCw className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? "Sincronizando" : "Sincronizar"}
          </Button>
          <Button size="sm" variant="outline" className="h-8 flex-1 gap-1.5" onClick={onEdit}>
            <Pencil className="h-3.5 w-3.5" /> Editar
          </Button>
          <Button size="icon" variant="outline" className="h-8 w-8" onClick={onToggle} title={active ? "Desativar" : "Ativar"}>
            {active ? <PowerOff className="h-3.5 w-3.5" /> : <Power className="h-3.5 w-3.5" />}
          </Button>
          <Button size="icon" variant="ghost" className="h-8 w-8 hover:text-destructive" onClick={onDelete}>
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
  onSubmit,
  pending,
}: {
  editing: Connection | null;
  form: any;
  setForm: (v: any) => void;
  providers: Provider[];
  platforms: Platform[];
  onSubmit: () => void;
  pending: boolean;
}) {
  const inputCls = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm";
  return (
    <DialogContent className="max-w-lg">
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
          <label className="text-xs font-medium text-muted-foreground">Secret ref</label>
          <input
            className={inputCls}
            value={form.secret_ref ?? ""}
            onChange={(e) => setForm({ ...form, secret_ref: e.target.value })}
            placeholder="OPENAI_API_KEY"
          />
        </div>

        <div className="col-span-2 space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Config (JSON)</label>
          <textarea
            className={`${inputCls} font-numeric text-xs`}
            rows={5}
            value={form.config_json ?? ""}
            onChange={(e) => setForm({ ...form, config_json: e.target.value })}
            placeholder='{"org_id": "...", "region": "us-east-1"}'
          />
          <p className="text-[11px] text-muted-foreground">
            Metadados usados pelo job de sincronização. Deixe em branco se não precisar.
          </p>
        </div>

        <DialogFooter className="col-span-2 mt-2">
          <Button type="submit" disabled={pending} className="gap-1.5">
            {pending ? "Salvando..." : editing ? "Salvar alterações" : "Criar integração"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

function Kpi({
  label,
  value,
  icon,
  tone = "neutral",
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  tone?: "neutral" | "good" | "warn" | "bad";
}) {
  const toneCls =
    tone === "good"
      ? "text-emerald-600 dark:text-emerald-400"
      : tone === "warn"
      ? "text-amber-600 dark:text-amber-400"
      : tone === "bad"
      ? "text-rose-600 dark:text-rose-400"
      : "text-foreground";
  return (
    <Card className="surface-elevated">
      <CardContent className="pt-5">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
          <span className="text-muted-foreground">{icon}</span>
        </div>
        <p className={`mt-2 font-numeric text-2xl font-semibold ${toneCls}`}>{value}</p>
      </CardContent>
    </Card>
  );
}
