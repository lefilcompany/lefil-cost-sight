import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, FlaskConical, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { sendBulkTestAlertNotifications } from "@/lib/alert-notify.functions";

type Rule = {
  id: string;
  name: string;
  metric: string;
  channel: string;
  enabled: boolean | null;
};

type BulkResult = {
  rule_id: string;
  rule_name: string;
  queued: number;
  sent: number;
  pending: number;
  failed: number;
  error?: string;
};

export function BulkTestNotificationsDialog({ onDone }: { onDone?: () => void }) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [targets, setTargets] = useState<Array<"slack" | "email">>([]);
  const [results, setResults] = useState<BulkResult[] | null>(null);


  const { data: rules = [], isLoading } = useQuery({
    queryKey: ["cost-alert-rules-for-test"],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cost_alerts")
        .select("id, name, metric, channel, enabled")
        .order("name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Rule[];
    },
  });

  const filtered = useMemo(() => {
    const q = term.trim().toLowerCase();
    if (!q) return rules;
    return rules.filter((r) => `${r.name} ${r.metric} ${r.channel}`.toLowerCase().includes(q));
  }, [rules, term]);

  const allSelected = filtered.length > 0 && filtered.every((r) => selected.includes(r.id));

  const run = useMutation({
    mutationFn: () => sendBulkTestAlertNotifications({ data: { rule_ids: selected, targets } }),
    onSuccess: (res: any) => {
      setResults(res?.results ?? []);
      const t = res?.totals ?? {};
      toast.success(
        `Teste em massa: ${res?.rules ?? 0} regra(s) — ${t.sent ?? 0} enviada(s), ${t.pending ?? 0} na fila, ${t.failed ?? 0} falha(s)`,
      );
      onDone?.();
    },
    onError: (err: any) => toast.error(err?.message ?? "Falha ao executar os testes"),
  });

  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) {
          setResults(null);
          setTerm("");
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <FlaskConical className="mr-2 h-4 w-4" />
          Testar em massa
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[90vh] max-w-2xl flex-col gap-4 overflow-hidden">
        <DialogHeader>
          <DialogTitle>Testes de notificação em massa</DialogTitle>
          <DialogDescription>
            Selecione as regras e dispare um envio de teste (Slack e/ou e-mail) para cada uma delas de uma vez.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <Input
            placeholder="Buscar regra..."
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            className="h-9 max-w-xs"
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              setSelected((prev) =>
                allSelected
                  ? prev.filter((id) => !filtered.some((r) => r.id === id))
                  : Array.from(new Set([...prev, ...filtered.map((r) => r.id)])),
              )
            }
          >
            {allSelected ? "Limpar seleção" : "Selecionar todas"}
          </Button>
          <span className="text-xs text-muted-foreground">{selected.length} selecionada(s)</span>
        </div>

        <div className="flex flex-wrap items-center gap-4 rounded-md border bg-muted/30 p-3">
          <span className="text-xs font-medium">Destinos do teste:</span>
          {([
            { key: "slack" as const, label: "Slack" },
            { key: "email" as const, label: "E-mail" },
          ]).map((t) => (
            <label key={t.key} className="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox
                checked={targets.includes(t.key)}
                onCheckedChange={() =>
                  setTargets((prev) =>
                    prev.includes(t.key) ? prev.filter((x) => x !== t.key) : [...prev, t.key],
                  )
                }
              />
              {t.label}
            </label>
          ))}
          <span className="text-xs text-muted-foreground">
            {targets.length === 0
              ? "Nenhum selecionado: usa o canal configurado em cada regra."
              : `Sobrescreve o canal das regras selecionadas (${targets.join(" + ")}).`}
          </span>
        </div>


        <ScrollArea className="min-h-0 flex-1 rounded-md border">
          <div className="divide-y">
            {isLoading ? (
              <p className="p-4 text-sm text-muted-foreground">Carregando regras...</p>
            ) : filtered.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">Nenhuma regra encontrada.</p>
            ) : (
              filtered.map((r) => {
                const result = results?.find((x) => x.rule_id === r.id);
                return (
                  <label
                    key={r.id}
                    className="flex cursor-pointer items-start gap-3 p-3 text-sm hover:bg-muted/40"
                  >
                    <Checkbox
                      checked={selected.includes(r.id)}
                      onCheckedChange={() => toggle(r.id)}
                      className="mt-0.5"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{r.name}</span>
                        {r.enabled === false && <Badge variant="outline">inativa</Badge>}
                        <Badge variant="secondary">{r.channel}</Badge>
                      </span>
                      <span className="block text-xs text-muted-foreground">{r.metric}</span>
                      {result && (
                        <span
                          className={`mt-1 flex items-center gap-1 text-xs ${
                            result.error || result.failed > 0
                              ? "text-red-600 dark:text-red-400"
                              : "text-emerald-600 dark:text-emerald-400"
                          }`}
                        >
                          {result.error || result.failed > 0 ? (
                            <AlertTriangle className="h-3.5 w-3.5" />
                          ) : (
                            <CheckCircle2 className="h-3.5 w-3.5" />
                          )}
                          {result.error
                            ? result.error
                            : `${result.sent} enviada(s), ${result.pending} na fila, ${result.failed} falha(s)`}
                        </span>
                      )}
                    </span>
                  </label>
                );
              })
            )}
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Fechar
          </Button>
          <Button onClick={() => run.mutate()} disabled={selected.length === 0 || run.isPending}>
            {run.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <FlaskConical className="mr-2 h-4 w-4" />
            )}
            Executar testes ({selected.length})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
