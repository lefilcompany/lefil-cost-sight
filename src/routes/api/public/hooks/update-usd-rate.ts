import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/update-usd-rate")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = request.headers.get("apikey") ?? request.headers.get("authorization")?.replace("Bearer ", "");
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY;
        if (!token || !expected || token !== expected) {
          return new Response(JSON.stringify({ error: "unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }

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
