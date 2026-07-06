import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/cron/evaluate-alerts")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const providedKey = request.headers.get("apikey") ?? "";
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY ?? "";
        if (!expected || providedKey !== expected) {
          return new Response(JSON.stringify({ error: "unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }
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
