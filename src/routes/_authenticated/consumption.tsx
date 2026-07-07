import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "@/components/coming-soon";

export const Route = createFileRoute("/_authenticated/consumption")({
  head: () => ({ meta: [{ title: "Consumo — Billing OS" }] }),
  component: () => (
    <ComingSoon
      title="Consumo"
      description="Métricas de requisições, tokens de entrada, saída, thinking e cache capturados diretamente das chamadas da Gemini API."
      phase="Fase 4"
    />
  ),
});
