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
    <AppShell eyebrow="Sistema" title="Configurações">
      <div className="grid gap-6 md:grid-cols-2">
        <Card className="surface-elevated">
          <CardHeader>
            <CardTitle className="font-display text-base">Cotação USD → BRL</CardTitle>
            <p className="text-xs text-muted-foreground">Usada para converter automaticamente lançamentos em dólar.</p>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="rounded-lg border border-border/60 bg-muted/30 p-4">
              <div className="font-numeric text-3xl font-semibold tracking-tight text-[color:var(--color-gold)]">
                {rateValue ? `R$ ${Number(rateValue).toFixed(4)}` : "—"}
              </div>
              <div className="mt-1 text-[11px] uppercase tracking-wider text-muted-foreground">
                Atualizada em {fmtDateTime(updatedAt)}
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Cotação manual</Label>
              <div className="flex gap-2">
                <Input type="number" step="any" value={rate} onChange={(e) => setRate(e.target.value)} className="h-10" />
                <Button onClick={() => save.mutate()} disabled={save.isPending}>Salvar</Button>
              </div>
            </div>
            <Button variant="outline" className="w-full" onClick={() => fetchAuto.mutate()} disabled={fetchAuto.isPending}>
              {fetchAuto.isPending ? "Buscando..." : "Buscar cotação automática"}
            </Button>
          </CardContent>
        </Card>

        <Card className="surface-elevated">
          <CardHeader>
            <CardTitle className="font-display text-base">Sobre</CardTitle>
            <p className="text-xs text-muted-foreground">LeFil Cost Center · versão MVP</p>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>
              Centro de inteligência de custos das plataformas LeFil. Consolida consumo de IA, infraestrutura
              e serviços em um único painel executivo.
            </p>
            <p>
              A arquitetura está preparada para evoluir para um Billing Hub completo:
              assinaturas, cobrança automática, integração com Stripe/Asaas e controle de créditos por cliente.
            </p>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

