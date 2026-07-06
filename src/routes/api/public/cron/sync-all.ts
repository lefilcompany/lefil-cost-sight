import { createFileRoute } from "@tanstack/react-router";

// Public cron endpoint — authenticated via Supabase anon key in the `apikey` header
// (the same key pg_net will send). No user session required.
export const Route = createFileRoute("/api/public/cron/sync-all")({
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
