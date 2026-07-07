import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "@/components/coming-soon";

export const Route = createFileRoute("/_authenticated/forecasts")({
  head: () => ({ meta: [{ title: "Projeções — Billing OS" }] }),
  component: () => (
    <ComingSoon
      title="Projeções"
      description="Projeção de fechamento mensal, tendência, comparação com orçamento e data prevista de ultrapassagem — com metodologia transparente."
      phase="Fase 5"
    />
  ),
});
