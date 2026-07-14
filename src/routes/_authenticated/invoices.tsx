import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { FileCheck2, FileClock, FileText, Receipt, WalletCards } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, KpiCard, LoadingState } from "@/components/ui-kit";
import { supabase } from "@/integrations/supabase/client";
import { fmtBRL, fmtDate } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/invoices")({
  head: () => ({ meta: [{ title: "Faturas — Quiwi Cost Center" }] }),
  component: InvoicesPage,
});

type Invoice = {
  id: string;
  invoice_number: string | null;
  issued_at: string | null;
  period_start: string | null;
  period_end: string | null;
  amount_brl: number;
  amount_usd: number;
  status: string;
  source: string;
  pdf_url: string | null;
  providers?: { name: string } | null;
  platforms?: { name: string } | null;
};

function statusLabel(status: string) {
  const value = status.toLowerCase();
  if (value === "paid") return "Paga";
  if (value === "approved") return "Aprovada";
  if (value === "review") return "Em revisão";
  if (value === "received") return "Recebida";
  if (value === "overdue") return "Vencida";
  if (value === "cancelled" || value === "canceled") return "Cancelada";
  return status || "Pendente";
}

function statusClass(status: string) {
  const value = status.toLowerCase();
  if (value === "paid") return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  if (value === "overdue") return "bg-red-500/10 text-red-700 dark:text-red-300";
  if (value === "approved") return "bg-sky-500/10 text-sky-700 dark:text-sky-300";
  return "bg-amber-500/10 text-amber-700 dark:text-amber-300";
}

function InvoicesPage() {
  const [status, setStatus] = useState("all");
  const { data: invoices = [], isLoading } = useQuery({
    queryKey: ["invoices-page"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("provider_invoices")
        .select("*, providers(name), platforms(name)")
        .order("issued_at", { ascending: false, nullsFirst: false })
        .limit(1000);
      if (error) throw error;
      return (data ?? []) as Invoice[];
    },
  });

  const summary = useMemo(() => {
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const current = invoices.filter((invoice) => invoice.issued_at?.startsWith(month));
    const paid = current.filter((invoice) => invoice.status.toLowerCase() === "paid");
    const pending = current.filter((invoice) => !["paid", "cancelled", "canceled"].includes(invoice.status.toLowerCase()));
    const overdue = current.filter((invoice) => invoice.status.toLowerCase() === "overdue");
    return {
      current,
      total: current.reduce((sum, invoice) => sum + Number(invoice.amount_brl ?? 0), 0),
      paid: paid.reduce((sum, invoice) => sum + Number(invoice.amount_brl ?? 0), 0),
      pending: pending.reduce((sum, invoice) => sum + Number(invoice.amount_brl ?? 0), 0),
      overdue: overdue.length,
    };
  }, [invoices]);

  const filtered = useMemo(
    () => (status === "all" ? invoices : invoices.filter((invoice) => invoice.status.toLowerCase() === status)),
    [invoices, status],
  );

  return (
    <AppShell
      eyebrow="Controle financeiro"
      title="Faturas"
      actions={
        <Link to="/billing">
          <Button variant="outline" size="sm" className="gap-1.5">
            <WalletCards className="h-3.5 w-3.5" /> Planos e consumo
          </Button>
        </Link>
      }
    >
      <div className="space-y-6">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <KpiCard label="Faturado no mês" value={fmtBRL(summary.total)} sub={`${summary.current.length} documento(s)`} icon={<Receipt className="h-4 w-4" />} />
          <KpiCard label="Pago" value={fmtBRL(summary.paid)} sub="Faturas confirmadas como pagas" icon={<FileCheck2 className="h-4 w-4" />} tone="good" />
          <KpiCard label="Pendente" value={fmtBRL(summary.pending)} sub="Ainda requer revisão ou pagamento" icon={<FileClock className="h-4 w-4" />} tone={summary.pending > 0 ? "warn" : "good"} />
          <KpiCard label="Vencidas" value={String(summary.overdue)} sub="Documentos com status de atraso" icon={<FileText className="h-4 w-4" />} tone={summary.overdue > 0 ? "bad" : "good"} />
        </div>

        <Card className="surface-elevated overflow-hidden">
          <CardHeader className="flex flex-row items-center justify-between gap-3 pb-3">
            <div>
              <CardTitle className="text-base font-semibold">Documentos dos fornecedores</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">Valores recebidos por API ou cadastrados manualmente na área de billing.</p>
            </div>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="h-9 w-[160px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os status</SelectItem>
                <SelectItem value="received">Recebidas</SelectItem>
                <SelectItem value="review">Em revisão</SelectItem>
                <SelectItem value="approved">Aprovadas</SelectItem>
                <SelectItem value="paid">Pagas</SelectItem>
                <SelectItem value="overdue">Vencidas</SelectItem>
              </SelectContent>
            </Select>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <LoadingState label="Carregando faturas..." />
            ) : filtered.length === 0 ? (
              <div className="p-8"><EmptyState title="Nenhuma fatura encontrada" description="Ajuste o filtro ou importe as cobranças dos fornecedores." /></div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Emissão</TableHead>
                      <TableHead>Fornecedor</TableHead>
                      <TableHead>Centro de custo</TableHead>
                      <TableHead>Número</TableHead>
                      <TableHead>Competência</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Origem</TableHead>
                      <TableHead className="text-right">Valor</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((invoice) => (
                      <TableRow key={invoice.id}>
                        <TableCell className="whitespace-nowrap text-xs">{invoice.issued_at ? fmtDate(invoice.issued_at) : "—"}</TableCell>
                        <TableCell className="text-xs font-medium">{invoice.providers?.name ?? "—"}</TableCell>
                        <TableCell className="text-xs">{invoice.platforms?.name ?? "—"}</TableCell>
                        <TableCell className="text-xs">{invoice.invoice_number ?? "—"}</TableCell>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                          {invoice.period_start ? fmtDate(invoice.period_start) : "—"} → {invoice.period_end ? fmtDate(invoice.period_end) : "—"}
                        </TableCell>
                        <TableCell><Badge variant="secondary" className={statusClass(invoice.status)}>{statusLabel(invoice.status)}</Badge></TableCell>
                        <TableCell className="text-xs capitalize">{invoice.source}</TableCell>
                        <TableCell className="text-right font-numeric text-sm">{fmtBRL(invoice.amount_brl)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
