import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Activity,
  Truck,
  Users,
  Wallet,
  Bell,
  Settings,
  BarChart3,
  Boxes,
  Target,
  TrendingUp,
  FileText,
  RefreshCw,
  Building2,
  ChevronDown,
} from "lucide-react";
import { useState } from "react";

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
import { useActiveOrg } from "@/hooks/use-active-org";

const overview = [
  { title: "Visão geral", url: "/dashboard", icon: LayoutDashboard },
  { title: "Custos", url: "/costs", icon: Wallet },
  { title: "Consumo", url: "/consumption", icon: Activity },
  { title: "Provedores", url: "/providers", icon: Truck },
];

const management = [
  { title: "Projetos", url: "/projects", icon: Boxes },
  { title: "Modelos e SKUs", url: "/skus", icon: BarChart3 },
  { title: "Orçamentos", url: "/budgets", icon: Target },
  { title: "Alertas", url: "/alerts", icon: Bell },
  { title: "Projeções", url: "/forecasts", icon: TrendingUp },
  { title: "Relatórios", url: "/reports", icon: FileText },
];

const system = [
  { title: "Sincronizações", url: "/syncs", icon: RefreshCw },
  { title: "Equipe", url: "/team", icon: Users },
  { title: "Configurações", url: "/settings", icon: Settings },
];

export function AppSidebar() {
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const isActive = (url: string) => pathname === url || pathname.startsWith(url + "/");
  const { orgs, active, setActive } = useActiveOrg();
  const [openPicker, setOpenPicker] = useState(false);

  const Section = ({ label, items }: { label: string; items: typeof overview }) => (
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
                className="group/link h-9 rounded-lg data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground"
              >
                <Link to={item.url}>
                  <item.icon className="text-muted-foreground group-data-[active=true]/link:text-primary" />
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
        <div className="flex h-12 items-center gap-2 px-3">
          <div className="grid h-8 w-8 place-items-center rounded-md bg-primary text-primary-foreground">
            <BarChart3 className="h-4 w-4" />
          </div>
          <div className="flex flex-col leading-none group-data-[collapsible=icon]:hidden">
            <span className="text-sm font-semibold tracking-tight">Billing OS</span>
            <span className="text-[10px] text-muted-foreground">Central de custos de IA</span>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent className="gap-1 py-2">
        <Section label="Análise" items={overview} />
        <Section label="Gestão" items={management} />
        <Section label="Sistema" items={system} />
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border p-2 group-data-[collapsible=icon]:hidden">
        <div className="relative">
          <button
            type="button"
            onClick={() => setOpenPicker((v) => !v)}
            className="flex w-full items-center gap-2 rounded-md border border-sidebar-border bg-sidebar-accent/40 px-2.5 py-2 text-left text-[12px] hover:bg-sidebar-accent"
          >
            <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{active?.name ?? "Sem organização"}</div>
              {active && <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{active.role}</div>}
            </div>
            <ChevronDown className="h-3 w-3 opacity-60" />
          </button>
          {openPicker && orgs.length > 0 && (
            <div className="absolute bottom-full left-0 right-0 z-50 mb-1 overflow-hidden rounded-md border border-border bg-popover shadow-lg">
              {orgs.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => { setActive(o.id); setOpenPicker(false); }}
                  className={`flex w-full items-center justify-between px-3 py-2 text-left text-[12px] hover:bg-accent ${o.id === active?.id ? "bg-accent/50" : ""}`}
                >
                  <span className="truncate">{o.name}</span>
                  <span className="ml-2 text-[10px] uppercase tracking-wider text-muted-foreground">{o.role}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
