import { createFileRoute } from "@tanstack/react-router";
import { authorizeCronRequest } from "@/lib/cron-auth.server";

export const Route = createFileRoute("/api/public/hooks/update-usd-rate")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const denied = await authorizeCronRequest(request);
        if (denied) return denied;

        const { refreshUsdBrlRate } = await import("@/lib/usd-rate.server");
        const result = await refreshUsdBrlRate(false);

        if (result.source === "manual") {
          return new Response(
            JSON.stringify({ success: true, skipped: true, reason: "manual override active", rate: result.rate }),
            { headers: { "Content-Type": "application/json" } },
          );
        }

        return new Response(JSON.stringify({ success: true, ...result }), {
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
