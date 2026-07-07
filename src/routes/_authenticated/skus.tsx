import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "@/components/coming-soon";

export const Route = createFileRoute("/_authenticated/skus")({
  head: () => ({ meta: [{ title: "Modelos e SKUs — Billing OS" }] }),
  component: () => (
    <ComingSoon
      title="Modelos e SKUs"
      description="Consolidação de modelos, SKUs, unidades de cobrança, preços oficiais e histórico de alterações."
      phase="Fase 3"
    />
  ),
});
