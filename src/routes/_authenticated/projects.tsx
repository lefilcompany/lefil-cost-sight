import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "@/components/coming-soon";

export const Route = createFileRoute("/_authenticated/projects")({
  head: () => ({ meta: [{ title: "Projetos — Billing OS" }] }),
  component: () => (
    <ComingSoon
      title="Projetos"
      description="Projetos do Google Cloud identificados nos dados de billing, com centro de custo, responsável, cliente e tags internas."
      phase="Fase 3"
    />
  ),
});
