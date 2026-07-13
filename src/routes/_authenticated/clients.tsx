import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
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
  Users,
  Wallet,
  Inbox,
  Building2,
  UserCircle2,
  BadgeCheck,
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
import { MonitorNewsPanel } from "@/components/monitor-news-panel";

const STATUSES = ["active", "inactive"] as const;

const searchSchema = z.object({
  status: z.enum(STATUSES).optional().catch(undefined),
  q: z.string().optional().catch(undefined),
  usage: z.enum(["in_use", "all"]).catch("in_use"),
});

export const Route = createFileRoute("/_authenticated/clients")({
  head: () => ({ meta: [{ title: "Clientes — Quiwi Cost Center" }] }),
  validateSearch: searchSchema,
  component: ClientsPage,
});

type Client = {
  id: string;
  name: string;
  company: string | null;
  cnpj: string | null;
  responsible: string | null;
  status: string;
  created_at: string;
  updated_at: string;
};

function formatCnpj(v: string | null | undefined) {
  const d = (v ?? "").replace(/\D/g, "");
  if (d.length !== 14) return v ?? "";
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12, 14)}`;
}

function initialsOf(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("") || "?";
}

function colorFor(seed: string) {
  const palette = ["#3b82f6", "#8b5cf6", "#ec4899", "#f97316", "#22c55e", "#0ea5e9", "#f43f5e", "#14b8a6"];
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}

function ClientsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate({ from: "/clients" });
  const search = Route.useSearch();

  const { data: clients = [], isLoading } = useQuery({
    queryKey: ["clients"],
    queryFn: async () => {
      const { data, error } = await supabase.from("clients").select("*").order("name");
      if (error) throw error;
      return (data ?? []) as Client[];
    },
  });

  const { data: costs = [] } = useQuery({
    queryKey: ["clients-costs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cost_entries")
        .select("client_id, cost_brl")
        .not("client_id", "is", null)
        .limit(20000);
      if (error) throw error;
      return (data ?? []) as { client_id: string; cost_brl: number | null }[];
    },
  });

  const { data: ownerLinks = [] } = useQuery({
    queryKey: ["clients-platform-owners"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("platforms")
        .select("id, owner_contact_id")
        .not("owner_contact_id", "is", null);
      if (error) throw error;
      return (data ?? []) as { id: string; owner_contact_id: string }[];
    },
  });

  const linkedIds = useMemo(() => {
    const s = new Set<string>();
    for (const c of costs) if (c.client_id) s.add(c.client_id);
    for (const p of ownerLinks) if (p.owner_contact_id) s.add(p.owner_contact_id);
    return s;
  }, [costs, ownerLinks]);

  const costByClient = useMemo(() => {
    const m = new Map<string, { total: number; count: number }>();
    for (const c of costs) {
      const cur = m.get(c.client_id) ?? { total: 0, count: 0 };
      cur.total += Number(c.cost_brl ?? 0);
      cur.count += 1;
      m.set(c.client_id, cur);
    }
    return m;
  }, [costs]);

  const platformCountByClient = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of ownerLinks) {
      if (!p.owner_contact_id) continue;
      m.set(p.owner_contact_id, (m.get(p.owner_contact_id) ?? 0) + 1);
    }
    return m;
  }, [ownerLinks]);

  const filtered = useMemo(() => {
    const q = (search.q ?? "").toLowerCase().trim();
    return clients.filter((c) => {
      if (search.usage === "in_use" && !linkedIds.has(c.id)) return false;
      if (search.status && c.status !== search.status) return false;
      if (
        q &&
        !`${c.name} ${c.company ?? ""} ${c.cnpj ?? ""} ${c.responsible ?? ""}`
          .toLowerCase()
          .includes(q)
      )
        return false;
      return true;
    });
  }, [clients, search, linkedIds]);

  const stats = useMemo(() => {
    const active = clients.filter((c) => c.status === "active").length;
    const inactive = clients.length - active;
    const totalBrl = costs.reduce((a, c) => a + Number(c.cost_brl ?? 0), 0);
    return { total: clients.length, active, inactive, totalBrl };
  }, [clients, costs]);

  const setSearch = (patch: Partial<z.infer<typeof searchSchema>>) =>
    navigate({ search: (prev: z.infer<typeof searchSchema>) => ({ ...prev, ...patch }) });

  const activeFilters = Number(!!search.status) + Number(!!search.q) + Number(search.usage !== "in_use");
  const clearFilters = () => navigate({ search: { usage: "in_use" } as any });

  // form
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Client | null>(null);
  const [form, setForm] = useState<any>({});

  const emptyForm = () => ({
    name: "",
    company: "",
    cnpj: "",
    responsible: "",
    status: "active",
  });

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm());
    setOpen(true);
  };
  const openEdit = (c: Client) => {
    setEditing(c);
    setForm({
      name: c.name,
      company: c.company ?? "",
      cnpj: c.cnpj ?? "",
      responsible: c.responsible ?? "",
      status: c.status,
    });
    setOpen(true);
  };

  const save = useMutation({
    mutationFn: async () => {
      const cnpjDigits = (form.cnpj ?? "").replace(/\D/g, "");
      const payload = {
        name: form.name?.trim(),
        company: form.company?.trim() || null,
        cnpj: cnpjDigits ? formatCnpj(cnpjDigits) : null,
        responsible: form.responsible?.trim() || null,
        status: form.status || "active",
      };
      if (!payload.name) throw new Error("Nome é obrigatório");
      if (cnpjDigits && cnpjDigits.length !== 14) throw new Error("CNPJ deve ter 14 dígitos");
      if (editing) {
        const { error } = await supabase.from("clients").update(payload).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("clients").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(editing ? "Cliente atualizado" : "Cliente criado");
      qc.invalidateQueries({ queryKey: ["clients"] });
      setOpen(false);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const toggleStatus = useMutation({
    mutationFn: async (c: Client) => {
      const next = c.status === "active" ? "inactive" : "active";
      const { error } = await supabase.from("clients").update({ status: next }).eq("id", c.id);
      if (error) throw error;
      return next;
    },
    onSuccess: (next) => {
      toast.success(next === "active" ? "Cliente ativado" : "Cliente desativado");
      qc.invalidateQueries({ queryKey: ["clients"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("clients").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Removido");
      qc.invalidateQueries({ queryKey: ["clients"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <AppShell
      eyebrow="Cadastros"
      title="Clientes"
      actions={
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button onClick={openCreate} className="gap-1.5">
              <Plus className="h-4 w-4" /> Novo cliente
            </Button>
          </DialogTrigger>
          <ClientDialog
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
        <MonitorNewsPanel />
        {/* KPIs */}
        <div className="grid gap-3 md:grid-cols-4">
          <Kpi label="Total" value={fmtNumber(stats.total)} icon={<Users className="h-4 w-4" />} />
          <Kpi label="Ativos" value={fmtNumber(stats.active)} tone="good" icon={<Power className="h-4 w-4" />} />
          <Kpi label="Inativos" value={fmtNumber(stats.inactive)} tone={stats.inactive ? "warn" : "neutral"} icon={<PowerOff className="h-4 w-4" />} />
          <Kpi label="Custo total (BRL)" value={fmtBRL(stats.totalBrl)} icon={<Wallet className="h-4 w-4" />} />
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
                <SelectTrigger className="h-9 w-[160px]"><SelectValue placeholder="Status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all">Todos status</SelectItem>
                  <SelectItem value="active">Ativos</SelectItem>
                  <SelectItem value="inactive">Inativos</SelectItem>
                </SelectContent>
              </Select>

              <Select value={search.usage} onValueChange={(v) => setSearch({ usage: v as any })}>
                <SelectTrigger className="h-9 w-[160px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="in_use">Somente em uso</SelectItem>
                  <SelectItem value="all">Mostrar todos</SelectItem>
                </SelectContent>
              </Select>

              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search.q ?? ""}
                  onChange={(e) => setSearch({ q: e.target.value || undefined })}
                  placeholder="Buscar por nome, empresa, CNPJ..."
                  className="h-9 w-80 border-border/70 bg-muted/30 pl-9 text-sm"
                />
              </div>

              {activeFilters > 0 && (
                <Button variant="ghost" size="sm" className="h-9 gap-1 text-muted-foreground" onClick={clearFilters}>
                  <X className="h-3.5 w-3.5" /> Limpar
                </Button>
              )}

              <span className="ml-auto text-xs text-muted-foreground">
                {fmtNumber(filtered.length)} de {fmtNumber(clients.length)}
              </span>
            </div>

            {isLoading ? (
              <LoadingState label="Carregando clientes..." />
            ) : filtered.length === 0 ? (
              <div className="py-16 text-center">
                <div className="mx-auto max-w-sm space-y-3">
                  <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-muted text-muted-foreground">
                    <Inbox className="h-5 w-5" />
                  </div>
                  <p className="font-display text-sm font-medium">
                    {activeFilters > 0 || clients.length > 0 ? "Nenhum cliente nesse filtro" : "Cadastre seu primeiro cliente"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {activeFilters > 0 || clients.length > 0
                      ? "Ajuste os filtros ou limpe a busca."
                      : "Clientes recebem rateio de custos das plataformas e fornecedores."}
                  </p>
                  {activeFilters > 0 ? (
                    <Button variant="outline" size="sm" onClick={clearFilters} className="gap-1.5">
                      <X className="h-3.5 w-3.5" /> Limpar filtros
                    </Button>
                  ) : (
                    <Button size="sm" onClick={openCreate} className="gap-1.5">
                      <Plus className="h-3.5 w-3.5" /> Novo cliente
                    </Button>
                  )}
                </div>
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {filtered.map((c) => {
                  const agg = costByClient.get(c.id) ?? { total: 0, count: 0 };
                  const platformCount = platformCountByClient.get(c.id) ?? 0;
                  return (
                    <ClientCard
                      key={c.id}
                      client={c}
                      totalBrl={agg.total}
                      entriesCount={agg.count}
                      platformCount={platformCount}
                      onEdit={() => openEdit(c)}
                      onToggle={() => toggleStatus.mutate(c)}
                      onDelete={() => {
                        if (confirm(`Excluir "${c.name}"? Custos associados perderão o vínculo.`)) remove.mutate(c.id);
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

function ClientCard({
  client,
  totalBrl,
  entriesCount,
  platformCount,
  onEdit,
  onToggle,
  onDelete,
}: {
  client: Client;
  totalBrl: number;
  entriesCount: number;
  platformCount: number;
  onEdit: () => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const active = client.status === "active";
  const color = colorFor(client.id || client.name);
  return (
    <Card className={`surface-elevated transition ${active ? "" : "opacity-70"}`}>
      <CardContent className="space-y-3 pt-5">
        <div className="flex items-start justify-between gap-3">
          <Link
            to="/clients/$id"
            params={{ id: client.id }}
            className="flex min-w-0 items-start gap-3 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <div
              className="grid h-10 w-10 shrink-0 place-items-center rounded-lg font-display text-sm font-semibold text-white shadow-sm"
              style={{ background: color }}
            >
              {initialsOf(client.name)}
            </div>
            <div className="min-w-0">
              <p className="truncate font-display text-sm font-semibold hover:underline">{client.name}</p>
              <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                {client.company ? (
                  <>
                    <Building2 className="h-3 w-3 shrink-0" />
                    <span className="truncate">{client.company}</span>
                  </>
                ) : (
                  <span className="text-[11px]">Sem empresa</span>
                )}
              </p>
            </div>
          </Link>
          {active ? (
            <Badge className="gap-1 bg-emerald-600/15 text-emerald-700 hover:bg-emerald-600/20 dark:text-emerald-400" variant="secondary">
              Ativo
            </Badge>
          ) : (
            <Badge variant="outline" className="border-border/60 text-muted-foreground">Inativo</Badge>
          )}
        </div>

        <div className="space-y-1.5 rounded-md border border-border/60 bg-muted/30 p-3 text-xs">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <BadgeCheck className="h-3.5 w-3.5" />
            <span className="font-numeric">{client.cnpj || "CNPJ não informado"}</span>
          </div>
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <UserCircle2 className="h-3.5 w-3.5" />
            <span className="truncate">{client.responsible || "Sem responsável"}</span>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 rounded-md border border-border/60 bg-muted/30 p-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Custo BRL</p>
            <p className="mt-0.5 font-numeric text-sm font-semibold">{fmtBRL(totalBrl)}</p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Lançamentos</p>
            <p className="mt-0.5 font-numeric text-sm font-medium">{fmtNumber(entriesCount)}</p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Plataformas</p>
            <p className="mt-0.5 font-numeric text-sm font-medium">{fmtNumber(platformCount)}</p>
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

function ClientDialog({
  editing,
  form,
  setForm,
  onSubmit,
  pending,
}: {
  editing: Client | null;
  form: any;
  setForm: (v: any) => void;
  onSubmit: () => void;
  pending: boolean;
}) {
  const color = colorFor(form.name || "cliente");
  const inputCls = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm";

  const setCnpj = (raw: string) => {
    const d = raw.replace(/\D/g, "").slice(0, 14);
    let out = d;
    if (d.length > 12) out = `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
    else if (d.length > 8) out = `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8)}`;
    else if (d.length > 5) out = `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5)}`;
    else if (d.length > 2) out = `${d.slice(0, 2)}.${d.slice(2)}`;
    setForm({ ...form, cnpj: out });
  };

  return (
    <DialogContent className="max-w-lg">
      <DialogHeader>
        <DialogTitle className="font-display">{editing ? "Editar cliente" : "Novo cliente"}</DialogTitle>
      </DialogHeader>

      <div className="mb-2 flex items-center gap-3 rounded-md border border-border/60 bg-muted/30 p-3">
        <div
          className="grid h-11 w-11 place-items-center rounded-lg font-display text-sm font-semibold text-white shadow-sm"
          style={{ background: color }}
        >
          {initialsOf(form.name || "?")}
        </div>
        <div className="min-w-0">
          <p className="truncate font-display text-sm font-semibold">{form.name || "Nome do cliente"}</p>
          <p className="truncate text-xs text-muted-foreground">
            {form.company || "Sem empresa"}
            {form.cnpj ? ` · ${form.cnpj}` : ""}
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
        <div className="col-span-2 space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Empresa</label>
          <input className={inputCls} value={form.company ?? ""} onChange={(e) => setForm({ ...form, company: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">CNPJ</label>
          <input
            className={`${inputCls} font-numeric`}
            value={form.cnpj ?? ""}
            onChange={(e) => setCnpj(e.target.value)}
            placeholder="00.000.000/0000-00"
            inputMode="numeric"
          />
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
          <label className="text-xs font-medium text-muted-foreground">Responsável</label>
          <input
            className={inputCls}
            value={form.responsible ?? ""}
            onChange={(e) => setForm({ ...form, responsible: e.target.value })}
            placeholder="Nome do contato principal"
          />
        </div>

        <DialogFooter className="col-span-2 mt-2">
          <Button type="submit" disabled={pending} className="gap-1.5">
            {pending ? "Salvando..." : editing ? "Salvar alterações" : "Criar cliente"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

