import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "@/components/coming-soon";

export const Route = createFileRoute("/_authenticated/reports")({
  head: () => ({ meta: [{ title: "Relatórios — Billing OS" }] }),
  component: () => (
    <ComingSoon
      title="Relatórios"
      description="Resumo executivo mensal, custos por projeto/serviço/modelo, divergências e exportação CSV/XLSX."
      phase="Fase 5"
    />
  ),
});
