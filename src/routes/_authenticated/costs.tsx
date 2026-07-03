import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Plus, Pencil, Trash2 } from "lucide-react";
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
import { fmtBRL, fmtDate, fmtUSD } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/costs")({
  head: () => ({ meta: [{ title: "Custos — LeFil Cost Center" }] }),
  component: CostsPage,
});

type Cost = any;

function CostsPage() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState({ platform: "", provider: "", client: "", origin: "" });

  const { data: costs = [], isLoading } = useQuery({
    queryKey: ["costs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cost_entries")
        .select("*, providers(name), platforms(name), clients(name)")
        .order("entry_date", { ascending: false })
        .limit(500);
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
  const { data: clients = [] } = useQuery({
    queryKey: ["clients"],
    queryFn: async () => (await supabase.from("clients").select("id,name").order("name")).data ?? [],
  });

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Cost | null>(null);
  const [form, setForm] = useState<any>({});

  const empty = () => ({
    entry_date: new Date().toISOString().slice(0, 10),
    provider_id: "",
    platform_id: "",
    client_id: "",
    description: "",
    usage_quantity: "",
    usage_unit: "",
    cost_usd: "",
    exchange_rate: "",
    origin: "manual",
  });

  const openCreate = () => {
    setEditing(null);
    setForm(empty());
    setOpen(true);
  };
  const openEdit = (row: any) => {
    setEditing(row);
    setForm({
      entry_date: row.entry_date,
      provider_id: row.provider_id ?? "",
      platform_id: row.platform_id ?? "",
      client_id: row.client_id ?? "",
      description: row.description ?? "",
      usage_quantity: row.usage_quantity ?? "",
      usage_unit: row.usage_unit ?? "",
      cost_usd: row.cost_usd ?? "",
      exchange_rate: row.exchange_rate ?? "",
      origin: row.origin,
    });
    setOpen(true);
  };

  const save = useMutation({
    mutationFn: async () => {
      const costUsd = Number(form.cost_usd || 0);
      const rate = Number(form.exchange_rate || 0);
      const payload = {
        entry_date: form.entry_date,
        provider_id: form.provider_id || null,
        platform_id: form.platform_id || null,
        client_id: form.client_id || null,
        description: form.description || null,
        usage_quantity: form.usage_quantity ? Number(form.usage_quantity) : null,
        usage_unit: form.usage_unit || null,
        cost_usd: costUsd,
        exchange_rate: rate || null,
        cost_brl: rate ? costUsd * rate : null,
        origin: form.origin,
      };
      if (editing) {
        const { error } = await supabase.from("cost_entries").update(payload).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("cost_entries").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Salvo");
      qc.invalidateQueries({ queryKey: ["costs"] });
      qc.invalidateQueries({ queryKey: ["dashboard-entries"] });
      setOpen(false);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("cost_entries").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["costs"] });
      qc.invalidateQueries({ queryKey: ["dashboard-entries"] });
    },
  });

  const input = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm";

  const filtered = costs.filter((c) => {
    if (filter.platform && c.platform_id !== filter.platform) return false;
    if (filter.provider && c.provider_id !== filter.provider) return false;
    if (filter.client && c.client_id !== filter.client) return false;
    if (filter.origin && c.origin !== filter.origin) return false;
    return true;
  });

  return (
    <AppShell
      eyebrow="Financeiro"
      title="Custos"
      actions={
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button onClick={openCreate} className="gap-1.5">
              <Plus className="h-4 w-4" /> Novo custo
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-xl">
            <DialogHeader>
              <DialogTitle className="font-display">{editing ? "Editar lançamento" : "Novo lançamento"}</DialogTitle>
            </DialogHeader>
            <form
              className="grid grid-cols-2 gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                save.mutate();
              }}
            >
              <Field label="Data">
                <input type="date" className={input} value={form.entry_date ?? ""} onChange={(e) => setForm({ ...form, entry_date: e.target.value })} required />
              </Field>
              <Field label="Origem">
                <select className={input} value={form.origin ?? "manual"} onChange={(e) => setForm({ ...form, origin: e.target.value })}>
                  <option value="manual">Manual</option>
                  <option value="api">API</option>
                  <option value="import">Importação</option>
                </select>
              </Field>
              <Field label="Plataforma">
                <select className={input} value={form.platform_id ?? ""} onChange={(e) => setForm({ ...form, platform_id: e.target.value })}>
                  <option value="">—</option>
                  {platforms.map((p: any) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Fornecedor">
                <select className={input} value={form.provider_id ?? ""} onChange={(e) => setForm({ ...form, provider_id: e.target.value })}>
                  <option value="">—</option>
                  {providers.map((p: any) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Cliente">
                <select className={input} value={form.client_id ?? ""} onChange={(e) => setForm({ ...form, client_id: e.target.value })}>
                  <option value="">—</option>
                  {clients.map((p: any) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Quantidade">
                <input type="number" step="any" className={input} value={form.usage_quantity ?? ""} onChange={(e) => setForm({ ...form, usage_quantity: e.target.value })} />
              </Field>
              <Field label="Unidade">
                <input className={input} value={form.usage_unit ?? ""} onChange={(e) => setForm({ ...form, usage_unit: e.target.value })} placeholder="tokens, credits, GB..." />
              </Field>
              <Field label="Custo USD">
                <input type="number" step="any" className={input} value={form.cost_usd ?? ""} onChange={(e) => setForm({ ...form, cost_usd: e.target.value })} />
              </Field>
              <Field label="Cotação USD→BRL">
                <input type="number" step="any" className={input} value={form.exchange_rate ?? ""} onChange={(e) => setForm({ ...form, exchange_rate: e.target.value })} placeholder="ex.: 5.10" />
              </Field>
              <div className="col-span-2">
                <Field label="Descrição">
                  <input className={input} value={form.description ?? ""} onChange={(e) => setForm({ ...form, description: e.target.value })} />
                </Field>
              </div>
              <DialogFooter className="col-span-2">
                <Button type="submit" disabled={save.isPending}>Salvar</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      }
    >
      <div className="space-y-6">


        <Card className="surface-elevated">
          <CardContent className="pt-6">
            <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-4">
              <select className={input} value={filter.platform} onChange={(e) => setFilter({ ...filter, platform: e.target.value })}>
                <option value="">Todas plataformas</option>
                {platforms.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <select className={input} value={filter.provider} onChange={(e) => setFilter({ ...filter, provider: e.target.value })}>
                <option value="">Todos fornecedores</option>
                {providers.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <select className={input} value={filter.client} onChange={(e) => setFilter({ ...filter, client: e.target.value })}>
                <option value="">Todos clientes</option>
                {clients.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <select className={input} value={filter.origin} onChange={(e) => setFilter({ ...filter, origin: e.target.value })}>
                <option value="">Todas origens</option>
                <option value="manual">Manual</option>
                <option value="api">API</option>
                <option value="import">Importação</option>
              </select>
            </div>
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Data</TableHead>
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Plataforma</TableHead>
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Fornecedor</TableHead>
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Cliente</TableHead>
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Descrição</TableHead>
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Origem</TableHead>
                  <TableHead className="text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">USD</TableHead>
                  <TableHead className="text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">BRL</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow><TableCell colSpan={9} className="py-8 text-center text-sm text-muted-foreground">Carregando...</TableCell></TableRow>
                )}
                {!isLoading && filtered.length === 0 && (
                  <TableRow><TableCell colSpan={9} className="py-12 text-center text-sm text-muted-foreground">Nenhum lançamento encontrado.</TableCell></TableRow>
                )}
                {filtered.map((c) => (
                  <TableRow key={c.id} className="border-border/50">
                    <TableCell className="text-sm text-muted-foreground">{fmtDate(c.entry_date)}</TableCell>
                    <TableCell className="text-sm">{c.platforms?.name ?? "—"}</TableCell>
                    <TableCell className="text-sm">{c.providers?.name ?? "—"}</TableCell>
                    <TableCell className="text-sm">{c.clients?.name ?? "—"}</TableCell>
                    <TableCell className="max-w-xs truncate text-sm text-muted-foreground">{c.description ?? "—"}</TableCell>
                    <TableCell><Badge variant="outline" className="border-border/60 font-normal">{c.origin}</Badge></TableCell>
                    <TableCell className="text-right font-numeric text-sm">{fmtUSD(c.cost_usd)}</TableCell>
                    <TableCell className="text-right font-numeric text-sm font-medium">{fmtBRL(c.cost_brl)}</TableCell>
                    <TableCell className="text-right">
                      <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => openEdit(c)}><Pencil className="h-3.5 w-3.5" /></Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8 hover:text-destructive" onClick={() => { if (confirm("Excluir?")) remove.mutate(c.id); }}><Trash2 className="h-3.5 w-3.5" /></Button>
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}
