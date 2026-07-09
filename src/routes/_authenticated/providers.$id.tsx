import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  ArrowLeft,
  Plug,
  RefreshCw,
  Pencil,
  Trash2,
  Key,
  Power,
  PowerOff,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Wallet,
  Activity,
  ExternalLink,
  Info,
  Sparkles,
  Cloud,
  Server,
  Mic,
  Wrench,
  BookOpen,
} from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { runProviderSync } from "@/lib/sync.functions";
import { getFirecrawlUsage } from "@/lib/firecrawl-usage.functions";
import { fmtBRL, fmtNumber } from "@/lib/format";
import { KpiCard as Kpi, LoadingState } from "@/components/ui-kit";
import { Progress } from "@/components/ui/progress";

import firecrawlLogo from "@/assets/providers/firecrawl-wordmark.png.asset.json";
import geminiLogo from "@/assets/providers/gemini.png.asset.json";
import openaiLogo from "@/assets/providers/openai-logo.png.asset.json";
import gcloudLogo from "@/assets/providers/gcloud.svg.asset.json";
import elevenlabsLogo from "@/assets/providers/elevenlabs.svg.asset.json";
import supabaseLogo from "@/assets/providers/supabase.svg.asset.json";

type ProviderMeta = {
  logo: string;
  bg: string;
  logoPadding?: string;
  logoScale?: string;
  category: string;
  description: string;
  website: string;
  docs: string;
  icon: any;
  highlights: string[];
};

const PROVIDER_META: Record<string, ProviderMeta> = {
  OpenAI: {
    logo: openaiLogo.url, bg: "#111827", category: "AI · LLM",
    description: "Modelos GPT, embeddings e Costs API. Ideal para chat, extração de dados e automações com IA.",
    website: "https://openai.com", docs: "https://platform.openai.com/docs", icon: Sparkles,
    highlights: ["Uso de tokens por modelo e projeto", "Costs API para custo diário em USD", "Chaves separadas por ambiente / cliente"],
  },
  "Google Gemini": {
    logo: geminiLogo.url, bg: "#1f2937", logoPadding: "p-2", category: "AI · Multimodal",
    description: "Gemini via Vertex AI. Eventos de uso (prompt/output/thinking tokens) com custo estimado.",
    website: "https://ai.google.dev", docs: "https://ai.google.dev/gemini-api/docs", icon: Sparkles,
    highlights: ["Eventos de uso por modelo e operação", "Custo estimado por request (USD)", "Integração com projetos Google Cloud"],
  },
  Firecrawl: {
    logo: firecrawlLogo.url, bg: "#f97316", category: "Ferramenta · Scraping",
    description: "Crawl / scrape com créditos mensais. Créditos, tokens e período de faturamento em tempo real.",
    website: "https://firecrawl.dev", docs: "https://docs.firecrawl.dev", icon: Wrench,
    highlights: ["Créditos e tokens do plano em tempo real", "Ciclo de faturamento detectado automaticamente", "Custo fixo mensal convertido em BRL"],
  },
  "Google Cloud": {
    logo: gcloudLogo.url, bg: "#0f172a", category: "Cloud · Infra",
    description: "Infra, BigQuery e serviços gerenciados. Billing via export do BigQuery da conta de cobrança.",
    website: "https://cloud.google.com", docs: "https://cloud.google.com/billing/docs", icon: Cloud,
    highlights: ["Snapshots periódicos de custo do ciclo", "Export de billing via BigQuery", "Limites e projeções por conexão"],
  },
  Supabase: {
    logo: supabaseLogo.url, bg: "#0f1a17", category: "Backend · Postgres",
    description: "Postgres, Auth, Storage e Realtime. Base gerenciada com RLS e Edge Functions.",
    website: "https://supabase.com", docs: "https://supabase.com/docs", icon: Server,
    highlights: ["Conexões e chaves por projeto", "Custo mensal do plano em BRL", "Integração de billing em breve"],
  },
  ElevenLabs: {
    logo: elevenlabsLogo.url, bg: "#0a0a0a", logoPadding: "p-0", logoScale: "scale-[1.35]",
    category: "Voz · TTS",
    description: "Text-to-speech ultra-realista e clonagem de voz. Cobrança por caracteres consumidos.",
    website: "https://elevenlabs.io", docs: "https://elevenlabs.io/docs", icon: Mic,
    highlights: ["Custo mensal do plano", "Caracteres / segundos por conexão", "Integração de billing em breve"],
  },
};

