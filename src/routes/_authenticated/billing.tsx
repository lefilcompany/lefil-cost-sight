import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Receipt,
  RefreshCw,
  Loader2,
  Play,
  Plus,
  FileText,
  TrendingUp,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { LoadingState } from "@/components/ui-kit";
import { fmtDateTime, fmtNumber } from "@/lib/format";
import { runBillingSync, runBillingSyncAllFn } from "@/lib/billing.functions";

export const Route = createFileRoute("/_authenticated/billing")({
  head: () => ({ meta: [{ title: "Billing — Quiwi Cost Center" }] }),
  component: BillingPage,
});

type Snapshot = {
  id: string;
  connection_id: string;
  provider_id: string;
  plan_name: string | null;
  billing_cycle: string | null;
  cycle_start: string | null;
  cycle_end: string | null;
  included_quantity: number | null;
  included_unit: string | null;
  used_quantity: number | null;
  remaining_quantity: number | null;
  hard_limit_usd: number | null;
  cost_period_usd: number | null;
  projected_cost_usd: number | null;
  currency: string;
  captured_at: string;
  provider_connections?: { name: string; providers?: { name: string } | null } | null;
};

type UsageRow = {
  id: string;
  usage_date: string;
  model: string;
  endpoint: string;
  input_tokens: number;
  output_tokens: number;
  requests: number;
  quantity: number;
  unit: string | null;
  cost_usd: number;
  cost_brl: number;
  providers?: { name: string } | null;
};

type Invoice = {
  id: string;
  provider_id: string;
  invoice_number: string | null;
  issued_at: string | null;
  period_start: string | null;
  period_end: string | null;
  amount_usd: number;
  amount_brl: number;
  status: string;
  pdf_url: string | null;
  source: string;
  notes: string | null;
  providers?: { name: string } | null;
};

