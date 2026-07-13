import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/cron/sync-monitor-news")({
  server: {
    handlers: {
      POST: async () => {
        try {
          const { syncMonitorNews } = await import("@/lib/monitor-news.server");
          const result = await syncMonitorNews("cron");
          return Response.json(result);
        } catch (e: any) {
          return new Response(JSON.stringify({ ok: false, message: String(e?.message ?? e) }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
