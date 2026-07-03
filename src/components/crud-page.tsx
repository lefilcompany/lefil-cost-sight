import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Search } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";

type Row = Record<string, any> & { id: string };

export type FieldDef = {
  key: string;
  label: string;
  type?: "text" | "textarea" | "select" | "color" | "url" | "number" | "date";
  options?: { value: string; label: string }[];
  required?: boolean;
  placeholder?: string;
  render?: (v: any, row: Row) => ReactNode;
};

export function CrudPage({
  table,
  title,
  description,
  fields,
  listFields,
  defaults,
  searchKeys = ["name"],
}: {
  table: string;
  title: string;
  description?: string;
  fields: FieldDef[];
  listFields: FieldDef[];
  defaults?: Record<string, any>;
  searchKeys?: string[];
}) {
  const qc = useQueryClient();
  const { data: rows = [], isLoading } = useQuery({
    queryKey: [table],
    queryFn: async () => {
      const { data, error } = await supabase.from(table as any).select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as Row[];
    },
  });

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [form, setForm] = useState<Record<string, any>>(defaults ?? {});
  const [q, setQ] = useState("");

  const save = useMutation({
    mutationFn: async (payload: Record<string, any>) => {
      if (editing) {
        const { error } = await supabase.from(table as any).update(payload).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from(table as any).insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(editing ? "Atualizado" : "Criado");
      qc.invalidateQueries({ queryKey: [table] });
      setOpen(false);
      setEditing(null);
      setForm(defaults ?? {});
    },
    onError: (e: any) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from(table as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Removido");
      qc.invalidateQueries({ queryKey: [table] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const openCreate = () => {
    setEditing(null);
    setForm(defaults ?? {});
    setOpen(true);
  };
  const openEdit = (row: Row) => {
    setEditing(row);
    const initial: Record<string, any> = {};
    fields.forEach((f) => (initial[f.key] = row[f.key] ?? ""));
    setForm(initial);
    setOpen(true);
  };

  const filtered = q
    ? rows.filter((r) => searchKeys.some((k) => String(r[k] ?? "").toLowerCase().includes(q.toLowerCase())))
    : rows;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <h2 className="font-display text-xl font-semibold tracking-tight">{title}</h2>
            <Badge variant="outline" className="border-border/60 font-normal text-muted-foreground">
              {rows.length}
            </Badge>
          </div>
          {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar..."
              className="h-9 w-56 border-border/70 bg-muted/30 pl-9 text-sm"
            />
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button onClick={openCreate} className="h-9 gap-1.5">
                <Plus className="h-4 w-4" /> Novo
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle className="font-display">{editing ? "Editar registro" : "Novo registro"}</DialogTitle>
                <DialogDescription>Preencha os campos abaixo.</DialogDescription>
              </DialogHeader>
              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  const payload: Record<string, any> = {};
                  fields.forEach((f) => {
                    let v = form[f.key];
                    if (v === "") v = null;
                    if (f.type === "number" && v != null) v = Number(v);
                    payload[f.key] = v;
                  });
                  save.mutate(payload);
                }}
              >
                {fields.map((f) => (
                  <FormField key={f.key} field={f} value={form[f.key] ?? ""} onChange={(v) => setForm((s) => ({ ...s, [f.key]: v }))} />
                ))}
                <DialogFooter className="pt-2">
                  <Button type="submit" disabled={save.isPending}>
                    {save.isPending ? "Salvando..." : "Salvar"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Card className="surface-elevated overflow-hidden">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                {listFields.map((f) => (
                  <TableHead key={f.key} className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {f.label}
                  </TableHead>
                ))}
                <TableHead className="w-24 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={listFields.length + 1} className="py-8 text-center text-sm text-muted-foreground">
                    Carregando...
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={listFields.length + 1} className="py-16 text-center">
                    <div className="mx-auto max-w-sm space-y-2">
                      <div className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-muted text-muted-foreground">
                        <Plus className="h-4 w-4" />
                      </div>
                      <p className="font-display text-sm font-medium">
                        {q ? "Nenhum resultado" : "Nada por aqui ainda"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {q ? "Tente outra busca." : "Clique em Novo para criar o primeiro registro."}
                      </p>
                    </div>
                  </TableCell>
                </TableRow>
              )}
              {filtered.map((row) => (
                <TableRow key={row.id} className="border-border/50">
                  {listFields.map((f) => (
                    <TableCell key={f.key} className="text-sm">
                      {f.render ? f.render(row[f.key], row) : (row[f.key] ?? "—")}
                    </TableCell>
                  ))}
                  <TableCell className="text-right">
                    <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => openEdit(row)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 hover:text-destructive"
                      onClick={() => {
                        if (confirm("Excluir registro?")) remove.mutate(row.id);
                      }}
                    >
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
  );
}

function FormField({ field, value, onChange }: { field: FieldDef; value: any; onChange: (v: any) => void }) {
  const base = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/40";
  return (
    <div className="space-y-1.5">
      <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{field.label}</label>
      {field.type === "textarea" ? (
        <textarea className={base} rows={3} value={value} onChange={(e) => onChange(e.target.value)} placeholder={field.placeholder} />
      ) : field.type === "select" ? (
        <select className={base} value={value ?? ""} onChange={(e) => onChange(e.target.value)} required={field.required}>
          <option value="">— selecione —</option>
          {field.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : field.type === "color" ? (
        <input type="color" className="h-10 w-20 rounded-md border border-input" value={value || "#0d7a5f"} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input
          type={field.type ?? "text"}
          className={base}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          required={field.required}
          placeholder={field.placeholder}
        />
      )}
    </div>
  );
}
