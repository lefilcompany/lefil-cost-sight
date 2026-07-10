// Chamadas ao Gemini via API Key própria (Google AI Studio).
// Mantido server-side para nunca expor GEMINI_API_KEY ao browser.

const MODEL = "gemini-2.5-flash";
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

type Msg = { role: "user" | "model"; content: string };

export async function callGemini(opts: {
  system?: string;
  messages: Msg[];
  temperature?: number;
  maxOutputTokens?: number;
}): Promise<string> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY não configurada");

  const body = {
    systemInstruction: opts.system
      ? { role: "system", parts: [{ text: opts.system }] }
      : undefined,
    contents: opts.messages.map((m) => ({
      role: m.role,
      parts: [{ text: m.content }],
    })),
    generationConfig: {
      temperature: opts.temperature ?? 0.4,
      maxOutputTokens: opts.maxOutputTokens ?? 1024,
    },
  };

  const res = await fetch(`${ENDPOINT}?key=${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Gemini ${res.status}: ${txt.slice(0, 400)}`);
  }
  const json: any = await res.json();
  const text = json?.candidates?.[0]?.content?.parts
    ?.map((p: any) => p?.text ?? "")
    .join("")
    .trim();
  return text || "(sem resposta)";
}
