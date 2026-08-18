import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, KeyRound, PlugZap, RefreshCw, ShieldOff, Timer } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CollapsibleSection, EmptyState, KpiCard, LoadingState } from "@/components/ui-kit";
import { fmtDateTime } from "@/lib/format";
import {
  credentialAuditFn,
  listCredentialsFn,
  renewCredentialFn,
  revokeCredentialFn,
  testCredentialFn,
} from "@/lib/credentials.functions";

export const Route = createFileRoute("/_authenticated/credentials")({
  head: () => ({
    meta: [
      { title: "Credenciais das integrações — Quiwi Cost Center" },
      {
        name: "description",
        content:
          "Status de tokens e API keys por integração, expiração e ações de renovar, revogar e testar conexão.",
      },
      { property: "og:title", content: "Credenciais das integrações — Quiwi Cost Center" },
      {
        property: "og:description",
        content: "Veja status, validade e histórico das credenciais e teste cada conexão em um clique.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CredentialsPage,
});

type CredentialItem = Awaited<ReturnType<typeof listCredentialsFn>>["items"][number];

const HEALTH_META: Record<string, { label: string; className: string }> = {
  ok: { label: "Saudável", className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" },
  warning: { label: "Atenção", className: "bg-amber-500/10 text-amber-700 dark:text-amber-300" },
  expired: { label: "Expirada", className: "bg-destructive/10 text-destructive" },
  missing: { label: "Sem credencial", className: "bg-muted text-muted-foreground" },
  error: { label: "Com erro", className: "bg-destructive/10 text-destructive" },
};

const KIND_LABELS: Record<string, string> = {
  api_key: "API key",
  service_account: "Service account",
  oauth: "Token OAuth",
};

function expiryLabel(item: { expires_at: string | null; days_to_expire: number | null }) {
  if (!item.expires_at) return "Sem validade definida";
  const days = item.days_to_expire ?? 0;
  if (days < 0) return `Expirou em ${fmtDateTime(item.expires_at)}`;
  return `${fmtDateTime(item.expires_at)} · ${days} dia(s)`;
}

function RenewDialog({
  item,
  onClose,
}: {
  item: CredentialItem | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [apiKey, setApiKey] = useState("");
  const [expiresAt, setExpiresAt] = useState("");

  const renew = useMutation({
    mutationFn: async () => {
      if (!item) return null;
      return renewCredentialFn({
        data: {
          connection_id: item.connection_id,
          api_key: apiKey,
          expires_at: expiresAt ? new Date(`${expiresAt}T12:00:00`).toISOString() : null,
        },
      });
    },
    onSuccess: (result: any) => {
      if (result?.test?.ok) toast.success(`Credencial renovada. ${result.test.detail ?? ""}`);
      else toast.warning(`Credencial salva, mas o teste falhou: ${result?.test?.detail ?? "sem detalhes"}`);
      queryClient.invalidateQueries({ queryKey: ["credentials"] });
      setApiKey("");
      setExpiresAt("");
      onClose();
    },
    onError: (err: any) => toast.error(String(err?.message ?? err)),
  });

  return (
    <Dialog open={Boolean(item)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Renovar credencial — {item?.provider_name}</DialogTitle>
          <DialogDescription>
            A credencial anterior é substituída imediatamente e a conexão é testada em seguida.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="new-secret">
              {item?.kind === "service_account" ? "Service account JSON" : "Nova API key / token"}
            </Label>
            <Input
              id="new-secret"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={item?.kind === "service_account" ? '{"type":"service_account", ...}' : "sk-..."}
              autoComplete="off"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="expires">Validade (opcional)</Label>
            <Input id="expires" type="date" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} />
            <p className="text-xs text-muted-foreground">
              Usada para avisar com antecedência quando a credencial estiver perto de vencer.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button disabled={renew.isPending || apiKey.trim().length < 8} onClick={() => renew.mutate()}>
            {renew.isPending ? "Renovando..." : "Renovar e testar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RevokeDialog({ item, onClose }: { item: CredentialItem | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [confirm, setConfirm] = useState("");

  const revoke = useMutation({
    mutationFn: async () => {
      if (!item) return null;
      return revokeCredentialFn({ data: { connection_id: item.connection_id } });
    },
    onSuccess: () => {
      toast.success("Credencial revogada. A conexão ficou inativa até uma nova credencial ser cadastrada.");
      queryClient.invalidateQueries({ queryKey: ["credentials"] });
      setConfirm("");
      onClose();
    },
    onError: (err: any) => toast.error(String(err?.message ?? err)),
  });

  return (
    <Dialog open={Boolean(item)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Revogar credencial — {item?.provider_name}</DialogTitle>
          <DialogDescription>
            A credencial é apagada do cofre e as sincronizações desta conexão param até você cadastrar outra.
            Digite <strong>REVOGAR</strong> para confirmar.
          </DialogDescription>
        </DialogHeader>
        <Input value={confirm} onChange={(event) => setConfirm(event.target.value)} placeholder="REVOGAR" />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            variant="destructive"
            disabled={confirm.trim().toUpperCase() !== "REVOGAR" || revoke.isPending}
            onClick={() => revoke.mutate()}
          >
            {revoke.isPending ? "Revogando..." : "Revogar credencial"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CredentialsPage() {
  const queryClient = useQueryClient();
  const [renewTarget, setRenewTarget] = useState<CredentialItem | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<CredentialItem | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["credentials"],
    queryFn: () => listCredentialsFn(),
  });

  const { data: audit } = useQuery({
    queryKey: ["credentials", "audit"],
    queryFn: () => credentialAuditFn(),
  });

  const test = useMutation({
    mutationFn: async (connectionId: string) => {
      setTestingId(connectionId);
      return testCredentialFn({ data: { connection_id: connectionId } });
    },
    onSuccess: (result: any) => {
      if (result?.ok) toast.success(`Conexão OK — ${result.detail}`);
      else toast.error(`Falha no teste — ${result?.detail ?? "sem detalhes"}`);
      queryClient.invalidateQueries({ queryKey: ["credentials"] });
    },
    onError: (err: any) => toast.error(String(err?.message ?? err)),
    onSettled: () => setTestingId(null),
  });

  const items = data?.items ?? [];
  const kpis = useMemo(() => {
    const healthy = items.filter((item) => item.health === "ok").length;
    const attention = items.filter((item) => item.health === "warning").length;
    const broken = items.filter((item) => item.health === "error" || item.health === "expired").length;
    const missing = items.filter((item) => item.health === "missing").length;
    return { healthy, attention, broken, missing };
  }, [items]);

  return (
    <AppShell
      title="Credenciais das integrações"
      actions={
        <Button
          variant="outline"
          className="gap-2"
          onClick={() => queryClient.invalidateQueries({ queryKey: ["credentials"] })}
        >
          <RefreshCw className="h-4 w-4" />
          Atualizar
        </Button>
      }
    >
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard label="Credenciais saudáveis" value={String(kpis.healthy)} tone="good" icon={<CheckCircle2 className="h-4 w-4" />} />
          <KpiCard label="Precisam de atenção" value={String(kpis.attention)} tone="warn" icon={<Timer className="h-4 w-4" />} />
          <KpiCard label="Expiradas ou com erro" value={String(kpis.broken)} tone="bad" icon={<AlertTriangle className="h-4 w-4" />} />
          <KpiCard label="Sem credencial" value={String(kpis.missing)} icon={<KeyRound className="h-4 w-4" />} />

        </div>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <CardTitle className="text-base">Conexões de fornecedor</CardTitle>
            <Link to="/api-keys" className="text-xs text-muted-foreground underline">
              Chaves de API internas: {data?.api_keys.active ?? 0} ativas · {data?.api_keys.expiring ?? 0} a vencer
            </Link>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-6">
                <LoadingState />
              </div>
            ) : items.length === 0 ? (
              <div className="p-6">
                <EmptyState
                  title="Nenhuma conexão cadastrada"
                  description="Conecte um fornecedor para gerenciar credenciais aqui."
                />
              </div>
            ) : (
              <div className="w-full overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Integração</TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead>Credencial</TableHead>
                      <TableHead>Expiração</TableHead>
                      <TableHead>Último teste</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((item) => {
                      const meta = HEALTH_META[item.health] ?? HEALTH_META.warning;
                      return (
                        <TableRow key={item.connection_id}>
                          <TableCell>
                            <div className="font-medium">{item.provider_name}</div>
                            <div className="text-xs text-muted-foreground">{item.connection_name}</div>
                            {item.last_error ? (
                              <div className="mt-1 max-w-[280px] truncate text-xs text-destructive" title={item.last_error}>
                                {item.last_error}
                              </div>
                            ) : null}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {KIND_LABELS[item.kind] ?? item.kind}
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {item.secret_hint ?? <span className="text-muted-foreground">—</span>}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">{expiryLabel(item)}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {item.last_test_at ? (
                              <span className={item.last_test_ok ? "" : "text-destructive"}>
                                {fmtDateTime(item.last_test_at)}
                              </span>
                            ) : (
                              "Nunca testada"
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge className={meta.className}>{meta.label}</Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap justify-end gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                className="gap-1"
                                disabled={!item.supports_test || (test.isPending && testingId === item.connection_id)}
                                onClick={() => test.mutate(item.connection_id)}
                              >
                                <PlugZap className="h-3.5 w-3.5" />
                                {test.isPending && testingId === item.connection_id ? "Testando..." : "Testar"}
                              </Button>
                              <Button size="sm" variant="outline" className="gap-1" onClick={() => setRenewTarget(item)}>
                                <RefreshCw className="h-3.5 w-3.5" />
                                Renovar
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="gap-1 text-destructive"
                                disabled={!item.has_secret}
                                onClick={() => setRevokeTarget(item)}
                              >
                                <ShieldOff className="h-3.5 w-3.5" />
                                Revogar
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <CollapsibleSection title="Monitor News (OAuth)">
          <div className="space-y-2 p-4 text-sm">
            {data?.monitor_news.connected ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    className={
                      data.monitor_news.status === "active"
                        ? HEALTH_META.ok!.className
                        : HEALTH_META.expired!.className
                    }
                  >
                    {data.monitor_news.status === "active" ? "Token ativo" : "Token expirado"}
                  </Badge>
                  <span className="text-xs text-muted-foreground">{expiryLabel(data.monitor_news)}</span>
                </div>
                {data.monitor_news.scope ? (
                  <p className="text-xs text-muted-foreground">Escopos: {data.monitor_news.scope}</p>
                ) : null}
                {data.monitor_news.last_error ? (
                  <p className="text-xs text-destructive">{data.monitor_news.last_error}</p>
                ) : null}
                <Link to="/platforms" className="inline-block text-xs underline">
                  Reconectar ou desconectar em Centros de custo
                </Link>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                Monitor News não conectado.{" "}
                <Link to="/platforms" className="underline">
                  Conectar em Centros de custo
                </Link>
                .
              </p>
            )}
          </div>
        </CollapsibleSection>

        <CollapsibleSection title="Histórico de credenciais">
          <div className="p-0">
            {(audit ?? []).length === 0 ? (
              <div className="p-6">
                <EmptyState title="Sem eventos" description="Renovações, revogações e testes aparecem aqui." />
              </div>
            ) : (
              <div className="w-full overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Quando</TableHead>
                      <TableHead>Ação</TableHead>
                      <TableHead>Integração</TableHead>
                      <TableHead>Detalhe</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(audit ?? []).map((event: any) => (
                      <TableRow key={event.id}>
                        <TableCell className="text-xs text-muted-foreground">{fmtDateTime(event.occurred_at)}</TableCell>
                        <TableCell className="text-xs">{event.action}</TableCell>
                        <TableCell className="text-xs">{event.metadata?.provider ?? "—"}</TableCell>
                        <TableCell className="max-w-[360px] truncate text-xs text-muted-foreground">
                          {event.metadata?.detail ?? event.metadata?.expires_at ?? "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </CollapsibleSection>
      </div>

      <RenewDialog item={renewTarget} onClose={() => setRenewTarget(null)} />
      <RevokeDialog item={revokeTarget} onClose={() => setRevokeTarget(null)} />
    </AppShell>
  );
}
