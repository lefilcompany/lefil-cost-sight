import { createFileRoute } from "@tanstack/react-router";
import { authorizeCronRequest } from "@/lib/cron-auth.server";

export const Route = createFileRoute("/api/public/cron/rotate-api-keys")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const denied = await authorizeCronRequest(request);
        if (denied) return denied;

        const { rotateDueApiKeys } = await import("@/lib/api-keys-rotation.server");
        try {
          const result = await rotateDueApiKeys();
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
