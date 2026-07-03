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
    <AppShell eyebrow="Análise" title="Sincronizações">
      <div className="space-y-6">
        <p className="max-w-2xl text-sm text-muted-foreground">
          Histórico completo de execuções automáticas e manuais. Re-execute qualquer conexão diretamente daqui.
        </p>

        <Card className="surface-elevated overflow-hidden">
          <CardHeader className="border-b border-border/60 py-4">
            <CardTitle className="font-display text-base">Execuções ({logs.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Fornecedor</TableHead>
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Início</TableHead>
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Status</TableHead>
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Duração</TableHead>
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Registros</TableHead>
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Mensagem</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow><TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">Carregando...</TableCell></TableRow>
                )}
                {!isLoading && logs.length === 0 && (
                  <TableRow><TableCell colSpan={7} className="py-16 text-center">
                    <div className="mx-auto max-w-sm space-y-2">
                      <div className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-muted text-muted-foreground">
                        <RefreshCw className="h-4 w-4" />
                      </div>
                      <p className="font-display text-sm font-medium">Nenhuma sincronização ainda</p>
                      <p className="text-xs text-muted-foreground">Execute uma conexão em Integrações para começar.</p>
                    </div>
                  </TableCell></TableRow>
                )}
                {logs.map((l) => (
                  <TableRow key={l.id} className="border-border/50">
                    <TableCell className="font-medium">{l.providers?.name ?? "—"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{fmtDateTime(l.started_at)}</TableCell>
                    <TableCell><Badge variant={statusVariant(l.status) as any} className="capitalize">{l.status}</Badge></TableCell>
                    <TableCell className="font-numeric text-sm">{l.duration_ms ? `${l.duration_ms} ms` : "—"}</TableCell>
                    <TableCell className="font-numeric text-sm">{l.records_imported ?? 0}</TableCell>
                    <TableCell className="max-w-md truncate text-xs text-muted-foreground">{l.error_message ?? "—"}</TableCell>
                    <TableCell className="text-right">
                      {l.connection_id && (
                        <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => retry.mutate(l.connection_id)} disabled={retry.isPending}>
                          <RefreshCw className={`h-3.5 w-3.5 ${retry.isPending ? "animate-spin" : ""}`} />
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

