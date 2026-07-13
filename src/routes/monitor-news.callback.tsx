import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { completeMonitorNewsOAuth } from "@/lib/monitor-news.functions";

export const Route = createFileRoute("/monitor-news/callback")({
  head: () => ({ meta: [{ title: "Monitor News — Conectando..." }] }),
  component: CallbackPage,
});

function CallbackPage() {
  const [status, setStatus] = useState<"processing" | "ok" | "error">("processing");
  const [message, setMessage] = useState<string>("Finalizando conexão...");

  useEffect(() => {
    const url = new URL(window.location.href);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const err = url.searchParams.get("error_description") ?? url.searchParams.get("error");
    if (err) {
      setStatus("error");
      setMessage(err);
      window.opener?.postMessage(
        { type: "monitor-news-oauth", ok: false, error: err },
        window.location.origin,
      );
      return;
    }
    if (!code || !state) {
      setStatus("error");
      setMessage("Parâmetros ausentes.");
      window.opener?.postMessage(
        { type: "monitor-news-oauth", ok: false, error: "Parâmetros ausentes" },
        window.location.origin,
      );
      return;
    }
    completeMonitorNewsOAuth({ data: { code, state } })
      .then(() => {
        setStatus("ok");
        setMessage("Conectado! Você pode fechar esta janela.");
        window.opener?.postMessage(
          { type: "monitor-news-oauth", ok: true },
          window.location.origin,
        );
        setTimeout(() => window.close(), 800);
      })
      .catch((e: Error) => {
        setStatus("error");
        setMessage(e.message);
        window.opener?.postMessage(
          { type: "monitor-news-oauth", ok: false, error: e.message },
          window.location.origin,
        );
      });
  }, []);

  return (
    <div className="grid min-h-screen place-items-center bg-background p-6">
      <div className="max-w-md space-y-2 text-center">
        <h1 className="text-lg font-semibold">
          {status === "processing" && "Conectando ao Monitor News..."}
          {status === "ok" && "Conectado!"}
          {status === "error" && "Falha ao conectar"}
        </h1>
        <p className="text-sm text-muted-foreground">{message}</p>
      </div>
    </div>
  );
}
