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
  ChevronLeft,
  ChevronRight,
  Wallet,
  Download,
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { KpiCard as Kpi, LoadingState } from "@/components/ui-kit";
import { fmtBRL, fmtDate, fmtUSD, fmtNumber } from "@/lib/format";

const PERIODS = ["7d", "30d", "90d", "month", "prev-month", "ytd", "all"] as const;
const ORIGINS = ["manual", "api", "import"] as const;
const PAGE_SIZES = [25, 50, 100, 200] as const;

const searchSchema = z.object({
  period: z.enum(PERIODS).catch("30d"),
  platform: z.string().optional().catch(undefined),
  provider: z.string().optional().catch(undefined),
  client: z.string().optional().catch(undefined),
  origin: z.enum(ORIGINS).optional().catch(undefined),
  q: z.string().optional().catch(undefined),
  page: z.coerce.number().int().min(1).catch(1),
  size: z.coerce.number().int().catch(50),
});

export const Route = createFileRoute("/_authenticated/costs")({
  head: () => ({ meta: [{ title: "Custos — LeFil Cost Center" }] }),
  validateSearch: searchSchema,
  component: CostsPage,
});

type Entry = {
  id: string;
  entry_date: string;
  cost_usd: number | null;
  cost_brl: number | null;
  usage_quantity: number | null;
  usage_unit: string | null;
  description: string | null;
  origin: string;
  provider_id: string | null;
  platform_id: string | null;
  client_id: string | null;
  exchange_rate: number | null;
  providers?: { name: string } | null;
  platforms?: { name: string; color: string | null } | null;
  clients?: { name: string } | null;
};

function periodStart(period: string): Date | null {
  const now = new Date();
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  switch (period) {
    case "7d":
      d.setDate(d.getDate() - 6);
      return d;
    case "30d":
      d.setDate(d.getDate() - 29);
      return d;
    case "90d":
      d.setDate(d.getDate() - 89);
      return d;
    case "month":
      return new Date(now.getFullYear(), now.getMonth(), 1);
    case "prev-month":
      return new Date(now.getFullYear(), now.getMonth() - 1, 1);
    case "ytd":
      return new Date(now.getFullYear(), 0, 1);
    case "all":
    default:
      return null;
  }
}

function periodEnd(period: string): Date | null {
  const now = new Date();
  if (period === "prev-month") return new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
  return null;
}

function CostsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate({ from: "/costs" });
  const search = Route.useSearch();

  const { data: dims } = useQuery({
    queryKey: ["cost-dims"],
    queryFn: async () => {
      const [{ data: p }, { data: pr }, { data: c }] = await Promise.all([
        supabase.from("platforms").select("id,name,color").order("name"),
        supabase.from("providers").select("id,name").order("name"),
        supabase.from("clients").select("id,name").order("name"),
      ]);
      return { platforms: p ?? [], providers: pr ?? [], clients: c ?? [] };
    },
  });

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["costs-all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cost_entries")
        .select("*, providers(name), platforms(name,color), clients(name)")
        .order("entry_date", { ascending: false })
        .limit(10000);
      if (error) throw error;
      return (data ?? []) as Entry[];
    },
  });

  const filtered = useMemo(() => {
    const start = periodStart(search.period);
    const end = periodEnd(search.period);
    const q = (search.q ?? "").toLowerCase().trim();
    return rows.filter((r) => {
      const d = new Date(r.entry_date);
      if (start && d < start) return false;
      if (end && d > end) return false;
      if (search.platform && r.platform_id !== search.platform) return false;
      if (search.provider && r.provider_id !== search.provider) return false;
      if (search.client && r.client_id !== search.client) return false;
      if (search.origin && r.origin !== search.origin) return false;
      if (q) {
        const hay = [
          r.description,
          r.providers?.name,
          r.platforms?.name,
          r.clients?.name,
          r.usage_unit,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, search]);

  const totals = useMemo(() => {
    const brl = filtered.reduce((a, r) => a + Number(r.cost_brl ?? 0), 0);
    const usd = filtered.reduce((a, r) => a + Number(r.cost_usd ?? 0), 0);
    return { brl, usd, count: filtered.length };
  }, [filtered]);

  const pageSize = search.size;
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const page = Math.min(search.page, totalPages);
  const paged = filtered.slice((page - 1) * pageSize, page * pageSize);

  const setSearch = (patch: Partial<z.infer<typeof searchSchema>>) => {
    navigate({ search: (prev: z.infer<typeof searchSchema>) => ({ ...prev, ...patch, page: patch.page ?? 1 }) });
  };

  const activeFilters =
    Number(!!search.platform) +
    Number(!!search.provider) +
    Number(!!search.client) +
    Number(!!search.origin) +
    Number(!!search.q) +
    Number(search.period !== "30d");

  const clearFilters = () =>
    navigate({
      search: { period: "30d", page: 1, size: search.size } as any,
    });

  // ---- form
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Entry | null>(null);
  const [form, setForm] = useState<any>({});

  const empty = () => ({
    entry_date: new Date().toISOString().slice(0, 10),
    provider_id: "",
    platform_id: "",
    client_id: "",
    description: "",
    usage_quantity: "",
    usage_unit: "",
    cost_usd: "",
    exchange_rate: "",
    origin: "manual",
  });

  const openCreate = () => {
    setEditing(null);
    setForm(empty());
    setOpen(true);
  };
  const openEdit = (r: Entry) => {
    setEditing(r);
    setForm({
      entry_date: r.entry_date,
      provider_id: r.provider_id ?? "",
      platform_id: r.platform_id ?? "",
      client_id: r.client_id ?? "",
      description: r.description ?? "",
      usage_quantity: r.usage_quantity ?? "",
      usage_unit: r.usage_unit ?? "",
      cost_usd: r.cost_usd ?? "",
      exchange_rate: r.exchange_rate ?? "",
      origin: r.origin,
    });
    setOpen(true);
  };

  const save = useMutation({
    mutationFn: async () => {
      const costUsd = Number(form.cost_usd || 0);
      const rate = Number(form.exchange_rate || 0);
      const payload = {
        entry_date: form.entry_date,
        provider_id: form.provider_id || null,
        platform_id: form.platform_id || null,
        client_id: form.client_id || null,
        description: form.description || null,
        usage_quantity: form.usage_quantity ? Number(form.usage_quantity) : null,
        usage_unit: form.usage_unit || null,
        cost_usd: costUsd,
        exchange_rate: rate || null,
        cost_brl: rate ? costUsd * rate : null,
        origin: form.origin,
      };
      if (editing) {
        const { error } = await supabase.from("cost_entries").update(payload).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("cost_entries").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(editing ? "Lançamento atualizado" : "Lançamento criado");
      qc.invalidateQueries({ queryKey: ["costs-all"] });
      qc.invalidateQueries({ queryKey: ["dashboard-entries"] });
      setOpen(false);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("cost_entries").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Removido");
      qc.invalidateQueries({ queryKey: ["costs-all"] });
      qc.invalidateQueries({ queryKey: ["dashboard-entries"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const exportCsv = () => {
    const header = ["data", "plataforma", "fornecedor", "cliente", "descrição", "quantidade", "unidade", "usd", "brl", "origem"];
    const lines = filtered.map((r) =>
      [
        r.entry_date,
        r.platforms?.name ?? "",
        r.providers?.name ?? "",
        r.clients?.name ?? "",
        (r.description ?? "").replace(/[\r\n";]/g, " "),
        r.usage_quantity ?? "",
        r.usage_unit ?? "",
        r.cost_usd ?? "",
        r.cost_brl ?? "",
        r.origin,
      ].map((v) => `"${String(v)}"`).join(";"),
    );
    const csv = [header.join(";"), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `custos-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const inputCls = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm";

  return (
    <AppShell
      eyebrow="Financeiro"
      title="Custos"
      actions={
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={exportCsv} className="gap-1.5" disabled={filtered.length === 0}>
            <Download className="h-4 w-4" /> Exportar
          </Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button onClick={openCreate} className="gap-1.5">
                <Plus className="h-4 w-4" /> Novo custo
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-xl">
              <DialogHeader>
                <DialogTitle className="font-display">
                  {editing ? "Editar lançamento" : "Novo lançamento"}
                </DialogTitle>
              </DialogHeader>
              <form
                className="grid grid-cols-2 gap-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  save.mutate();
                }}
              >
                <Field label="Data">
                  <input type="date" className={inputCls} value={form.entry_date ?? ""} onChange={(e) => setForm({ ...form, entry_date: e.target.value })} required />
                </Field>
                <Field label="Origem">
                  <select className={inputCls} value={form.origin ?? "manual"} onChange={(e) => setForm({ ...form, origin: e.target.value })}>
                    <option value="manual">Manual</option>
                    <option value="api">API</option>
                    <option value="import">Importação</option>
                  </select>
                </Field>
                <Field label="Plataforma">
                  <select className={inputCls} value={form.platform_id ?? ""} onChange={(e) => setForm({ ...form, platform_id: e.target.value })}>
                    <option value="">—</option>
                    {dims?.platforms.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </Field>
                <Field label="Fornecedor">
                  <select className={inputCls} value={form.provider_id ?? ""} onChange={(e) => setForm({ ...form, provider_id: e.target.value })}>
                    <option value="">—</option>
                    {dims?.providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </Field>
                <Field label="Cliente">
                  <select className={inputCls} value={form.client_id ?? ""} onChange={(e) => setForm({ ...form, client_id: e.target.value })}>
                    <option value="">—</option>
                    {dims?.clients.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </Field>
                <Field label="Quantidade">
                  <input type="number" step="any" className={inputCls} value={form.usage_quantity ?? ""} onChange={(e) => setForm({ ...form, usage_quantity: e.target.value })} />
                </Field>
                <Field label="Unidade">
                  <input className={inputCls} value={form.usage_unit ?? ""} onChange={(e) => setForm({ ...form, usage_unit: e.target.value })} placeholder="tokens, credits, GB..." />
                </Field>
                <Field label="Custo USD">
                  <input type="number" step="any" className={inputCls} value={form.cost_usd ?? ""} onChange={(e) => setForm({ ...form, cost_usd: e.target.value })} />
                </Field>
                <Field label="Cotação USD→BRL">
                  <input type="number" step="any" className={inputCls} value={form.exchange_rate ?? ""} onChange={(e) => setForm({ ...form, exchange_rate: e.target.value })} placeholder="ex.: 5.10" />
                </Field>
                <div className="col-span-2">
                  <Field label="Descrição">
                    <input className={inputCls} value={form.description ?? ""} onChange={(e) => setForm({ ...form, description: e.target.value })} />
                  </Field>
                </div>
                <DialogFooter className="col-span-2">
                  <Button type="submit" disabled={save.isPending}>Salvar</Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      }
    >
      <div className="space-y-6">
        {/* KPIs */}
        <div className="grid gap-3 md:grid-cols-3">
          <Kpi label="Total BRL" value={fmtBRL(totals.brl)} icon={<Wallet className="h-4 w-4" />} />
          <Kpi label="Total USD" value={fmtUSD(totals.usd)} />
          <Kpi label="Lançamentos" value={fmtNumber(totals.count)} />
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

              <Select value={search.period} onValueChange={(v) => setSearch({ period: v as any })}>
                <SelectTrigger className="h-9 w-[140px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="7d">Últimos 7 dias</SelectItem>
                  <SelectItem value="30d">Últimos 30 dias</SelectItem>
                  <SelectItem value="90d">Últimos 90 dias</SelectItem>
                  <SelectItem value="month">Mês atual</SelectItem>
                  <SelectItem value="prev-month">Mês anterior</SelectItem>
                  <SelectItem value="ytd">Ano atual</SelectItem>
                  <SelectItem value="all">Tudo</SelectItem>
                </SelectContent>
              </Select>

              <Select value={search.platform ?? "__all"} onValueChange={(v) => setSearch({ platform: v === "__all" ? undefined : v })}>
                <SelectTrigger className="h-9 w-[170px]"><SelectValue placeholder="Plataforma" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all">Todas plataformas</SelectItem>
                  {dims?.platforms.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>

              <Select value={search.provider ?? "__all"} onValueChange={(v) => setSearch({ provider: v === "__all" ? undefined : v })}>
                <SelectTrigger className="h-9 w-[170px]"><SelectValue placeholder="Fornecedor" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all">Todos fornecedores</SelectItem>
                  {dims?.providers.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>

              <Select value={search.client ?? "__all"} onValueChange={(v) => setSearch({ client: v === "__all" ? undefined : v })}>
                <SelectTrigger className="h-9 w-[170px]"><SelectValue placeholder="Cliente" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all">Todos clientes</SelectItem>
                  {dims?.clients.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>

              <Select value={search.origin ?? "__all"} onValueChange={(v) => setSearch({ origin: v === "__all" ? undefined : (v as any) })}>
                <SelectTrigger className="h-9 w-[140px]"><SelectValue placeholder="Origem" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all">Todas origens</SelectItem>
                  <SelectItem value="manual">Manual</SelectItem>
                  <SelectItem value="api">API</SelectItem>
                  <SelectItem value="import">Importação</SelectItem>
                </SelectContent>
              </Select>

              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search.q ?? ""}
                  onChange={(e) => setSearch({ q: e.target.value || undefined })}
                  placeholder="Buscar descrição..."
                  className="h-9 w-56 border-border/70 bg-muted/30 pl-9 text-sm"
                />
              </div>

              {activeFilters > 0 && (
                <Button variant="ghost" size="sm" className="h-9 gap-1 text-muted-foreground" onClick={clearFilters}>
                  <X className="h-3.5 w-3.5" /> Limpar
                </Button>
              )}
            </div>

            <div className="overflow-hidden rounded-lg border border-border/60">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Data</TableHead>
                    <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Plataforma</TableHead>
                    <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Fornecedor</TableHead>
                    <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Cliente</TableHead>
                    <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Descrição</TableHead>
                    <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Origem</TableHead>
                    <TableHead className="text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">USD</TableHead>
                    <TableHead className="text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">BRL</TableHead>
                    <TableHead className="w-24" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading && (
                    <TableRow>
                      <TableCell colSpan={9} className="p-0">
                        <LoadingState label="Carregando lançamentos..." />
                      </TableCell>
                    </TableRow>
                  )}
                  {!isLoading && filtered.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={9} className="py-16 text-center">
                        <div className="mx-auto max-w-sm space-y-3">
                          <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-muted text-muted-foreground">
                            <Inbox className="h-5 w-5" />
                          </div>
                          <p className="font-display text-sm font-medium">
                            {activeFilters > 0 || rows.length > 0 ? "Nenhum lançamento nesse filtro" : "Ainda sem lançamentos"}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {activeFilters > 0 || rows.length > 0
                              ? "Ajuste o período ou limpe os filtros para ver mais resultados."
                              : "Crie o primeiro custo manualmente ou importe uma sincronização."}
                          </p>
                          {activeFilters > 0 ? (
                            <Button variant="outline" size="sm" onClick={clearFilters} className="gap-1.5">
                              <X className="h-3.5 w-3.5" /> Limpar filtros
                            </Button>
                          ) : (
                            <Button size="sm" onClick={openCreate} className="gap-1.5">
                              <Plus className="h-3.5 w-3.5" /> Novo custo
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                  {paged.map((c) => (
                    <TableRow key={c.id} className="border-border/50">
                      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">{fmtDate(c.entry_date)}</TableCell>
                      <TableCell className="text-sm">
                        {c.platforms ? (
                          <span className="inline-flex items-center gap-2">
                            <span className="h-2 w-2 rounded-full" style={{ background: c.platforms.color ?? "var(--color-gold)" }} />
                            {c.platforms.name}
                          </span>
                        ) : "—"}
                      </TableCell>
                      <TableCell className="text-sm">{c.providers?.name ?? "—"}</TableCell>
                      <TableCell className="text-sm">{c.clients?.name ?? "—"}</TableCell>
                      <TableCell className="max-w-xs truncate text-sm text-muted-foreground">{c.description ?? "—"}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="border-border/60 font-normal capitalize">{c.origin}</Badge>
                      </TableCell>
                      <TableCell className="text-right font-numeric text-sm">{fmtUSD(c.cost_usd)}</TableCell>
                      <TableCell className="text-right font-numeric text-sm font-medium">{fmtBRL(c.cost_brl)}</TableCell>
                      <TableCell className="text-right">
                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => openEdit(c)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 hover:text-destructive"
                          onClick={() => { if (confirm("Excluir lançamento?")) remove.mutate(c.id); }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Pagination */}
            {filtered.length > 0 && (
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
                <div>
                  Mostrando <span className="font-medium text-foreground">{(page - 1) * pageSize + 1}</span>–
                  <span className="font-medium text-foreground">{Math.min(page * pageSize, filtered.length)}</span> de{" "}
                  <span className="font-medium text-foreground">{fmtNumber(filtered.length)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span>Por página</span>
                  <Select value={String(pageSize)} onValueChange={(v) => setSearch({ size: Number(v), page: 1 })}>
                    <SelectTrigger className="h-8 w-[80px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PAGE_SIZES.map((s) => <SelectItem key={s} value={String(s)}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <div className="ml-3 flex items-center gap-1">
                    <Button variant="outline" size="icon" className="h-8 w-8" disabled={page <= 1} onClick={() => setSearch({ page: page - 1 })}>
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="px-2 font-medium text-foreground">
                      {page} / {totalPages}
                    </span>
                    <Button variant="outline" size="icon" className="h-8 w-8" disabled={page >= totalPages} onClick={() => setSearch({ page: page + 1 })}>
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}


function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}
