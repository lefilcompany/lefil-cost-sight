import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Check, Copy, History, KeyRound, Plus, RefreshCw, ShieldOff } from "lucide-react";
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
import { fmtDateTime } from "@/lib/format";
import {
  createIntegrationApiKey,
  getIntegrationApiKeyEvents,
  revokeIntegrationApiKey,
  rotateIntegrationApiKey,
} from "@/lib/api-keys.functions";

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
};

const ACTION_LABELS: Record<string, string> = {
  "api_key.created": "Chave criada",
  "api_key.rotated": "Chave rotacionada",
  "api_key.revoked": "Chave revogada",
  "api_key.used": "Chave utilizada",
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

function ApiKeysPage() {
  const queryClient = useQueryClient();
  const [secret, setSecret] = useState<{ value: string; title: string } | null>(null);
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState<ApiKey | null>(null);
  const [confirmRotate, setConfirmRotate] = useState<ApiKey | null>(null);

  const [name, setName] = useState("");
  const [environment, setEnvironment] = useState("production");
  const [expiresInDays, setExpiresInDays] = useState("");
  const [permissions, setPermissions] = useState<string[]>(["costs:read", "billing:read"]);

  const keysQuery = useQuery({
    queryKey: ["integration-api-keys"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("integration_api_keys")
        .select(
          "id, name, key_prefix, permissions, environment, status, expires_at, last_used_at, created_at",
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
    return { total: keys.length, active, revoked, expiring };
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
        },
      }),
    onSuccess: (result) => {
      setCreateOpen(false);
      setName("");
      setExpiresInDays("");
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
                      <TableHead>Último uso</TableHead>
                      <TableHead>Expira</TableHead>
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
                        <TableCell className="text-xs text-muted-foreground">
                          {key.last_used_at ? fmtDateTime(key.last_used_at) : "Nunca usada"}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {key.expires_at ? fmtDateTime(key.expires_at) : "Sem expiração"}
                        </TableCell>
                        <TableCell>{statusBadge(key)}</TableCell>
                        <TableCell>
                          <div className="flex justify-end gap-1">
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
