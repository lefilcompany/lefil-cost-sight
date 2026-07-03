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
    <AppShell
      eyebrow="Sistema"
      title="Integrações"
      actions={
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="gap-1.5">
              <Plus className="h-4 w-4" /> Nova conexão
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="font-display">Nova conexão</DialogTitle>
            </DialogHeader>
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                create.mutate();
              }}
            >
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Nome</label>
                <input className={input} required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Fornecedor</label>
                <select className={input} required value={form.provider_id} onChange={(e) => setForm({ ...form, provider_id: e.target.value })}>
                  <option value="">— selecione —</option>
                  {providers.map((p: any) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Plataforma (opcional)</label>
                <select className={input} value={form.platform_id} onChange={(e) => setForm({ ...form, platform_id: e.target.value })}>
                  <option value="">— nenhuma —</option>
                  {platforms.map((p: any) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              <DialogFooter>
                <Button type="submit" disabled={create.isPending}>Salvar</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      }
    >
      <div className="space-y-6">
        <p className="max-w-2xl text-sm text-muted-foreground">
          Conecte fornecedores para sincronizar consumos automaticamente. Credenciais permanecem no servidor com segurança.
        </p>

        <Card className="surface-elevated overflow-hidden">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Fornecedor</TableHead>
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Plataforma</TableHead>
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Conexão</TableHead>
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Status</TableHead>
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Última sincronização</TableHead>
                  <TableHead className="text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {connections.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-16 text-center">
                      <div className="mx-auto max-w-sm space-y-2">
                        <div className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-muted text-muted-foreground">
                          <Plus className="h-4 w-4" />
                        </div>
                        <p className="font-display text-sm font-medium">Nenhuma conexão</p>
                        <p className="text-xs text-muted-foreground">Crie uma conexão para começar a sincronizar custos.</p>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
                {connections.map((c) => (
                  <TableRow key={c.id} className="border-border/50">
                    <TableCell className="font-medium">{c.providers?.name}</TableCell>
                    <TableCell className="text-sm">{c.platforms?.name ?? "—"}</TableCell>
                    <TableCell className="text-sm">{c.name}</TableCell>
                    <TableCell>
                      <Badge variant={c.status === "active" ? "default" : "secondary"} className="capitalize">{c.status}</Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{fmtDateTime(c.last_sync_at)}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 gap-1.5"
                        onClick={() => doSync.mutate(c.id)}
                        disabled={doSync.isPending}
                      >
                        <RefreshCw className={`h-3.5 w-3.5 ${doSync.isPending ? "animate-spin" : ""}`} />
                        Sincronizar
                      </Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8 hover:text-destructive" onClick={() => remove.mutate(c.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
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

