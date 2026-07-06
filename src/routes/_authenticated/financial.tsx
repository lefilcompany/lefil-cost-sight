import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  TrendingUp,
  TrendingDown,
  Factory,
  Cog,
  Users,
  Layers,
  Filter,
  X,
  Pin,
  Plus,
  Trash2,
  Lightbulb,
  Radio,
} from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { KpiCard, EmptyState, LoadingState } from "@/components/ui-kit";
import { supabase } from "@/integrations/supabase/client";
import { fmtBRL, fmtDate, fmtDateTime } from "@/lib/format";
import { toast } from "sonner";

const PERIODS = ["7d", "30d", "90d", "month", "prev-month", "ytd"] as const;
type Period = (typeof PERIODS)[number];

const searchSchema = z.object({
  period: z.enum(PERIODS).catch("30d"),
  platform: z.string().optional().catch(undefined),
  client: z.string().optional().catch(undefined),
  provider: z.string().optional().catch(undefined),
  env: z.enum(["all", "production", "internal"]).catch("all"),
});

export const Route = createFileRoute("/_authenticated/financial")({
  head: () => ({ meta: [{ title: "Painel financeiro — Quiui Cost Center" }] }),
  validateSearch: searchSchema,
  component: FinancialDashboard,
});

type Entry = {
  id: string;
  entry_date: string;
  cost_brl: number | null;
  cost_usd: number | null;
  description: string | null;
  provider_id: string | null;
  platform_id: string | null;
  client_id: string | null;
  providers?: { name: string } | null;
  platforms?: { name: string; color: string; environment: string } | null;
  clients?: { name: string } | null;
};

type Note = {
  id: string;
  title: string;
  body: string | null;
  pinned: boolean;
  author_id: string | null;
  created_at: string;
  updated_at: string;
};

async function fetchAll() {
  const { data, error } = await supabase
    .from("cost_entries")
    .select("*, providers(name), platforms(name,color,environment), clients(name)")
    .order("entry_date", { ascending: false })
    .limit(5000);
  if (error) throw error;
  return (data ?? []) as Entry[];
}

async function fetchDims() {
  const [{ data: p }, { data: c }, { data: pr }] = await Promise.all([
    supabase.from("platforms").select("id,name,color,environment").order("name"),
    supabase.from("clients").select("id,name").order("name"),
    supabase.from("providers").select("id,name").order("name"),
  ]);
  return { platforms: p ?? [], clients: c ?? [], providers: pr ?? [] };
}

async function fetchNotes() {
  const { data, error } = await supabase
    .from("dashboard_notes")
    .select("*")
    .order("pinned", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Note[];
}

function periodRange(period: Period) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const end = new Date(today);
  const start = new Date(today);
  let label = "";

  if (period === "7d") { start.setDate(end.getDate() - 6); label = "Últimos 7 dias"; }
  else if (period === "30d") { start.setDate(end.getDate() - 29); label = "Últimos 30 dias"; }
  else if (period === "90d") { start.setDate(end.getDate() - 89); label = "Últimos 90 dias"; }
  else if (period === "month") { start.setDate(1); label = "Mês atual"; }
  else if (period === "prev-month") { start.setMonth(end.getMonth() - 1, 1); end.setDate(0); label = "Mês anterior"; }
  else { start.setMonth(0, 1); label = "Ano até hoje"; }

  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  const prevEnd = new Date(start);
  prevEnd.setDate(prevEnd.getDate() - 1);
  const prevStart = new Date(prevEnd);
  prevStart.setDate(prevStart.getDate() - (days - 1));
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { start: iso(start), end: iso(end), prevStart: iso(prevStart), prevEnd: iso(prevEnd), label };
}

