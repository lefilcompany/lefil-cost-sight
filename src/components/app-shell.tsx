import type { ReactNode } from "react";
import { Moon, Sun, LogOut } from "lucide-react";

import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/lib/theme";
import { supabase } from "@/integrations/supabase/client";

export function AppShell({ children, title }: { children: ReactNode; title?: string }) {
  const { theme, toggle } = useTheme();
  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background text-foreground">
        <AppSidebar />
        <div className="flex flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-background/80 px-4 backdrop-blur">
            <SidebarTrigger />
            <div className="flex-1">
              {title && <h1 className="text-sm font-medium text-muted-foreground">{title}</h1>}
            </div>
            <Button variant="ghost" size="icon" onClick={toggle} aria-label="Alternar tema">
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
            <Button variant="ghost" size="icon" onClick={() => supabase.auth.signOut()} aria-label="Sair">
              <LogOut className="h-4 w-4" />
            </Button>
          </header>
          <main className="flex-1 p-6">{children}</main>
        </div>
      </div>
    </SidebarProvider>
  );
}
