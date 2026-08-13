import { createFileRoute } from "@tanstack/react-router";
import { authorizeCronRequest } from "@/lib/cron-auth.server";

// Scheduled endpoint — requires the private cron secret (`x-cron-secret`).
export const Route = createFileRoute("/api/public/cron/sync-all")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const denied = await authorizeCronRequest(request);
        if (denied) return denied;

        const { runSyncAll } = await import("@/lib/sync.server");
        try {
          const result = await runSyncAll();
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
