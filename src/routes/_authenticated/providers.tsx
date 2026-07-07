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
      const name = connectForm.name.trim();
      const apiKey = connectForm.api_key.trim();
      if (!name) throw new Error("Nome da conexão é obrigatório");
      if (!apiKey) throw new Error("API key é obrigatória");
      const { data: insertedConnection, error } = await supabase.from("provider_connections").insert({
        provider_id: connectProvider.id,
        platform_id: connectForm.platform_id || null,
        name,
        status: "active",
        config: {} as any,
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
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display">
              Conectar {connectProvider?.name ?? "fornecedor"}
            </DialogTitle>
            <DialogDescription>
              Crie uma conexão segura para sincronizar custos deste fornecedor.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              connect.mutate();
            }}
          >
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
              <label className="text-xs font-medium text-muted-foreground">API Key *</label>
              <Input
                type="password"
                value={connectForm.api_key}
                onChange={(e) => setConnectForm({ ...connectForm, api_key: e.target.value })}
                placeholder="sk-..."
                autoComplete="off"
                required
              />
              <p className="text-[11px] text-muted-foreground">
                A chave é armazenada com segurança no backend e usada para sincronizar custos.
              </p>
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setConnectOpen(false)}>Cancelar</Button>
              <Button type="submit" disabled={connect.isPending} className="gap-1.5">
                <Plug className="h-4 w-4" />
                {connect.isPending ? "Conectando..." : "Conectar"}
              </Button>
            </DialogFooter>
          </form>
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
