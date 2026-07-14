import { Link, useRouterState } from "@tanstack/react-router";
import {
  Bell,
  FileText,
  Gauge,
  Layers,
  LayoutDashboard,
  Plug,
  Receipt,
  RefreshCw,
  Settings,
  ShieldCheck,
  Sparkles,
  Users,
  type LucideIcon,
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
import { NAVIGATION_SECTIONS, type NavigationItem } from "@/lib/navigation";
import quiwiIcon from "@/assets/quiwi-icon.png.asset.json";
import quiwiLogo from "@/assets/quiwi-logo.png.asset.json";

const ICONS: Record<string, LucideIcon> = {
  Bell,
  FileText,
  Gauge,
  Layers,
  LayoutDashboard,
  Plug,
  Receipt,
  RefreshCw,
  Settings,
  ShieldCheck,
  Users,
};

export function AppSidebar() {
  const pathname = useRouterState({ select: (router) => router.location.pathname });
  const isActive = (url: string) => pathname === url || pathname.startsWith(`${url}/`);

  const Section = ({ label, items }: { label: string; items: NavigationItem[] }) => (
    <SidebarGroup>
      <SidebarGroupLabel className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
        {label}
      </SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => {
            const Icon = ICONS[item.icon] ?? LayoutDashboard;
            return (
              <SidebarMenuItem key={item.url}>
                <SidebarMenuButton
                  asChild
                  isActive={isActive(item.url)}
                  tooltip={item.title}
                  className="group/link h-9 rounded-lg data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground data-[active=true]:shadow-[inset_0_0_0_1px_var(--color-sidebar-border)]"
                >
                  <Link to={item.url} title={item.description}>
                    <Icon className="text-muted-foreground group-data-[active=true]/link:text-[color:var(--color-gold)]" />
                    <span className="text-[13px] font-medium tracking-tight">{item.title}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border">
      <SidebarHeader className="border-b border-sidebar-border">
        <div className="flex h-12 items-center gap-3 px-2 py-2.5">
          <img
            src={quiwiIcon.url}
            alt="Quiwi"
            className="hidden h-10 w-10 shrink-0 rounded-lg object-contain shadow-[inset_0_0_0_1px_var(--color-sidebar-border)] group-data-[collapsible=icon]:block"
          />
          <img
            src={quiwiLogo.url}
            alt="Quiwi"
            className="block h-10 w-auto shrink-0 object-contain group-data-[collapsible=icon]:hidden"
          />
        </div>
      </SidebarHeader>

      <SidebarContent className="gap-1 py-2">
        {NAVIGATION_SECTIONS.map((section) => (
          <Section key={section.label} label={section.label} items={section.items} />
        ))}
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border p-3 group-data-[collapsible=icon]:hidden">
        <div className="rounded-lg border border-sidebar-border bg-sidebar-accent/40 p-3">
          <div className="flex items-center gap-2 text-[color:var(--color-gold)]">
            <Sparkles className="h-3.5 w-3.5" />
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em]">Próxima decisão</span>
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
            Revise projeções, custos sem alocação e faturas pendentes antes do fechamento do mês.
          </p>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
