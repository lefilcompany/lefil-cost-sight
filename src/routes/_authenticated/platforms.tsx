import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { z } from "zod";
import * as LucideIcons from "lucide-react";
import {
  Plus,
  Pencil,
  Trash2,
  Search,
  Filter,
  X,
  Power,
  PowerOff,
  Layers,
  Wallet,
  Inbox,
  CreditCard,
  UserRound,
  AlertTriangle,
  Factory,
  Home,
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
import { fmtBRL, fmtNumber } from "@/lib/format";

const STATUSES = ["active", "inactive"] as const;
const ENVIRONMENTS = ["production", "internal"] as const;

const searchSchema = z.object({
  status: z.enum(STATUSES).optional().catch(undefined),
  environment: z.enum(ENVIRONMENTS).optional().catch(undefined),
  q: z.string().optional().catch(undefined),
});

export const Route = createFileRoute("/_authenticated/platforms")({
  head: () => ({ meta: [{ title: "Plataformas — Quiui Cost Center" }] }),
  validateSearch: searchSchema,
  component: PlatformsPage,
});

type Platform = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  color: string;
  icon: string;
  image_url: string | null;
  summary: string | null;
  payment_method: string | null;
  card_last4: string | null;
  environment: string;
  owner_contact_id: string | null;
  created_at: string;
  updated_at: string;
};

type Contact = { id: string; name: string; company: string | null };

type Preset = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  category: string | null;
  environment: string | null;
  icon: string | null;
  color: string | null;
  default_provider_id: string | null;
};

function PlatformsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate({ from: "/platforms" });
  const search = Route.useSearch();

  const { data: platforms = [], isLoading } = useQuery({
    queryKey: ["platforms"],
    queryFn: async () => {
      const { data, error } = await supabase.from("platforms").select("*").order("name");
      if (error) throw error;
      return (data ?? []) as Platform[];
    },
  });

  const { data: costs = [] } = useQuery({
    queryKey: ["platforms-costs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cost_entries")
        .select("platform_id, cost_brl")
        .not("platform_id", "is", null)
        .limit(20000);
      if (error) throw error;
      return (data ?? []) as { platform_id: string; cost_brl: number | null }[];
    },
  });

  const { data: contacts = [] } = useQuery({
    queryKey: ["platforms-contacts"],
    queryFn: async () => {
      const { data, error } = await supabase.from("clients").select("id,name,company").order("name");
      if (error) throw error;
      return (data ?? []) as Contact[];
    },
  });

  const { data: presets = [] } = useQuery({
    queryKey: ["platform-presets"],
    queryFn: async () => {
      const { data, error } = await supabase.from("platform_presets").select("*").order("name");
      if (error) throw error;
      return (data ?? []) as Preset[];
    },
  });

  const contactById = useMemo(() => {
    const m = new Map<string, Contact>();
    for (const c of contacts) m.set(c.id, c);
    return m;
  }, [contacts]);

  const costByPlatform = useMemo(() => {
    const m = new Map<string, { total: number; count: number }>();
    for (const c of costs) {
      const cur = m.get(c.platform_id) ?? { total: 0, count: 0 };
      cur.total += Number(c.cost_brl ?? 0);
      cur.count += 1;
      m.set(c.platform_id, cur);
    }
    return m;
  }, [costs]);

  const filtered = useMemo(() => {
    const q = (search.q ?? "").toLowerCase().trim();
    return platforms.filter((p) => {
      if (search.status && p.status !== search.status) return false;
      if (search.environment && p.environment !== search.environment) return false;
      if (q && !`${p.name} ${p.description ?? ""} ${p.summary ?? ""}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [platforms, search]);

  const stats = useMemo(() => {
    const active = platforms.filter((p) => p.status === "active").length;
    const production = platforms.filter((p) => p.environment === "production").length;
    const internal = platforms.filter((p) => p.environment === "internal").length;
    const totalBrl = costs.reduce((a, c) => a + Number(c.cost_brl ?? 0), 0);
    return { total: platforms.length, active, production, internal, totalBrl };
  }, [platforms, costs]);

  const incompleteCount = useMemo(
    () =>
      platforms.filter(
        (p) =>
          !p.summary?.trim() ||
          !p.payment_method?.trim() ||
          !p.owner_contact_id,
      ).length,
    [platforms],
  );

  const setSearch = (patch: Partial<z.infer<typeof searchSchema>>) =>
    navigate({ search: (prev: z.infer<typeof searchSchema>) => ({ ...prev, ...patch }) });

  const activeFilters =
    Number(!!search.status) + Number(!!search.environment) + Number(!!search.q);
  const clearFilters = () => navigate({ search: {} as any });

  // form
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Platform | null>(null);
  const [form, setForm] = useState<any>({});

  const emptyForm = () => ({
    name: "",
    description: "",
    summary: "",
    icon: "Box",
    color: "#3b82f6",
    status: "active",
    environment: "production",
    payment_method: "",
    card_last4: "",
    owner_contact_id: "",
    image_url: "",
  });

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm());
    setOpen(true);
  };
  const openFromPreset = (preset: Preset) => {
    setEditing(null);
    setForm({
      ...emptyForm(),
      name: preset.name,
      description: preset.description ?? "",
      summary: preset.description ?? "",
      icon: preset.icon || "Box",
      color: preset.color || "#3b82f6",
      environment: preset.environment || "production",
    });
    setOpen(true);
  };
  const openEdit = (p: Platform) => {
    setEditing(p);
    setForm({
      name: p.name,
      description: p.description ?? "",
      summary: p.summary ?? "",
      icon: p.icon,
      color: p.color,
      status: p.status,
      environment: p.environment ?? "production",
      payment_method: p.payment_method ?? "",
      card_last4: p.card_last4 ?? "",
      owner_contact_id: p.owner_contact_id ?? "",
      image_url: p.image_url ?? "",
    });
    setOpen(true);
  };

  const save = useMutation({
    mutationFn: async () => {
      const last4 = (form.card_last4 ?? "").trim();
      if (last4 && !/^\d{4}$/.test(last4)) throw new Error("Final do cartão deve ter 4 dígitos");
      const payload = {
        name: form.name?.trim(),
        description: form.description?.trim() || null,
        summary: form.summary?.trim() || null,
        icon: form.icon?.trim() || "Box",
        color: form.color || "#3b82f6",
        status: form.status || "active",
        environment: form.environment || "production",
        payment_method: form.payment_method?.trim() || null,
        card_last4: last4 || null,
        owner_contact_id: form.owner_contact_id || null,
      };
      if (!payload.name) throw new Error("Nome é obrigatório");
      if (editing) {
        const { error } = await supabase.from("platforms").update(payload).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("platforms").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(editing ? "Plataforma atualizada" : "Plataforma criada");
      qc.invalidateQueries({ queryKey: ["platforms"] });
      setOpen(false);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const toggleStatus = useMutation({
    mutationFn: async (p: Platform) => {
      const next = p.status === "active" ? "inactive" : "active";
      const { error } = await supabase.from("platforms").update({ status: next }).eq("id", p.id);
      if (error) throw error;
      return next;
    },
    onSuccess: (next) => {
      toast.success(next === "active" ? "Plataforma ativada" : "Plataforma desativada");
      qc.invalidateQueries({ queryKey: ["platforms"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("platforms").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Removido");
      qc.invalidateQueries({ queryKey: ["platforms"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <AppShell
      eyebrow="Cadastros"
      title="Plataformas"
      actions={
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button onClick={openCreate} className="gap-1.5">
              <Plus className="h-4 w-4" /> Nova plataforma
            </Button>
          </DialogTrigger>
          <PlatformDialog
            editing={editing}
            form={form}
            setForm={setForm}
            contacts={contacts}
            onSubmit={() => save.mutate()}
            pending={save.isPending}
          />
        </Dialog>
      }
    >
      <div className="space-y-6">
        {/* KPIs */}
        <div className="grid gap-3 md:grid-cols-4">
          <Kpi label="Total" value={fmtNumber(stats.total)} icon={<Layers className="h-4 w-4" />} />
          <Kpi label="Produção" value={fmtNumber(stats.production)} tone="good" icon={<Factory className="h-4 w-4" />} />
          <Kpi label="Uso interno" value={fmtNumber(stats.internal)} icon={<Home className="h-4 w-4" />} />
          <Kpi label="Custo total (BRL)" value={fmtBRL(stats.totalBrl)} icon={<Wallet className="h-4 w-4" />} />
        </div>

        {/* Presets */}
        {presets.length > 0 && (
          <Card className="surface-elevated">
            <CardContent className="pt-5">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div>
                  <p className="font-display text-sm font-semibold">Criar a partir de preset</p>
                  <p className="text-xs text-muted-foreground">Modelos prontos com ícone, ambiente e cor sugeridos.</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {presets.map((preset) => {
                  const Icon = (LucideIcons as any)[preset.icon || "Box"] ?? LucideIcons.Box;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => openFromPreset(preset)}
                      className="group flex items-center gap-2 rounded-md border border-border/70 bg-muted/30 px-3 py-2 text-left transition hover:border-border hover:bg-muted"
                    >
                      <span
                        className="grid h-8 w-8 place-items-center rounded-md text-white"
                        style={{ background: preset.color || "#3b82f6" }}
                      >
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-xs font-semibold">{preset.name}</span>
                        <span className="block truncate text-[10px] text-muted-foreground">
                          {preset.category ?? ""}{preset.environment ? ` · ${preset.environment === "internal" ? "interno" : "produção"}` : ""}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Incompletas banner */}
        {incompleteCount > 0 && (
          <Card className="border-amber-500/40 bg-amber-500/5">
            <CardContent className="flex items-center gap-3 py-3">
              <div className="grid h-9 w-9 place-items-center rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400">
                <AlertTriangle className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-display text-sm font-medium">
                  {incompleteCount} {incompleteCount === 1 ? "plataforma com cadastro incompleto" : "plataformas com cadastro incompleto"}
                </p>
                <p className="text-xs text-muted-foreground">
                  Falta resumo, forma de pagamento ou responsável. Complete para manter o financeiro rastreável.
                </p>
              </div>
            </CardContent>
          </Card>
        )}

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

              <Select value={search.environment ?? "__all"} onValueChange={(v) => setSearch({ environment: v === "__all" ? undefined : (v as any) })}>
                <SelectTrigger className="h-9 w-[170px]"><SelectValue placeholder="Ambiente" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all">Todos ambientes</SelectItem>
                  <SelectItem value="production">Produção</SelectItem>
                  <SelectItem value="internal">Uso interno</SelectItem>
                </SelectContent>
              </Select>

              <Select value={search.status ?? "__all"} onValueChange={(v) => setSearch({ status: v === "__all" ? undefined : (v as any) })}>
                <SelectTrigger className="h-9 w-[160px]"><SelectValue placeholder="Status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all">Todos status</SelectItem>
                  <SelectItem value="active">Ativas</SelectItem>
                  <SelectItem value="inactive">Inativas</SelectItem>
                </SelectContent>
              </Select>

              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search.q ?? ""}
                  onChange={(e) => setSearch({ q: e.target.value || undefined })}
                  placeholder="Buscar plataforma..."
                  className="h-9 w-64 border-border/70 bg-muted/30 pl-9 text-sm"
                />
              </div>

              {activeFilters > 0 && (
                <Button variant="ghost" size="sm" className="h-9 gap-1 text-muted-foreground" onClick={clearFilters}>
                  <X className="h-3.5 w-3.5" /> Limpar
                </Button>
              )}

              <span className="ml-auto text-xs text-muted-foreground">
                {fmtNumber(filtered.length)} de {fmtNumber(platforms.length)}
              </span>
            </div>

            {isLoading ? (
              <LoadingState label="Carregando plataformas..." />
            ) : filtered.length === 0 ? (
              <div className="py-16 text-center">
                <div className="mx-auto max-w-sm space-y-3">
                  <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-muted text-muted-foreground">
                    <Inbox className="h-5 w-5" />
                  </div>
                  <p className="font-display text-sm font-medium">
                    {activeFilters > 0 || platforms.length > 0 ? "Nenhuma plataforma nesse filtro" : "Cadastre sua primeira plataforma"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {activeFilters > 0 || platforms.length > 0
                      ? "Ajuste os filtros ou limpe a busca."
                      : "Plataformas agrupam custos e fornecedores por produto Quiui."}
                  </p>
                  {activeFilters > 0 ? (
                    <Button variant="outline" size="sm" onClick={clearFilters} className="gap-1.5">
                      <X className="h-3.5 w-3.5" /> Limpar filtros
                    </Button>
                  ) : (
                    <Button size="sm" onClick={openCreate} className="gap-1.5">
                      <Plus className="h-3.5 w-3.5" /> Nova plataforma
                    </Button>
                  )}
                </div>
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {filtered.map((p) => {
                  const agg = costByPlatform.get(p.id) ?? { total: 0, count: 0 };
                  return (
                    <PlatformCard
                      key={p.id}
                      platform={p}
                      totalBrl={agg.total}
                      entriesCount={agg.count}
                      contact={p.owner_contact_id ? contactById.get(p.owner_contact_id) : undefined}
                      onEdit={() => openEdit(p)}
                      onToggle={() => toggleStatus.mutate(p)}
                      onDelete={() => {
                        if (confirm(`Excluir "${p.name}"? Custos associados perderão o vínculo.`)) remove.mutate(p.id);
                      }}
                    />
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

function PlatformCard({
  platform,
  totalBrl,
  entriesCount,
  contact,
  onEdit,
  onToggle,
  onDelete,
}: {
  platform: Platform;
  totalBrl: number;
  entriesCount: number;
  contact?: Contact;
  onEdit: () => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const Icon = (LucideIcons as any)[platform.icon] ?? LucideIcons.Box;
  const active = platform.status === "active";
  const isInternal = platform.environment === "internal";
  const incomplete =
    !platform.summary?.trim() || !platform.payment_method?.trim() || !platform.owner_contact_id;
  return (
    <Card className={`surface-elevated overflow-hidden transition ${active ? "" : "opacity-70"}`}>
      <div
        className="relative aspect-[16/9] w-full overflow-hidden bg-muted"
        style={platform.image_url ? undefined : { background: platform.color }}
      >
        {platform.image_url ? (
          <img
            src={platform.image_url}
            alt={platform.name}
            className="h-full w-full object-cover"
            loading="lazy"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
            }}
          />
        ) : (
          <div className="grid h-full w-full place-items-center text-white/80">
            <Icon className="h-10 w-10" />
          </div>
        )}
        <div className="absolute right-2 top-2 flex flex-col items-end gap-1">
          {isInternal ? (
            <Badge variant="secondary" className="gap-1 bg-sky-600/90 text-white backdrop-blur">
              <Home className="h-3 w-3" /> Interno
            </Badge>
          ) : (
            <Badge variant="secondary" className="gap-1 bg-violet-600/90 text-white backdrop-blur">
              <Factory className="h-3 w-3" /> Produção
            </Badge>
          )}
          {active ? (
            <Badge className="gap-1 bg-emerald-600/90 text-white backdrop-blur hover:bg-emerald-600" variant="secondary">
              Ativa
            </Badge>
          ) : (
            <Badge variant="secondary" className="bg-background/80 text-muted-foreground backdrop-blur">Inativa</Badge>
          )}
        </div>
      </div>
      <CardContent className="space-y-3 pt-4">
        <div className="min-w-0">
          <p className="truncate font-display text-sm font-semibold">{platform.name}</p>
          <p className="line-clamp-2 text-xs text-muted-foreground">
            {platform.summary || platform.description || "Sem resumo"}
          </p>
        </div>


        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="flex items-center gap-1.5 rounded-md border border-border/60 bg-muted/30 px-2 py-1.5">
            <CreditCard className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="truncate">
              {platform.payment_method ? (
                <>
                  {platform.payment_method}
                  {platform.card_last4 && <span className="ml-1 font-numeric text-muted-foreground">•••• {platform.card_last4}</span>}
                </>
              ) : (
                <span className="text-muted-foreground">Sem pagamento</span>
              )}
            </span>
          </div>
          <div className="flex items-center gap-1.5 rounded-md border border-border/60 bg-muted/30 px-2 py-1.5">
            <UserRound className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="truncate">
              {contact ? contact.name : <span className="text-muted-foreground">Sem responsável</span>}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 rounded-md border border-border/60 bg-muted/30 p-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Custo BRL</p>
            <p className="mt-0.5 font-numeric text-sm font-semibold">{fmtBRL(totalBrl)}</p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Lançamentos</p>
            <p className="mt-0.5 font-numeric text-sm font-medium">{fmtNumber(entriesCount)}</p>
          </div>
        </div>

        {incomplete && (
          <div className="flex items-center gap-1.5 text-[11px] text-amber-600 dark:text-amber-400">
            <AlertTriangle className="h-3 w-3" /> Cadastro incompleto
          </div>
        )}

        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="outline" className="h-8 flex-1 gap-1.5" onClick={onEdit}>
            <Pencil className="h-3.5 w-3.5" /> Editar
          </Button>
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
          <Button size="icon" variant="ghost" className="h-8 w-8 hover:text-destructive" onClick={onDelete}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function PlatformDialog({
  editing,
  form,
  setForm,
  contacts,
  onSubmit,
  pending,
}: {
  editing: Platform | null;
  form: any;
  setForm: (v: any) => void;
  contacts: Contact[];
  onSubmit: () => void;
  pending: boolean;
}) {
  const Icon = (LucideIcons as any)[form.icon || "Box"] ?? LucideIcons.Box;
  const inputCls = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm";
  return (
    <DialogContent className="max-w-2xl">
      <DialogHeader>
        <DialogTitle className="font-display">{editing ? "Editar plataforma" : "Nova plataforma"}</DialogTitle>
      </DialogHeader>

      <div className="mb-2 flex items-center gap-3 rounded-md border border-border/60 bg-muted/30 p-3">
        {form.image_url ? (
          <img
            src={form.image_url}
            alt="Prévia"
            className="h-11 w-11 shrink-0 rounded-lg object-cover shadow-sm"
            onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = "none")}
          />
        ) : (
          <div
            className="grid h-11 w-11 place-items-center rounded-lg text-white shadow-sm"
            style={{ background: form.color || "#3b82f6" }}
          >
            <Icon className="h-5 w-5" />
          </div>
        )}
        <div className="min-w-0">
          <p className="truncate font-display text-sm font-semibold">{form.name || "Nome da plataforma"}</p>
          <p className="truncate text-xs text-muted-foreground">{form.summary || form.description || "Prévia"}</p>
        </div>
      </div>

      <form
        className="grid max-h-[70vh] grid-cols-2 gap-3 overflow-y-auto pr-1"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        <div className="col-span-2 space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Nome *</label>
          <input className={inputCls} value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        </div>

        <div className="col-span-2 space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Resumo do funcionamento</label>
          <textarea
            className={inputCls}
            rows={3}
            placeholder="O que a plataforma faz, como é usada, integrações principais..."
            value={form.summary ?? ""}
            onChange={(e) => setForm({ ...form, summary: e.target.value })}
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Ambiente</label>
          <Select value={form.environment || "production"} onValueChange={(v) => setForm({ ...form, environment: v })}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="production">Produção</SelectItem>
              <SelectItem value="internal">Uso interno</SelectItem>
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
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Forma de pagamento</label>
          <input
            className={inputCls}
            placeholder="Ex: Cartão Corporativo"
            value={form.payment_method ?? ""}
            onChange={(e) => setForm({ ...form, payment_method: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Final do cartão (4 dígitos)</label>
          <input
            className={inputCls}
            inputMode="numeric"
            maxLength={4}
            placeholder="1234"
            value={form.card_last4 ?? ""}
            onChange={(e) => setForm({ ...form, card_last4: e.target.value.replace(/\D/g, "").slice(0, 4) })}
          />
        </div>

        <div className="col-span-2 space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Contato responsável</label>
          <Select
            value={form.owner_contact_id || "__none"}
            onValueChange={(v) => setForm({ ...form, owner_contact_id: v === "__none" ? "" : v })}
          >
            <SelectTrigger className="h-9"><SelectValue placeholder="Selecione um responsável" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none">Sem responsável</SelectItem>
              {contacts.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}{c.company ? ` — ${c.company}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="col-span-2 space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Imagem da plataforma (URL)</label>
          <input
            className={inputCls}
            placeholder="https://... (usada como capa do card)"
            value={form.image_url ?? ""}
            onChange={(e) => setForm({ ...form, image_url: e.target.value })}
          />
        </div>

        <div className="col-span-2 space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Descrição curta</label>
          <textarea className={inputCls} rows={2} value={form.description ?? ""} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </div>


        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Ícone (lucide)</label>
          <input className={inputCls} value={form.icon ?? ""} onChange={(e) => setForm({ ...form, icon: e.target.value })} placeholder="Box, Sparkles, Layers..." />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Cor</label>
          <div className="flex items-center gap-2">
            <input type="color" className="h-9 w-14 rounded-md border border-input" value={form.color || "#3b82f6"} onChange={(e) => setForm({ ...form, color: e.target.value })} />
            <input className={inputCls} value={form.color ?? ""} onChange={(e) => setForm({ ...form, color: e.target.value })} />
          </div>
        </div>

        <DialogFooter className="col-span-2 mt-2">
          <Button type="submit" disabled={pending}>
            {pending ? "Salvando..." : editing ? "Salvar alterações" : "Criar plataforma"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
