export type NavigationItem = {
  title: string;
  url: string;
  icon: string;
  description: string;
};

export type NavigationSection = {
  label: string;
  items: NavigationItem[];
};

export const NAVIGATION_SECTIONS: NavigationSection[] = [
  {
    label: "Visão",
    items: [
      {
        title: "Visão geral",
        url: "/overview",
        icon: "LayoutDashboard",
        description: "Resumo executivo, projeção e pendências do período.",
      },
    ],
  },
  {
    label: "Gestão de custos",
    items: [
      {
        title: "Lançamentos",
        url: "/costs",
        icon: "Receipt",
        description: "Extrato consolidado de custos manuais e importados.",
      },
      {
        title: "Consumo e planos",
        url: "/billing",
        icon: "Gauge",
        description: "Uso, limites e planos contratados por fornecedor.",
      },
      {
        title: "Faturas",
        url: "/invoices",
        icon: "FileText",
        description: "Acompanhamento das cobranças recebidas dos fornecedores.",
      },
      {
        title: "Alertas",
        url: "/alerts",
        icon: "Bell",
        description: "Desvios, limites e eventos que exigem atenção.",
      },
    ],
  },
  {
    label: "Estrutura financeira",
    items: [
      {
        title: "Centros de custo",
        url: "/platforms",
        icon: "Layers",
        description: "Produtos, projetos e ambientes que recebem custos.",
      },
      {
        title: "Clientes",
        url: "/clients",
        icon: "Users",
        description: "Clientes e responsáveis vinculados aos gastos.",
      },
      {
        title: "Fornecedores e integrações",
        url: "/providers",
        icon: "Plug",
        description: "Fornecedores, credenciais e conexões de dados.",
      },
    ],
  },
  {
    label: "Administração",
    items: [
      {
        title: "Saúde dos dados",
        url: "/syncs",
        icon: "RefreshCw",
        description: "Execuções, falhas e atualização das integrações.",
      },
      {
        title: "Equipe e acessos",
        url: "/users",
        icon: "ShieldCheck",
        description: "Aprovação e gestão dos usuários do sistema.",
      },
      {
        title: "Configurações",
        url: "/settings",
        icon: "Settings",
        description: "Cotação, parâmetros globais e opções avançadas.",
      },
    ],
  },
];

export const LEGACY_ROUTE_REDIRECTS: Record<string, string> = {
  "/": "/overview",
  "/dashboard": "/overview",
  "/financial": "/overview",
};

const routeLabels = new Map(
  NAVIGATION_SECTIONS.flatMap((section) => section.items.map((item) => [item.url, item.title] as const)),
);

export function getNavigationLabel(pathname: string): string | undefined {
  const exact = routeLabels.get(pathname);
  if (exact) return exact;

  const match = [...routeLabels.entries()]
    .sort(([a], [b]) => b.length - a.length)
    .find(([route]) => pathname.startsWith(`${route}/`));

  return match?.[1];
}

export function resolveLegacyRoute(pathname: string): string {
  return LEGACY_ROUTE_REDIRECTS[pathname] ?? pathname;
}
