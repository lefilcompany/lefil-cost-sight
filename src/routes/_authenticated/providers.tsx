import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { CrudPage } from "@/components/crud-page";

export const Route = createFileRoute("/_authenticated/providers")({
  head: () => ({ meta: [{ title: "Fornecedores — LeFil Cost Center" }] }),
  component: () => (
    <AppShell title="Fornecedores">
      <CrudPage
        table="providers"
        title="Fornecedores"
        description="Provedores de IA e infraestrutura consumidos pelas plataformas."
        defaults={{ status: "active" }}
        fields={[
          { key: "name", label: "Nome", required: true },
          { key: "category", label: "Categoria", placeholder: "AI, Infrastructure, Voice..." },
          { key: "website", label: "Website", type: "url" },
          {
            key: "status",
            label: "Status",
            type: "select",
            options: [
              { value: "active", label: "Ativo" },
              { value: "inactive", label: "Inativo" },
            ],
          },
        ]}
        listFields={[
          { key: "name", label: "Nome" },
          { key: "category", label: "Categoria" },
          { key: "website", label: "Website" },
          { key: "status", label: "Status" },
        ]}
      />
    </AppShell>
  ),
});
