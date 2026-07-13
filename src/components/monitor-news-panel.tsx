import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Newspaper, Plug, PlugZap, DownloadCloud, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  startMonitorNewsOAuth,
  getMonitorNewsStatus,
  disconnectMonitorNews,
  listMonitorNewsTools,
  importMonitorNewsWorkspaces,
} from "@/lib/monitor-news.functions";

export function MonitorNewsPanel() {
  const qc = useQueryClient();
  const status = useQuery({
    queryKey: ["monitor-news-status"],
    queryFn: () => getMonitorNewsStatus(),
  });
  const [toolsOpen, setToolsOpen] = useState(false);

  const tools = useQuery({
    queryKey: ["monitor-news-tools"],
    queryFn: () => listMonitorNewsTools(),
    enabled: false,
  });

  const connect = useMutation({
    mutationFn: async () => {
      const { authorizeUrl } = await startMonitorNewsOAuth({
        data: { origin: window.location.origin },
      });
      const popup = window.open(authorizeUrl, "mn-oauth", "width=600,height=720");
      if (!popup) throw new Error("Popup bloqueado. Permita popups e tente novamente.");
      return new Promise<void>((resolve, reject) => {
        const onMsg = (e: MessageEvent) => {
          if (e.origin !== window.location.origin) return;
          if (!e.data || e.data.type !== "monitor-news-oauth") return;
          window.removeEventListener("message", onMsg);
          clearInterval(t);
          popup.close();
          if (e.data.ok) resolve();
          else reject(new Error(e.data.error ?? "Falha na autenticação"));
        };
        window.addEventListener("message", onMsg);
        const t = setInterval(() => {
          if (popup.closed) {
            window.removeEventListener("message", onMsg);
            clearInterval(t);
            reject(new Error("Login cancelado."));
          }
        }, 500);
      });
    },
    onSuccess: () => {
      toast.success("Monitor News conectado.");
      qc.invalidateQueries({ queryKey: ["monitor-news-status"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Falha ao conectar"),
  });

  const disconnect = useMutation({
    mutationFn: () => disconnectMonitorNews(),
    onSuccess: () => {
      toast.success("Monitor News desconectado.");
      qc.invalidateQueries({ queryKey: ["monitor-news-status"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const importWs = useMutation({
    mutationFn: () => importMonitorNewsWorkspaces({ data: {} }),
    onSuccess: (res: any) => {
      toast.success(
        `Workspaces importados: ${res.imported} novo(s), ${res.updated} atualizado(s).`,
      );
      qc.invalidateQueries({ queryKey: ["clients"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const openTools = async () => {
    setToolsOpen(true);
    await tools.refetch();
  };

  const connected = status.data?.connected === true;

  return (
    <>
      <Card className="surface-elevated">
        <CardContent className="flex flex-col gap-3 py-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-blue-600/10 text-blue-600">
              <Newspaper className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="font-display text-sm font-semibold">Monitor News (MCP)</p>
              <p className="text-xs text-muted-foreground">
                {connected
                  ? `Conectado${status.data?.connected_at ? ` em ${new Date(status.data.connected_at).toLocaleString("pt-BR")}` : ""}. Importe workspaces como clientes.`
                  : "Conecte via OAuth para importar workspaces e ver créditos/custos por cliente."}
              </p>
            </div>
            {connected && (
              <Badge className="ml-2 bg-emerald-600/15 text-emerald-700 dark:text-emerald-400" variant="secondary">
                Conectado
              </Badge>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!connected ? (
              <Button onClick={() => connect.mutate()} disabled={connect.isPending} className="gap-1.5">
                <Plug className="h-4 w-4" />
                {connect.isPending ? "Conectando..." : "Conectar Monitor News"}
              </Button>
            ) : (
              <>
                <Button variant="outline" size="sm" onClick={openTools} className="gap-1.5">
                  <RefreshCw className="h-4 w-4" /> Ver ferramentas
                </Button>
                <Button
                  size="sm"
                  onClick={() => importWs.mutate()}
                  disabled={importWs.isPending}
                  className="gap-1.5"
                >
                  <DownloadCloud className="h-4 w-4" />
                  {importWs.isPending ? "Importando..." : "Importar workspaces"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => disconnect.mutate()}
                  className="gap-1.5 text-muted-foreground"
                >
                  <PlugZap className="h-4 w-4" /> Desconectar
                </Button>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog open={toolsOpen} onOpenChange={setToolsOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Ferramentas MCP disponíveis</DialogTitle>
          </DialogHeader>
          <div className="max-h-[60vh] space-y-2 overflow-auto">
            {tools.isFetching && <p className="text-sm text-muted-foreground">Carregando...</p>}
            {tools.error && (
              <p className="text-sm text-destructive">{(tools.error as Error).message}</p>
            )}
            {(tools.data?.tools as any[] | undefined)?.map((t) => (
              <div key={t.name} className="rounded-md border border-border/60 p-3 text-sm">
                <p className="font-mono font-semibold">{t.name}</p>
                {t.description && (
                  <p className="mt-1 text-xs text-muted-foreground">{t.description}</p>
                )}
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setToolsOpen(false)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
