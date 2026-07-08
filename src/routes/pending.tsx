import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Clock, LogOut, ShieldAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import quiwiLogo from "@/assets/quiwi-logo.png.asset.json";

export const Route = createFileRoute("/pending")({
  head: () => ({ meta: [{ title: "Aguardando aprovação — Quiwi" }] }),
  component: PendingPage,
});

type State =
  | { kind: "loading" }
  | { kind: "no-session" }
  | { kind: "pending"; email: string }
  | { kind: "blocked"; email: string }
  | { kind: "active" };

function PendingPage() {
  const navigate = useNavigate();
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (!data.session) return setState({ kind: "no-session" });
      const user = data.session.user;
      const { data: profile } = await supabase
        .from("profiles")
        .select("status,email")
        .eq("id", user.id)
        .maybeSingle();
      if (cancelled) return;
      const email = profile?.email ?? user.email ?? "";
      if (profile?.status === "active") {
        setState({ kind: "active" });
        navigate({ to: "/dashboard" });
      } else if (profile?.status === "blocked") {
        setState({ kind: "blocked", email });
      } else {
        setState({ kind: "pending", email });
      }
    };
    check();
    const id = setInterval(check, 15000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [navigate]);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/auth" });
  };

  useEffect(() => {
    if (state.kind === "no-session") navigate({ to: "/auth" });
  }, [state.kind, navigate]);

  const isBlocked = state.kind === "blocked";
  const Icon = isBlocked ? ShieldAlert : Clock;
  const email = state.kind === "pending" || state.kind === "blocked" ? state.email : "";

  return (
    <div className="grid min-h-screen w-full place-items-center bg-background px-6">
      <div className="w-full max-w-md space-y-8 text-center">
        <div className="flex justify-center">
          <img src={quiwiLogo.url} alt="Quiwi" className="h-12 w-auto object-contain" />
        </div>

        <div className="space-y-4">
          <div
            className={`mx-auto grid h-14 w-14 place-items-center rounded-2xl ${
              isBlocked
                ? "bg-destructive/10 text-destructive"
                : "bg-[color:var(--emerald-deep)]/10 text-[color:var(--emerald-deep)]"
            }`}
          >
            <Icon className="h-6 w-6" />
          </div>
          <div className="space-y-2">
            <h1 className="font-display text-2xl font-semibold tracking-tight">
              {isBlocked ? "Acesso bloqueado" : "Aguardando aprovação"}
            </h1>
            <p className="text-sm text-muted-foreground">
              {isBlocked
                ? "Este e-mail não tem permissão para acessar o Quiwi. Fale com o administrador."
                : "Sua conta foi criada. Um administrador precisa aprovar o acesso antes de você entrar no painel."}
            </p>
            {email ? (
              <p className="text-xs font-medium text-foreground/80">{email}</p>
            ) : null}
          </div>
        </div>

        {!isBlocked && state.kind !== "loading" ? (
          <div className="rounded-xl border border-border/60 bg-muted/30 p-4 text-left">
            <p className="text-xs leading-relaxed text-muted-foreground">
              Assim que o administrador liberar seu acesso, esta página vai atualizar
              automaticamente e você será redirecionado ao painel.
            </p>
          </div>
        ) : null}

        <Button variant="outline" className="w-full gap-2" onClick={handleSignOut}>
          <LogOut className="h-4 w-4" />
          Sair
        </Button>
      </div>
    </div>
  );
}
