import { Link, useRouterState } from "@tanstack/react-router";
import {
  Bell,
  FileText,
  Gauge,
  HeartPulse,
  KeyRound,
  Layers,
  LayoutDashboard,
  Plug,
  PlugZap,
  Receipt,
  RefreshCw,
  Scale,
  Send,
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
  HeartPulse,
  KeyRound,
  Layers,
  LayoutDashboard,
  Plug,
  PlugZap,
  Receipt,
  RefreshCw,
  Scale,
  Send,
  Settings,
  ShieldCheck,
  Users,
};

export function AppSidebar() {
  const pathname = useRouterState({ select: (router) => router.location.pathname });
  const isActive = (url: string) => pathname === url || pathname.startsWith(`${url}/`);

  const Section = ({
    label,
    items,
    collapsedByDefault,
  }: {
    label: string;
    items: NavigationItem[];
    collapsedByDefault?: boolean;
  }) => {
    const hasActive = items.some((item) => isActive(item.url));
    const [open, setOpen] = useState(!collapsedByDefault || hasActive);

    return (
      <SidebarGroup className="px-2.5 py-1 group-data-[collapsible=icon]:px-1.5">
        <SidebarGroupLabel asChild className="h-7 px-2 text-[9px] font-semibold uppercase tracking-[0.18em] text-sidebar-foreground/45">
          {collapsedByDefault ? (
            <button
              type="button"
              onClick={() => setOpen((value) => !value)}
              aria-expanded={open}
              className="flex w-full items-center gap-1.5 group-data-[collapsible=icon]:hidden"
            >
              <span>{label}</span>
              <ChevronDown className={`h-3 w-3 transition-transform ${open ? "" : "-rotate-90"}`} />
            </button>
          ) : (
            <span>{label}</span>
          )}
        </SidebarGroupLabel>
        {(open || collapsedByDefault === undefined) && (
          <SidebarGroupContent>
            <SidebarMenu className="gap-0.5">
              {items.map((item) => {
                const Icon = ICONS[item.icon] ?? LayoutDashboard;
                return (
                  <SidebarMenuItem key={item.url}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive(item.url)}
                      tooltip={item.title}
                      className="group/link relative h-9 rounded-lg px-2.5 text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground data-[active=true]:bg-sidebar-primary data-[active=true]:text-sidebar-primary-foreground group-data-[collapsible=icon]:!size-9 group-data-[collapsible=icon]:!p-1.5"
                    >
                      <Link to={item.url}>
                        <Icon className="size-4 shrink-0 text-sidebar-foreground/55 transition-colors group-hover/link:text-sidebar-accent-foreground group-data-[active=true]/link:text-[color:var(--color-lime)]" />
                        <span className="text-[12.5px] font-medium tracking-[-0.01em] group-data-[collapsible=icon]:hidden">
                          {item.title}
                        </span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        )}
      </SidebarGroup>
    );
  };

  return (
    <Sidebar variant="floating" collapsible="icon" className="app-sidebar">
      <SidebarHeader className="p-3 pb-1 group-data-[collapsible=icon]:p-1.5">
        <div className="flex min-h-12 items-center gap-3 px-1 group-data-[collapsible=icon]:min-h-10 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
          <img
            src={quiwiIcon.url}
            alt="Quiwi"
            className="hidden h-8 w-8 shrink-0 rounded-lg object-contain group-data-[collapsible=icon]:block"
          />
          <img
            src={quiwiLogo.url}
            alt="Quiwi"
            className="h-7 w-auto shrink-0 object-contain group-data-[collapsible=icon]:hidden"
          />
        </div>
      </SidebarHeader>

      <SidebarContent className="sidebar-scrollarea gap-0 px-1 pb-4 pt-1">
        <nav aria-label="Navegação principal" className="flex flex-col gap-0.5">
          {NAVIGATION_SECTIONS.map((section) => (
            <Section
              key={section.label}
              label={section.label}
              items={section.items}
              collapsedByDefault={section.collapsedByDefault}
            />
          ))}
        </nav>
      </SidebarContent>
    </Sidebar>
  );
}

