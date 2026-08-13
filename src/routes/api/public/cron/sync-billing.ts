import { createFileRoute } from "@tanstack/react-router";
import { authorizeCronRequest } from "@/lib/cron-auth.server";

export const Route = createFileRoute("/api/public/cron/sync-billing")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const denied = await authorizeCronRequest(request);
        if (denied) return denied;

        const { runBillingSyncAll } = await import("@/lib/billing.server");
        try {
          const result = await runBillingSyncAll();
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
