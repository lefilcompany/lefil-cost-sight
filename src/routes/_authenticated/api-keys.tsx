import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  Activity,
  Check,
  Copy,
  Eye,
  History,
  KeyRound,
  Plus,
  RefreshCw,
  ShieldOff,
  Target,
  Timer,
} from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, KpiCard, LoadingState } from "@/components/ui-kit";
import { supabase } from "@/integrations/supabase/client";
import { fmtBRL, fmtDate, fmtDateTime, fmtNumber } from "@/lib/format";
import {
  createIntegrationApiKey,
  getIntegrationApiKeyEvents,
  getIntegrationApiKeyMetrics,
  revealRotatedApiKeySecret,
  revokeIntegrationApiKey,
  rotateIntegrationApiKey,
  runIntegrationApiKeyRotation,
  updateIntegrationApiKeyRotation,
  updateIntegrationApiKeyScope,
} from "@/lib/api-keys.functions";
import { Switch } from "@/components/ui/switch";

export const Route = createFileRoute("/_authenticated/api-keys")({
  head: () => ({
    meta: [
      { title: "Chaves de API — Quiwi Cost Center" },
      {
        name: "description",
        content:
          "Crie, visualize, rotacione e revogue chaves de API de integração, com histórico de uso e auditoria.",
      },
      { property: "og:title", content: "Chaves de API — Quiwi Cost Center" },
      {
        property: "og:description",
        content: "Gestão completa das credenciais de integração: criação, rotação, revogação e histórico.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ApiKeysPage,
});

const PERMISSIONS = [
  { value: "costs:read", label: "Ler custos" },
  { value: "costs:write", label: "Lançar custos" },
  { value: "billing:read", label: "Ler consumo e planos" },
  { value: "alerts:read", label: "Ler alertas" },
  { value: "alerts:write", label: "Gerenciar alertas" },
  { value: "sync:trigger", label: "Disparar sincronizações" },
];

type ApiKey = {
  id: string;
  name: string;
  key_prefix: string;
  permissions: string[];
  environment: string;
  status: string;
  expires_at: string | null;
  last_used_at: string | null;
  created_at: string;
  auto_rotate: boolean;
  rotate_before_days: number;
  rotation_interval_days: number | null;
  last_rotated_at: string | null;
  rotation_count: number;
  next_rotation_at: string | null;
  pending_secret_at: string | null;
  scope_provider_ids: string[] | null;
  scope_platform_ids: string[] | null;
};

type ScopeOption = { id: string; name: string };

const ACTION_LABELS: Record<string, string> = {
  "api_key.created": "Chave criada",
  "api_key.rotated": "Chave rotacionada",
  "api_key.revoked": "Chave revogada",
  "api_key.used": "Chave utilizada",
  "api_key.auto_rotated": "Rotação automática executada",
  "api_key.scope_updated": "Escopo atualizado",
};

function isExpired(key: ApiKey) {
  return Boolean(key.expires_at && new Date(key.expires_at).getTime() < Date.now());
}

function statusBadge(key: ApiKey) {
  if (key.status === "revoked") {
    return <Badge className="bg-destructive/10 text-destructive">Revogada</Badge>;
  }
  if (isExpired(key)) {
    return <Badge className="bg-amber-500/10 text-amber-700 dark:text-amber-300">Expirada</Badge>;
  }
  return <Badge className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">Ativa</Badge>;
}

function SecretDialog({
  secret,
  onClose,
}: {
  secret: { value: string; title: string } | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <Dialog open={Boolean(secret)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{secret?.title ?? "Chave gerada"}</DialogTitle>
          <DialogDescription>
            Copie agora: por segurança, o valor completo não pode ser exibido novamente.
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-md border bg-muted/40 p-3 font-mono text-xs break-all">
          {secret?.value}
        </div>
        <DialogFooter>
          <Button
            className="gap-2"
            onClick={async () => {
              if (!secret) return;
              try {
                await navigator.clipboard.writeText(secret.value);
                setCopied(true);
                toast.success("Chave copiada");
              } catch {
                toast.error("Não foi possível copiar automaticamente");
              }
            }}
          >
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            Copiar chave
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function HistoryDialog({ keyId, onClose }: { keyId: string | null; onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ["api-key-events", keyId],
    enabled: Boolean(keyId),
    queryFn: () => getIntegrationApiKeyEvents({ data: { id: keyId! } }),
  });

  return (
    <Dialog open={Boolean(keyId)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[85vh] max-w-2xl flex-col">
        <DialogHeader>
          <DialogTitle>Histórico da chave</DialogTitle>
          <DialogDescription>
            Eventos de criação, rotação, revogação e uso registrados na auditoria.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {isLoading ? (
            <LoadingState />
          ) : !data?.events.length ? (
            <EmptyState
              title="Sem eventos registrados"
              description="Ainda não há histórico de uso disponível para esta chave."
            />
          ) : (
            <ul className="space-y-2">
              {data.events.map((event) => (
                <li key={event.id} className="rounded-md border p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{ACTION_LABELS[event.action] ?? event.action}</span>
                    <span className="text-xs text-muted-foreground">{fmtDateTime(event.occurred_at)}</span>
                  </div>
                  {event.metadata ? (
                    <pre className="mt-2 overflow-x-auto rounded bg-muted/40 p-2 text-[11px]">
                      {JSON.stringify(event.metadata, null, 2)}
                    </pre>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RotationDialog({
  apiKey,
  onClose,
  onSaved,
}: {
  apiKey: ApiKey | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [enabled, setEnabled] = useState(false);
  const [beforeDays, setBeforeDays] = useState("7");
  const [intervalDays, setIntervalDays] = useState("");
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  if (apiKey && loadedFor !== apiKey.id) {
    setLoadedFor(apiKey.id);
    setEnabled(apiKey.auto_rotate);
    setBeforeDays(String(apiKey.rotate_before_days ?? 7));
    setIntervalDays(apiKey.rotation_interval_days ? String(apiKey.rotation_interval_days) : "");
  }

  const save = useMutation({
    mutationFn: () =>
      updateIntegrationApiKeyRotation({
        data: {
          id: apiKey!.id,
          autoRotate: enabled,
          rotateBeforeDays: Math.max(1, Number(beforeDays) || 7),
          rotationIntervalDays: intervalDays ? Number(intervalDays) : null,
        },
      }),
    onSuccess: () => {
      toast.success(enabled ? "Rotação automática ativada" : "Rotação automática desativada");
      onSaved();
    },
    onError: (error: Error) => toast.error(error.message || "Falha ao salvar política"),
  });

  const runNow = useMutation({
    mutationFn: () => runIntegrationApiKeyRotation({ data: { id: apiKey!.id, force: true } }),
    onSuccess: (result: any) => {
      if (result?.rotated) {
        toast.success("Chave rotacionada. Use \u201cRevelar nova chave\u201d para copiar o novo valor.");
      } else {
        toast.warning(
          result?.results?.[0]?.message ??
            "Nada rotacionado: ative a rotação automática e defina uma data de expiração.",
        );
      }
      onSaved();
    },
    onError: (error: Error) => toast.error(error.message || "Falha ao rotacionar agora"),
  });

  return (
    <Dialog open={Boolean(apiKey)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[90vh] max-w-lg flex-col">
        <DialogHeader>
          <DialogTitle>Rotação automática</DialogTitle>
          <DialogDescription>
            A chave é regenerada automaticamente antes de expirar. O novo valor fica guardado com segurança
            e pode ser revelado uma única vez por um administrador.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
          <label className="flex items-start justify-between gap-3 rounded-lg border p-3">
            <span className="text-sm">
              <span className="font-medium">Rotacionar automaticamente</span>
              <span className="block text-xs text-muted-foreground">
                Requer data de expiração definida na chave.
              </span>
            </span>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="rot-before">Antecedência (dias)</Label>
              <Input
                id="rot-before"
                type="number"
                min={1}
                value={beforeDays}
                onChange={(event) => setBeforeDays(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rot-interval">Nova validade (dias)</Label>
              <Input
                id="rot-interval"
                type="number"
                min={1}
                value={intervalDays}
                onChange={(event) => setIntervalDays(event.target.value)}
                placeholder="Manter validade atual"
              />
            </div>
          </div>

          <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
            {apiKey?.expires_at
              ? `Expira em ${fmtDateTime(apiKey.expires_at)}. ${
                  apiKey.next_rotation_at
                    ? `Rotação prevista para ${fmtDateTime(apiKey.next_rotation_at)}.`
                    : "A rotação prevista será calculada ao salvar."
                }`
              : "Esta chave não possui data de expiração — a rotação automática não será executada."}
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            className="gap-2"
            disabled={runNow.isPending || !apiKey}
            onClick={() => runNow.mutate()}
          >
            <RefreshCw className="h-4 w-4" /> Rotacionar agora
          </Button>
          <Button disabled={save.isPending || !apiKey} onClick={() => save.mutate()}>
            Salvar política
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function useScopeOptions() {
  return useQuery({
    queryKey: ["api-key-scope-options"],
    queryFn: async () => {
      const [providers, platforms] = await Promise.all([
        supabase.from("providers").select("id, name").order("name"),
        supabase.from("platforms").select("id, name").order("name"),
      ]);
      if (providers.error) throw providers.error;
      if (platforms.error) throw platforms.error;
      return {
        providers: (providers.data ?? []) as ScopeOption[],
        platforms: (platforms.data ?? []) as ScopeOption[],
      };
    },
    staleTime: 60_000,
  });
}

function ScopePicker({
  options,
  selected,
  onToggle,
  emptyLabel,
}: {
  options: ScopeOption[];
  selected: string[];
  onToggle: (id: string, checked: boolean) => void;
  emptyLabel: string;
}) {
  if (!options.length) {
    return <p className="text-xs text-muted-foreground">{emptyLabel}</p>;
  }
  return (
    <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border p-2">
      {options.map((option) => (
        <label key={option.id} className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={selected.includes(option.id)}
            onCheckedChange={(checked) => onToggle(option.id, Boolean(checked))}
          />
          <span className="truncate">{option.name}</span>
        </label>
      ))}
    </div>
  );
}

function ScopeDialog({
  apiKey,
  onClose,
  onSaved,
}: {
  apiKey: ApiKey | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const optionsQuery = useScopeOptions();
  const [providerIds, setProviderIds] = useState<string[]>([]);
  const [platformIds, setPlatformIds] = useState<string[]>([]);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  if (apiKey && loadedFor !== apiKey.id) {
    setLoadedFor(apiKey.id);
    setProviderIds(apiKey.scope_provider_ids ?? []);
    setPlatformIds(apiKey.scope_platform_ids ?? []);
  }

  const save = useMutation({
    mutationFn: () =>
      updateIntegrationApiKeyScope({
        data: { id: apiKey!.id, scopeProviderIds: providerIds, scopePlatformIds: platformIds },
      }),
    onSuccess: () => {
      toast.success("Escopo atualizado");
      onSaved();
    },
    onError: (error: Error) => toast.error(error.message || "Falha ao salvar escopo"),
  });

  const toggle = (setter: typeof setProviderIds) => (id: string, checked: boolean) =>
    setter((prev) => (checked ? [...new Set([...prev, id])] : prev.filter((item) => item !== id)));

  return (
    <Dialog open={Boolean(apiKey)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[90vh] max-w-lg flex-col">
        <DialogHeader>
          <DialogTitle>Escopo de acesso</DialogTitle>
          <DialogDescription>
            Limite quais fornecedores e plataformas esta chave pode consultar. Sem seleção, o acesso é
            liberado para todos.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
          {optionsQuery.isLoading ? (
            <LoadingState />
          ) : (
            <>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Fornecedores</Label>
                  {providerIds.length ? (
                    <Button variant="ghost" size="sm" onClick={() => setProviderIds([])}>
                      Liberar todos
                    </Button>
                  ) : (
                    <Badge variant="secondary" className="text-[10px]">Todos</Badge>
                  )}
                </div>
                <ScopePicker
                  options={optionsQuery.data?.providers ?? []}
                  selected={providerIds}
                  onToggle={toggle(setProviderIds)}
                  emptyLabel="Nenhum fornecedor cadastrado."
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Plataformas</Label>
                  {platformIds.length ? (
                    <Button variant="ghost" size="sm" onClick={() => setPlatformIds([])}>
                      Liberar todas
                    </Button>
                  ) : (
                    <Badge variant="secondary" className="text-[10px]">Todas</Badge>
                  )}
                </div>
                <ScopePicker
                  options={optionsQuery.data?.platforms ?? []}
                  selected={platformIds}
                  onToggle={toggle(setPlatformIds)}
                  emptyLabel="Nenhuma plataforma cadastrada."
                />
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button disabled={save.isPending || !apiKey} onClick={() => save.mutate()}>
            {save.isPending ? "Salvando…" : "Salvar escopo"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MetricsDialog({ apiKey, onClose }: { apiKey: ApiKey | null; onClose: () => void }) {
  const [days, setDays] = useState("30");

  const metricsQuery = useQuery({
    queryKey: ["api-key-metrics", apiKey?.id, days],
    enabled: Boolean(apiKey),
    queryFn: () => getIntegrationApiKeyMetrics({ data: { id: apiKey!.id, days: Number(days) } }),
  });

  const metrics = metricsQuery.data;
  const chartData = useMemo(
    () =>
      (metrics?.daily ?? []).map((item) => ({
        label: fmtDate(item.day),
        requests: item.requests,
        cost: Number(item.estimatedCostBrl.toFixed(2)),
      })),
    [metrics],
  );

  return (
    <Dialog open={Boolean(apiKey)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[90vh] max-w-3xl flex-col">
        <DialogHeader>
          <DialogTitle>Métricas de uso — {apiKey?.name}</DialogTitle>
          <DialogDescription>
            Solicitações por dia registradas para esta chave e custo estimado associado quando a
            integração informa esse valor.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Label className="text-xs text-muted-foreground">Período</Label>
            <Select value={days} onValueChange={setDays}>
              <SelectTrigger className="w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">Últimos 7 dias</SelectItem>
                <SelectItem value="30">Últimos 30 dias</SelectItem>
                <SelectItem value="90">Últimos 90 dias</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {metricsQuery.isLoading ? (
            <LoadingState />
          ) : !metrics ? (
            <EmptyState title="Sem métricas" description="Não foi possível carregar as métricas." />
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <KpiCard label="Solicitações" value={fmtNumber(metrics.totals.requests)} />
                <KpiCard label="Média/dia" value={fmtNumber(metrics.totals.avgRequestsPerDay, 1)} />
                <KpiCard
                  label="Custo estimado"
                  value={metrics.hasCostData ? fmtBRL(metrics.totals.estimatedCostBrl) : "—"}
                  tone={metrics.hasCostData ? "warn" : "neutral"}
                />
                <KpiCard
                  label={metrics.scope.unrestricted ? "Custo total do período" : "Custo do escopo"}
                  value={fmtBRL(metrics.totals.scopedCostBrl)}
                />
              </div>

              <div className="rounded-lg border p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium">Solicitações por dia</span>
                  <span className="text-xs text-muted-foreground">
                    {metrics.totals.lastRequestAt
                      ? `Último uso: ${fmtDateTime(metrics.totals.lastRequestAt)}`
                      : "Nenhum uso registrado no período"}
                  </span>
                </div>
                {metrics.hasRequestData ? (
                  <div className="h-56 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chartData}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                        <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={32} />
                        <Tooltip
                          formatter={(value: number, name) =>
                            name === "cost" ? fmtBRL(value) : fmtNumber(value)
                          }
                        />
                        <Bar dataKey="requests" name="Solicitações" fill="var(--color-primary)" radius={[3, 3, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <EmptyState
                    title="Nenhuma solicitação registrada"
                    description="As métricas aparecem aqui conforme as integrações consomem a API com esta chave."
                  />
                )}
              </div>

              {metrics.hasRequestData ? (
                <div className="w-full overflow-x-auto rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Dia</TableHead>
                        <TableHead className="text-right">Solicitações</TableHead>
                        <TableHead className="text-right">Custo estimado</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {metrics.daily
                        .filter((item) => item.requests > 0)
                        .reverse()
                        .map((item) => (
                          <TableRow key={item.day}>
                            <TableCell className="text-xs">{fmtDate(item.day)}</TableCell>
                            <TableCell className="text-right text-xs">{fmtNumber(item.requests)}</TableCell>
                            <TableCell className="text-right text-xs">
                              {item.estimatedCostBrl ? fmtBRL(item.estimatedCostBrl) : "—"}
                            </TableCell>
                          </TableRow>
                        ))}
                    </TableBody>
                  </Table>
                </div>
              ) : null}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ApiKeysPage() {
  const queryClient = useQueryClient();
  const [secret, setSecret] = useState<{ value: string; title: string } | null>(null);
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState<ApiKey | null>(null);
  const [confirmRotate, setConfirmRotate] = useState<ApiKey | null>(null);
  const [rotationKey, setRotationKey] = useState<ApiKey | null>(null);
  const [scopeKey, setScopeKey] = useState<ApiKey | null>(null);
  const [metricsKey, setMetricsKey] = useState<ApiKey | null>(null);

  const [name, setName] = useState("");
  const [environment, setEnvironment] = useState("production");
  const [expiresInDays, setExpiresInDays] = useState("");
  const [permissions, setPermissions] = useState<string[]>(["costs:read", "billing:read"]);
  const [scopeProviderIds, setScopeProviderIds] = useState<string[]>([]);
  const [scopePlatformIds, setScopePlatformIds] = useState<string[]>([]);
  const scopeOptions = useScopeOptions();
  const providerNames = useMemo(
    () => new Map((scopeOptions.data?.providers ?? []).map((item) => [item.id, item.name])),
    [scopeOptions.data],
  );
  const platformNames = useMemo(
    () => new Map((scopeOptions.data?.platforms ?? []).map((item) => [item.id, item.name])),
    [scopeOptions.data],
  );

  const keysQuery = useQuery({
    queryKey: ["integration-api-keys"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("integration_api_keys")
        .select(
          "id, name, key_prefix, permissions, environment, status, expires_at, last_used_at, created_at, auto_rotate, rotate_before_days, rotation_interval_days, last_rotated_at, rotation_count, next_rotation_at, pending_secret_at, scope_provider_ids, scope_platform_ids",
        )
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ApiKey[];
    },
  });

  const keys = keysQuery.data ?? [];

  const kpis = useMemo(() => {
    const active = keys.filter((k) => k.status === "active" && !isExpired(k)).length;
    const revoked = keys.filter((k) => k.status === "revoked").length;
    const expiring = keys.filter(
      (k) =>
        k.status === "active" &&
        k.expires_at &&
        new Date(k.expires_at).getTime() - Date.now() < 30 * 86_400_000 &&
        !isExpired(k),
    ).length;
    const autoRotate = keys.filter((k) => k.auto_rotate && k.status === "active").length;
    return { total: keys.length, active, revoked, expiring, autoRotate };
  }, [keys]);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["integration-api-keys"] });
  };

  const create = useMutation({
    mutationFn: () =>
      createIntegrationApiKey({
        data: {
          name: name.trim(),
          environment: environment as "production" | "sandbox",
          permissions,
          expiresInDays: expiresInDays ? Number(expiresInDays) : null,
          scopeProviderIds,
          scopePlatformIds,
        },
      }),
    onSuccess: (result) => {
      setCreateOpen(false);
      setName("");
      setExpiresInDays("");
      setScopeProviderIds([]);
      setScopePlatformIds([]);
      setSecret({ value: result.secret, title: "Nova chave criada" });
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message || "Falha ao criar chave"),
  });

  const rotate = useMutation({
    mutationFn: (id: string) => rotateIntegrationApiKey({ data: { id } }),
    onSuccess: (result) => {
      setConfirmRotate(null);
      setSecret({ value: result.secret, title: "Chave rotacionada" });
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message || "Falha ao rotacionar chave"),
  });

  const reveal = useMutation({
    mutationFn: (id: string) => revealRotatedApiKeySecret({ data: { id } }),
    onSuccess: (result) => {
      setSecret({ value: result.secret, title: "Chave gerada pela rotação automática" });
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message || "Falha ao revelar chave"),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => revokeIntegrationApiKey({ data: { id } }),
    onSuccess: () => {
      setConfirmRevoke(null);
      toast.success("Chave revogada");
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message || "Falha ao revogar chave"),
  });

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight">Chaves de API</h1>
            <p className="text-sm text-muted-foreground">
              Credenciais para integrações externas consumirem os dados de custos.
            </p>
          </div>
          <Button className="gap-2" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> Nova chave
          </Button>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard label="Total" value={String(kpis.total)} />
          <KpiCard label="Ativas" value={String(kpis.active)} tone="good" />
          <KpiCard label="Expirando em 30d" value={String(kpis.expiring)} tone={kpis.expiring ? "warn" : "neutral"} />
          <KpiCard label="Rotação automática" value={String(kpis.autoRotate)} tone={kpis.autoRotate ? "good" : "neutral"} />
          <KpiCard label="Revogadas" value={String(kpis.revoked)} tone={kpis.revoked ? "bad" : "neutral"} />
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <KeyRound className="h-4 w-4" /> Chaves cadastradas
            </CardTitle>
          </CardHeader>
          <CardContent>
            {keysQuery.isLoading ? (
              <LoadingState />
            ) : !keys.length ? (
              <EmptyState
                title="Nenhuma chave criada"
                description="Crie uma chave de API para permitir que integrações externas acessem os dados."
              />
            ) : (
              <div className="w-full overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nome</TableHead>
                      <TableHead>Prefixo</TableHead>
                      <TableHead>Ambiente</TableHead>
                      <TableHead>Permissões</TableHead>
                      <TableHead>Escopo</TableHead>
                      <TableHead>Último uso</TableHead>
                      <TableHead>Expira</TableHead>
                      <TableHead>Rotação automática</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {keys.map((key) => (
                      <TableRow key={key.id}>
                        <TableCell className="font-medium">{key.name}</TableCell>
                        <TableCell className="font-mono text-xs">{key.key_prefix}…</TableCell>
                        <TableCell className="text-xs">
                          {key.environment === "sandbox" ? "Sandbox" : "Produção"}
                        </TableCell>
                        <TableCell className="max-w-[240px]">
                          <div className="flex flex-wrap gap-1">
                            {(key.permissions ?? []).map((permission) => (
                              <Badge key={permission} variant="secondary" className="text-[10px]">
                                {permission}
                              </Badge>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell className="max-w-[220px] text-xs">
                          <div className="flex flex-wrap gap-1">
                            {(key.scope_provider_ids ?? []).length === 0 &&
                            (key.scope_platform_ids ?? []).length === 0 ? (
                              <Badge variant="secondary" className="text-[10px]">
                                Acesso total
                              </Badge>
                            ) : (
                              <>
                                {(key.scope_provider_ids ?? []).map((id) => (
                                  <Badge key={id} className="bg-primary/10 text-[10px] text-primary">
                                    {providerNames.get(id) ?? "Fornecedor"}
                                  </Badge>
                                ))}
                                {(key.scope_platform_ids ?? []).map((id) => (
                                  <Badge key={id} variant="outline" className="text-[10px]">
                                    {platformNames.get(id) ?? "Plataforma"}
                                  </Badge>
                                ))}
                              </>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {key.last_used_at ? fmtDateTime(key.last_used_at) : "Nunca usada"}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {key.expires_at ? fmtDateTime(key.expires_at) : "Sem expiração"}
                        </TableCell>
                        <TableCell className="text-xs">
                          {key.auto_rotate ? (
                            <div className="space-y-0.5">
                              <Badge className="bg-primary/10 text-primary">
                                {key.rotate_before_days}d antes
                              </Badge>
                              <div className="text-muted-foreground">
                                {key.next_rotation_at
                                  ? `Próxima: ${fmtDateTime(key.next_rotation_at)}`
                                  : "Sem expiração definida"}
                              </div>
                              {key.rotation_count ? (
                                <div className="text-muted-foreground">
                                  {key.rotation_count} rotação(ões) · última {key.last_rotated_at ? fmtDateTime(key.last_rotated_at) : "—"}
                                </div>
                              ) : null}
                            </div>
                          ) : (
                            <span className="text-muted-foreground">Desativada</span>
                          )}
                        </TableCell>
                        <TableCell>{statusBadge(key)}</TableCell>
                        <TableCell>
                          <div className="flex justify-end gap-1">
                            {key.pending_secret_at ? (
                              <Button
                                variant="secondary"
                                size="sm"
                                className="gap-1"
                                disabled={reveal.isPending}
                                onClick={() => reveal.mutate(key.id)}
                              >
                                <Eye className="h-3.5 w-3.5" /> Revelar nova chave
                              </Button>
                            ) : null}
                            <Button
                              variant="ghost"
                              size="sm"
                              className="gap-1"
                              onClick={() => setMetricsKey(key)}
                            >
                              <Activity className="h-3.5 w-3.5" /> Métricas
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="gap-1"
                              disabled={key.status === "revoked"}
                              onClick={() => setScopeKey(key)}
                            >
                              <Target className="h-3.5 w-3.5" /> Escopo
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="gap-1"
                              disabled={key.status === "revoked"}
                              onClick={() => setRotationKey(key)}
                            >
                              <Timer className="h-3.5 w-3.5" /> Rotação automática
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => setHistoryId(key.id)} className="gap-1">
                              <History className="h-3.5 w-3.5" /> Histórico
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="gap-1"
                              disabled={key.status === "revoked"}
                              onClick={() => setConfirmRotate(key)}
                            >
                              <RefreshCw className="h-3.5 w-3.5" /> Rotacionar
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="gap-1 text-destructive"
                              disabled={key.status === "revoked"}
                              onClick={() => setConfirmRevoke(key)}
                            >
                              <ShieldOff className="h-3.5 w-3.5" /> Revogar
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <MetricsDialog apiKey={metricsKey} onClose={() => setMetricsKey(null)} />

      <ScopeDialog
        apiKey={scopeKey}
        onClose={() => setScopeKey(null)}
        onSaved={() => {
          setScopeKey(null);
          invalidate();
        }}
      />

      <RotationDialog
        apiKey={rotationKey}
        onClose={() => setRotationKey(null)}
        onSaved={() => {
          setRotationKey(null);
          invalidate();
        }}
      />

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="flex max-h-[90vh] max-w-lg flex-col">
          <DialogHeader>
            <DialogTitle>Nova chave de API</DialogTitle>
            <DialogDescription>
              A chave completa é exibida apenas uma vez, imediatamente após a criação.
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
            <div className="space-y-2">
              <Label htmlFor="key-name">Nome</Label>
              <Input
                id="key-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Ex.: Integração BI"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Ambiente</Label>
                <Select value={environment} onValueChange={setEnvironment}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="production">Produção</SelectItem>
                    <SelectItem value="sandbox">Sandbox</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="key-expires">Expira em (dias)</Label>
                <Input
                  id="key-expires"
                  type="number"
                  min={1}
                  value={expiresInDays}
                  onChange={(event) => setExpiresInDays(event.target.value)}
                  placeholder="Opcional"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Permissões</Label>
              <div className="grid gap-2 sm:grid-cols-2">
                {PERMISSIONS.map((permission) => (
                  <label key={permission.value} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={permissions.includes(permission.value)}
                      onCheckedChange={(checked) =>
                        setPermissions((prev) =>
                          checked
                            ? [...new Set([...prev, permission.value])]
                            : prev.filter((item) => item !== permission.value),
                        )
                      }
                    />
                    {permission.label}
                  </label>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label>Escopo de fornecedores</Label>
              <ScopePicker
                options={scopeOptions.data?.providers ?? []}
                selected={scopeProviderIds}
                onToggle={(id, checked) =>
                  setScopeProviderIds((prev) =>
                    checked ? [...new Set([...prev, id])] : prev.filter((item) => item !== id),
                  )
                }
                emptyLabel="Nenhum fornecedor cadastrado."
              />
              <p className="text-xs text-muted-foreground">Sem seleção: acesso a todos os fornecedores.</p>
            </div>
            <div className="space-y-2">
              <Label>Escopo de plataformas</Label>
              <ScopePicker
                options={scopeOptions.data?.platforms ?? []}
                selected={scopePlatformIds}
                onToggle={(id, checked) =>
                  setScopePlatformIds((prev) =>
                    checked ? [...new Set([...prev, id])] : prev.filter((item) => item !== id),
                  )
                }
                emptyLabel="Nenhuma plataforma cadastrada."
              />
              <p className="text-xs text-muted-foreground">Sem seleção: acesso a todas as plataformas.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() => create.mutate()}
              disabled={create.isPending || name.trim().length < 2 || permissions.length === 0}
            >
              {create.isPending ? "Criando…" : "Criar chave"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(confirmRotate)} onOpenChange={(open) => !open && setConfirmRotate(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Rotacionar chave</DialogTitle>
            <DialogDescription>
              A chave atual de “{confirmRotate?.name}” deixa de funcionar imediatamente e uma nova é gerada.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmRotate(null)}>
              Cancelar
            </Button>
            <Button
              onClick={() => confirmRotate && rotate.mutate(confirmRotate.id)}
              disabled={rotate.isPending}
            >
              {rotate.isPending ? "Rotacionando…" : "Rotacionar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(confirmRevoke)} onOpenChange={(open) => !open && setConfirmRevoke(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Revogar chave</DialogTitle>
            <DialogDescription>
              “{confirmRevoke?.name}” perderá o acesso permanentemente. Essa ação não pode ser desfeita.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmRevoke(null)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={() => confirmRevoke && revoke.mutate(confirmRevoke.id)}
              disabled={revoke.isPending}
            >
              {revoke.isPending ? "Revogando…" : "Revogar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SecretDialog secret={secret} onClose={() => setSecret(null)} />
      <HistoryDialog keyId={historyId} onClose={() => setHistoryId(null)} />
    </AppShell>
  );
}
