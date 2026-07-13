import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Plus, RefreshCw, Trash2, Newspaper } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { fmtDateTime } from "@/lib/format";
import {
  startMonitorNewsOauth,
  getMonitorNewsStatus,
  syncMonitorNewsFn,
  disconnectMonitorNewsFn,
} from "@/lib/monitor-news.functions";

export function MonitorNewsCard() {
  const qc = useQueryClient();
  const start = useServerFn(startMonitorNewsOauth);
  const status = useServerFn(getMonitorNewsStatus);
  const sync = useServerFn(syncMonitorNewsFn);
  const disconnect = useServerFn(disconnectMonitorNewsFn);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["monitor_news_status"],
    queryFn: () => status({}),
  });

  useEffect(() => {
    const url = new URL(window.location.href);
    const mn = url.searchParams.get("mn");
    if (mn === "ok") {
      toast.success("Monitor News conectado");
      url.searchParams.delete("mn");
      window.history.replaceState({}, "", url.toString());
      refetch();
    } else if (mn === "err") {
      toast.error("Falha ao conectar Monitor News");
      url.searchParams.delete("mn");
      window.history.replaceState({}, "", url.toString());
    }
  }, [refetch]);

  const connectMut = useMutation({
    mutationFn: async () => start({ data: { origin: window.location.origin } }),
    onSuccess: (r: any) => {
      if (r?.authorize_url) window.location.href = r.authorize_url;
    },
    onError: (e: any) => toast.error(e.message ?? String(e)),
  });

  const syncMut = useMutation({
    mutationFn: async () => sync({}),
    onSuccess: (r: any) => {
      if (r?.ok) {
        toast.success(
          `Monitor News sincronizado: ${r.clients ?? 0} clientes, ${r.usage_rows ?? 0} usos`,
        );
      } else {
        toast.error(r?.message ?? "Falha na sincronização");
      }
      qc.invalidateQueries();
    },
    onError: (e: any) => toast.error(e.message ?? String(e)),
  });

  const disconnectMut = useMutation({
    mutationFn: async () => disconnect({}),
    onSuccess: () => {
      toast.success("Monitor News desconectado");
      qc.invalidateQueries({ queryKey: ["monitor_news_status"] });
    },
    onError: (e: any) => toast.error(e.message ?? String(e)),
  });

  return (
    <Card className="surface-elevated">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 font-display text-base">
          <Newspaper className="h-4 w-4 text-[color:var(--color-gold)]" />
          Monitor News (MCP)
          <Badge variant="outline" className="ml-1 text-[10px]">
            Plataforma integrada
          </Badge>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Conecte-se ao MCP do Monitor News para importar workspaces como clientes e sincronizar
          créditos/custos de cada um.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border/60 bg-muted/30 p-3 text-sm">
          {isLoading ? (
            <span className="text-muted-foreground">Verificando...</span>
          ) : data?.connected ? (
            <>
              <Badge className="bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/20">Conectado</Badge>
              <span className="text-xs text-muted-foreground">
                Desde {data.connected_at ? fmtDateTime(data.connected_at) : "—"}
                {data.expires_at ? ` · expira ${fmtDateTime(data.expires_at)}` : ""}
              </span>
            </>
          ) : (
            <>
              <Badge variant="outline">Desconectado</Badge>
              <span className="text-xs text-muted-foreground">
                Nenhuma conta admin autorizada.
              </span>
            </>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          {!data?.connected && (
            <Button onClick={() => connectMut.mutate()} disabled={connectMut.isPending} className="gap-1.5">
              <Plus className="h-4 w-4" />
              {connectMut.isPending ? "Abrindo..." : "Conectar Monitor News"}
            </Button>
          )}
          {data?.connected && (
            <>
              <Button onClick={() => syncMut.mutate()} disabled={syncMut.isPending} className="gap-1.5">
                <RefreshCw className={`h-4 w-4 ${syncMut.isPending ? "animate-spin" : ""}`} />
                {syncMut.isPending ? "Sincronizando..." : "Sincronizar agora"}
              </Button>
              <Button
                variant="outline"
                onClick={() => connectMut.mutate()}
                disabled={connectMut.isPending}
                className="gap-1.5"
              >
                <RefreshCw className="h-4 w-4" /> Reautenticar
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  if (confirm("Desconectar o Monitor News? Sincronizações vão parar até reconectar."))
                    disconnectMut.mutate();
                }}
                disabled={disconnectMut.isPending}
                className="gap-1.5"
              >
                <Trash2 className="h-4 w-4" /> Desconectar
              </Button>
            </>
          )}
        </div>

        <p className="text-[11px] text-muted-foreground">
          Sincronização automática diária via cron. Cada workspace vira um cliente com origem
          <code className="mx-1 rounded bg-muted px-1 font-numeric text-[10px]">monitor_news</code>.
        </p>
      </CardContent>
    </Card>
  );
}
