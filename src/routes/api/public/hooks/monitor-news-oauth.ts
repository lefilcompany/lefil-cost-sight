import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/monitor-news-oauth")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const err = url.searchParams.get("error");
        const appOrigin = url.origin;

        if (err) {
          return renderResult(false, `OAuth Monitor News negado: ${err}`, appOrigin);
        }
        if (!code || !state) {
          return renderResult(false, "Callback OAuth sem code/state", appOrigin);
        }
        try {
          const { completeOauthCallback } = await import("@/lib/monitor-news.server");
          await completeOauthCallback(state, code);
          return renderResult(true, "Monitor News conectado com sucesso.", appOrigin);
        } catch (e: any) {
          return renderResult(false, `Falha na conexão: ${e?.message ?? e}`, appOrigin);
        }
      },
    },
  },
});

function renderResult(ok: boolean, message: string, origin: string) {
  const target = `${origin}/settings?mn=${ok ? "ok" : "err"}`;
  const html = `<!doctype html><meta charset="utf-8"><title>Monitor News</title>
<body style="font-family:system-ui;padding:32px;max-width:520px;margin:auto">
<h2>${ok ? "✅ Conectado" : "⚠️ Falhou"}</h2>
<p>${escape(message)}</p>
<p><a href="${target}">Voltar para Configurações</a></p>
<script>setTimeout(function(){location.href=${JSON.stringify(target)}},1500)</script>
</body>`;
  return new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function escape(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
