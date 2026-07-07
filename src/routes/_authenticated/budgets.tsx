import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "@/components/coming-soon";

export const Route = createFileRoute("/_authenticated/budgets")({
  head: () => ({ meta: [{ title: "Orçamentos — Billing OS" }] }),
  component: () => (
    <ComingSoon
      title="Orçamentos"
      description="Orçamentos internos e sincronizados do Google Cloud, com thresholds, escopo por projeto/serviço e canais de notificação."
      phase="Fase 5"
    />
  ),
});
