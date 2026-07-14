import { useEffect, useState, type ReactNode } from "react";
import { Bell, ChevronRight, LogOut, Moon, Search, Sun } from "lucide-react";
import { Link, useRouterState } from "@tanstack/react-router";

import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/lib/theme";
import { getNavigationLabel } from "@/lib/navigation";
import { supabase } from "@/integrations/supabase/client";
import { GeminiAssistant } from "@/components/gemini-assistant";

const SEGMENT_LABELS: Record<string, string> = {
  overview: "Visão geral",
  dashboard: "Visão geral",
  financial: "Visão geral",
  platforms: "Centros de custo",
  providers: "Fornecedores e integrações",
  clients: "Clientes",
  costs: "Lançamentos",
  billing: "Consumo e planos",
  invoices: "Faturas",
  syncs: "Saúde dos dados",
  alerts: "Alertas",
  users: "Equipe e acessos",
  settings: "Configurações",
};

export function AppShell({
  children,
  title,
  eyebrow,
  actions,
}: {
  children: ReactNode;
  title?: string;
  eyebrow?: string;
  actions?: ReactNode;
}) {
  const { theme, toggle } = useTheme();
  const pathname = useRouterState({ select: (router) => router.location.pathname });
  const [email, setEmail] = useState("");
  const [openAlerts, setOpenAlerts] = useState(0);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? ""));
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const { count } = await supabase
        .from("alert_events")
        .select("id", { count: "exact", head: true })
        .eq("status", "open");
      if (!cancelled) setOpenAlerts(count ?? 0);
    };

    void load();
    const channel = supabase
      .channel("app-shell-alerts")
      .on("postgres_changes", { event: "*", schema: "public", table: "alert_events" }, () => void load())
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, []);

  const segments = pathname.split("/").filter(Boolean);
  const currentNavigationLabel = getNavigationLabel(pathname);

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background text-foreground">
        <AppSidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-3 z-30 mx-3 mt-3 flex h-14 items-center gap-3 rounded-2xl border border-border/70 bg-background/70 px-4 shadow-[0_10px_30px_-18px_var(--color-sidebar-primary)] backdrop-blur-xl">
            <SidebarTrigger className="h-8 w-8" />
            <nav className="hidden items-center gap-1.5 text-[12px] text-muted-foreground md:flex">
              <Link to="/overview" className="hover:text-foreground">Quiwi</Link>
              {segments.map((segment, index) => {
                const isLast = index === segments.length - 1;
                const label = isLast && currentNavigationLabel
                  ? currentNavigationLabel
                  : SEGMENT_LABELS[segment] ?? segment;
                return (
                  <span key={`${segment}-${index}`} className="flex items-center gap-1.5">
                    <ChevronRight className="h-3 w-3 opacity-50" />
                    <span className={isLast ? "font-medium text-foreground" : ""}>{label}</span>
                  </span>
                );
              })}
            </nav>

            <div className="ml-auto flex items-center gap-2">
              <div className="hidden items-center gap-2 rounded-md border border-border/70 bg-muted/40 px-2.5 py-1.5 text-xs text-muted-foreground md:flex">
                <Search className="h-3.5 w-3.5" />
                <span>Buscar</span>
                <kbd className="ml-2 rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[10px]">⌘K</kbd>
              </div>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={toggle} aria-label="Alternar tema">
                {theme === "light" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </Button>
              <Link
                to="/alerts"
                aria-label="Alertas"
                className="relative grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <Bell className="h-4 w-4" />
                {openAlerts > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[9px] font-semibold text-white">
                    {openAlerts > 99 ? "99+" : openAlerts}
                  </span>
                )}
              </Link>
              <div className="hidden items-center gap-2 rounded-full border border-border/70 bg-muted/40 py-0.5 pl-0.5 pr-3 sm:flex">
                <div className="grid h-6 w-6 place-items-center rounded-full gradient-emerald text-[10px] font-semibold text-[color:var(--color-gold)]">
                  {(email[0] ?? "L").toUpperCase()}
                </div>
                <span className="max-w-[140px] truncate text-[11px] text-muted-foreground">{email || "usuário"}</span>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => supabase.auth.signOut()}
                aria-label="Sair"
              >
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          </header>

          <main className="flex-1 px-4 py-6 md:px-8 md:py-8">
            {(title || actions || eyebrow) && (
              <div className="mx-auto mb-8 flex max-w-[1400px] flex-wrap items-end justify-between gap-4">
                <div className="min-w-0">
                  {eyebrow && (
                    <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-border/70 bg-muted/40 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                      <span className="h-1.5 w-1.5 rounded-full bg-[color:var(--color-gold)]" />
                      {eyebrow}
                    </div>
                  )}
                  {title && (
                    <h1 className="font-display text-[28px] font-semibold leading-tight tracking-tight md:text-[32px]">
                      {title}
                    </h1>
                  )}
                </div>
                {actions && <div className="flex items-center gap-2">{actions}</div>}
              </div>
            )}
            <div className="mx-auto max-w-[1400px]">{children}</div>
          </main>
        </div>
      </div>
      <GeminiAssistant />
    </SidebarProvider>
  );
}
