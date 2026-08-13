import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const runDataQualityCheck = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { validateUsageConsistency } = await import("./data-quality.server");
    return validateUsageConsistency();
  });
