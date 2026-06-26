import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { fmtDateTime } from "@/lib/format";
import { runProviderSync } from "@/lib/sync.functions";

export const Route = createFileRoute("/_authenticated/syncs")({
  head: () => ({ meta: [{ title: "Sincronizações — LeFil Cost Center" }] }),
  component: SyncsPage,
});

function SyncsPage() {
  const qc = useQueryClient();
  const sync = useServerFn(runProviderSync);

  const { data: logs = [], isLoading } = useQuery({
    queryKey: ["sync_logs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sync_logs")
        .select("*, providers(name), provider_connections(id,name)")
        .order("started_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const retry = useMutation({
    mutationFn: async (connection_id: string) => sync({ data: { connection_id } }),
    onSuccess: () => {
      toast.success("Re-executado");
      qc.invalidateQueries({ queryKey: ["sync_logs"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const statusVariant = (s: string) =>
    s === "success" ? "default" : s === "error" ? "destructive" : s === "running" ? "secondary" : "outline";

  return (
    <AppShell title="Sincronizações">
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Histórico de sincronizações</h2>
          <p className="text-sm text-muted-foreground">Todas as execuções automáticas e manuais.</p>
        </div>

        <Card className="border-border/60">
          <CardHeader>
            <CardTitle className="text-base">Execuções ({logs.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fornecedor</TableHead>
                  <TableHead>Início</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Duração</TableHead>
                  <TableHead>Registros</TableHead>
                  <TableHead>Mensagem</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">Carregando...</TableCell></TableRow>
                )}
                {!isLoading && logs.length === 0 && (
                  <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">Nenhuma sincronização ainda.</TableCell></TableRow>
                )}
                {logs.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="font-medium">{l.providers?.name ?? "—"}</TableCell>
                    <TableCell>{fmtDateTime(l.started_at)}</TableCell>
                    <TableCell><Badge variant={statusVariant(l.status) as any}>{l.status}</Badge></TableCell>
                    <TableCell>{l.duration_ms ? `${l.duration_ms} ms` : "—"}</TableCell>
                    <TableCell>{l.records_imported ?? 0}</TableCell>
                    <TableCell className="max-w-md truncate text-xs text-muted-foreground">{l.error_message ?? "—"}</TableCell>
                    <TableCell className="text-right">
                      {l.connection_id && (
                        <Button size="sm" variant="outline" onClick={() => retry.mutate(l.connection_id)} disabled={retry.isPending}>
                          <RefreshCw className={`mr-2 h-3.5 w-3.5 ${retry.isPending ? "animate-spin" : ""}`} />
                          Re-executar
                        </Button>
                      )}
                    </TableCell>
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
