import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export type OrgSummary = {
  id: string;
  name: string;
  slug: string;
  role: string;
};

const STORAGE_KEY = "billing-os:active-org";

export function useActiveOrg() {
  const [orgs, setOrgs] = useState<OrgSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      setOrgs([]);
      setActiveId(null);
      setLoading(false);
      return;
    }
    const { data, error } = await supabase
      .from("organization_members")
      .select("role, organization:organizations(id, name, slug)")
      .eq("user_id", userData.user.id)
      .eq("status", "active");
    if (error || !data) {
      setOrgs([]);
      setLoading(false);
      return;
    }
    const list: OrgSummary[] = data
      .map((m: any) => m.organization ? {
        id: m.organization.id,
        name: m.organization.name,
        slug: m.organization.slug,
        role: m.role,
      } : null)
      .filter(Boolean) as OrgSummary[];
    setOrgs(list);
    const saved = typeof window !== "undefined" ? window.localStorage.getItem(STORAGE_KEY) : null;
    const pick = saved && list.some((o) => o.id === saved) ? saved : (list[0]?.id ?? null);
    setActiveId(pick);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const setActive = useCallback((id: string) => {
    setActiveId(id);
    if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, id);
  }, []);

  const active = orgs.find((o) => o.id === activeId) ?? null;

  return { orgs, active, activeId, setActive, loading, reload: load };
}