function FinancialDashboard() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const qc = useQueryClient();

  const { data: entries = [], isLoading } = useQuery({ queryKey: ["fin-entries"], queryFn: fetchAll });
  const { data: dims } = useQuery({ queryKey: ["fin-dims"], queryFn: fetchDims });
  const { data: notes = [] } = useQuery({ queryKey: ["dashboard-notes"], queryFn: fetchNotes });

  // Realtime: refetch when cost_entries or provider_usage_syncs change.
  useEffect(() => {
    const channel = supabase
      .channel("financial-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "cost_entries" }, () => {
        qc.invalidateQueries({ queryKey: ["fin-entries"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "provider_usage_syncs" }, () => {
        qc.invalidateQueries({ queryKey: ["fin-entries"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "dashboard_notes" }, () => {
        qc.invalidateQueries({ queryKey: ["dashboard-notes"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [qc]);

  const range = useMemo(() => periodRange(search.period), [search.period]);

  const filtered = useMemo(() => entries.filter((e) => {
    if (search.platform && e.platform_id !== search.platform) return false;
    if (search.client && e.client_id !== search.client) return false;
    if (search.provider && e.provider_id !== search.provider) return false;
    if (search.env !== "all") {
      const env = e.platforms?.environment ?? "production";
      if (env !== search.env) return false;
    }
    return true;
  }), [entries, search]);

  const inRange = useMemo(
    () => filtered.filter((e) => e.entry_date >= range.start && e.entry_date <= range.end),
    [filtered, range],
  );
  const inPrev = useMemo(
    () => filtered.filter((e) => e.entry_date >= range.prevStart && e.entry_date <= range.prevEnd),
    [filtered, range],
  );

  const sum = (arr: Entry[]) => arr.reduce((s, e) => s + Number(e.cost_brl ?? 0), 0);
  const totalCurr = sum(inRange);
  const totalPrev = sum(inPrev);
  const delta = totalPrev > 0 ? ((totalCurr - totalPrev) / totalPrev) * 100 : totalCurr > 0 ? 100 : 0;

  const prodTotal = sum(inRange.filter((e) => (e.platforms?.environment ?? "production") === "production"));
  const intTotal = sum(inRange.filter((e) => e.platforms?.environment === "internal"));

  const topClients = useMemo(() => {
    const map = new Map<string, { name: string; value: number }>();
    for (const e of inRange) {
      const name = e.clients?.name ?? "Sem cliente";
      const key = e.client_id ?? "none";
      const prev = map.get(key) ?? { name, value: 0 };
      prev.value += Number(e.cost_brl ?? 0);
      map.set(key, prev);
    }
    return Array.from(map.values()).sort((a, b) => b.value - a.value).slice(0, 5);
  }, [inRange]);

  const byPlatform = useMemo(() => {
    const map = new Map<string, { name: string; value: number; color?: string; env: string }>();
    for (const e of inRange) {
      const name = e.platforms?.name ?? "—";
      const prev = map.get(name) ?? { name, value: 0, color: e.platforms?.color, env: e.platforms?.environment ?? "production" };
      prev.value += Number(e.cost_brl ?? 0);
      map.set(name, prev);
    }
    return Array.from(map.values()).sort((a, b) => b.value - a.value);
  }, [inRange]);

  const internalPlatforms = useMemo(
    () => byPlatform.filter((p) => p.env === "internal"),
    [byPlatform],
  );

  // Insights
  const insights = useMemo(() => {
    const items: { title: string; body: string; tone: "good" | "warn" | "bad" | "neutral" }[] = [];
    if (totalPrev > 0) {
      const varPct = ((totalCurr - totalPrev) / totalPrev) * 100;
      if (Math.abs(varPct) >= 15) {
        items.push({
          title: varPct > 0 ? "Aumento relevante de custos" : "Redução relevante de custos",
          body: `Variação de ${varPct > 0 ? "+" : ""}${varPct.toFixed(1)}% vs. período anterior (${fmtBRL(totalPrev)} → ${fmtBRL(totalCurr)}).`,
          tone: varPct > 0 ? "bad" : "good",
        });
      }
    }
    // Cliente com maior participação
    if (topClients[0] && totalCurr > 0) {
      const share = (topClients[0].value / totalCurr) * 100;
      if (share >= 30) {
        items.push({
          title: `${topClients[0].name} concentra ${share.toFixed(0)}% do custo`,
          body: `Custo de ${fmtBRL(topClients[0].value)} no período — considere revisar a alocação.`,
          tone: "warn",
        });
      }
    }
    // Plataformas sem consumo há 30 dias
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    const cutoffIso = cutoff.toISOString().slice(0, 10);
    const activePlatformIds = new Set(entries.filter((e) => e.entry_date >= cutoffIso).map((e) => e.platform_id));
    const idle = (dims?.platforms ?? []).filter((p: any) => !activePlatformIds.has(p.id));
    if (idle.length > 0) {
      items.push({
        title: `${idle.length} plataforma(s) sem consumo há 30 dias`,
        body: idle.slice(0, 3).map((p: any) => p.name).join(", ") + (idle.length > 3 ? "…" : ""),
        tone: "neutral",
      });
    }
    return items;
  }, [totalCurr, totalPrev, topClients, entries, dims]);

  const setSearch = (patch: Partial<z.infer<typeof searchSchema>>) =>
    navigate({ search: (prev: any) => ({ ...prev, ...patch }) });

  const hasFilters = !!(search.platform || search.client || search.provider || search.env !== "all");
  const chartColors = ["var(--color-chart-1)", "var(--color-chart-2)", "var(--color-chart-3)", "var(--color-chart-4)", "var(--color-chart-5)"];

  return (
    <AppShell
      eyebrow={`Financeiro · ${range.label}`}
      title="Dashboard financeiro"
      actions={
        <div className="hidden items-center gap-2 rounded-full border border-border/70 bg-muted/30 px-3 py-1.5 text-[11px] text-muted-foreground sm:flex">
          <Radio className="h-3 w-3 animate-pulse text-emerald-500" />
          Tempo real ativo
        </div>
      }
    >
      <div className="space-y-8">
        {/* Filters */}
        <Card className="surface-elevated">
          <CardContent className="flex flex-wrap items-center gap-3 p-4">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              <Filter className="h-3.5 w-3.5" /> Filtros
            </div>
            <Select value={search.period} onValueChange={(v) => setSearch({ period: v as Period })}>
              <SelectTrigger className="h-9 w-[170px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="7d">Últimos 7 dias</SelectItem>
                <SelectItem value="30d">Últimos 30 dias</SelectItem>
                <SelectItem value="90d">Últimos 90 dias</SelectItem>
                <SelectItem value="month">Mês atual</SelectItem>
                <SelectItem value="prev-month">Mês anterior</SelectItem>
                <SelectItem value="ytd">Ano até hoje</SelectItem>
              </SelectContent>
            </Select>
            <Select value={search.env} onValueChange={(v) => setSearch({ env: v as any })}>
              <SelectTrigger className="h-9 w-[160px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos ambientes</SelectItem>
                <SelectItem value="production">Produção</SelectItem>
                <SelectItem value="internal">Uso interno</SelectItem>
              </SelectContent>
            </Select>
            <Select value={search.client ?? "all"} onValueChange={(v) => setSearch({ client: v === "all" ? undefined : v })}>
              <SelectTrigger className="h-9 w-[170px]"><SelectValue placeholder="Cliente" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos clientes</SelectItem>
                {dims?.clients.map((c: any) => (<SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>))}
              </SelectContent>
            </Select>
            <Select value={search.platform ?? "all"} onValueChange={(v) => setSearch({ platform: v === "all" ? undefined : v })}>
              <SelectTrigger className="h-9 w-[170px]"><SelectValue placeholder="Plataforma" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas plataformas</SelectItem>
                {dims?.platforms.map((p: any) => (<SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>))}
              </SelectContent>
            </Select>
            <Select value={search.provider ?? "all"} onValueChange={(v) => setSearch({ provider: v === "all" ? undefined : v })}>
              <SelectTrigger className="h-9 w-[170px]"><SelectValue placeholder="Fornecedor" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos fornecedores</SelectItem>
                {dims?.providers.map((p: any) => (<SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>))}
              </SelectContent>
            </Select>
            {hasFilters && (
              <Button variant="ghost" size="sm" className="h-9 gap-1.5 text-xs"
                onClick={() => setSearch({ platform: undefined, client: undefined, provider: undefined, env: "all" })}>
                <X className="h-3.5 w-3.5" /> Limpar
              </Button>
            )}
          </CardContent>
        </Card>

        {/* KPIs */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <KpiCard
            label="Custo total"
            value={fmtBRL(totalCurr)}
            sub={`${delta >= 0 ? "+" : ""}${delta.toFixed(1)}% vs. período anterior`}
            icon={delta >= 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
            tone={delta > 15 ? "bad" : delta < -5 ? "good" : "neutral"}
          />
          <KpiCard label="Produção" value={fmtBRL(prodTotal)}
            sub={totalCurr > 0 ? `${((prodTotal / totalCurr) * 100).toFixed(0)}% do total` : "—"}
            icon={<Factory className="h-4 w-4" />} />
          <KpiCard label="Uso interno" value={fmtBRL(intTotal)}
            sub={totalCurr > 0 ? `${((intTotal / totalCurr) * 100).toFixed(0)}% do total` : "—"}
            icon={<Cog className="h-4 w-4" />} tone="warn" />
          <KpiCard label="Clientes ativos" value={String(topClients.length)}
            sub={topClients[0] ? `Top: ${topClients[0].name}` : "Nenhum cliente com custo"}
            icon={<Users className="h-4 w-4" />} />
        </div>

        {/* Insights + Notes */}
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="surface-elevated lg:col-span-2">
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                <Lightbulb className="h-4 w-4 text-[color:var(--color-gold)]" /> Insights automáticos
              </CardTitle>
              <span className="text-[11px] text-muted-foreground">{insights.length} sinal(is)</span>
            </CardHeader>
            <CardContent>
              {insights.length === 0 ? (
                <EmptyState title="Sem sinais no período" description="Nenhuma variação relevante detectada." />
              ) : (
                <div className="space-y-2">
                  {insights.map((i, idx) => (
                    <div key={idx} className="rounded-lg border border-border/70 bg-muted/20 p-3">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-[13px] font-medium">{i.title}</p>
                        <Badge variant={i.tone === "bad" ? "destructive" : i.tone === "good" ? "default" : "secondary"} className="text-[10px]">
                          {i.tone === "bad" ? "Atenção" : i.tone === "good" ? "Positivo" : "Info"}
                        </Badge>
                      </div>
                      <p className="mt-1 text-[12px] text-muted-foreground">{i.body}</p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <NotesPanel notes={notes} />
        </div>

        {/* Consumo por cliente */}
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="surface-elevated">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                <Users className="h-4 w-4" /> Top 5 clientes
              </CardTitle>
            </CardHeader>
            <CardContent>
              {topClients.length === 0 ? (
                <EmptyState title="Sem custos por cliente" />
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={topClients} layout="vertical" margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
                    <CartesianGrid strokeDasharray="2 4" stroke="var(--color-border)" horizontal={false} />
                    <XAxis type="number" stroke="var(--color-muted-foreground)" fontSize={11} tickLine={false} axisLine={false} />
                    <YAxis type="category" dataKey="name" stroke="var(--color-muted-foreground)" fontSize={11} tickLine={false} axisLine={false} width={120} />
                    <Tooltip formatter={(v: number) => fmtBRL(v)} contentStyle={tooltipStyle} cursor={{ fill: "var(--color-muted)" }} />
                    <Bar dataKey="value" fill="var(--color-primary)" radius={[0, 6, 6, 0]} maxBarSize={26} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card className="surface-elevated">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                <Layers className="h-4 w-4" /> Consumo por plataforma
              </CardTitle>
            </CardHeader>
            <CardContent>
              {byPlatform.length === 0 ? (
                <EmptyState title="Sem custos por plataforma" />
              ) : (
                <>
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie data={byPlatform} dataKey="value" nameKey="name" innerRadius={50} outerRadius={85} paddingAngle={3} stroke="var(--color-background)" strokeWidth={2}>
                        {byPlatform.map((d, i) => (
                          <Cell key={i} fill={d.color ?? chartColors[i % chartColors.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v: number) => fmtBRL(v)} contentStyle={tooltipStyle} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="mt-3 space-y-1.5 max-h-28 overflow-y-auto pr-1">
                    {byPlatform.slice(0, 6).map((p, i) => (
                      <button
                        key={p.name}
                        onClick={() => {
                          const found = dims?.platforms.find((x: any) => x.name === p.name);
                          if (found) setSearch({ platform: found.id });
                        }}
                        className="flex w-full items-center justify-between rounded-md px-2 py-1 text-[12px] hover:bg-muted/40"
                      >
                        <span className="flex items-center gap-2">
                          <span className="h-2 w-2 rounded-full" style={{ background: p.color ?? chartColors[i % chartColors.length] }} />
                          <span className="text-muted-foreground">{p.name}</span>
                          <Badge variant={p.env === "internal" ? "secondary" : "outline"} className="h-4 px-1.5 text-[9px]">
                            {p.env === "internal" ? "interno" : "produção"}
                          </Badge>
                        </span>
                        <span className="font-numeric text-foreground">{fmtBRL(p.value)}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Uso interno isolado */}
        {internalPlatforms.length > 0 && (
          <Card className="surface-elevated">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                <Cog className="h-4 w-4" /> Uso interno
                <Badge variant="secondary" className="ml-2 text-[10px]">{fmtBRL(intTotal)}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
                {internalPlatforms.map((p) => (
                  <div key={p.name} className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/20 p-3">
                    <div className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: p.color ?? "var(--color-chart-3)" }} />
                      <span className="text-[13px] font-medium">{p.name}</span>
                    </div>
                    <span className="font-numeric text-[13px]">{fmtBRL(p.value)}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Consumo detalhado */}
        <Card className="surface-elevated">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-semibold">Consumo detalhado</CardTitle>
            <span className="text-[11px] text-muted-foreground">{inRange.length} lançamento(s)</span>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <LoadingState />
            ) : inRange.length === 0 ? (
              <EmptyState title="Sem lançamentos no período" description="Ajuste os filtros ou registre novos custos." />
            ) : (
              <div className="max-h-[420px] overflow-auto rounded-md border border-border/60">
                <Table>
                  <TableHeader className="sticky top-0 bg-background">
                    <TableRow>
                      <TableHead>Data</TableHead>
                      <TableHead>Cliente</TableHead>
                      <TableHead>Plataforma</TableHead>
                      <TableHead>Fornecedor</TableHead>
                      <TableHead>Descrição</TableHead>
                      <TableHead className="text-right">Custo</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {inRange.slice(0, 300).map((e) => (
                      <TableRow key={e.id}>
                        <TableCell className="whitespace-nowrap text-xs">{fmtDate(e.entry_date)}</TableCell>
                        <TableCell className="text-xs">{e.clients?.name ?? "—"}</TableCell>
                        <TableCell className="text-xs">
                          <span className="inline-flex items-center gap-1.5">
                            <span className="h-2 w-2 rounded-full" style={{ background: e.platforms?.color ?? "var(--color-muted-foreground)" }} />
                            {e.platforms?.name ?? "—"}
                          </span>
                        </TableCell>
                        <TableCell className="text-xs">{e.providers?.name ?? "—"}</TableCell>
                        <TableCell className="max-w-[260px] truncate text-xs text-muted-foreground">{e.description ?? "—"}</TableCell>
                        <TableCell className="text-right font-numeric text-xs">{fmtBRL(e.cost_brl)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

const tooltipStyle = {
  background: "var(--color-popover)",
  border: "1px solid var(--color-border)",
  borderRadius: "8px",
  fontSize: "12px",
  color: "var(--color-popover-foreground)",
};

function NotesPanel({ notes }: { notes: Note[] }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: "", body: "", pinned: false });

  const create = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase.from("dashboard_notes").insert({
        title: form.title,
        body: form.body || null,
        pinned: form.pinned,
        author_id: user?.id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Anotação criada");
      setOpen(false);
      setForm({ title: "", body: "", pinned: false });
      qc.invalidateQueries({ queryKey: ["dashboard-notes"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Erro ao criar. Verifique se você é admin."),
  });

  const togglePin = useMutation({
    mutationFn: async (n: Note) => {
      const { error } = await supabase.from("dashboard_notes").update({ pinned: !n.pinned }).eq("id", n.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["dashboard-notes"] }),
    onError: (e: any) => toast.error(e.message ?? "Erro"),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("dashboard_notes").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Anotação removida");
      qc.invalidateQueries({ queryKey: ["dashboard-notes"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Erro"),
  });

  return (
    <Card className="surface-elevated">
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-sm font-semibold">Comentários & anotações</CardTitle>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline" className="h-7 gap-1 text-xs">
              <Plus className="h-3 w-3" /> Nova
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Nova anotação</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium">Título</label>
                <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Ex.: Pico Firecrawl em outubro" />
              </div>
              <div>
                <label className="text-xs font-medium">Comentário</label>
                <Textarea rows={5} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} placeholder="Contexto, causa raiz, próximos passos…" />
              </div>
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={form.pinned} onChange={(e) => setForm({ ...form, pinned: e.target.checked })} />
                Fixar no topo
              </label>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
              <Button disabled={!form.title || create.isPending} onClick={() => create.mutate()}>Salvar</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {notes.length === 0 ? (
          <EmptyState title="Sem anotações" description="Registre observações do time sobre custos." />
        ) : (
          <div className="max-h-[320px] space-y-2 overflow-y-auto pr-1">
            {notes.map((n) => (
              <div key={n.id} className="rounded-lg border border-border/60 bg-muted/10 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 text-[13px] font-medium">
                      {n.pinned && <Pin className="h-3 w-3 text-[color:var(--color-gold)]" />}
                      {n.title}
                    </p>
                    {n.body && <p className="mt-1 whitespace-pre-wrap text-[12px] text-muted-foreground">{n.body}</p>}
                    <p className="mt-1 text-[10px] text-muted-foreground">{fmtDateTime(n.created_at)}</p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => togglePin.mutate(n)} title={n.pinned ? "Desafixar" : "Fixar"}>
                      <Pin className={`h-3 w-3 ${n.pinned ? "text-[color:var(--color-gold)]" : ""}`} />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive" onClick={() => remove.mutate(n.id)} title="Remover">
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
