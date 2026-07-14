## Objetivo

Trocar a fonte oficial da cotação USD→BRL para a **AwesomeAPI** (`https://economia.awesomeapi.com.br/json/last/USD-BRL`) e garantir que **todos** os custos exibidos em BRL usem uma cotação essencialmente em tempo real, com atualização automática e sem quebrar o override manual existente.

## Situação atual (o que já existe)

- A cotação é lida de `system_settings.usd_brl_rate` (`{ rate, updated_at, manual? }`).
- Hoje a **fonte primária é o Banco Central (BCB)** e a AwesomeAPI é só fallback.
- O refresh automático roda **mensalmente** via `pg_cron` no endpoint `/api/public/hooks/update-usd-rate`.
- A lógica de buscar/cachear a cotação está **duplicada** em 5 lugares: `src/lib/sync.server.ts`, `src/lib/sync.functions.ts`, `src/lib/billing.server.ts`, `src/lib/monitor-news.server.ts`, `src/routes/api/public/hooks/update-usd-rate.ts` (e leituras avulsas em `gemini-ai.functions.ts`).
- O override manual em Configurações (`manual: true`) precisa continuar sendo respeitado.

## O que vai mudar

1. **Fonte primária = AwesomeAPI**, BCB vira fallback (se AwesomeAPI falhar).
2. **Cache curto com refresh sob demanda ("quase tempo real")**: toda leitura de custo passa a chamar um helper único que:
   - Se `manual = true` → usa o valor fixo salvo pelo admin.
   - Senão, se `updated_at` tem menos de **15 min** → usa o cache do `system_settings`.
   - Senão, busca AwesomeAPI (fallback BCB), grava em `system_settings` e retorna.
   - Se todas as fontes falharem, usa o último valor conhecido (não quebra a UI).
3. **Cron horário** substitui o mensal como "rede de segurança", para o cache nunca ficar frio quando ninguém abrir o app.
4. **Deduplicação**: um único helper (`src/lib/usd-rate.server.ts`) usado por sync, billing, monitor-news, gemini e o endpoint público.
5. **UI de Configurações**: mostrar a fonte atual (AwesomeAPI/BCB/manual) e o horário da última atualização.

## Detalhes técnicos

- **Novo arquivo `src/lib/usd-rate.server.ts`** expondo:
  - `getUsdBrlRate(): Promise<{ rate: number; source: "awesomeapi" | "bcb" | "manual" | "cache"; updated_at: string }>`
  - `refreshUsdBrlRate(force?: boolean)` usado pelo cron e por um botão "Atualizar agora" em Configurações.
- **Refatorar** os 5 pontos listados para importar esse helper (remover as funções `fetchUsdBrlRate*` locais).
- **Endpoint `/api/public/hooks/update-usd-rate`**: passa a chamar `refreshUsdBrlRate(true)` e retornar `{ rate, source }`.
- **pg_cron**: atualizar o job existente para rodar **de hora em hora** (`0 * * * *`) em vez de mensal.
- **Settings UI (`src/routes/_authenticated/settings.tsx`)**: adicionar linha "Fonte: AwesomeAPI · atualizado há X min" + botão "Atualizar agora" (chama a server function que executa `refreshUsdBrlRate(true)`).
- **Manual override**: continua funcionando exatamente igual — se o admin marcar `manual`, nem AwesomeAPI nem cron sobrescrevem.

## Fora do escopo

- Não recalcular retroativamente `cost_brl` já persistido em `cost_entries` (usam a cotação do dia do sync — isso é intencional). A cotação em tempo real vale para os **próximos syncs** e para qualquer conversão feita na hora da exibição.
- Não trocar a AwesomeAPI por plano pago / token — usamos o endpoint público gratuito.