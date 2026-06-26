import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
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
import { TrendingUp, DollarSign, CalendarDays, Crown, Truck, Users } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { fmtBRL, fmtDate } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — LeFil Cost Center" }] }),
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
  const last30 = new Date();
  last30.setDate(last30.getDate() - 30);
  const last30Str = last30.toISOString().slice(0, 10);

  const sum = (arr: Entry[]) => arr.reduce((s, e) => s + Number(e.cost_brl ?? 0), 0);
  const costToday = sum(entries.filter((e) => e.entry_date === today));
  const costMonth = sum(entries.filter((e) => e.entry_date >= monthStartStr));
  const cost30 = sum(entries.filter((e) => e.entry_date >= last30Str));

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

  // Daily evolution last 30 days
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

  // Monthly evolution last 6 months
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

  const chartColors = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

  return (
    <AppShell title="Dashboard">
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Visão geral</h2>
          <p className="text-sm text-muted-foreground">
            Custos consolidados das plataformas LeFil em tempo quase real.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <StatCard icon={DollarSign} label="Custo do mês" value={fmtBRL(costMonth)} />
          <StatCard icon={CalendarDays} label="Custo hoje" value={fmtBRL(costToday)} />
          <StatCard icon={TrendingUp} label="Últimos 30 dias" value={fmtBRL(cost30)} />
          <StatCard icon={Crown} label="Plataforma top" value={topPlatform} />
          <StatCard icon={Truck} label="Fornecedor top" value={topProvider} />
          <StatCard icon={Users} label="Cliente top" value={topClient} />
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <ChartCard title="Custos por plataforma">
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie data={byPlatform} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90} paddingAngle={2}>
                  {byPlatform.map((d, i) => (
                    <Cell key={i} fill={d.color ?? chartColors[i % chartColors.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v: number) => fmtBRL(v)} contentStyle={tooltipStyle} />
              </PieChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="Custos por fornecedor">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={byProvider}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="name" stroke="var(--muted-foreground)" fontSize={11} />
                <YAxis stroke="var(--muted-foreground)" fontSize={11} />
                <Tooltip formatter={(v: number) => fmtBRL(v)} contentStyle={tooltipStyle} />
                <Bar dataKey="value" fill="var(--chart-1)" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="Evolução diária (30d)">
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={dailySeries}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="date" stroke="var(--muted-foreground)" fontSize={11} />
                <YAxis stroke="var(--muted-foreground)" fontSize={11} />
                <Tooltip formatter={(v: number) => fmtBRL(v)} contentStyle={tooltipStyle} />
                <Line type="monotone" dataKey="value" stroke="var(--chart-1)" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="Evolução mensal (6m)">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={monthlySeries}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="month" stroke="var(--muted-foreground)" fontSize={11} />
                <YAxis stroke="var(--muted-foreground)" fontSize={11} />
                <Tooltip formatter={(v: number) => fmtBRL(v)} contentStyle={tooltipStyle} />
                <Bar dataKey="value" fill="var(--chart-2)" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Últimos consumos</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Plataforma</TableHead>
                  <TableHead>Fornecedor</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Descrição</TableHead>
                  <TableHead className="text-right">Valor (BRL)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground">
                      Carregando...
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading && entries.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground">
                      Nenhum lançamento ainda. Adicione custos manualmente ou sincronize uma integração.
                    </TableCell>
                  </TableRow>
                )}
                {entries.slice(0, 20).map((e) => (
                  <TableRow key={e.id}>
                    <TableCell>{fmtDate(e.entry_date)}</TableCell>
                    <TableCell>{e.platforms?.name ?? "—"}</TableCell>
                    <TableCell>{e.providers?.name ?? "—"}</TableCell>
                    <TableCell>{e.clients?.name ?? "—"}</TableCell>
                    <TableCell className="max-w-xs truncate">{e.description ?? "—"}</TableCell>
                    <TableCell className="text-right font-mono">{fmtBRL(e.cost_brl)}</TableCell>
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
  backgroundColor: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  fontSize: 12,
  color: "var(--popover-foreground)",
};

function StatCard({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <Card className="border-border/60">
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</span>
          <Icon className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="mt-2 font-display text-2xl font-semibold tracking-tight">{value}</div>
      </CardContent>
    </Card>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="border-border/60">
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
