import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Ban, CheckCircle2, Clock, Search, ShieldCheck, UserX } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/users")({
  head: () => ({ meta: [{ title: "Usuários — Quiwi" }] }),
  component: UsersPage,
});

type Profile = {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  status: "pending" | "active" | "blocked";
  approved_at: string | null;
  created_at: string;
};

async function fetchProfiles(): Promise<Profile[]> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id,email,full_name,avatar_url,status,approved_at,created_at")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Profile[];
}

async function fetchIsAdmin(): Promise<boolean> {
  const { data: session } = await supabase.auth.getSession();
  const uid = session.session?.user.id;
  if (!uid) return false;
  const { data } = await supabase.rpc("has_role", { _user_id: uid, _role: "admin" });
  return Boolean(data);
}

function UsersPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | Profile["status"]>("all");

  const isAdminQuery = useQuery({ queryKey: ["is-admin"], queryFn: fetchIsAdmin });
  const profilesQuery = useQuery({
    queryKey: ["profiles"],
    queryFn: fetchProfiles,
    enabled: isAdminQuery.data === true,
  });

  const approve = useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await supabase.rpc("approve_user", { _user_id: userId });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Usuário aprovado.");
      queryClient.invalidateQueries({ queryKey: ["profiles"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Falha ao aprovar."),
  });

  const block = useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await supabase.rpc("block_user", { _user_id: userId });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Acesso removido.");
      queryClient.invalidateQueries({ queryKey: ["profiles"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Falha ao bloquear."),
  });

  const filtered = useMemo(() => {
    const list = profilesQuery.data ?? [];
    return list.filter((p) => {
      if (statusFilter !== "all" && p.status !== statusFilter) return false;
      if (!search.trim()) return true;
      const q = search.trim().toLowerCase();
      return p.email.toLowerCase().includes(q) || (p.full_name ?? "").toLowerCase().includes(q);
    });
  }, [profilesQuery.data, search, statusFilter]);

  const counts = useMemo(() => {
    const list = profilesQuery.data ?? [];
    return {
      pending: list.filter((p) => p.status === "pending").length,
      active: list.filter((p) => p.status === "active").length,
      blocked: list.filter((p) => p.status === "blocked").length,
      total: list.length,
    };
  }, [profilesQuery.data]);

  if (isAdminQuery.isLoading) {
    return <div className="p-8 text-sm text-muted-foreground">Carregando…</div>;
  }

  if (!isAdminQuery.data) {
    return (
      <div className="mx-auto max-w-md space-y-3 p-12 text-center">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-destructive/10 text-destructive">
          <ShieldCheck className="h-5 w-5" />
        </div>
        <h1 className="font-display text-lg font-semibold">Somente administradores</h1>
        <p className="text-sm text-muted-foreground">
          Apenas administradores podem aprovar ou bloquear usuários.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Sistema
          </div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">Usuários</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Aprove novos acessos e gerencie quem pode entrar no painel.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Pendentes" value={counts.pending} tone="pending" />
        <StatCard label="Ativos" value={counts.active} tone="active" />
        <StatCard label="Bloqueados" value={counts.blocked} tone="blocked" />
        <StatCard label="Total" value={counts.total} tone="neutral" />
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por e-mail ou nome…"
            className="pl-9"
          />
        </div>
        <div className="flex gap-1 rounded-lg border border-border/60 bg-muted/40 p-1">
          {(["all", "pending", "active", "blocked"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                statusFilter === s
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {s === "all" ? "Todos" : s === "pending" ? "Pendentes" : s === "active" ? "Ativos" : "Bloqueados"}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-border/60 bg-card">
        {profilesQuery.isLoading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Carregando usuários…</div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-sm text-muted-foreground">Nenhum usuário nesse filtro.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-border/60 bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Usuário</th>
                <th className="px-4 py-3 text-left font-medium">Status</th>
                <th className="px-4 py-3 text-left font-medium">Criado</th>
                <th className="px-4 py-3 text-right font-medium">Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id} className="border-b border-border/40 last:border-0">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      {p.avatar_url ? (
                        <img
                          src={p.avatar_url}
                          alt={p.email}
                          className="h-8 w-8 rounded-full object-cover"
                        />
                      ) : (
                        <div className="grid h-8 w-8 place-items-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
                          {p.email.slice(0, 1).toUpperCase()}
                        </div>
                      )}
                      <div>
                        <div className="font-medium">{p.full_name ?? p.email.split("@")[0]}</div>
                        <div className="text-xs text-muted-foreground">{p.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={p.status} />
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(p.created_at), { addSuffix: true, locale: ptBR })}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      {p.status === "pending" ? (
                        <Button
                          size="sm"
                          onClick={() => approve.mutate(p.id)}
                          disabled={approve.isPending}
                          className="gap-1.5"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" /> Aprovar
                        </Button>
                      ) : null}
                      {p.status !== "blocked" ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => block.mutate(p.id)}
                          disabled={block.isPending}
                          className="gap-1.5 text-destructive hover:text-destructive"
                        >
                          <UserX className="h-3.5 w-3.5" /> Bloquear
                        </Button>
                      ) : null}
                      {p.status === "blocked" ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => approve.mutate(p.id)}
                          disabled={approve.isPending}
                          className="gap-1.5"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" /> Reativar
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "pending" | "active" | "blocked" | "neutral";
}) {
  const styles = {
    pending: "text-amber-600",
    active: "text-emerald-600",
    blocked: "text-destructive",
    neutral: "text-foreground",
  }[tone];
  return (
    <div className="rounded-xl border border-border/60 bg-card p-4">
      <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`mt-1 font-display text-2xl font-semibold tabular-nums ${styles}`}>{value}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: Profile["status"] }) {
  if (status === "active") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-700">
        <CheckCircle2 className="h-3 w-3" /> Ativo
      </span>
    );
  }
  if (status === "pending") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-700">
        <Clock className="h-3 w-3" /> Pendente
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
      <Ban className="h-3 w-3" /> Bloqueado
    </span>
  );
}
