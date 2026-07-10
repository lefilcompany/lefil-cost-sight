import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Sparkles, RefreshCw, Loader2 } from "lucide-react";
import ReactMarkdown from "react-markdown";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { summarizeCosts } from "@/lib/gemini-ai.functions";

export function GeminiSummaryCard() {
  const run = useServerFn(summarizeCosts);
  const mutation = useMutation({
    mutationFn: async () => {
      const res: any = await run();
      return res as { summary: string; generated_at: string };
    },
  });

  return (
    <Card className="surface-elevated">
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
        <div className="flex items-center gap-2">
          <div className="grid h-8 w-8 place-items-center rounded-full gradient-emerald text-[color:var(--color-gold)]">
            <Sparkles className="h-4 w-4" />
          </div>
          <div>
            <CardTitle className="font-display text-base">Resumo IA (Gemini)</CardTitle>
            <p className="text-[11px] text-muted-foreground">Análise executiva dos últimos 30 dias</p>
          </div>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-8 gap-1.5"
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending}
        >
          {mutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          {mutation.data ? "Atualizar" : "Gerar"}
        </Button>
      </CardHeader>
      <CardContent>
        {mutation.isPending && !mutation.data && (
          <p className="text-sm text-muted-foreground">Analisando dados...</p>
        )}
        {mutation.isError && (
          <p className="text-sm text-red-500">
            ⚠️ {(mutation.error as any)?.message ?? "Falha ao gerar resumo"}
          </p>
        )}
        {!mutation.data && !mutation.isPending && !mutation.isError && (
          <p className="text-sm text-muted-foreground">
            Clique em "Gerar" para receber um resumo executivo automático dos seus custos.
          </p>
        )}
        {mutation.data && (
          <div className="prose prose-sm max-w-none dark:prose-invert prose-p:my-1 prose-ul:my-1">
            <ReactMarkdown>{mutation.data.summary}</ReactMarkdown>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