function metaFor(name: string): ProviderMeta {
  return (
    PROVIDER_META[name] ?? {
      logo: "", bg: "#1f2937", category: "Fornecedor",
      description: "Fornecedor conectado ao Quiwi.",
      website: "", docs: "", icon: Info, highlights: [],
    }
  );
}


export const Route = createFileRoute("/_authenticated/providers/$id")({
  head: () => ({ meta: [{ title: "Detalhes do fornecedor — Quiwi" }] }),
  component: ProviderDetailPage,
});

type Connection = {
  id: string;
  provider_id: string;
  platform_id: string | null;
  name: string;
  status: string;
  last_sync_at: string | null;
  created_at: string;
  api_key_secret_id: string | null;
};

type SyncLog = {
  id: string;
  connection_id: string | null;
  status: string;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  records_imported: number | null;
  error_message: string | null;
  metadata: any;
};

function relTime(iso: string | null) {
  if (!iso) return "nunca";
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `há ${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `há ${m}min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `há ${h}h`;
  const d = Math.floor(h / 24);
  return `há ${d}d`;
}

function ProviderDetailPage() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const syncFn = useServerFn(runProviderSync);
  const firecrawlUsageFn = useServerFn(getFirecrawlUsage);


  const { data: provider, isLoading: providerLoading } = useQuery({
    queryKey: ["provider", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("providers").select("*").eq("id", id).single();
      if (error) throw error;
      return data;
    },
  });

  const { data: connections = [], isLoading: connLoading } = useQuery({
    queryKey: ["provider-connections", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("provider_connections")
        .select("*")
        .eq("provider_id", id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Connection[];
    },
  });

  const { data: logs = [] } = useQuery({
    queryKey: ["provider-sync-logs", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sync_logs")
        .select("*")
        .eq("provider_id", id)
        .order("started_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as SyncLog[];
    },
    refetchInterval: 15_000,
  });

  const { data: entries = [] } = useQuery({
    queryKey: ["provider-entries", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cost_entries")
        .select("id, entry_date, description, cost_brl, cost_usd, metadata")
        .eq("provider_id", id)
        .order("entry_date", { ascending: false })
        .limit(30);
      if (error) throw error;
      return data ?? [];
    },
  });

  const providerName = provider?.name ?? "";
  const meta = metaFor(providerName);
  const isFirecrawl = providerName.toLowerCase() === "firecrawl";
  const isGemini = providerName.toLowerCase().includes("gemini");
  const isGCloud = providerName.toLowerCase().includes("google cloud");
  const activeConnId = connections.find((c) => c.status === "active")?.id ?? connections[0]?.id;
  const firecrawlUsage = useQuery({
    queryKey: ["firecrawl-usage", activeConnId],
    queryFn: async () => firecrawlUsageFn({ data: { connection_id: activeConnId! } }),
    enabled: isFirecrawl && !!activeConnId,
    refetchInterval: 60_000,
    retry: false,
  });

  const geminiUsage = useQuery({
    queryKey: ["gemini-usage-summary", id],
    enabled: isGemini,
    queryFn: async () => {
      const since = new Date();
      since.setDate(since.getDate() - 30);
      const { data, error } = await supabase
        .from("gemini_usage_events")
        .select("model, total_tokens, prompt_tokens, output_tokens, estimated_cost, success, occurred_at")
        .in("provider_connection_id", connections.map((c) => c.id))
        .gte("occurred_at", since.toISOString())
        .limit(5000);
      if (error) throw error;
      const rows = data ?? [];
      const byModel = new Map<string, { requests: number; tokens: number; cost: number }>();
      let totalTokens = 0, totalCost = 0, ok = 0, fail = 0;
      for (const r of rows as any[]) {
        const m = r.model ?? "—";
        const cur = byModel.get(m) ?? { requests: 0, tokens: 0, cost: 0 };
        cur.requests += 1;
        cur.tokens += Number(r.total_tokens ?? 0);
        cur.cost += Number(r.estimated_cost ?? 0);
        byModel.set(m, cur);
        totalTokens += Number(r.total_tokens ?? 0);
        totalCost += Number(r.estimated_cost ?? 0);
        if (r.success === false) fail += 1; else ok += 1;
      }
      return {
        totalRequests: rows.length,
        totalTokens,
        totalCost,
        successRate: rows.length ? (ok / rows.length) * 100 : 0,
        failed: fail,
        topModels: Array.from(byModel.entries())
          .sort((a, b) => b[1].tokens - a[1].tokens)
          .slice(0, 5)
          .map(([model, v]) => ({ model, ...v })),
      };
    },
  });

  const gcloudSnapshot = useQuery({
    queryKey: ["gcloud-snapshot", id],
    enabled: isGCloud,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("provider_billing_snapshots")
        .select("*")
        .eq("provider_id", id)
        .order("captured_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });




  const [renameOpen, setRenameOpen] = useState<Connection | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [rotateOpen, setRotateOpen] = useState<Connection | null>(null);
  const [rotateValue, setRotateValue] = useState("");

  const syncOne = useMutation({
    mutationFn: async (cid: string) => syncFn({ data: { connection_id: cid } }),
    onSuccess: (r: any, cid) => {
      toast.success(r?.message ?? "Sincronização concluída", { description: `${r?.records ?? 0} registros` });
      qc.invalidateQueries({ queryKey: ["provider-connections", id] });
      qc.invalidateQueries({ queryKey: ["provider-sync-logs", id] });
      qc.invalidateQueries({ queryKey: ["provider-entries", id] });
    },
    onError: (e: any) => toast.error(String(e?.message ?? e)),
  });

  const toggleConn = useMutation({
    mutationFn: async (c: Connection) => {
      const next = c.status === "active" ? "inactive" : "active";
      const { error } = await supabase.from("provider_connections").update({ status: next }).eq("id", c.id);
      if (error) throw error;
      return next;
    },
    onSuccess: (next) => {
      toast.success(next === "active" ? "Conexão ativada" : "Conexão pausada");
      qc.invalidateQueries({ queryKey: ["provider-connections", id] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteConn = useMutation({
    mutationFn: async (cid: string) => {
      await supabase.rpc("clear_connection_api_key", { _connection_id: cid });
      const { error } = await supabase.from("provider_connections").delete().eq("id", cid);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Conexão removida");
      qc.invalidateQueries({ queryKey: ["provider-connections", id] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const rename = useMutation({
    mutationFn: async () => {
      if (!renameOpen) return;
      const { error } = await supabase
        .from("provider_connections")
        .update({ name: renameValue.trim() })
        .eq("id", renameOpen.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Nome atualizado");
      qc.invalidateQueries({ queryKey: ["provider-connections", id] });
      setRenameOpen(null);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const rotate = useMutation({
    mutationFn: async () => {
      if (!rotateOpen) return;
      const { error } = await supabase.rpc("set_connection_api_key", {
        _connection_id: rotateOpen.id,
        _api_key: rotateValue.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Chave atualizada");
      setRotateOpen(null);
      setRotateValue("");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const totalBrl = entries.reduce((a, e: any) => a + Number(e.cost_brl ?? 0), 0);
  const successCount = logs.filter((l) => l.status === "success").length;
  const errorCount = logs.filter((l) => l.status === "error").length;

  if (providerLoading) {
    return (
      <AppShell title="Carregando...">
        <LoadingState label="Carregando fornecedor..." />
      </AppShell>
    );
  }
  if (!provider) {
    return (
      <AppShell title="Não encontrado">
        <p className="text-sm text-muted-foreground">Fornecedor não encontrado.</p>
      </AppShell>
    );
  }

  return (
    <AppShell
      eyebrow="Fornecedor"
      title={provider.name}
      actions={
        <Link to="/providers">
          <Button variant="outline" size="sm" className="gap-1.5"><ArrowLeft className="h-3.5 w-3.5" /> Voltar</Button>
        </Link>
      }
    >
      <div className="space-y-6">
        <div className="grid gap-3 md:grid-cols-4">
          <Kpi label="Conexões" value={fmtNumber(connections.length)} icon={<Plug className="h-4 w-4" />} />
          <Kpi label="Custo importado" value={fmtBRL(totalBrl)} icon={<Wallet className="h-4 w-4" />} />
          <Kpi label="Syncs OK" value={fmtNumber(successCount)} tone="good" icon={<CheckCircle2 className="h-4 w-4" />} />
          <Kpi label="Syncs com erro" value={fmtNumber(errorCount)} tone={errorCount ? "warn" : "neutral"} icon={<XCircle className="h-4 w-4" />} />
        </div>

        {isFirecrawl && activeConnId && (
          <FirecrawlUsageCard
            query={firecrawlUsage}
            onRefresh={() => firecrawlUsage.refetch()}
          />
        )}



        <Card className="surface-elevated">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="font-display text-base">Chaves / conexões</CardTitle>
            <Link to="/providers">
              <Button size="sm" variant="outline" className="gap-1.5">
                <Plug className="h-3.5 w-3.5" /> Nova conexão
              </Button>
            </Link>
          </CardHeader>
          <CardContent className="p-0">
            {connLoading ? (
              <div className="p-6"><LoadingState label="Carregando..." /></div>
            ) : connections.length === 0 ? (
              <div className="p-10 text-center text-sm text-muted-foreground">
                Nenhuma chave cadastrada.{" "}
                <Link to="/providers" className="text-primary hover:underline">Adicionar a primeira</Link>.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Chave</TableHead>
                    <TableHead>Último sync</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {connections.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">{c.name}</TableCell>
                      <TableCell>
                        {c.status === "active" ? (
                          <Badge className="gap-1 bg-emerald-600/15 text-emerald-700 dark:text-emerald-400" variant="secondary">
                            <CheckCircle2 className="h-3 w-3" /> Ativa
                          </Badge>
                        ) : c.status === "error" ? (
                          <Badge className="gap-1 bg-red-600/15 text-red-700 dark:text-red-400" variant="secondary">
                            <AlertCircle className="h-3 w-3" /> Erro
                          </Badge>
                        ) : (
                          <Badge variant="outline">Pausada</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {c.api_key_secret_id ? "•••••• configurada" : "não configurada"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{relTime(c.last_sync_at)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 gap-1"
                            onClick={() => syncOne.mutate(c.id)}
                            disabled={syncOne.isPending}
                            title="Sincronizar agora"
                          >
                            <RefreshCw className={`h-3.5 w-3.5 ${syncOne.isPending ? "animate-spin" : ""}`} />
                            Sync
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8"
                            title="Renomear"
                            onClick={() => {
                              setRenameOpen(c);
                              setRenameValue(c.name);
                            }}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8"
                            title="Rotacionar chave"
                            onClick={() => {
                              setRotateOpen(c);
                              setRotateValue("");
                            }}
                          >
                            <Key className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8"
                            title={c.status === "active" ? "Pausar" : "Ativar"}
                            onClick={() => toggleConn.mutate(c)}
                          >
                            {c.status === "active" ? <PowerOff className="h-3.5 w-3.5" /> : <Power className="h-3.5 w-3.5" />}
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 hover:text-destructive"
                            title="Excluir"
                            onClick={() => {
                              if (confirm(`Excluir "${c.name}"? Esta ação apaga a chave.`)) deleteConn.mutate(c.id);
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="surface-elevated">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 font-display text-base">
                <Activity className="h-4 w-4" /> Histórico de sincronizações
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {logs.length === 0 ? (
                <p className="p-6 text-center text-sm text-muted-foreground">Nenhuma sincronização registrada.</p>
              ) : (
                <div className="max-h-[420px] overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Quando</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Registros</TableHead>
                        <TableHead>Detalhes</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {logs.map((l) => (
                        <TableRow key={l.id}>
                          <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                            <Clock className="mr-1 inline h-3 w-3" />
                            {relTime(l.started_at)}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={l.status === "success" ? "secondary" : "outline"}
                              className={
                                l.status === "success"
                                  ? "bg-emerald-600/15 text-emerald-700 dark:text-emerald-400"
                                  : l.status === "error"
                                  ? "bg-red-600/15 text-red-700 dark:text-red-400"
                                  : ""
                              }
                            >
                              {l.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs">{l.records_imported ?? 0}</TableCell>
                          <TableCell className="max-w-[260px] truncate text-xs text-muted-foreground" title={l.error_message ?? ""}>
                            {l.error_message ??
                              (l.metadata && typeof l.metadata === "object"
                                ? Object.entries(l.metadata)
                                    .slice(0, 2)
                                    .map(([k, v]) => `${k}: ${String(v).slice(0, 30)}`)
                                    .join(" · ")
                                : "—")}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="surface-elevated">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 font-display text-base">
                <Wallet className="h-4 w-4" /> Últimos custos importados
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {entries.length === 0 ? (
                <p className="p-6 text-center text-sm text-muted-foreground">
                  Nenhum custo importado ainda. Rode um sync ou aguarde o agendamento (a cada hora).
                </p>
              ) : (
                <div className="max-h-[420px] overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Data</TableHead>
                        <TableHead>Descrição</TableHead>
                        <TableHead className="text-right">USD</TableHead>
                        <TableHead className="text-right">BRL</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {entries.map((e: any) => (
                        <TableRow key={e.id}>
                          <TableCell className="whitespace-nowrap text-xs">{e.entry_date}</TableCell>
                          <TableCell className="text-xs">{e.description}</TableCell>
                          <TableCell className="text-right font-numeric text-xs">
                            {Number(e.cost_usd ?? 0).toFixed(2)}
                          </TableCell>
                          <TableCell className="text-right font-numeric text-xs">{fmtBRL(Number(e.cost_brl ?? 0))}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Rename dialog */}
      <Dialog open={!!renameOpen} onOpenChange={(v) => !v && setRenameOpen(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Renomear conexão</DialogTitle>
            <DialogDescription>Escolha um nome que ajude a identificar (ex: "Produção", "Cliente X").</DialogDescription>
          </DialogHeader>
          <Input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} autoFocus />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRenameOpen(null)}>Cancelar</Button>
            <Button onClick={() => rename.mutate()} disabled={rename.isPending || !renameValue.trim()}>
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rotate key dialog */}
      <Dialog open={!!rotateOpen} onOpenChange={(v) => !v && setRotateOpen(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Rotacionar chave</DialogTitle>
            <DialogDescription>
              Substitui a chave atual desta conexão. A chave anterior é apagada imediatamente.
            </DialogDescription>
          </DialogHeader>
          <textarea
            className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs min-h-[120px]"
            value={rotateValue}
            onChange={(e) => setRotateValue(e.target.value)}
            placeholder="Cole a nova chave / JSON aqui"
            spellCheck={false}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRotateOpen(null)}>Cancelar</Button>
            <Button onClick={() => rotate.mutate()} disabled={rotate.isPending || !rotateValue.trim()}>
              Atualizar chave
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

function fmtInt(n: number) {
  return new Intl.NumberFormat("pt-BR").format(Math.round(n));
}
function fmtDate(iso: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return iso;
  }
}

function FirecrawlUsageCard({
  query,
  onRefresh,
}: {
  query: ReturnType<typeof useQuery<any, any>>;
  onRefresh: () => void;
}) {
  const usage = query.data as
    | {
        credits: { used: number; remaining: number; total: number };
        tokens: { used: number; remaining: number; total: number };
        billing_period: { start: string | null; end: string | null };
        plan_name: string | null;
      }
    | undefined;

  return (
    <Card className="surface-elevated">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2 font-display text-base">
            <Activity className="h-4 w-4" /> Uso do plano Firecrawl
          </CardTitle>
          {usage?.billing_period.start && usage.billing_period.end && (
            <p className="mt-1 text-xs text-muted-foreground">
              Ciclo: {fmtDate(usage.billing_period.start)} → {fmtDate(usage.billing_period.end)}
              {usage.plan_name ? ` · ${usage.plan_name}` : ""}
            </p>
          )}
        </div>
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          onClick={onRefresh}
          disabled={query.isFetching}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${query.isFetching ? "animate-spin" : ""}`} />
          Atualizar
        </Button>
      </CardHeader>
      <CardContent>
        {query.isLoading ? (
          <LoadingState label="Consultando Firecrawl..." />
        ) : query.error ? (
          <p className="text-sm text-destructive">
            Falha ao consultar Firecrawl: {String((query.error as any)?.message ?? query.error)}
          </p>
        ) : !usage ? (
          <p className="text-sm text-muted-foreground">Sem dados.</p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            <UsageBlock
              label="Créditos do plano"
              used={usage.credits.used}
              remaining={usage.credits.remaining}
              total={usage.credits.total}
              unit="créditos"
            />
            <UsageBlock
              label="Tokens (1 crédito ≈ 15 tokens)"
              used={usage.tokens.used}
              remaining={usage.tokens.remaining}
              total={usage.tokens.total}
              unit="tokens"
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function UsageBlock({
  label,
  used,
  remaining,
  total,
  unit,
}: {
  label: string;
  used: number;
  remaining: number;
  total: number;
  unit: string;
}) {
  const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;
  return (
    <div className="rounded-lg border border-border/60 bg-muted/30 p-4">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        <p className="font-numeric text-xs text-muted-foreground">{pct.toFixed(1)}%</p>
      </div>
      <div className="flex items-baseline gap-2">
        <span className="font-numeric text-2xl font-semibold tracking-tight">{fmtInt(used)}</span>
        <span className="text-xs text-muted-foreground">/ {fmtInt(total)} {unit}</span>
      </div>
      <Progress value={pct} className="mt-3 h-2" />
      <div className="mt-2 flex justify-between text-[11px] text-muted-foreground">
        <span>Usados: <span className="font-numeric text-foreground">{fmtInt(used)}</span></span>
        <span>Restantes: <span className="font-numeric text-foreground">{fmtInt(remaining)}</span></span>
      </div>
    </div>
  );
}

