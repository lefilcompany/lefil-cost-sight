import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { UserPlus, Trash2, Shield } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { LoadingState } from "@/components/ui-kit";
import { supabase } from "@/integrations/supabase/client";
import { useActiveOrg } from "@/hooks/use-active-org";

export const Route = createFileRoute("/_authenticated/team")({
  head: () => ({ meta: [{ title: "Equipe — Billing OS" }] }),
  component: TeamPage,
});

const ROLES: { value: string; label: string; desc: string }[] = [
  { value: "owner", label: "Owner", desc: "Controle total, incluindo exclusão da organização" },
  { value: "administrator", label: "Administrator", desc: "Gerencia conexões, membros e configurações" },
  { value: "finance", label: "Finance", desc: "Visualiza dados financeiros e cria orçamentos" },
  { value: "analyst", label: "Analyst", desc: "Consulta dashboards e gera relatórios" },
  { value: "viewer", label: "Viewer", desc: "Acesso somente leitura" },
];

function TeamPage() {
  const { active, activeId } = useActiveOrg();
  const qc = useQueryClient();
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("viewer");

  const canManage = active?.role === "owner" || active?.role === "administrator";

  const membersQ = useQuery({
    queryKey: ["team-members", activeId],
    enabled: !!activeId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organization_members")
        .select("id, user_id, role, status, joined_at")
        .eq("organization_id", activeId!)
        .order("joined_at");
      if (error) throw error;
      return data ?? [];
    },
  });

  const invitesQ = useQuery({
    queryKey: ["team-invites", activeId],
    enabled: !!activeId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organization_invitations")
        .select("id, email, role, status, expires_at, created_at")
        .eq("organization_id", activeId!)
        .eq("status", "pending")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const inviteMut = useMutation({
    mutationFn: async () => {
      if (!activeId || !inviteEmail.trim()) throw new Error("Preencha o email");
      const { error } = await supabase.from("organization_invitations").insert({
        organization_id: activeId,
        email: inviteEmail.trim().toLowerCase(),
        role: inviteRole as any,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Convite registrado. O usuário deve se cadastrar com este email.");
      setInviteEmail("");
      qc.invalidateQueries({ queryKey: ["team-invites"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const roleMut = useMutation({
    mutationFn: async ({ id, role }: { id: string; role: string }) => {
      const { error } = await supabase.from("organization_members").update({ role: role as any }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Papel atualizado");
      qc.invalidateQueries({ queryKey: ["team-members"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const removeMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("organization_members").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Membro removido");
      qc.invalidateQueries({ queryKey: ["team-members"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <AppShell title="Equipe" eyebrow="Gestão de acesso">
      <div className="grid gap-6">
        {canManage && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base"><UserPlus className="h-4 w-4" /> Convidar membro</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 md:grid-cols-[1fr_180px_auto]">
                <div>
                  <Label className="text-xs">Email</Label>
                  <Input type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="pessoa@empresa.com" />
                </div>
                <div>
                  <Label className="text-xs">Papel</Label>
                  <select
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value)}
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
                  >
                    {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </select>
                </div>
                <div className="flex items-end">
                  <Button onClick={() => inviteMut.mutate()} disabled={inviteMut.isPending || !inviteEmail}>
                    Enviar convite
                  </Button>
                </div>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                O convite fica registrado. Quando a pessoa se cadastrar com este email, ela será adicionada à organização automaticamente (implementado na Fase 2).
              </p>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Membros ativos</CardTitle>
          </CardHeader>
          <CardContent>
            {membersQ.isLoading ? <LoadingState /> : (
              <div className="divide-y divide-border">
                {membersQ.data?.map((m: any) => (
                  <div key={m.id} className="flex items-center justify-between py-3">
                    <div>
                      <div className="font-mono text-xs text-muted-foreground">{m.user_id.slice(0, 8)}…</div>
                      <div className="mt-1 flex items-center gap-2">
                        <Badge variant="outline"><Shield className="mr-1 h-3 w-3" />{m.role}</Badge>
                        <span className="text-xs text-muted-foreground">
                          Entrou em {new Date(m.joined_at).toLocaleDateString("pt-BR")}
                        </span>
                      </div>
                    </div>
                    {canManage && (
                      <div className="flex items-center gap-2">
                        <select
                          value={m.role}
                          onChange={(e) => roleMut.mutate({ id: m.id, role: e.target.value })}
                          className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                        >
                          {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                        </select>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive"
                          onClick={() => { if (confirm("Remover este membro?")) removeMut.mutate(m.id); }}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {(invitesQ.data?.length ?? 0) > 0 && (
          <Card>
            <CardHeader><CardTitle className="text-base">Convites pendentes</CardTitle></CardHeader>
            <CardContent>
              <div className="divide-y divide-border">
                {invitesQ.data?.map((inv: any) => (
                  <div key={inv.id} className="flex items-center justify-between py-3 text-sm">
                    <div>
                      <div className="font-medium">{inv.email}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        Papel: <Badge variant="outline" className="ml-1">{inv.role}</Badge>
                        <span className="ml-3">Expira {new Date(inv.expires_at).toLocaleDateString("pt-BR")}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
