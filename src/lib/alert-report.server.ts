// Server-only: gera um CSV com os cost_entries do período afetado por um alerta
// e devolve um link assinado (o e-mail não suporta anexos, então enviamos link de download).
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const BUCKET = "alert-reports";
const SIGNED_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 dias

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export type AlertReportScope = {
  scope: "global" | "client" | "platform" | "provider";
  scopeId?: string | null;
};

export type AlertReport = { url: string; rows: number; totalBrl: number; fileName: string };

/**
 * Monta o CSV dos lançamentos de custo do período e faz upload no storage privado.
 * Nunca lança: em caso de falha retorna null para não bloquear a notificação.
 */
export async function buildCostEntriesReport(params: {
  ruleId: string;
  ruleName: string;
  periodStart: string;
  periodEnd: string;
  scope: AlertReportScope;
  organizationId?: string | null;
}): Promise<AlertReport | null> {
  try {
    const { periodStart, periodEnd, scope } = params;
    if (!periodStart || !periodEnd) return null;

    // periodEnd é inclusivo no rótulo; na consulta usamos < dia seguinte.
    const endExclusive = new Date(`${periodEnd}T00:00:00.000Z`);
    endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);

    let q = supabaseAdmin
      .from("cost_entries")
      .select(
        "entry_date, description, origin, cost_usd, exchange_rate, cost_brl, usage_quantity, usage_unit, provider_id, platform_id, client_id",
      )
      .gte("entry_date", periodStart)
      .lt("entry_date", endExclusive.toISOString().slice(0, 10))
      .order("entry_date", { ascending: true });

    if (params.organizationId) q = q.eq("organization_id", params.organizationId);
    if (scope.scope === "client" && scope.scopeId) q = q.eq("client_id", scope.scopeId);
    if (scope.scope === "platform" && scope.scopeId) q = q.eq("platform_id", scope.scopeId);
    if (scope.scope === "provider" && scope.scopeId) q = q.eq("provider_id", scope.scopeId);

    const { data, error } = await q.limit(20000);
    if (error) throw error;
    const rows = (data ?? []) as any[];
    if (rows.length === 0) return null;

    // Resolve nomes para leitura humana.
    const [{ data: providers }, { data: platforms }, { data: clients }] = await Promise.all([
      supabaseAdmin.from("providers").select("id,name"),
      supabaseAdmin.from("platforms").select("id,name"),
      supabaseAdmin.from("clients").select("id,name"),
    ]);
    const nameOf = (list: any[] | null, id: string | null) =>
      (id && (list ?? []).find((x) => x.id === id)?.name) || "";

    const header = [
      "data",
      "fornecedor",
      "plataforma",
      "cliente",
      "descricao",
      "origem",
      "quantidade",
      "unidade",
      "custo_usd",
      "cotacao",
      "custo_brl",
    ];
    const lines = [header.join(";")];
    let totalBrl = 0;
    for (const r of rows) {
      totalBrl += Number(r.cost_brl ?? 0);
      lines.push(
        [
          r.entry_date,
          nameOf(providers as any[], r.provider_id),
          nameOf(platforms as any[], r.platform_id),
          nameOf(clients as any[], r.client_id),
          r.description ?? "",
          r.origin ?? "",
          r.usage_quantity ?? "",
          r.usage_unit ?? "",
          Number(r.cost_usd ?? 0).toFixed(6),
          r.exchange_rate ?? "",
          Number(r.cost_brl ?? 0).toFixed(2),
        ]
          .map(csvCell)
          .join(";"),
      );
    }
    lines.push(["TOTAL", "", "", "", "", "", "", "", "", "", totalBrl.toFixed(2)].join(";"));

    const csv = "\uFEFF" + lines.join("\n");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const fileName = `custos_${periodStart}_a_${periodEnd}.csv`;
    const path = `${params.organizationId ?? "org"}/${params.ruleId}/${stamp}_${fileName}`;

    const up = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(path, new Blob([csv], { type: "text/csv;charset=utf-8" }), {
        contentType: "text/csv;charset=utf-8",
        upsert: true,
      });
    if (up.error) throw up.error;

    const signed = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(path, SIGNED_TTL_SECONDS);
    if (signed.error || !signed.data?.signedUrl) throw signed.error ?? new Error("signed url vazia");

    return { url: signed.data.signedUrl, rows: rows.length, totalBrl, fileName };
  } catch (err: any) {
    console.error("[alert-report] falha ao gerar CSV", err?.message ?? err);
    return null;
  }
}
