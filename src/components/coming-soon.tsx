import { AppShell } from "@/components/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Sparkles } from "lucide-react";
import type { ReactNode } from "react";

export function ComingSoon({
  title,
  eyebrow,
  description,
  phase,
  children,
}: {
  title: string;
  eyebrow?: string;
  description: string;
  phase: string;
  children?: ReactNode;
}) {
  return (
    <AppShell title={title} eyebrow={eyebrow ?? "Em breve"}>
      <Card>
        <CardContent className="flex flex-col items-center justify-center gap-4 py-16 text-center">
          <div className="grid h-12 w-12 place-items-center rounded-full bg-primary/10 text-primary">
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">{title}</h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">{description}</p>
          </div>
          <div className="rounded-full border border-border bg-muted/40 px-3 py-1 text-[11px] font-medium text-muted-foreground">
            Previsto para {phase}
          </div>
          {children}
        </CardContent>
      </Card>
    </AppShell>
  );
}
