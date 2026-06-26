import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState, useEffect } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { fmtDateTime } from "@/lib/format";
import { getUsdRate } from "@/lib/sync.functions";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({ meta: [{ title: "Configurações — LeFil Cost Center" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const qc = useQueryClient();
  const refreshRate = useServerFn(getUsdRate);
  const [rate, setRate] = useState("");

  const { data: setting } = useQuery({
    queryKey: ["setting", "usd_brl_rate"],
    queryFn: async () => {
      const { data, error } = await supabase.from("system_settings").select("*").eq("key", "usd_brl_rate").maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    if (setting?.value && typeof (setting.value as any).rate === "number") {
      setRate(String((setting.value as any).rate));
    }
  }, [setting]);

  const save = useMutation({
    mutationFn: async () => {
      const value = { rate: Number(rate), updated_at: new Date().toISOString(), manual: true };
      const { error } = await supabase.from("system_settings").upsert({ key: "usd_brl_rate", value });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Cotação atualizada");
      qc.invalidateQueries({ queryKey: ["setting", "usd_brl_rate"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const fetchAuto = useMutation({
    mutationFn: async () => refreshRate({}),
    onSuccess: (res: any) => {
      toast.success(`Cotação atualizada: ${res.rate}`);
      qc.invalidateQueries({ queryKey: ["setting", "usd_brl_rate"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const rateValue = (setting?.value as any)?.rate;
  const updatedAt = (setting?.value as any)?.updated_at;

  return (
    <AppShell title="Configurações">
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Configurações</h2>
          <p className="text-sm text-muted-foreground">Parâmetros globais do sistema.</p>
        </div>

        <Card className="max-w-xl border-border/60">
          <CardHeader>
            <CardTitle className="text-base">Cotação USD → BRL</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-md bg-muted/50 p-3 text-sm">
              <div className="font-mono text-lg">{rateValue ? `R$ ${Number(rateValue).toFixed(4)}` : "—"}</div>
              <div className="text-xs text-muted-foreground">Atualizada em: {fmtDateTime(updatedAt)}</div>
            </div>
            <div className="space-y-2">
              <Label>Cotação manual</Label>
              <div className="flex gap-2">
                <Input type="number" step="any" value={rate} onChange={(e) => setRate(e.target.value)} />
                <Button onClick={() => save.mutate()} disabled={save.isPending}>Salvar</Button>
              </div>
            </div>
            <Button variant="outline" onClick={() => fetchAuto.mutate()} disabled={fetchAuto.isPending}>
              {fetchAuto.isPending ? "Buscando..." : "Buscar cotação automática"}
            </Button>
          </CardContent>
        </Card>

        <Card className="max-w-xl border-border/60">
          <CardHeader>
            <CardTitle className="text-base">Sobre</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            <p>LeFil Cost Center — MVP de monitoramento de custos.</p>
            <p className="mt-2">
              A arquitetura está preparada para evoluir para um Billing Hub completo (assinaturas, cobrança automática,
              integração com Stripe/Asaas, controle de créditos por cliente, etc.).
            </p>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
