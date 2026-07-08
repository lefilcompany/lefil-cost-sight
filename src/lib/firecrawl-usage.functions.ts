import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getFirecrawlUsage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { connection_id: string }) => data)
  .handler(async ({ data }) => {
    const { fetchFirecrawlUsage } = await import("./firecrawl-usage.server");
    return fetchFirecrawlUsage(data.connection_id);
  });
