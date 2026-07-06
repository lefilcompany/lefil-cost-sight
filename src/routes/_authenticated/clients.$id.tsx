import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import {
  ArrowLeft,
  Building2,
  BadgeCheck,
  UserCircle2,
  Wallet,
  Layers,
  Receipt,
  RefreshCw,
  Pencil,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { KpiCard, EmptyState, LoadingState } from "@/components/ui-kit";
import { supabase } from "@/integrations/supabase/client";
import { fmtBRL, fmtDate, fmtDateTime, fmtNumber } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/clients/$id")({
  head: () => ({ meta: [{ title: "Contato — Quiwi Cost Center" }] }),
  component: ClientDetail,
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

async function fetchDetail(id: string) {
  const [{ data: client, error: cErr }, platforms, costs, syncs] = await Promise.all([
    supabase.from("clients").select("*").eq("id", id).maybeSingle(),
    supabase
      .from("platforms")
      .select("id,name,color,environment,status,summary,payment_method")
      .eq("owner_contact_id", id)
      .order("name"),
    supabase
      .from("cost_entries")
      .select("*, providers(name), platforms(name,color,environment)")
      .eq("client_id", id)
      .order("entry_date", { ascending: false })
      .limit(2000),
    supabase
      .from("provider_usage_syncs")
      .select("id, period_start, period_end, cost_brl, cost_usd, usage_quantity, usage_unit, created_at, providers(name), platforms(name)")
      .order("created_at", { ascending: false })
      .limit(500),
  ]);
  if (cErr) throw cErr;
  return {
    client: client as Client | null,
    platforms: (platforms.data ?? []) as any[],
    costs: (costs.data ?? []) as any[],
    syncs: (syncs.data ?? []) as any[],
  };
}

function ClientDetail() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({ queryKey: ["client-detail", id], queryFn: () => fetchDetail(id) });

  const client = data?.client;
  const platforms = data?.platforms ?? [];
  const costs = data?.costs ?? [];
  const platformIds = useMemo(() => new Set(platforms.map((p) => p.id)), [platforms]);
  const relatedSyncs = useMemo(
    () => (data?.syncs ?? []).filter((s: any) => platformIds.has(s.platform_id) || platforms.length === 0).slice(0, 25),
    [data?.syncs, platformIds, platforms.length],
  );

  const totals = useMemo(() => {
    const brl = costs.reduce((a, r) => a + Number(r.cost_brl ?? 0), 0);
    const now = new Date();
    const start30 = new Date(now); start30.setDate(now.getDate() - 30);
    const iso30 = start30.toISOString().slice(0, 10);
    const last30 = costs.filter((r) => r.entry_date >= iso30).reduce((a, r) => a + Number(r.cost_brl ?? 0), 0);
    return { brl, count: costs.length, last30 };
  }, [costs]);

  // Daily series last 90 days
  const series = useMemo(() => {
    const map = new Map<string, number>();
    const now = new Date();
    for (let i = 89; i >= 0; i--) {
      const d = new Date(now); d.setDate(now.getDate() - i);
      map.set(d.toISOString().slice(0, 10), 0);
    }
    for (const r of costs) {
      if (map.has(r.entry_date)) map.set(r.entry_date, (map.get(r.entry_date) ?? 0) + Number(r.cost_brl ?? 0));
    }
    return Array.from(map.entries()).map(([date, value]) => ({ date: date.slice(5), value }));
  }, [costs]);

  if (isLoading) return <AppShell title="Contato"><LoadingState label="Carregando contato..." /></AppShell>;
  if (!client) {
    return (
      <AppShell title="Contato">
        <EmptyState
          title="Contato não encontrado"
          action={<Button variant="outline" onClick={() => navigate({ to: "/clients" })}>Voltar</Button>}
        />
      </AppShell>
    );
  }

  const active = client.status === "active";

  return (
    <AppShell
      eyebrow="Contato"
      title={client.name}
      actions={
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => navigate({ to: "/clients" })} className="gap-1.5">
            <ArrowLeft className="h-3.5 w-3.5" /> Voltar
          </Button>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => navigate({ to: "/clients", search: { q: client.name } as any })}>
            <Pencil className="h-3.5 w-3.5" /> Editar
          </Button>
        </div>
      }
    >
      <div className="space-y-6">
        {/* Identificação */}
        <Card className="surface-elevated">
          <CardContent className="grid gap-4 pt-6 md:grid-cols-4">
            <InfoBlock icon={<Building2 className="h-3.5 w-3.5" />} label="Empresa" value={client.company || "—"} />
            <InfoBlock icon={<BadgeCheck className="h-3.5 w-3.5" />} label="CNPJ" value={client.cnpj || "—"} />
            <InfoBlock icon={<UserCircle2 className="h-3.5 w-3.5" />} label="Responsável" value={client.responsible || "—"} />
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Status</p>
              <div className="mt-1">
                {active ? (
                  <Badge className="bg-emerald-600/15 text-emerald-700 dark:text-emerald-400" variant="secondary">Ativo</Badge>
                ) : (
                  <Badge variant="outline" className="border-border/60 text-muted-foreground">Inativo</Badge>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* KPIs */}
        <div className="grid gap-3 md:grid-cols-4">
          <KpiCard label="Custo total" value={fmtBRL(totals.brl)} icon={<Wallet className="h-4 w-4" />} />
          <KpiCard label="Custo 30d" value={fmtBRL(totals.last30)} icon={<Wallet className="h-4 w-4" />} tone={totals.last30 > 0 ? "warn" : "neutral"} />
          <KpiCard label="Lançamentos" value={fmtNumber(totals.count)} icon={<Receipt className="h-4 w-4" />} />
          <KpiCard label="Plataformas sob responsabilidade" value={fmtNumber(platforms.length)} icon={<Layers className="h-4 w-4" />} />
        </div>

        {/* Consumo 90d */}
        <Card className="surface-elevated">
          <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Consumo — últimos 90 dias</CardTitle></CardHeader>
          <CardContent>
            {costs.length === 0 ? (
              <EmptyState title="Sem histórico de consumo" />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: -10 }}>
                  <defs>
                    <linearGradient id="clDetail" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.5} />
                      <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="2 4" stroke="var(--color-border)" vertical={false} />
                  <XAxis dataKey="date" stroke="var(--color-muted-foreground)" fontSize={11} tickLine={false} axisLine={false} interval={9} />
                  <YAxis stroke="var(--color-muted-foreground)" fontSize={11} tickLine={false} axisLine={false} />
                  <Tooltip formatter={(v: number) => fmtBRL(v)} contentStyle={{ background: "var(--color-popover)", border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 12 }} />
                  <Area type="monotone" dataKey="value" stroke="var(--color-primary)" strokeWidth={2} fill="url(#clDetail)" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Plataformas que responde */}
        <Card className="surface-elevated">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <Layers className="h-4 w-4" /> Plataformas sob responsabilidade
              <Badge variant="secondary" className="ml-1 text-[10px]">{platforms.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {platforms.length === 0 ? (
              <EmptyState
                title="Nenhuma plataforma vinculada"
                description="Defina este contato como responsável em uma plataforma para vê-la aqui."
                action={<Link to="/platforms"><Button size="sm" variant="outline">Ir para plataformas</Button></Link>}
              />
            ) : (
              <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
                {platforms.map((p: any) => (
                  <div key={p.id} className="rounded-lg border border-border/60 bg-muted/20 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: p.color || "var(--color-primary)" }} />
                        <span className="truncate text-[13px] font-medium">{p.name}</span>
                      </div>
                      <Badge variant={p.environment === "internal" ? "secondary" : "outline"} className="text-[9px]">
                        {p.environment === "internal" ? "interno" : "produção"}
                      </Badge>
                    </div>
                    {p.summary && <p className="mt-1.5 line-clamp-2 text-[11px] text-muted-foreground">{p.summary}</p>}
                    {p.payment_method && (
                      <p className="mt-1 text-[10px] text-muted-foreground">Pgto: {p.payment_method}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Últimas sincronizações */}
        <Card className="surface-elevated">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <RefreshCw className="h-4 w-4" /> Sincronizações recentes das plataformas
            </CardTitle>
          </CardHeader>
          <CardContent>
            {relatedSyncs.length === 0 ? (
              <EmptyState title="Sem sincronizações" description="As plataformas deste contato ainda não foram sincronizadas." />
            ) : (
              <div className="overflow-x-auto rounded-md border border-border/60">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Data</TableHead>
                      <TableHead>Plataforma</TableHead>
                      <TableHead>Fornecedor</TableHead>
                      <TableHead>Uso</TableHead>
                      <TableHead className="text-right">Custo</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {relatedSyncs.map((s: any) => (
                      <TableRow key={s.id}>
                        <TableCell className="text-xs">{fmtDateTime(s.created_at)}</TableCell>
                        <TableCell className="text-xs">{s.platforms?.name ?? "—"}</TableCell>
                        <TableCell className="text-xs">{s.providers?.name ?? "—"}</TableCell>
                        <TableCell className="text-xs">
                          {s.usage_quantity ? `${fmtNumber(Number(s.usage_quantity))} ${s.usage_unit ?? ""}` : "—"}
                        </TableCell>
                        <TableCell className="text-right font-numeric text-xs">{fmtBRL(s.cost_brl)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Histórico de custos */}
        <Card className="surface-elevated">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-semibold">Histórico de custos</CardTitle>
            <Link to="/costs" search={{ client: client.id, period: "all" } as any}>
              <Button size="sm" variant="ghost" className="h-7 text-xs">Ver tudo</Button>
            </Link>
          </CardHeader>
          <CardContent>
            {costs.length === 0 ? (
              <EmptyState title="Sem custos" />
            ) : (
              <div className="max-h-[420px] overflow-auto rounded-md border border-border/60">
                <Table>
                  <TableHeader className="sticky top-0 bg-background">
                    <TableRow>
                      <TableHead>Data</TableHead>
                      <TableHead>Plataforma</TableHead>
                      <TableHead>Fornecedor</TableHead>
                      <TableHead>Descrição</TableHead>
                      <TableHead className="text-right">Custo</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {costs.slice(0, 200).map((r: any) => (
                      <TableRow key={r.id}>
                        <TableCell className="whitespace-nowrap text-xs">{fmtDate(r.entry_date)}</TableCell>
                        <TableCell className="text-xs">
                          <span className="inline-flex items-center gap-1.5">
                            <span className="h-2 w-2 rounded-full" style={{ background: r.platforms?.color ?? "var(--color-muted-foreground)" }} />
                            {r.platforms?.name ?? "—"}
                          </span>
                        </TableCell>
                        <TableCell className="text-xs">{r.providers?.name ?? "—"}</TableCell>
                        <TableCell className="max-w-[300px] truncate text-xs text-muted-foreground">{r.description ?? "—"}</TableCell>
                        <TableCell className="text-right font-numeric text-xs">{fmtBRL(r.cost_brl)}</TableCell>
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

function InfoBlock({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 flex items-center gap-1.5 text-[13px]">
        <span className="text-muted-foreground">{icon}</span>
        <span className="truncate">{value}</span>
      </p>
    </div>
  );
}
