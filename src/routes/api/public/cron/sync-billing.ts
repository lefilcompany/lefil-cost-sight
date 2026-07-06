import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/cron/sync-billing")({
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
