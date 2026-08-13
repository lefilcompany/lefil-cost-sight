import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const runCostReconciliation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ months: z.number().int().min(1).max(12).optional() }).parse(data ?? {}),
  )
  .handler(async ({ data }) => {
    const { runReconciliation } = await import("./reconciliation.server");
    return runReconciliation({ months: data.months });
  });

export const getReconciliationSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { getReconciliationTolerance } = await import("./reconciliation.server");
    return { tolerance_pct: await getReconciliationTolerance() };
  });

export const updateReconciliationTolerance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ tolerance_pct: z.number().min(0.1).max(100) }).parse(data))
  .handler(async ({ data }) => {
    const { setReconciliationTolerance } = await import("./reconciliation.server");
    return { tolerance_pct: await setReconciliationTolerance(data.tolerance_pct) };
  });
