import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { CrudPage } from "@/components/crud-page";

export const Route = createFileRoute("/_authenticated/platforms")({
  head: () => ({ meta: [{ title: "Plataformas — LeFil Cost Center" }] }),
  component: () => (
    <AppShell title="Plataformas">
      <CrudPage
        table="platforms"
        title="Plataformas"
        description="Plataformas LeFil monitoradas pelo Cost Center."
        defaults={{ status: "active", color: "#3b82f6", icon: "Box" }}
        fields={[
          { key: "name", label: "Nome", required: true },
          { key: "description", label: "Descrição", type: "textarea" },
          { key: "icon", label: "Ícone (lucide)", placeholder: "Box, Sparkles, Layers..." },
          { key: "color", label: "Cor", type: "color" },
          {
            key: "status",
            label: "Status",
            type: "select",
            options: [
              { value: "active", label: "Ativa" },
              { value: "inactive", label: "Inativa" },
            ],
          },
        ]}
        listFields={[
          {
            key: "color",
            label: "Cor",
            render: (v) => <div className="h-4 w-4 rounded-full" style={{ background: v }} />,
          },
          { key: "name", label: "Nome" },
          { key: "description", label: "Descrição" },
          { key: "status", label: "Status" },
        ]}
      />
    </AppShell>
  ),
});
