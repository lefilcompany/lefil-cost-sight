import { createFileRoute } from "@tanstack/react-router";
import { authorizeCronRequest } from "@/lib/cron-auth.server";

export const Route = createFileRoute("/api/public/cron/backfill-usage")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const denied = await authorizeCronRequest(request);
        if (denied) return denied;

        let full = false;
        try {
          const body = (await request.json()) as { full?: boolean } | null;
          full = Boolean(body?.full);
        } catch {
          /* corpo vazio = incremental */
        }

        const { backfillUsageDailyAll } = await import("@/lib/usage-backfill.server");
        try {
          const result = await backfillUsageDailyAll({ full });
          return Response.json(result);
        } catch (err: any) {
          return new Response(JSON.stringify({ error: String(err?.message ?? err) }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
