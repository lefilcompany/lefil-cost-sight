import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Sparkles, Send, X, Loader2, RefreshCw, EyeOff } from "lucide-react";
import ReactMarkdown from "react-markdown";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { askAssistant } from "@/lib/gemini-ai.functions";
import { cn } from "@/lib/utils";

type Msg = { role: "user" | "model"; content: string };

const WELCOME: Msg = {
  role: "model",
  content:
    "Olá! Sou o assistente Quiwi com Gemini. Pergunte sobre custos, fornecedores, alertas ou tendências dos últimos 30 dias. Exemplos:\n\n- Quanto gastei com OpenAI este mês?\n- Quais fornecedores mais cresceram?\n- Explique meus alertas abertos.",
};

const HIDDEN_KEY = "quiwi.assistant.hidden";

export function GeminiAssistant() {
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([WELCOME]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const ask = useServerFn(askAssistant);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      setHidden(localStorage.getItem(HIDDEN_KEY) === "1");
    } catch {}
  }, []);

  function toggleHidden(next: boolean) {
    setHidden(next);
    if (next) setOpen(false);
    try {
      localStorage.setItem(HIDDEN_KEY, next ? "1" : "0");
    } catch {}
  }

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, open, loading]);

  async function send() {
    const text = input.trim();
    if (!text || loading) return;
    const next: Msg[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    setLoading(true);
    try {
      const res: any = await ask({ data: { messages: next.filter((m) => m !== WELCOME) } });
      setMessages([...next, { role: "model", content: res.reply }]);
    } catch (e: any) {
      setMessages([...next, { role: "model", content: `⚠️ ${e?.message ?? "Erro ao consultar o Gemini"}` }]);
    } finally {
      setLoading(false);
    }
  }

  if (hidden) {
    return (
      <button
        onClick={() => toggleHidden(false)}
        className="fixed bottom-3 right-3 z-40 grid h-8 w-8 place-items-center rounded-full border border-border/60 bg-background/80 text-muted-foreground shadow-sm backdrop-blur transition hover:text-foreground"
        aria-label="Mostrar assistente Gemini"
        title="Mostrar assistente"
      >
        <Sparkles className="h-3.5 w-3.5" />
      </button>
    );
  }

  return (
    <>
      <div className="fixed bottom-5 right-5 z-40 flex items-center gap-1.5">
        <button
          onClick={() => toggleHidden(true)}
          className="grid h-8 w-8 place-items-center rounded-full border border-border/60 bg-background/90 text-muted-foreground shadow-sm transition hover:text-foreground"
          aria-label="Esconder assistente"
          title="Esconder assistente"
        >
          <EyeOff className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex h-12 items-center gap-2 rounded-full bg-[color:var(--color-gold)] px-4 text-sm font-semibold text-[color:var(--color-gold-foreground)] shadow-lg transition hover:brightness-110"
          aria-label="Assistente Gemini"
        >
          <Sparkles className="h-4 w-4" />
          {open ? "Fechar assistente" : "Assistente IA"}
        </button>
      </div>


      {open && (
        <div className="fixed bottom-20 right-5 z-40 flex h-[560px] w-[min(420px,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-2xl border border-border/70 bg-background shadow-2xl">
          <header className="flex items-center gap-2 border-b border-border/70 bg-muted/40 px-4 py-3">
            <div className="grid h-8 w-8 place-items-center rounded-full gradient-emerald text-[color:var(--color-gold)]">
              <Sparkles className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-display text-sm font-semibold">Assistente Quiwi</p>
              <p className="truncate text-[11px] text-muted-foreground">Gemini · dados dos últimos 30 dias</p>
            </div>
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setMessages([WELCOME])} title="Limpar conversa">
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setOpen(false)}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </header>

          <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto p-4">
            {messages.map((m, i) => (
              <div
                key={i}
                className={cn(
                  "max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed",
                  m.role === "user"
                    ? "ml-auto bg-[color:var(--color-gold)] text-[color:var(--color-gold-foreground)]"
                    : "bg-muted/60 text-foreground",
                )}
              >
                <div className="prose prose-sm max-w-none dark:prose-invert prose-p:my-1 prose-ul:my-1 prose-li:my-0">
                  <ReactMarkdown>{m.content}</ReactMarkdown>
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Pensando...
              </div>
            )}
          </div>

          <form
            className="flex items-end gap-2 border-t border-border/70 bg-background p-3"
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder="Pergunte sobre custos, fornecedores, alertas..."
              className="min-h-[44px] resize-none text-sm"
              rows={1}
            />
            <Button type="submit" size="icon" className="h-10 w-10 shrink-0" disabled={loading || !input.trim()}>
              <Send className="h-4 w-4" />
            </Button>
          </form>
        </div>
      )}
    </>
  );
}
