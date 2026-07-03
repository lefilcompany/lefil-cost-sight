import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
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
import { TrendingUp, TrendingDown, Crown, Truck, Users, ArrowUpRight, Zap } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { fmtBRL, fmtDate } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Painel geral — LeFil Cost Center" }] }),
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
    .limit(2000);
  if (error) throw error;
  return (data ?? []) as Entry[];
}

function Dashboard() {
  const { data: entries = [], isLoading } = useQuery({ queryKey: ["dashboard-entries"], queryFn: fetchAll });

  const today = new Date().toISOString().slice(0, 10);
  const monthStart = new Date();
  monthStart.setDate(1);
  const monthStartStr = monthStart.toISOString().slice(0, 10);

  const prevMonthStart = new Date();
  prevMonthStart.setMonth(prevMonthStart.getMonth() - 1);
  prevMonthStart.setDate(1);
  const prevMonthEnd = new Date();
  prevMonthEnd.setDate(0);
  const prevMonthStartStr = prevMonthStart.toISOString().slice(0, 10);
  const prevMonthEndStr = prevMonthEnd.toISOString().slice(0, 10);

  const last30 = new Date();
  last30.setDate(last30.getDate() - 30);
  const last30Str = last30.toISOString().slice(0, 10);

  const sum = (arr: Entry[]) => arr.reduce((s, e) => s + Number(e.cost_brl ?? 0), 0);
  const costToday = sum(entries.filter((e) => e.entry_date === today));
  const costMonth = sum(entries.filter((e) => e.entry_date >= monthStartStr));
  const costPrevMonth = sum(
    entries.filter((e) => e.entry_date >= prevMonthStartStr && e.entry_date <= prevMonthEndStr),
  );
  const cost30 = sum(entries.filter((e) => e.entry_date >= last30Str));

  const monthDelta = costPrevMonth > 0 ? ((costMonth - costPrevMonth) / costPrevMonth) * 100 : 0;

  const byGroup = (key: "platforms" | "providers" | "clients") => {
    const map = new Map<string, { name: string; value: number; color?: string }>();
    for (const e of entries) {
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

  const dayMap = new Map<string, number>();
  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    dayMap.set(d.toISOString().slice(0, 10), 0);
  }
  for (const e of entries) {
    if (e.entry_date >= last30Str && dayMap.has(e.entry_date)) {
      dayMap.set(e.entry_date, (dayMap.get(e.entry_date) ?? 0) + Number(e.cost_brl ?? 0));
    }
  }
  const dailySeries = Array.from(dayMap.entries()).map(([date, value]) => ({
    date: date.slice(5),
    value,
  }));

  const monthMap = new Map<string, number>();
  for (let i = 5; i >= 0; i--) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    monthMap.set(d.toISOString().slice(0, 7), 0);
  }
  for (const e of entries) {
    const m = e.entry_date.slice(0, 7);
    if (monthMap.has(m)) monthMap.set(m, (monthMap.get(m) ?? 0) + Number(e.cost_brl ?? 0));
  }
  const monthlySeries = Array.from(monthMap.entries()).map(([month, value]) => ({ month, value }));

  const chartColors = [
    "var(--color-chart-1)",
    "var(--color-chart-2)",
    "var(--color-chart-3)",
    "var(--color-chart-4)",
    "var(--color-chart-5)",
  ];

  const monthNow = new Date().toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

  return (
    <AppShell
      eyebrow={`Ciclo · ${monthNow}`}
      title="Inteligência de custos"
      actions={
        <>
          <div className="hidden items-center gap-2 rounded-full border border-border/70 bg-muted/30 px-3 py-1.5 text-[11px] text-muted-foreground sm:flex">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            Última sync há poucos minutos
          </div>
        </>
      }
    >
      <div className="space-y-8">
        {/* Hero row: main KPI + sparkline + 3 side stats */}
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="relative overflow-hidden border-0 gradient-emerald p-0 text-[color:var(--color-gold-foreground)] lg:col-span-2">
            <div className="absolute inset-0 opacity-30 [background:radial-gradient(600px_200px_at_80%_-20%,var(--color-gold),transparent_60%)]" />
            <CardContent className="relative grid gap-8 p-8 md:grid-cols-[1.1fr_1fr]">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--color-gold)] backdrop-blur">
                  <Zap className="h-3 w-3" /> Custo do mês
                </div>
                <div className="mt-4 flex items-baseline gap-3">
                  <span className="font-display text-5xl font-semibold tracking-tight text-white md:text-6xl">
                    {fmtBRL(costMonth)}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-3 text-[13px] text-white/70">
                  <span className="inline-flex items-center gap-1.5">
                    {monthDelta >= 0 ? (
                      <TrendingUp className="h-3.5 w-3.5 text-[color:var(--color-gold)]" />
                    ) : (
                      <TrendingDown className="h-3.5 w-3.5 text-emerald-300" />
                    )}
                    <span className="font-medium text-white">
                      {monthDelta >= 0 ? "+" : ""}
                      {monthDelta.toFixed(1)}%
                    </span>
                    vs. mês anterior ({fmtBRL(costPrevMonth)})
                  </span>
                  <span className="h-3 w-px bg-white/15" />
                  <span>
                    Hoje: <span className="text-white">{fmtBRL(costToday)}</span>
                  </span>
                  <span className="h-3 w-px bg-white/15" />
                  <span>
                    30d: <span className="text-white">{fmtBRL(cost30)}</span>
                  </span>
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
                    <Tooltip
                      formatter={(v: number) => fmtBRL(v)}
                      contentStyle={tooltipStyle}
                      cursor={{ stroke: "rgba(255,255,255,0.2)" }}
                    />
                    <Area
                      type="monotone"
                      dataKey="value"
                      stroke="var(--color-gold)"
                      strokeWidth={2}
                      fill="url(#heroGrad)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 lg:grid-cols-1">
            <SideStat icon={Crown} label="Plataforma líder" value={topPlatform} hint="Maior consumo acumulado" />
            <SideStat icon={Truck} label="Fornecedor top" value={topProvider} hint="Maior gasto no período" />
            <SideStat icon={Users} label="Cliente destaque" value={topClient} hint="Ponto de atenção" />
          </div>
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <ChartCard title="Distribuição por plataforma" subtitle="Participação no custo acumulado" className="lg:col-span-1">
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={byPlatform}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={60}
                  outerRadius={95}
                  paddingAngle={3}
                  stroke="var(--color-background)"
                  strokeWidth={2}
                >
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
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ background: p.color ?? chartColors[i % chartColors.length] }}
                    />
                    <span className="text-muted-foreground">{p.name}</span>
                  </div>
                  <span className="font-numeric text-foreground">{fmtBRL(p.value)}</span>
                </div>
              ))}
            </div>
          </ChartCard>

          <ChartCard title="Custo por fornecedor" subtitle="Top 6 em BRL" className="lg:col-span-2">
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={byProvider.slice(0, 6)} margin={{ top: 10, right: 10, bottom: 0, left: -10 }}>
                <CartesianGrid strokeDasharray="2 4" stroke="var(--color-border)" vertical={false} />
                <XAxis dataKey="name" stroke="var(--color-muted-foreground)" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke="var(--color-muted-foreground)" fontSize={11} tickLine={false} axisLine={false} />
                <Tooltip formatter={(v: number) => fmtBRL(v)} contentStyle={tooltipStyle} cursor={{ fill: "var(--color-muted)" }} />
                <Bar dataKey="value" fill="var(--color-primary)" radius={[8, 8, 0, 0]} maxBarSize={48} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <ChartCard title="Evolução diária" subtitle="Últimos 30 dias">
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

        {/* Recent activity */}
        <Card className="surface-elevated overflow-hidden">
          <CardHeader className="flex flex-row items-center justify-between border-b border-border/60 py-4">
            <div>
              <CardTitle className="font-display text-base">Últimos lançamentos</CardTitle>
              <p className="mt-0.5 text-xs text-muted-foreground">Consumos registrados nas últimas horas</p>
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
                    <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                      Carregando...
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading && entries.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-16 text-center">
                      <div className="mx-auto max-w-sm space-y-2">
                        <div className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-muted text-muted-foreground">
                          <Zap className="h-4 w-4" />
                        </div>
                        <p className="font-display text-sm font-medium">Sem lançamentos ainda</p>
                        <p className="text-xs text-muted-foreground">
                          Configure uma integração ou registre um custo manual para começar.
                        </p>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
                {entries.slice(0, 10).map((e) => (
                  <TableRow key={e.id} className="border-border/50">
                    <TableCell className="text-xs text-muted-foreground">{fmtDate(e.entry_date)}</TableCell>
                    <TableCell>
                      {e.platforms?.name ? (
                        <Badge variant="outline" className="gap-1.5 border-border/60 font-normal">
                          <span className="h-1.5 w-1.5 rounded-full" style={{ background: e.platforms.color || "var(--color-primary)" }} />
                          {e.platforms.name}
                        </Badge>
                      ) : (
                        "—"
                      )}
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

function SideStat({ icon: Icon, label, value, hint }: { icon: any; label: string; value: string; hint: string }) {
  return (
    <Card className="surface-elevated group relative overflow-hidden transition-all hover:border-[color:var(--color-gold)]/40">
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
            <div className="mt-2 truncate font-display text-lg font-semibold tracking-tight">{value}</div>
            <div className="mt-1 text-[11px] text-muted-foreground">{hint}</div>
          </div>
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent text-[color:var(--color-gold)]">
            <Icon className="h-4 w-4" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ChartCard({
  title,
  subtitle,
  children,
  className,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
}) {
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
