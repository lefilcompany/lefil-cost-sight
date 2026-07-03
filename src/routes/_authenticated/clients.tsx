import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { CrudPage } from "@/components/crud-page";

export const Route = createFileRoute("/_authenticated/clients")({
  head: () => ({ meta: [{ title: "Clientes — LeFil Cost Center" }] }),
  component: () => (
    <AppShell eyebrow="Cadastros">
      <CrudPage
        table="clients"
        title="Clientes"
        description="Clientes atendidos pelas plataformas LeFil."
        defaults={{ status: "active" }}
        fields={[
          { key: "name", label: "Nome", required: true },
          { key: "company", label: "Empresa" },
          { key: "cnpj", label: "CNPJ" },
          { key: "responsible", label: "Responsável" },
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
          { key: "company", label: "Empresa" },
          { key: "cnpj", label: "CNPJ" },
          { key: "responsible", label: "Responsável" },
          { key: "status", label: "Status" },
        ]}
      />
    </AppShell>
  ),
});
