import { createFileRoute } from "@tanstack/react-router";
import { authorizeCronRequest } from "@/lib/cron-auth.server";

export const Route = createFileRoute("/api/public/cron/evaluate-alerts")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const denied = await authorizeCronRequest(request);
        if (denied) return denied;

        const { evaluateAlerts } = await import("@/lib/alerts.server");
        try {
          const result = await evaluateAlerts();
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
