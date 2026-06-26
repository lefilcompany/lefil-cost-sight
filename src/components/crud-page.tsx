import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
}: {
  table: string;
  title: string;
  description?: string;
  fields: FieldDef[];
  listFields: FieldDef[];
  defaults?: Record<string, any>;
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

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button onClick={openCreate}>
              <Plus className="mr-2 h-4 w-4" /> Novo
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{editing ? "Editar" : "Novo"}</DialogTitle>
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

      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="text-base">Registros ({rows.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                {listFields.map((f) => (
                  <TableHead key={f.key}>{f.label}</TableHead>
                ))}
                <TableHead className="w-24 text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={listFields.length + 1} className="text-center text-muted-foreground">
                    Carregando...
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={listFields.length + 1} className="text-center text-muted-foreground">
                    Nenhum registro.
                  </TableCell>
                </TableRow>
              )}
              {rows.map((row) => (
                <TableRow key={row.id}>
                  {listFields.map((f) => (
                    <TableCell key={f.key}>{f.render ? f.render(row[f.key], row) : (row[f.key] ?? "—")}</TableCell>
                  ))}
                  <TableCell className="text-right">
                    <Button size="icon" variant="ghost" onClick={() => openEdit(row)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => {
                        if (confirm("Excluir registro?")) remove.mutate(row.id);
                      }}
                    >
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
  );
}

function FormField({ field, value, onChange }: { field: FieldDef; value: any; onChange: (v: any) => void }) {
  const base = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm";
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-muted-foreground">{field.label}</label>
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
        <input type="color" className="h-10 w-20 rounded-md border border-input" value={value || "#3b82f6"} onChange={(e) => onChange(e.target.value)} />
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
