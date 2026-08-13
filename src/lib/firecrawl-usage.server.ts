import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { latestPeriodUsage } from "./firecrawl-periods";

export type FirecrawlUsage = {
  credits: { used: number; remaining: number; total: number };
  tokens: { used: number; remaining: number; total: number };
  billing_period: { start: string | null; end: string | null };
  plan_name: string | null;
};

async function getKey(connectionId: string): Promise<string | null> {
  const { data } = await supabaseAdmin.rpc("get_connection_api_key_internal", {
    _connection_id: connectionId,
  });
  return (data as string) ?? null;
}

function pick(obj: any, keys: string[]): any {
  for (const k of keys) {
    const v = k.split(".").reduce((a: any, p) => (a == null ? a : a[p]), obj);
    if (v != null) return v;
  }
  return null;
}

export async function fetchFirecrawlUsage(connectionId: string): Promise<FirecrawlUsage> {
  const key = await getKey(connectionId);
  if (!key) throw new Error("API key da Firecrawl não configurada nesta conexão.");
  const headers = { Authorization: `Bearer ${key}` };

  const [creditRes, tokenRes, creditHistRes, tokenHistRes] = await Promise.all([
    fetch("https://api.firecrawl.dev/v2/team/credit-usage", { headers }),
    fetch("https://api.firecrawl.dev/v2/team/token-usage", { headers }),
    fetch("https://api.firecrawl.dev/v2/team/credit-usage/historical", { headers }),
    fetch("https://api.firecrawl.dev/v2/team/token-usage/historical", { headers }),
  ]);

  // O consumo real do ciclo vem do histórico: o saldo pode exceder o plano (rollover).
  const creditHist = creditHistRes.ok ? await creditHistRes.json().catch(() => null) : null;
  const tokenHist = tokenHistRes.ok ? await tokenHistRes.json().catch(() => null) : null;
  const histCreditsUsed = latestPeriodUsage(creditHist, "creditsUsed");
  const histTokensUsed = latestPeriodUsage(tokenHist, "tokensUsed");

  if (!creditRes.ok) {
    throw new Error(`Firecrawl credit-usage ${creditRes.status}: ${await creditRes.text()}`);
  }
  const creditJson: any = await creditRes.json();
  const cData = creditJson?.data ?? creditJson ?? {};

  const cTotal = Number(pick(cData, ["planCredits", "plan_credits", "total_credits", "credits.total"]) ?? 0);
  const cRemaining = Number(
    pick(cData, ["remainingCredits", "remaining_credits", "credits_remaining", "credits.remaining"]) ?? 0,
  );
  const cUsed = Number(
    histCreditsUsed ?? pick(cData, ["creditsUsed", "credits_used", "used_credits"]) ?? Math.max(0, cTotal - cRemaining),
  );

  let tUsed = 0,
    tRemaining = 0,
    tTotal = 0;
  tUsed = histTokensUsed ?? 0;
  if (tokenRes.ok) {
    const tokenJson: any = await tokenRes.json();
    const tData = tokenJson?.data ?? tokenJson ?? {};
    tTotal = Number(pick(tData, ["planTokens", "plan_tokens", "total_tokens", "tokens.total"]) ?? 0);
    tRemaining = Number(
      pick(tData, ["remainingTokens", "remaining_tokens", "tokens_remaining", "tokens.remaining"]) ?? 0,
    );
    tUsed = Number(
      histTokensUsed ?? pick(tData, ["tokensUsed", "tokens_used", "used_tokens"]) ?? Math.max(0, tTotal - tRemaining),
    );
  }

  const start =
    pick(cData, ["billingPeriodStart", "billing_period_start", "billing_period.start", "period_start"]) ?? null;
  const end = pick(cData, ["billingPeriodEnd", "billing_period_end", "billing_period.end", "period_end"]) ?? null;
  const plan_name = pick(cData, ["plan_name", "plan"]) ?? null;

  return {
    credits: { used: cUsed, remaining: cRemaining, total: cTotal },
    tokens: { used: tUsed, remaining: tRemaining, total: tTotal },
    billing_period: {
      start: start ? String(start).slice(0, 10) : null,
      end: end ? String(end).slice(0, 10) : null,
    },
    plan_name: plan_name ? String(plan_name) : null,
  };
}
