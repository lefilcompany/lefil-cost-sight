import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { z } from "zod";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { TrendingUp, TrendingDown, Crown, Truck, Users, ArrowUpRight, Zap, Filter, X } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { fmtBRL, fmtDate } from "@/lib/format";
import { useAutoSync } from "@/hooks/use-auto-sync";


const PERIODS = ["7d", "30d", "90d", "month", "prev-month", "ytd"] as const;
type Period = (typeof PERIODS)[number];

const searchSchema = z.object({
  period: z.enum(PERIODS).catch("30d"),
  platform: z.string().optional().catch(undefined),
  client: z.string().optional().catch(undefined),
  provider: z.string().optional().catch(undefined),
});

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Painel geral — Quiwi Cost Center" }] }),
  validateSearch: searchSchema,
  component: Dashboard,
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
  platforms?: { name: string; color: string } | null;
  clients?: { name: string } | null;
};

async function fetchAll() {
  const { data, error } = await supabase
    .from("cost_entries")
    .select("*, providers(name), platforms(name,color), clients(name)")
    .order("entry_date", { ascending: false })
    .limit(5000);
  if (error) throw error;
  return (data ?? []) as Entry[];
}

async function fetchDims() {
  const [{ data: p }, { data: c }, { data: pr }] = await Promise.all([
    supabase.from("platforms").select("id,name,color").order("name"),
    supabase.from("clients").select("id,name").order("name"),
    supabase.from("providers").select("id,name").order("name"),
  ]);
  return { platforms: p ?? [], clients: c ?? [], providers: pr ?? [] };
}

function periodRange(period: Period): { start: string; end: string; prevStart: string; prevEnd: string; label: string } {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const end = new Date(today);
  const start = new Date(today);
  let label = "";

  if (period === "7d") {
    start.setDate(end.getDate() - 6);
    label = "Últimos 7 dias";
  } else if (period === "30d") {
    start.setDate(end.getDate() - 29);
    label = "Últimos 30 dias";
  } else if (period === "90d") {
    start.setDate(end.getDate() - 89);
    label = "Últimos 90 dias";
  } else if (period === "month") {
    start.setDate(1);
    label = "Mês atual";
  } else if (period === "prev-month") {
    start.setMonth(end.getMonth() - 1, 1);
    end.setDate(0);
    label = "Mês anterior";
  } else {
    start.setMonth(0, 1);
    label = "Ano até hoje";
  }

  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  const prevEnd = new Date(start);
  prevEnd.setDate(prevEnd.getDate() - 1);
  const prevStart = new Date(prevEnd);
  prevStart.setDate(prevStart.getDate() - (days - 1));

  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { start: iso(start), end: iso(end), prevStart: iso(prevStart), prevEnd: iso(prevEnd), label };
}

