import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import quiwiLogo from "@/assets/quiwi-logo.png.asset.json";

type AuthorizationDetails = {
  client?: { name?: string; client_uri?: string; redirect_uris?: string[] } | null;
  redirect_url?: string;
  redirect_to?: string;
  scope?: string;
};

// Local typed wrapper — supabase.auth.oauth is beta and may not appear in types.
function oauthApi() {
  const anyAuth = (supabase.auth as unknown) as {
    oauth: {
      getAuthorizationDetails: (id: string) => Promise<{ data: AuthorizationDetails | null; error: Error | null }>;
      approveAuthorization: (id: string) => Promise<{ data: AuthorizationDetails | null; error: Error | null }>;
      denyAuthorization: (id: string) => Promise<{ data: AuthorizationDetails | null; error: Error | null }>;
    };
  };
  return anyAuth.oauth;
}

export const Route = createFileRoute("/.lovable/oauth/consent")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>) => ({
    authorization_id: typeof s.authorization_id === "string" ? s.authorization_id : "",
  }),
  beforeLoad: async ({ search, location }) => {
    if (!search.authorization_id) throw new Error("Faltando authorization_id");
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      const next = location.pathname + location.searchStr;
      throw redirect({ to: "/auth", search: { next } });
    }
  },
  loader: async ({ location }) => {
    const authorizationId = new URLSearchParams(location.search).get("authorization_id")!;
    const { data, error } = await oauthApi().getAuthorizationDetails(authorizationId);
    if (error) throw error;
    const immediate = data?.redirect_url ?? data?.redirect_to;
    if (immediate && !data?.client) throw redirect({ href: immediate });
    return data;
  },
  component: Consent,
  errorComponent: ({ error }) => (
    <main className="mx-auto max-w-md p-8">
      <h1 className="text-xl font-semibold">Não foi possível carregar esta autorização</h1>
      <p className="mt-2 text-sm text-muted-foreground">{String((error as Error)?.message ?? error)}</p>
    </main>
  ),
});

function Consent() {
  const details = Route.useLoaderData();
  const { authorization_id } = Route.useSearch();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
  }, []);

  async function decide(approve: boolean) {
    setBusy(true);
    setError(null);
    const api = oauthApi();
    const { data, error } = approve
      ? await api.approveAuthorization(authorization_id)
      : await api.denyAuthorization(authorization_id);
    if (error) {
      setBusy(false);
      setError(error.message);
      return;
    }
    const target = data?.redirect_url ?? data?.redirect_to;
    if (!target) {
      setBusy(false);
      setError("O servidor de autorização não devolveu um URL de retorno.");
      return;
    }
    window.location.href = target;
  }

  const clientName = details?.client?.name ?? "um aplicativo externo";
  const scopes = (details?.scope ?? "openid email profile")
    .split(/\s+/)
    .filter(Boolean);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 p-8">
      <div className="flex items-center gap-3">
        <img src={quiwiLogo.url} alt="Quiwi" className="h-10 w-auto object-contain" />
      </div>
      <div className="space-y-2">
        <h1 className="font-display text-2xl font-semibold tracking-tight">
          Conectar {clientName} ao Quiwi Cost Center
        </h1>
        <p className="text-sm text-muted-foreground">
          Isso permite que {clientName} use as ferramentas deste app agindo como você
          {email ? ` (${email})` : ""}. Suas permissões e políticas de dados continuam valendo.
        </p>
      </div>

      <div className="rounded-lg border bg-card p-4 text-sm">
        <div className="font-medium">Permissões solicitadas</div>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
          {scopes.map((s: string) => (
            <li key={s}>{scopeLabel(s)}</li>
          ))}
          <li>Chamar as ferramentas MCP habilitadas neste app enquanto você estiver conectado.</li>
        </ul>
      </div>

      {error && (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex gap-3">
        <Button className="flex-1" disabled={busy} onClick={() => decide(true)}>
          Aprovar
        </Button>
        <Button variant="outline" className="flex-1" disabled={busy} onClick={() => decide(false)}>
          Cancelar conexão
        </Button>
      </div>
    </main>
  );
}

function scopeLabel(scope: string): string {
  switch (scope) {
    case "openid":
      return "Identificar você via login";
    case "email":
      return "Compartilhar seu endereço de e-mail";
    case "profile":
      return "Compartilhar seu perfil básico";
    default:
      return `Permissão adicional: ${scope}`;
  }
}
