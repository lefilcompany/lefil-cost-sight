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
import { fmtBRL, fmtNumber } from "@/lib/format";

const STATUSES = ["active", "inactive"] as const;

const searchSchema = z.object({
  status: z.enum(STATUSES).optional().catch(undefined),
  q: z.string().optional().catch(undefined),
});

export const Route = createFileRoute("/_authenticated/platforms")({
  head: () => ({ meta: [{ title: "Plataformas — LeFil Cost Center" }] }),
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
  created_at: string;
  updated_at: string;
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
      if (q && !`${p.name} ${p.description ?? ""}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [platforms, search]);

  const stats = useMemo(() => {
    const active = platforms.filter((p) => p.status === "active").length;
    const inactive = platforms.length - active;
    const totalBrl = costs.reduce((a, c) => a + Number(c.cost_brl ?? 0), 0);
    return { total: platforms.length, active, inactive, totalBrl };
  }, [platforms, costs]);

  const setSearch = (patch: Partial<z.infer<typeof searchSchema>>) =>
    navigate({ search: (prev: z.infer<typeof searchSchema>) => ({ ...prev, ...patch }) });

  const activeFilters = Number(!!search.status) + Number(!!search.q);
  const clearFilters = () => navigate({ search: {} as any });

  // form
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Platform | null>(null);
  const [form, setForm] = useState<any>({});

  const emptyForm = () => ({
    name: "",
    description: "",
    icon: "Box",
    color: "#3b82f6",
    status: "active",
  });

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm());
    setOpen(true);
  };
  const openEdit = (p: Platform) => {
    setEditing(p);
    setForm({
      name: p.name,
      description: p.description ?? "",
      icon: p.icon,
      color: p.color,
      status: p.status,
    });
    setOpen(true);
  };

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        name: form.name?.trim(),
        description: form.description?.trim() || null,
        icon: form.icon?.trim() || "Box",
        color: form.color || "#3b82f6",
        status: form.status || "active",
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
          <PlatformDialog editing={editing} form={form} setForm={setForm} onSubmit={() => save.mutate()} pending={save.isPending} />
        </Dialog>
      }
    >
      <div className="space-y-6">
        {/* KPIs */}
        <div className="grid gap-3 md:grid-cols-4">
          <Kpi label="Total" value={fmtNumber(stats.total)} icon={<Layers className="h-4 w-4" />} />
          <Kpi label="Ativas" value={fmtNumber(stats.active)} tone="good" icon={<Power className="h-4 w-4" />} />
          <Kpi label="Inativas" value={fmtNumber(stats.inactive)} tone={stats.inactive ? "warn" : "neutral"} icon={<PowerOff className="h-4 w-4" />} />
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
                      : "Plataformas agrupam custos e fornecedores por produto LeFil."}
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
  onEdit,
  onToggle,
  onDelete,
}: {
  platform: Platform;
  totalBrl: number;
  entriesCount: number;
  onEdit: () => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const Icon = (LucideIcons as any)[platform.icon] ?? LucideIcons.Box;
  const active = platform.status === "active";
  return (
    <Card className={`surface-elevated transition ${active ? "" : "opacity-70"}`}>
      <CardContent className="space-y-3 pt-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <div
              className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-white shadow-sm"
              style={{ background: platform.color }}
            >
              <Icon className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="truncate font-display text-sm font-semibold">{platform.name}</p>
              <p className="line-clamp-2 text-xs text-muted-foreground">
                {platform.description || "Sem descrição"}
              </p>
            </div>
          </div>
          {active ? (
            <Badge className="gap-1 bg-emerald-600/15 text-emerald-700 hover:bg-emerald-600/20 dark:text-emerald-400" variant="secondary">
              Ativa
            </Badge>
          ) : (
            <Badge variant="outline" className="border-border/60 text-muted-foreground">Inativa</Badge>
          )}
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
  onSubmit,
  pending,
}: {
  editing: Platform | null;
  form: any;
  setForm: (v: any) => void;
  onSubmit: () => void;
  pending: boolean;
}) {
  const Icon = (LucideIcons as any)[form.icon || "Box"] ?? LucideIcons.Box;
  const inputCls = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm";
  return (
    <DialogContent className="max-w-lg">
      <DialogHeader>
        <DialogTitle className="font-display">{editing ? "Editar plataforma" : "Nova plataforma"}</DialogTitle>
      </DialogHeader>

      <div className="mb-2 flex items-center gap-3 rounded-md border border-border/60 bg-muted/30 p-3">
        <div
          className="grid h-11 w-11 place-items-center rounded-lg text-white shadow-sm"
          style={{ background: form.color || "#3b82f6" }}
        >
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="truncate font-display text-sm font-semibold">{form.name || "Nome da plataforma"}</p>
          <p className="truncate text-xs text-muted-foreground">{form.description || "Prévia"}</p>
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
        <div className="col-span-2 space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Descrição</label>
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
        <div className="col-span-2 space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Status</label>
          <select className={inputCls} value={form.status ?? "active"} onChange={(e) => setForm({ ...form, status: e.target.value })}>
            <option value="active">Ativa</option>
            <option value="inactive">Inativa</option>
          </select>
        </div>
        <DialogFooter className="col-span-2">
          <Button type="submit" disabled={pending}>
            {pending ? "Salvando..." : "Salvar"}
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
  icon?: React.ReactNode;
  tone?: "neutral" | "good" | "warn";
}) {
  const toneCls =
    tone === "good"
      ? "text-emerald-600 dark:text-emerald-400"
      : tone === "warn"
      ? "text-amber-600 dark:text-amber-400"
      : "";
  return (
    <Card className="surface-elevated">
      <CardContent className="flex items-center justify-between pt-6">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
          <p className={`mt-1 font-display text-2xl font-semibold tracking-tight ${toneCls}`}>{value}</p>
        </div>
        {icon && (
          <div className="grid h-9 w-9 place-items-center rounded-full border border-border/60 bg-muted/40 text-muted-foreground">
            {icon}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