function Dashboard() {
  useAutoSync(["dashboard-entries", "dashboard-dims"]);
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { data: entries = [], isLoading } = useQuery({ queryKey: ["dashboard-entries"], queryFn: fetchAll });
  const { data: dims } = useQuery({ queryKey: ["dashboard-dims"], queryFn: fetchDims });
  const { data: usageDaily = [] } = useQuery({
    queryKey: ["dashboard-usage-daily"],
    queryFn: async () => {
      const since = new Date();
      since.setDate(since.getDate() - 120);
      const { data, error } = await supabase
        .from("provider_usage_daily")
        .select("usage_date, model, endpoint, cost_usd, cost_brl, providers(name)")
        .gte("usage_date", since.toISOString().slice(0, 10))
        .order("usage_date", { ascending: false })
        .limit(10000);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });


  const range = useMemo(() => periodRange(search.period), [search.period]);

  const filtered = useMemo(() => {
    return entries.filter((e) => {
      if (search.platform && e.platform_id !== search.platform) return false;
      if (search.client && e.client_id !== search.client) return false;
      if (search.provider && e.provider_id !== search.provider) return false;
      return true;
    });
  }, [entries, search.platform, search.client, search.provider]);

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
  const avgDay = inRange.length ? totalCurr / new Set(inRange.map((e) => e.entry_date)).size : 0;

  const today = new Date().toISOString().slice(0, 10);
  const costToday = sum(filtered.filter((e) => e.entry_date === today));

  const byGroup = (key: "platforms" | "providers" | "clients") => {
    const map = new Map<string, { name: string; value: number; color?: string }>();
    for (const e of inRange) {
      const obj = e[key];
      const name = obj?.name ?? "—";
      const prev = map.get(name) ?? { name, value: 0, color: (obj as any)?.color };
      prev.value += Number(e.cost_brl ?? 0);
      map.set(name, prev);
    }
    return Array.from(map.values()).sort((a, b) => b.value - a.value);
  };

  const byPlatform = byGroup("platforms");
  const byProvider = byGroup("providers");
  const byClient = byGroup("clients");

  const topPlatform = byPlatform[0]?.name ?? "—";
  const topProvider = byProvider[0]?.name ?? "—";
  const topClient = byClient[0]?.name ?? "—";

  // Daily series across the selected range
  const dailySeries = useMemo(() => {
    const map = new Map<string, number>();
    const s = new Date(range.start);
    const e = new Date(range.end);
    for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
      map.set(d.toISOString().slice(0, 10), 0);
    }
    for (const en of inRange) {
      if (map.has(en.entry_date)) map.set(en.entry_date, (map.get(en.entry_date) ?? 0) + Number(en.cost_brl ?? 0));
    }
    return Array.from(map.entries()).map(([date, value]) => ({ date: date.slice(5), value }));
  }, [inRange, range]);

  // Monthly series — last 6 months relative to today, always
  const monthlySeries = useMemo(() => {
    const map = new Map<string, number>();
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      map.set(d.toISOString().slice(0, 7), 0);
    }
    for (const en of filtered) {
      const m = en.entry_date.slice(0, 7);
      if (map.has(m)) map.set(m, (map.get(m) ?? 0) + Number(en.cost_brl ?? 0));
    }
    return Array.from(map.entries()).map(([month, value]) => ({ month, value }));
  }, [filtered]);

  const chartColors = [
    "var(--color-chart-1)",
    "var(--color-chart-2)",
    "var(--color-chart-3)",
    "var(--color-chart-4)",
    "var(--color-chart-5)",
  ];

  const setSearch = (patch: Partial<z.infer<typeof searchSchema>>) =>
    navigate({ search: (prev: any) => ({ ...prev, ...patch }) });

  const modelBreakdown = useMemo(() => {
    const inWindow = usageDaily.filter((u: any) => u.usage_date >= range.start && u.usage_date <= range.end && u.model !== "__project__");
    const map = new Map<string, { provider: string; model: string; type: string; costBrl: number; costUsd: number }>();
    for (const u of inWindow) {
      const provider = u.providers?.name ?? "—";
      const model = u.model ?? "—";
      const type = u.endpoint ?? "—";
      const k = `${provider}::${model}::${type}`;
      const cur = map.get(k) ?? { provider, model, type, costBrl: 0, costUsd: 0 };
      cur.costBrl += Number(u.cost_brl ?? 0);
      cur.costUsd += Number(u.cost_usd ?? 0);
      map.set(k, cur);
    }
    return Array.from(map.values()).sort((a, b) => b.costBrl - a.costBrl);
  }, [usageDaily, range]);

  const hasFilters = !!(search.platform || search.client || search.provider);

  return (
    <AppShell
      eyebrow={`Ciclo · ${range.label}`}
      title="Inteligência de custos"
      actions={
        <div className="hidden items-center gap-2 rounded-full border border-border/70 bg-muted/30 px-3 py-1.5 text-[11px] text-muted-foreground sm:flex">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          {inRange.length} lançamentos no período
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
              <SelectTrigger className="h-9 w-[180px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="7d">Últimos 7 dias</SelectItem>
                <SelectItem value="30d">Últimos 30 dias</SelectItem>
                <SelectItem value="90d">Últimos 90 dias</SelectItem>
                <SelectItem value="month">Mês atual</SelectItem>
                <SelectItem value="prev-month">Mês anterior</SelectItem>
                <SelectItem value="ytd">Ano até hoje</SelectItem>
              </SelectContent>
            </Select>
            <Select value={search.platform ?? "all"} onValueChange={(v) => setSearch({ platform: v === "all" ? undefined : v })}>
              <SelectTrigger className="h-9 w-[180px]"><SelectValue placeholder="Plataforma" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas plataformas</SelectItem>
                {dims?.platforms.map((p: any) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={search.client ?? "all"} onValueChange={(v) => setSearch({ client: v === "all" ? undefined : v })}>
              <SelectTrigger className="h-9 w-[180px]"><SelectValue placeholder="Cliente" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos clientes</SelectItem>
                {dims?.clients.map((c: any) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={search.provider ?? "all"} onValueChange={(v) => setSearch({ provider: v === "all" ? undefined : v })}>
              <SelectTrigger className="h-9 w-[180px]"><SelectValue placeholder="Fornecedor" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos fornecedores</SelectItem>
                {dims?.providers.map((p: any) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {hasFilters && (
              <Button
                variant="ghost"
                size="sm"
                className="h-9 gap-1.5 text-xs"
                onClick={() => setSearch({ platform: undefined, client: undefined, provider: undefined })}
              >
                <X className="h-3.5 w-3.5" /> Limpar
              </Button>
            )}
          </CardContent>
        </Card>

        {/* Hero */}
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="relative overflow-hidden border-0 gradient-emerald p-0 text-[color:var(--color-gold-foreground)] lg:col-span-2">
            <div className="absolute inset-0 opacity-30 [background:radial-gradient(600px_200px_at_80%_-20%,var(--color-gold),transparent_60%)]" />
            <CardContent className="relative grid gap-8 p-8 md:grid-cols-[1.1fr_1fr]">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--color-gold)] backdrop-blur">
                  <Zap className="h-3 w-3" /> Custo do período
                </div>
                <div className="mt-4 flex items-baseline gap-3">
                  <span className="font-display text-5xl font-semibold tracking-tight text-white md:text-6xl">
                    {fmtBRL(totalCurr)}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-3 text-[13px] text-white/70">
                  <span className="inline-flex items-center gap-1.5">
                    {delta >= 0 ? (
                      <TrendingUp className="h-3.5 w-3.5 text-[color:var(--color-gold)]" />
                    ) : (
                      <TrendingDown className="h-3.5 w-3.5 text-emerald-300" />
                    )}
                    <span className="font-medium text-white">
                      {delta >= 0 ? "+" : ""}
                      {delta.toFixed(1)}%
                    </span>
                    vs. período anterior ({fmtBRL(totalPrev)})
                  </span>
                  <span className="h-3 w-px bg-white/15" />
                  <span>Hoje: <span className="text-white">{fmtBRL(costToday)}</span></span>
                  <span className="h-3 w-px bg-white/15" />
                  <span>Média/dia: <span className="text-white">{fmtBRL(avgDay)}</span></span>
                </div>
              </div>
              <div className="h-[180px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={dailySeries} margin={{ top: 10, right: 0, bottom: 0, left: 0 }}>
                    <defs>
                      <linearGradient id="heroGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--color-gold)" stopOpacity={0.55} />
                        <stop offset="100%" stopColor="var(--color-gold)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <Tooltip formatter={(v: number) => fmtBRL(v)} contentStyle={tooltipStyle} cursor={{ stroke: "rgba(255,255,255,0.2)" }} />
                    <Area type="monotone" dataKey="value" stroke="var(--color-gold)" strokeWidth={2} fill="url(#heroGrad)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 lg:grid-cols-1">
            <SideStat icon={Crown} label="Plataforma líder" value={topPlatform} hint={fmtBRL(byPlatform[0]?.value ?? 0)} />
            <SideStat icon={Truck} label="Fornecedor top" value={topProvider} hint={fmtBRL(byProvider[0]?.value ?? 0)} />
            <SideStat icon={Users} label="Cliente destaque" value={topClient} hint={fmtBRL(byClient[0]?.value ?? 0)} />
          </div>
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <ChartCard title="Distribuição por plataforma" subtitle="Participação no custo do período" className="lg:col-span-1">
            {byPlatform.length === 0 ? (
              <EmptyChart />
            ) : (
              <>
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie data={byPlatform} dataKey="value" nameKey="name" innerRadius={60} outerRadius={95} paddingAngle={3} stroke="var(--color-background)" strokeWidth={2}>
                      {byPlatform.map((d, i) => (
                        <Cell key={i} fill={d.color ?? chartColors[i % chartColors.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v: number) => fmtBRL(v)} contentStyle={tooltipStyle} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="mt-4 space-y-2">
                  {byPlatform.slice(0, 4).map((p, i) => (
                    <div key={p.name} className="flex items-center justify-between text-[12px]">
                      <div className="flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full" style={{ background: p.color ?? chartColors[i % chartColors.length] }} />
                        <span className="text-muted-foreground">{p.name}</span>
                      </div>
                      <span className="font-numeric text-foreground">{fmtBRL(p.value)}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </ChartCard>

          <ChartCard title="Custo por fornecedor" subtitle="Top 6 no período" className="lg:col-span-2">
            {byProvider.length === 0 ? (
              <EmptyChart />
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={byProvider.slice(0, 6)} margin={{ top: 10, right: 10, bottom: 0, left: -10 }}>
                  <CartesianGrid strokeDasharray="2 4" stroke="var(--color-border)" vertical={false} />
                  <XAxis dataKey="name" stroke="var(--color-muted-foreground)" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis stroke="var(--color-muted-foreground)" fontSize={11} tickLine={false} axisLine={false} />
                  <Tooltip formatter={(v: number) => fmtBRL(v)} contentStyle={tooltipStyle} cursor={{ fill: "var(--color-muted)" }} />
                  <Bar dataKey="value" fill="var(--color-primary)" radius={[8, 8, 0, 0]} maxBarSize={48} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartCard>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <ChartCard title="Evolução diária" subtitle={range.label}>
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={dailySeries} margin={{ top: 8, right: 8, bottom: 0, left: -10 }}>
                <CartesianGrid strokeDasharray="2 4" stroke="var(--color-border)" vertical={false} />
                <XAxis dataKey="date" stroke="var(--color-muted-foreground)" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke="var(--color-muted-foreground)" fontSize={11} tickLine={false} axisLine={false} />
                <Tooltip formatter={(v: number) => fmtBRL(v)} contentStyle={tooltipStyle} />
                <Line type="monotone" dataKey="value" stroke="var(--color-gold)" strokeWidth={2.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="Evolução mensal" subtitle="Últimos 6 meses">
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={monthlySeries} margin={{ top: 8, right: 8, bottom: 0, left: -10 }}>
                <CartesianGrid strokeDasharray="2 4" stroke="var(--color-border)" vertical={false} />
                <XAxis dataKey="month" stroke="var(--color-muted-foreground)" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke="var(--color-muted-foreground)" fontSize={11} tickLine={false} axisLine={false} />
                <Tooltip formatter={(v: number) => fmtBRL(v)} contentStyle={tooltipStyle} cursor={{ fill: "var(--color-muted)" }} />
                <Bar dataKey="value" fill="var(--color-primary)" radius={[8, 8, 0, 0]} maxBarSize={40} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>

        {/* Model & type breakdown (OpenAI/Gemini/…) */}
        {modelBreakdown.length > 0 && (
          <Card className="surface-elevated overflow-hidden">
            <CardHeader className="border-b border-border/60 py-4">
              <CardTitle className="font-display text-base">Custos por modelo e tipo</CardTitle>
              <p className="mt-0.5 text-xs text-muted-foreground">Detalhamento das APIs no período — top 12</p>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Fornecedor</TableHead>
                    <TableHead>Modelo</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead className="text-right">Custo USD</TableHead>
                    <TableHead className="text-right">Custo BRL</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {modelBreakdown.slice(0, 12).map((r) => (
                    <TableRow key={`${r.provider}-${r.model}-${r.type}`} className="border-border/50">
                      <TableCell className="text-sm">{r.provider}</TableCell>
                      <TableCell className="text-xs font-medium">{r.model}</TableCell>
                      <TableCell><Badge variant="outline" className="font-normal">{r.type}</Badge></TableCell>
                      <TableCell className="text-right font-numeric text-xs">{r.costUsd.toFixed(4)}</TableCell>
                      <TableCell className="text-right font-numeric text-sm">{fmtBRL(r.costBrl)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {/* Recent */}
        <Card className="surface-elevated overflow-hidden">
          <CardHeader className="flex flex-row items-center justify-between border-b border-border/60 py-4">
            <div>
              <CardTitle className="font-display text-base">Últimos lançamentos</CardTitle>
              <p className="mt-0.5 text-xs text-muted-foreground">Filtrados pelo período e recortes selecionados</p>
            </div>
            <a href="/costs" className="inline-flex items-center gap-1 text-xs font-medium text-[color:var(--color-gold)] hover:underline">
              Ver tudo <ArrowUpRight className="h-3 w-3" />
            </a>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Data</TableHead>
                  <TableHead>Plataforma</TableHead>
                  <TableHead>Fornecedor</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Descrição</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">Carregando...</TableCell>
                  </TableRow>
                )}
                {!isLoading && inRange.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-16 text-center">
                      <div className="mx-auto max-w-sm space-y-2">
                        <div className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-muted text-muted-foreground">
                          <Zap className="h-4 w-4" />
                        </div>
                        <p className="font-display text-sm font-medium">Sem lançamentos no período</p>
                        <p className="text-xs text-muted-foreground">Ajuste os filtros ou registre um novo custo.</p>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
                {inRange.slice(0, 10).map((e) => (
                  <TableRow key={e.id} className="border-border/50">
                    <TableCell className="text-xs text-muted-foreground">{fmtDate(e.entry_date)}</TableCell>
                    <TableCell>
                      {e.platforms?.name ? (
                        <Badge variant="outline" className="gap-1.5 border-border/60 font-normal">
                          <span className="h-1.5 w-1.5 rounded-full" style={{ background: e.platforms.color || "var(--color-primary)" }} />
                          {e.platforms.name}
                        </Badge>
                      ) : "—"}
                    </TableCell>
                    <TableCell className="text-sm">{e.providers?.name ?? "—"}</TableCell>
                    <TableCell className="text-sm">{e.clients?.name ?? "—"}</TableCell>
                    <TableCell className="max-w-xs truncate text-sm text-muted-foreground">{e.description ?? "—"}</TableCell>
                    <TableCell className="text-right font-numeric text-sm">{fmtBRL(e.cost_brl)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

const tooltipStyle = {
  backgroundColor: "var(--color-popover)",
  border: "1px solid var(--color-border)",
  borderRadius: 10,
  fontSize: 12,
  color: "var(--color-popover-foreground)",
  padding: "8px 12px",
  boxShadow: "0 10px 30px -10px rgba(0,0,0,0.4)",
};

function EmptyChart() {
  return (
    <div className="grid h-[280px] place-items-center text-center">
      <div className="space-y-1">
        <p className="text-sm text-muted-foreground">Sem dados no período</p>
        <p className="text-xs text-muted-foreground/70">Ajuste os filtros para ver o gráfico</p>
      </div>
    </div>
  );
}

function SideStat({ icon: Icon, label, value, hint }: { icon: any; label: string; value: string; hint: string }) {
  return (
    <Card className="surface-elevated group relative overflow-hidden transition-all hover:border-[color:var(--color-gold)]/40">
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
            <div className="mt-2 truncate font-display text-lg font-semibold tracking-tight">{value}</div>
            <div className="mt-1 font-numeric text-[11px] text-muted-foreground">{hint}</div>
          </div>
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent text-[color:var(--color-gold)]">
            <Icon className="h-4 w-4" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ChartCard({ title, subtitle, children, className }: { title: string; subtitle?: string; children: React.ReactNode; className?: string }) {
  return (
    <Card className={`surface-elevated ${className ?? ""}`}>
      <CardHeader className="pb-2">
        <CardTitle className="font-display text-base">{title}</CardTitle>
        {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
