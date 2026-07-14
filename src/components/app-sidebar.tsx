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
    <SidebarGroup className="px-2.5 py-1 group-data-[collapsible=icon]:px-1.5">
      <SidebarGroupLabel className="h-7 px-2 text-[9px] font-semibold uppercase tracking-[0.18em] text-sidebar-foreground/45">
        {label}
      </SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu className="gap-1.5">
          {items.map((item) => {
            const Icon = ICONS[item.icon] ?? LayoutDashboard;
            return (
              <SidebarMenuItem key={item.url}>
                <SidebarMenuButton
                  asChild
                  isActive={isActive(item.url)}
                  tooltip={item.title}
                  className="group/link relative h-10 rounded-xl px-2.5 text-sidebar-foreground/70 transition-all duration-200 hover:bg-sidebar-accent/65 hover:text-sidebar-accent-foreground data-[active=true]:bg-sidebar-primary data-[active=true]:text-sidebar-primary-foreground data-[active=true]:shadow-[0_12px_28px_-18px_var(--color-sidebar-primary)] group-data-[collapsible=icon]:!size-10 group-data-[collapsible=icon]:!p-1.5"
                >
                  <Link to={item.url} title={item.description}>
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-sidebar-border/70 bg-sidebar-accent/35 transition-colors group-hover/link:bg-sidebar-accent group-data-[active=true]/link:border-[color:var(--color-lime)]/25 group-data-[active=true]/link:bg-[color:var(--color-lime)]">
                      <Icon className="size-4 text-sidebar-foreground/65 transition-colors group-hover/link:text-sidebar-accent-foreground group-data-[active=true]/link:text-[color:var(--color-lime-foreground)]" />
                    </span>
                    <span className="text-[12px] font-semibold tracking-[-0.01em] group-data-[collapsible=icon]:hidden">
                      {item.title}
                    </span>
                    <span className="ml-auto h-1.5 w-1.5 rounded-full bg-[color:var(--color-lime)] opacity-0 shadow-[0_0_0_4px_color-mix(in_oklab,var(--color-lime)_16%,transparent)] transition-opacity group-data-[active=true]/link:opacity-100 group-data-[collapsible=icon]:hidden" />
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
    <Sidebar variant="floating" collapsible="icon" className="app-sidebar">
      <SidebarHeader className="p-3 pb-2 group-data-[collapsible=icon]:p-1.5">
        <div className="flex min-h-16 items-center gap-3 rounded-2xl border border-sidebar-border/80 bg-sidebar-accent/30 px-3 shadow-[0_10px_30px_-24px_var(--color-sidebar-primary)] backdrop-blur-sm group-data-[collapsible=icon]:min-h-11 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
          <img
            src={quiwiIcon.url}
            alt="Quiwi"
            className="hidden h-9 w-9 shrink-0 rounded-xl object-contain shadow-[inset_0_0_0_1px_var(--color-sidebar-border)] group-data-[collapsible=icon]:block"
          />
          <img
            src={quiwiLogo.url}
            alt="Quiwi"
            className="h-8 w-auto shrink-0 object-contain group-data-[collapsible=icon]:hidden"
          />
        </div>
      </SidebarHeader>

      <SidebarContent className="sidebar-scrollarea gap-0 px-1 pb-3 pt-1">
        <nav aria-label="Navegação principal" className="flex flex-col gap-1">
          {NAVIGATION_SECTIONS.map((section) => (
            <Section key={section.label} label={section.label} items={section.items} />
          ))}
        </nav>
      </SidebarContent>

      <SidebarFooter className="p-3 pt-2 group-data-[collapsible=icon]:hidden">
        <div className="sidebar-decision-card relative overflow-hidden rounded-2xl border border-sidebar-border/80 p-3.5">
          <div className="relative flex items-center gap-2 text-sidebar-accent-foreground">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-[color:var(--color-lime)] text-[color:var(--color-lime-foreground)] shadow-sm">
              <Sparkles className="h-3.5 w-3.5" />
            </span>
            <div>
              <span className="block text-[9px] font-semibold uppercase tracking-[0.16em] text-sidebar-foreground/50">
                Próxima decisão
              </span>
              <span className="mt-0.5 block text-[11px] font-semibold text-sidebar-foreground">Fechamento do mês</span>
            </div>
          </div>
          <p className="relative mt-2.5 text-[10px] leading-relaxed text-sidebar-foreground/60">
            Revise projeções, custos sem alocação e faturas pendentes.
          </p>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
