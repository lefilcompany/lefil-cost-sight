import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Layers,
  Truck,
  Users,
  Plug,
  Receipt,
  RefreshCw,
  Settings,
  Sparkles,
} from "lucide-react";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

const analytics = [
  { title: "Painel geral", url: "/dashboard", icon: LayoutDashboard },
  { title: "Custos", url: "/costs", icon: Receipt },
  { title: "Sincronizações", url: "/syncs", icon: RefreshCw },
];

const registry = [
  { title: "Plataformas", url: "/platforms", icon: Layers },
  { title: "Fornecedores", url: "/providers", icon: Truck },
  { title: "Clientes", url: "/clients", icon: Users },
];

const system = [
  { title: "Integrações", url: "/integrations", icon: Plug },
  { title: "Configurações", url: "/settings", icon: Settings },
];

export function AppSidebar() {
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const isActive = (url: string) => pathname === url || pathname.startsWith(url + "/");

  const Section = ({ label, items }: { label: string; items: typeof analytics }) => (
    <SidebarGroup>
      <SidebarGroupLabel className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
        {label}
      </SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem key={item.url}>
              <SidebarMenuButton
                asChild
                isActive={isActive(item.url)}
                tooltip={item.title}
                className="group/link h-9 rounded-lg data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground data-[active=true]:shadow-[inset_0_0_0_1px_var(--color-sidebar-border)]"
              >
                <Link to={item.url}>
                  <item.icon className="text-muted-foreground group-data-[active=true]/link:text-[color:var(--color-gold)]" />
                  <span className="text-[13px] font-medium tracking-tight">{item.title}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border">
      <SidebarHeader className="border-b border-sidebar-border">
        <div className="flex items-center gap-3 px-2 py-3">
          <div className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg gradient-emerald text-[color:var(--color-gold)] shadow-[inset_0_0_0_1px_var(--color-sidebar-border)]">
            <span className="font-display text-[15px] font-bold leading-none">L</span>
            <span className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full bg-[color:var(--color-gold)] shadow-[0_0_8px_var(--color-gold)]" />
          </div>
          <div className="flex min-w-0 flex-col leading-tight group-data-[collapsible=icon]:hidden">
            <span className="font-display text-[13px] font-semibold tracking-tight">LeFil</span>
            <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">Cost Center</span>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent className="gap-1 py-2">
        <Section label="Análise" items={analytics} />
        <Section label="Cadastros" items={registry} />
        <Section label="Sistema" items={system} />
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border p-3 group-data-[collapsible=icon]:hidden">
        <div className="rounded-lg border border-sidebar-border bg-sidebar-accent/40 p-3">
          <div className="flex items-center gap-2 text-[color:var(--color-gold)]">
            <Sparkles className="h-3.5 w-3.5" />
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em]">Insight</span>
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
            Sincronize integrações para receber estimativas de custo em tempo quase real.
          </p>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