function BillingPage() {
  const qc = useQueryClient();
  const syncOne = useServerFn(runBillingSync);
  const syncAll = useServerFn(runBillingSyncAllFn);

  const { data: providers = [] } = useQuery({
    queryKey: ["billing-providers"],
    queryFn: async () => {
      const { data } = await supabase.from("providers").select("id,name").order("name");
      return data ?? [];
    },
  });

  const { data: snapshots = [], isLoading: loadingSnaps } = useQuery({
    queryKey: ["billing-snapshots"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("provider_billing_snapshots")
        .select("*, provider_connections(name, providers(name))")
        .order("captured_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as Snapshot[];
    },
  });

  const latestByConnection = useMemo(() => {
    const map = new Map<string, Snapshot>();
    for (const s of snapshots) if (!map.has(s.connection_id)) map.set(s.connection_id, s);
    return Array.from(map.values());
  }, [snapshots]);

  const { data: usage = [], isLoading: loadingUsage } = useQuery({
    queryKey: ["billing-usage"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("provider_usage_daily")
        .select("*, providers(name)")
        .order("usage_date", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as UsageRow[];
    },
  });

  const { data: invoices = [], isLoading: loadingInv } = useQuery({
    queryKey: ["billing-invoices"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("provider_invoices")
        .select("*, providers(name)")
        .order("issued_at", { ascending: false, nullsFirst: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as Invoice[];
    },
  });

  const syncOneM = useMutation({
    mutationFn: async (connection_id: string) => syncOne({ data: { connection_id } }),
    onSuccess: (r: any) => {
      toast.success(r?.message ?? "Sincronizado");
      qc.invalidateQueries({ queryKey: ["billing-snapshots"] });
      qc.invalidateQueries({ queryKey: ["billing-usage"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const syncAllM = useMutation({
    mutationFn: async () => syncAll({}),
    onSuccess: () => {
      toast.success("Sincronização de billing concluída");
      qc.invalidateQueries({ queryKey: ["billing-snapshots"] });
      qc.invalidateQueries({ queryKey: ["billing-usage"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <AppShell
      eyebrow="Financeiro"
      title="Billing"
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <GcpConfigDialog />
          <Button onClick={() => syncAllM.mutate()} disabled={syncAllM.isPending} className="gap-2">
            {syncAllM.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Sincronizar todos
          </Button>
        </div>
      }
    >
      <Tabs defaultValue="plans" className="space-y-6">
        <TabsList>
          <TabsTrigger value="plans" className="gap-2"><TrendingUp className="h-3.5 w-3.5" /> Planos & limites</TabsTrigger>
          <TabsTrigger value="usage" className="gap-2"><Receipt className="h-3.5 w-3.5" /> Uso por dia/modelo</TabsTrigger>
          <TabsTrigger value="invoices" className="gap-2"><FileText className="h-3.5 w-3.5" /> Faturas</TabsTrigger>
        </TabsList>

        {/* PLANOS & LIMITES */}
        <TabsContent value="plans" className="space-y-3">
          {loadingSnaps ? (
            <LoadingState label="Carregando snapshots..." />
          ) : latestByConnection.length === 0 ? (
            <Card className="surface-elevated">
              <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
                <div className="grid h-10 w-10 place-items-center rounded-full bg-muted text-muted-foreground">
                  <AlertTriangle className="h-4 w-4" />
                </div>
                <p className="font-display text-sm font-medium">Nenhum snapshot ainda</p>
                <p className="text-xs text-muted-foreground">Clique em "Sincronizar todos" para buscar planos e limites nos provedores.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {latestByConnection.map((s) => (
                <SnapshotCard
                  key={s.id}
                  snap={s}
                  onSync={() => syncOneM.mutate(s.connection_id)}
                  syncing={syncOneM.isPending && syncOneM.variables === s.connection_id}
                />
              ))}
            </div>
          )}
        </TabsContent>

        {/* USO POR DIA/MODELO */}
        <TabsContent value="usage">
          <Card className="surface-elevated">
            <CardContent className="pt-6">
              <div className="overflow-hidden rounded-lg border border-border/60">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Data</TableHead>
                      <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Fornecedor</TableHead>
                      <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Modelo</TableHead>
                      <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Endpoint</TableHead>
                      <TableHead className="text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Requests</TableHead>
                      <TableHead className="text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Tokens (in/out)</TableHead>
                      <TableHead className="text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Custo USD</TableHead>
                      <TableHead className="text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Custo BRL</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loadingUsage && (
                      <TableRow><TableCell colSpan={8} className="p-0"><LoadingState label="Carregando uso..." /></TableCell></TableRow>
                    )}
                    {!loadingUsage && usage.length === 0 && (
                      <TableRow><TableCell colSpan={8} className="py-10 text-center text-sm text-muted-foreground">Sem dados de uso ainda. Sincronize um provedor.</TableCell></TableRow>
                    )}
                    {usage.map((u) => (
                      <TableRow key={u.id} className="border-border/50">
                        <TableCell className="whitespace-nowrap text-sm">{u.usage_date}</TableCell>
                        <TableCell className="text-sm">{u.providers?.name ?? "—"}</TableCell>
                        <TableCell className="text-sm font-medium">{u.model || "—"}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{u.endpoint || "—"}</TableCell>
                        <TableCell className="text-right font-numeric text-sm">{fmtNumber(u.requests)}</TableCell>
                        <TableCell className="text-right font-numeric text-xs">
                          {u.input_tokens || u.output_tokens
                            ? `${fmtNumber(u.input_tokens)} / ${fmtNumber(u.output_tokens)}`
                            : "—"}
                        </TableCell>
                        <TableCell className="text-right font-numeric text-sm">
                          {u.cost_usd > 0 ? `US$ ${u.cost_usd.toFixed(2)}` : "—"}
                        </TableCell>
                        <TableCell className="text-right font-numeric text-sm">
                          {u.cost_brl > 0 ? `R$ ${u.cost_brl.toFixed(2)}` : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* FATURAS */}
        <TabsContent value="invoices">
          <Card className="surface-elevated">
            <CardContent className="pt-6 space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  Faturas dos provedores (importadas via API ou cadastradas manualmente).
                </p>
                <ManualInvoiceDialog providers={providers} onSaved={() => qc.invalidateQueries({ queryKey: ["billing-invoices"] })} />
              </div>
              <div className="overflow-hidden rounded-lg border border-border/60">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Data</TableHead>
                      <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Fornecedor</TableHead>
                      <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Nº</TableHead>
                      <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Período</TableHead>
                      <TableHead className="text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">USD</TableHead>
                      <TableHead className="text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">BRL</TableHead>
                      <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Status</TableHead>
                      <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Origem</TableHead>
                      <TableHead className="text-right" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loadingInv && (
                      <TableRow><TableCell colSpan={9} className="p-0"><LoadingState label="Carregando faturas..." /></TableCell></TableRow>
                    )}
                    {!loadingInv && invoices.length === 0 && (
                      <TableRow><TableCell colSpan={9} className="py-10 text-center text-sm text-muted-foreground">Nenhuma fatura cadastrada.</TableCell></TableRow>
                    )}
                    {invoices.map((i) => (
                      <TableRow key={i.id} className="border-border/50">
                        <TableCell className="whitespace-nowrap text-sm">{i.issued_at ?? "—"}</TableCell>
                        <TableCell className="text-sm">{i.providers?.name ?? "—"}</TableCell>
                        <TableCell className="text-sm font-medium">{i.invoice_number ?? "—"}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {i.period_start && i.period_end ? `${i.period_start} → ${i.period_end}` : "—"}
                        </TableCell>
                        <TableCell className="text-right font-numeric text-sm">US$ {i.amount_usd.toFixed(2)}</TableCell>
                        <TableCell className="text-right font-numeric text-sm">R$ {i.amount_brl.toFixed(2)}</TableCell>
                        <TableCell><Badge variant={i.status === "paid" ? "secondary" : "outline"} className="capitalize">{i.status}</Badge></TableCell>
                        <TableCell><Badge variant="outline" className="capitalize">{i.source}</Badge></TableCell>
                        <TableCell className="text-right">
                          {i.pdf_url && (
                            <a href={i.pdf_url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary underline">PDF</a>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </AppShell>
  );
}

function SnapshotCard({
  snap,
  onSync,
  syncing,
}: {
  snap: Snapshot;
  onSync: () => void;
  syncing: boolean;
}) {
  const providerName = snap.provider_connections?.providers?.name ?? "—";
  const connName = snap.provider_connections?.name ?? "—";
  const used = Number(snap.used_quantity ?? 0);
  const included = Number(snap.included_quantity ?? 0);
  const pct = included > 0 ? Math.min(100, (used / included) * 100) : null;
  const period = Number(snap.cost_period_usd ?? 0);
  const projected = Number(snap.projected_cost_usd ?? 0);

  return (
    <Card className="surface-elevated">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-sm font-semibold">{providerName}</CardTitle>
            <p className="text-xs text-muted-foreground">{connName}</p>
          </div>
          <Button size="sm" variant="outline" onClick={onSync} disabled={syncing} className="h-8 gap-1.5">
            {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            Sync
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Plano</p>
          <p className="text-sm font-medium">{snap.plan_name ?? "—"}</p>
        </div>
        {pct !== null && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Uso do ciclo</span>
              <span className="font-numeric">{fmtNumber(used)} / {fmtNumber(included)} {snap.included_unit ?? ""}</span>
            </div>
            <Progress value={pct} className="h-1.5" />
          </div>
        )}
        {(period > 0 || projected > 0) && (
          <div className="grid grid-cols-2 gap-2 pt-2">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Gasto no ciclo</p>
              <p className="text-sm font-numeric font-semibold">US$ {period.toFixed(2)}</p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Projeção</p>
              <p className="text-sm font-numeric font-semibold">US$ {projected.toFixed(2)}</p>
            </div>
          </div>
        )}
        {snap.hard_limit_usd && (
          <div className="text-xs text-muted-foreground">
            Hard limit: <span className="font-numeric font-semibold text-foreground">US$ {Number(snap.hard_limit_usd).toFixed(2)}</span>
          </div>
        )}
        <p className="text-[10px] text-muted-foreground">Atualizado {fmtDateTime(snap.captured_at)}</p>
      </CardContent>
    </Card>
  );
}

function ManualInvoiceDialog({
  providers,
  onSaved,
}: {
  providers: { id: string; name: string }[];
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    provider_id: "",
    invoice_number: "",
    issued_at: new Date().toISOString().slice(0, 10),
    period_start: "",
    period_end: "",
    amount_usd: "",
    exchange_rate: "5.0",
    status: "paid",
    pdf_url: "",
    notes: "",
  });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!form.provider_id || !form.amount_usd) {
      toast.error("Fornecedor e valor USD são obrigatórios");
      return;
    }
    setSaving(true);
    const usd = Number(form.amount_usd);
    const rate = Number(form.exchange_rate) || 5;
    const { error } = await supabase.from("provider_invoices").insert({
      provider_id: form.provider_id,
      invoice_number: form.invoice_number || null,
      issued_at: form.issued_at || null,
      period_start: form.period_start || null,
      period_end: form.period_end || null,
      amount_usd: usd,
      exchange_rate: rate,
      amount_brl: usd * rate,
      status: form.status,
      pdf_url: form.pdf_url || null,
      notes: form.notes || null,
      source: "manual",
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Fatura cadastrada");
    setOpen(false);
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5"><Plus className="h-3.5 w-3.5" /> Adicionar fatura</Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Cadastrar fatura manual</DialogTitle>
          <DialogDescription>Use para faturas que não vêm por API (OpenAI, Firecrawl).</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <div className="grid gap-1.5">
            <Label>Fornecedor *</Label>
            <Select value={form.provider_id} onValueChange={(v) => setForm({ ...form, provider_id: v })}>
              <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>
                {providers.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Nº da fatura</Label>
              <Input value={form.invoice_number} onChange={(e) => setForm({ ...form, invoice_number: e.target.value })} />
            </div>
            <div className="grid gap-1.5">
              <Label>Emitida em</Label>
              <Input type="date" value={form.issued_at} onChange={(e) => setForm({ ...form, issued_at: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Início do período</Label>
              <Input type="date" value={form.period_start} onChange={(e) => setForm({ ...form, period_start: e.target.value })} />
            </div>
            <div className="grid gap-1.5">
              <Label>Fim do período</Label>
              <Input type="date" value={form.period_end} onChange={(e) => setForm({ ...form, period_end: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="grid gap-1.5">
              <Label>Valor USD *</Label>
              <Input type="number" step="0.01" value={form.amount_usd} onChange={(e) => setForm({ ...form, amount_usd: e.target.value })} />
            </div>
            <div className="grid gap-1.5">
              <Label>Câmbio</Label>
              <Input type="number" step="0.01" value={form.exchange_rate} onChange={(e) => setForm({ ...form, exchange_rate: e.target.value })} />
            </div>
            <div className="grid gap-1.5">
              <Label>Status</Label>
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="paid">Paga</SelectItem>
                  <SelectItem value="open">Em aberto</SelectItem>
                  <SelectItem value="void">Cancelada</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>PDF URL</Label>
            <Input value={form.pdf_url} onChange={(e) => setForm({ ...form, pdf_url: e.target.value })} placeholder="https://..." />
          </div>
          <div className="grid gap-1.5">
            <Label>Notas</Label>
            <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function GcpConfigDialog() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [conns, setConns] = useState<{ id: string; name: string; config: any; providers: { name: string } | null }[]>([]);
  const [connectionId, setConnectionId] = useState<string>("");
  const [saJson, setSaJson] = useState("");
  const [dataset, setDataset] = useState("");
  const [runProject, setRunProject] = useState("");

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("provider_connections")
      .select("id, name, config, providers(name)")
      .order("name");
    const list = (data ?? []).filter(
      (c: any) => c.providers?.name && /gemini|gcp|google/i.test(c.providers.name),
    ) as any;
    setConns(list);
    setLoading(false);
  };

  const selectConn = (id: string) => {
    setConnectionId(id);
    const c = conns.find((x) => x.id === id);
    const cfg = (c?.config ?? {}) as any;
    setSaJson(cfg.service_account_json ? JSON.stringify(cfg.service_account_json, null, 2) : "");
    setDataset(cfg.billing_export_dataset ?? "");
    setRunProject(cfg.billing_run_project ?? "");
  };

  const save = async () => {
    if (!connectionId) return toast.error("Selecione uma conexão");
    let parsed: any = null;
    if (saJson.trim()) {
      try {
        parsed = JSON.parse(saJson);
      } catch {
        return toast.error("Service Account JSON inválido");
      }
      if (!parsed.client_email || !parsed.private_key || !parsed.project_id) {
        return toast.error("JSON precisa ter client_email, private_key e project_id");
      }
    }
    setSaving(true);
    const current = conns.find((c) => c.id === connectionId)?.config ?? {};
    const nextConfig = {
      ...(current as any),
      ...(parsed ? { service_account_json: parsed } : {}),
      billing_export_dataset: dataset || null,
      billing_run_project: runProject || null,
    };
    const { error } = await supabase
      .from("provider_connections")
      .update({ config: nextConfig })
      .eq("id", connectionId);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Configuração GCP salva. Sincronize para importar os dados.");
    setOpen(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) load();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <FileText className="h-3.5 w-3.5" /> Configurar GCP
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Configurar GCP / BigQuery billing export</DialogTitle>
          <DialogDescription>
            Cole o JSON da service account com permissão BigQuery Data Viewer + Job User no dataset do billing export.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <div className="grid gap-1.5">
            <Label>Conexão</Label>
            <Select value={connectionId} onValueChange={selectConn} disabled={loading}>
              <SelectTrigger><SelectValue placeholder={loading ? "Carregando..." : "Selecione a conexão Gemini/GCP"} /></SelectTrigger>
              <SelectContent>
                {conns.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.providers?.name} — {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>Dataset do billing export *</Label>
            <Input
              value={dataset}
              onChange={(e) => setDataset(e.target.value)}
              placeholder="meu-projeto.billing_export"
            />
            <p className="text-[11px] text-muted-foreground">
              Formato: <code>projeto.dataset</code> (ou só <code>dataset</code> se estiver no mesmo projeto da SA).
            </p>
          </div>
          <div className="grid gap-1.5">
            <Label>Projeto de execução (opcional)</Label>
            <Input
              value={runProject}
              onChange={(e) => setRunProject(e.target.value)}
              placeholder="projeto onde as queries rodam (padrão: project_id da SA)"
            />
          </div>
          <div className="grid gap-1.5">
            <Label>Service Account JSON *</Label>
            <Textarea
              value={saJson}
              onChange={(e) => setSaJson(e.target.value)}
              placeholder={'{\n  "type": "service_account",\n  "project_id": "...",\n  "client_email": "...",\n  "private_key": "-----BEGIN PRIVATE KEY-----\\n..."\n}'}
              className="min-h-[180px] font-mono text-xs"
            />
            <p className="text-[11px] text-muted-foreground">
              Armazenado em <code>provider_connections.config</code> (acesso admin apenas via RLS).
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button onClick={save} disabled={saving || !connectionId}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
