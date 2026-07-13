import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(context: any) {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Somente administradores podem gerenciar o Monitor News.");
}

function originFromRequest(): string {
  try {
    const req = getRequest();
    if (req) return new URL(req.url).origin;
  } catch {}
  return process.env.APP_URL || "https://lefil-cost-sight.lovable.app";
}

export const startMonitorNewsOauth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { origin?: string }) => data ?? {})
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { buildAuthUrl } = await import("./monitor-news.server");
    const origin = data.origin || originFromRequest();
    return buildAuthUrl(context.userId, origin);
  });

export const getMonitorNewsStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { getActiveConnection } = await import("./monitor-news.server");
    const conn = await getActiveConnection();
    return {
      connected: !!conn,
      connected_at: conn?.connected_at ?? null,
      expires_at: conn?.expires_at ?? null,
      scope: conn?.scope ?? null,
    };
  });

export const syncMonitorNewsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { syncMonitorNews } = await import("./monitor-news.server");
    return syncMonitorNews(context.userId);
  });

export const disconnectMonitorNewsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { disconnectMonitorNews } = await import("./monitor-news.server");
    await disconnectMonitorNews();
    return { ok: true };
  });
