import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Plus, Pencil, Trash2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { fmtDateTime } from "@/lib/format";
import { runProviderSync } from "@/lib/sync.functions";

export const Route = createFileRoute("/_authenticated/integrations")({
  head: () => ({ meta: [{ title: "Integrações — LeFil Cost Center" }] }),
  component: IntegrationsPage,
});

function IntegrationsPage() {
  const qc = useQueryClient();
  const sync = useServerFn(runProviderSync);

  const { data: connections = [] } = useQuery({
    queryKey: ["connections"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("provider_connections")
        .select("*, providers(name), platforms(name)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
  const { data: providers = [] } = useQuery({
    queryKey: ["providers"],
    queryFn: async () => (await supabase.from("providers").select("id,name").order("name")).data ?? [],
  });
  const { data: platforms = [] } = useQuery({
    queryKey: ["platforms"],
    queryFn: async () => (await supabase.from("platforms").select("id,name").order("name")).data ?? [],
  });

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({ name: "", provider_id: "", platform_id: "", status: "active" });
  const create = useMutation({
    mutationFn: async () => {
      const payload = { ...form, platform_id: form.platform_id || null };
      const { error } = await supabase.from("provider_connections").insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Conexão criada");
      qc.invalidateQueries({ queryKey: ["connections"] });
      setOpen(false);
      setForm({ name: "", provider_id: "", platform_id: "", status: "active" });
    },
    onError: (e: any) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("provider_connections").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["connections"] }),
  });

  const doSync = useMutation({
    mutationFn: async (id: string) => sync({ data: { connection_id: id } }),
    onSuccess: (res: any) => {
      if (res?.ok) toast.success("Sincronização concluída");
      else toast.message(res?.message ?? "Sincronização registrada");
      qc.invalidateQueries({ queryKey: ["connections"] });
      qc.invalidateQueries({ queryKey: ["sync_logs"] });
      qc.invalidateQueries({ queryKey: ["dashboard-entries"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const input = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm";

  return (
    <AppShell title="Integrações">
      <div className="space-y-6">
        <div className="flex items-end justify-between">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">Integrações</h2>
            <p className="text-sm text-muted-foreground">
              Conexões com fornecedores. Credenciais ficam armazenadas com segurança no servidor — nunca no frontend.
            </p>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" /> Nova conexão
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Nova conexão</DialogTitle>
              </DialogHeader>
              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  create.mutate();
                }}
              >
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Nome</label>
                  <input className={input} required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Fornecedor</label>
                  <select className={input} required value={form.provider_id} onChange={(e) => setForm({ ...form, provider_id: e.target.value })}>
                    <option value="">— selecione —</option>
                    {providers.map((p: any) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Plataforma (opcional)</label>
                  <select className={input} value={form.platform_id} onChange={(e) => setForm({ ...form, platform_id: e.target.value })}>
                    <option value="">— nenhuma —</option>
                    {platforms.map((p: any) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
                <DialogFooter>
                  <Button type="submit" disabled={create.isPending}>
                    Salvar
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        <Card className="border-border/60">
          <CardHeader>
            <CardTitle className="text-base">Conexões</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fornecedor</TableHead>
                  <TableHead>Plataforma</TableHead>
                  <TableHead>Conexão</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Última sincronização</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {connections.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground">
                      Nenhuma conexão. Crie uma para começar a sincronizar.
                    </TableCell>
                  </TableRow>
                )}
                {connections.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.providers?.name}</TableCell>
                    <TableCell>{c.platforms?.name ?? "—"}</TableCell>
                    <TableCell>{c.name}</TableCell>
                    <TableCell>
                      <Badge variant={c.status === "active" ? "default" : "secondary"}>{c.status}</Badge>
                    </TableCell>
                    <TableCell>{fmtDateTime(c.last_sync_at)}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => doSync.mutate(c.id)}
                        disabled={doSync.isPending}
                      >
                        <RefreshCw className={`mr-2 h-3.5 w-3.5 ${doSync.isPending ? "animate-spin" : ""}`} />
                        Sincronizar
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => remove.mutate(c.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
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
